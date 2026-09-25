import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type WebContents, type WebFrameMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ApiEventName, ApiEvents, ApiResponse } from "../../lib/api/contract";
import type { CloudConfig } from "../core/cloud/api";
import { CloudService } from "../core/cloud/service";
import { toErrorShape } from "../core/errors";
import { createHandlers, type Handlers, type Platform } from "../core/handlers";
import { HttpFeedFetcher } from "../core/channels/fetcher";
import { ChannelScheduler } from "../core/channels/scheduler";
import { safeSyncDiagnostic } from "../core/channels/diagnostics";
import { Workspaces } from "../core/workspace";
import { electronImages } from "./images";
import { SafeStorageChannelSecrets } from "./channel-secrets";
import { buildMenu } from "./menu";
import { APP_ORIGIN, registerProtocols, registerSchemes } from "./protocols";
import { SafeStorageSecrets } from "./secrets";

const DEV_URL = !app.isPackaged ? process.env.HAVENOS_DEV_SERVER_URL?.replace(/\/+$/, "") || null : null;
const START_URL = DEV_URL ?? APP_ORIGIN;

// A stable data folder that survives app upgrades and renames:
//   macOS   ~/Library/Application Support/HavenOS
//   Windows %APPDATA%\HavenOS
app.setName("HavenOS");
app.setPath("userData", process.env.HAVENOS_DATA_DIR ? path.resolve(process.env.HAVENOS_DATA_DIR) : path.join(app.getPath("appData"), "HavenOS"));
// Day/month/year in native date fields, whatever the OS region.
app.commandLine.appendSwitch("lang", "en-GB");
registerSchemes();

function loadCloudConfig(): CloudConfig | null {
  if (process.env.HAVENOS_CLOUD_URL && process.env.HAVENOS_CLOUD_ANON_KEY && !app.isPackaged) {
    return { url: process.env.HAVENOS_CLOUD_URL.replace(/\/+$/, ""), anonKey: process.env.HAVENOS_CLOUD_ANON_KEY };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "cloud-config.json"), "utf8"));
    return raw && typeof raw.url === "string" && typeof raw.anonKey === "string" ? raw : null;
  } catch {
    return null;
  }
}

/** Only our own top-level page may call into main. */
function isTrusted(frame: WebFrameMain | null): boolean {
  if (!frame || frame.parent) return false;
  try {
    return new URL(frame.url).origin === new URL(START_URL).origin;
  } catch {
    return false;
  }
}

function broadcast<E extends ApiEventName>(event: E, payload: ApiEvents[E]) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(`havenos:event:${event}`, payload);
}

const WINDOW_STATE = () => path.join(app.getPath("userData"), "window-state.json");

function secureWebPreferences() {
  return {
    preload: path.join(__dirname, "..", "preload", "preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: true,
    navigateOnDragDrop: false,
  } as const;
}

function lockDown(contents: WebContents) {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== new URL(START_URL).origin) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

function createMainWindow(): BrowserWindow {
  let bounds: { width: number; height: number; x?: number; y?: number } = { width: 1360, height: 880 };
  try {
    bounds = { ...bounds, ...JSON.parse(fs.readFileSync(WINDOW_STATE(), "utf8")) };
  } catch {
    /* first run */
  }
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0b0b0d",
    title: "HavenOS",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: secureWebPreferences(),
  });
  lockDown(win.webContents);
  win.once("ready-to-show", () => win.show());
  win.on("close", () => {
    try {
      fs.writeFileSync(WINDOW_STATE(), JSON.stringify(win.getNormalBounds()));
    } catch {
      /* not critical */
    }
  });
  void win.loadURL(`${START_URL}/dashboard/`);
  return win;
}

/** Render the receipt page off-screen and print it to PDF. */
async function receiptPdf(paymentId: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: secureWebPreferences() });
  lockDown(win.webContents);
  try {
    await win.loadURL(`${START_URL}/receipt/?id=${encodeURIComponent(paymentId)}&print=1`);
    const started = Date.now();
    while (!(await win.webContents.executeJavaScript("document.documentElement.dataset.receiptReady === '1'"))) {
      if (Date.now() - started > 15_000) throw new Error("The receipt took too long to prepare.");
      await new Promise((r) => setTimeout(r, 100));
    }
    return await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
  } finally {
    win.destroy();
  }
}

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

const FILTERS = {
  photo: [{ name: "Photos", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
  document: [{ name: "Documents and photos", extensions: ["pdf", "jpg", "jpeg", "png", "webp", "gif", "heic", "docx", "xlsx", "pptx", "txt", "csv"] }],
  receipt: [{ name: "Receipts", extensions: ["pdf", "jpg", "jpeg", "png", "webp", "heic"] }],
};

function createPlatform(): Platform {
  return {
    name: process.platform,
    isPackaged: app.isPackaged,
    async pickFiles(purpose) {
      const win = focusedWindow();
      const opts = { properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[], filters: FILTERS[purpose] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : r.filePaths;
    },
    async pickImportFile() {
      const win = focusedWindow();
      const opts = { properties: ["openFile"] as "openFile"[], filters: [{ name: "CSV", extensions: ["csv"] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    async saveFile(defaultName, filter) {
      const win = focusedWindow();
      const opts = { defaultPath: path.join(app.getPath("documents"), defaultName), filters: [filter] };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    async pickFolder() {
      const win = focusedWindow();
      const opts = { properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    async pickBackup() {
      const win = focusedWindow();
      const opts = { properties: ["openFile"] as "openFile"[], filters: [{ name: "HavenOS backup", extensions: ["havenos-backup"] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    async openPath(target) {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    },
    showInFolder: (target) => shell.showItemInFolder(target),
    openExternal: (url) => shell.openExternal(url),
    receiptPdf,
    emit: broadcast,
  };
}

function registerIpc(handlers: Handlers) {
  ipcMain.handle("havenos:invoke", async (event, method: unknown, params: unknown): Promise<ApiResponse<unknown>> => {
    if (!isTrusted(event.senderFrame)) return { ok: false, error: { code: "NOT_ALLOWED", message: "Request from an untrusted page." } };
    if (typeof method !== "string" || !Object.prototype.hasOwnProperty.call(handlers, method)) {
      return { ok: false, error: { code: "NOT_ALLOWED", message: "Unknown request." } };
    }
    try {
      const data = await handlers[method as keyof Handlers](params);
      return { ok: true, data };
    } catch (err) {
      const shape = toErrorShape(err);
      if (shape.code === "INTERNAL") console.error(`[havenos] ${method} failed:`, safeSyncDiagnostic(err));
      return { ok: false, error: shape };
    }
  });
}

function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

async function main() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on("web-contents-created", (_e, contents) => lockDown(contents));

  await app.whenReady();
  const rootDir = app.getPath("userData");
  // Deterministic "today" for automated checks only; ignored in installed builds.
  const fakeNow = !app.isPackaged && process.env.HAVENOS_FAKE_NOW ? new Date(process.env.HAVENOS_FAKE_NOW) : null;
  let workspaces: Workspaces;
  try {
    workspaces = new Workspaces({ rootDir, appVersion: app.getVersion(), images: electronImages, now: fakeNow ? () => fakeNow : undefined });
  } catch (err) {
    dialog.showErrorBox("HavenOS can't open your records", `${err instanceof Error ? err.message : String(err)}\n\nData folder: ${rootDir}`);
    app.exit(1);
    return;
  }
  const cloud = new CloudService({
    config: loadCloudConfig(),
    secrets: new SafeStorageSecrets(path.join(rootDir, "cloud-session.bin")),
    stateFile: path.join(rootDir, "cloud-state.json"),
    tempDir: path.join(rootDir, ".cloud-tmp"),
    workspaces,
    emitProgress: (p) => broadcast("cloud-progress", p),
    openExternal: (url) => shell.openExternal(url),
  });
  hardenSession();
  // An old web-mode permanent redirect can oppose Next's trailing-slash
  // redirect. Clear only dev HTTP cache, before the first navigation.
  if (DEV_URL) await session.defaultSession.clearCache();
  registerProtocols(path.join(app.getAppPath(), "out"), workspaces);
  // Calendar feeds: read shortly after launch, then every 20 minutes while open. Links live in the OS credential store.
  const channels = new ChannelScheduler({
    workspaces,
    secrets: new SafeStorageChannelSecrets(path.join(rootDir, "channel-feeds.bin")),
    fetcher: new HttpFeedFetcher({ appVersion: app.getVersion() }),
    emit: broadcast,
  });
  registerIpc(createHandlers(workspaces, createPlatform(), cloud, channels));
  Menu.setApplicationMenu(buildMenu({ isDev: !!DEV_URL || !app.isPackaged, send: (command) => broadcast("menu-command", { command }), openDataFolder: () => void shell.openPath(workspaces.current.dir) }));
  createMainWindow();
  channels.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    channels.stop();
    workspaces.close();
  });
}

void main();
