// Runs the desktop app's core (../desktop/core) on the phone: same schema,
// migrations, validation and services, on expo-sqlite. Screens call
// `invokeCore(method, params)` exactly like the desktop UI calls
// `window.havenos.invoke` over Electron IPC.
import { Directory, File, Paths } from "expo-file-system";
import { Buffer } from "buffer";
import Constants from "expo-constants";
import { ApiError } from "@/lib/api/client";
import type { ApiErrorShape, ApiMethod, ApiParams, ApiResult } from "@/lib/api/contract";
import { HttpFeedFetcher } from "@/desktop/core/channels/fetcher";
import { ChannelScheduler } from "@/desktop/core/channels/scheduler";
import { CloudService, MemorySecretStore } from "@/desktop/core/cloud/service";
import { toErrorShape } from "@/desktop/core/errors";
import { createHandlers, type Handlers } from "@/desktop/core/handlers";
import { resolveAttachmentFile } from "@/desktop/core/services/attachments";
import { Workspaces } from "@/desktop/core/workspace";
import { bumpDataVersion, currentDataVersion, emitCoreEvent } from "./events";
import { mobileImages } from "./photos";
import { createMobilePlatform, flushPendingShares, SecureStoreChannelSecrets, toPath } from "./platform";

/** Calls that only read. Anything else may change records and refreshes every open screen. */
const READS = new Set<string>([
  "app.info", "app.now", "settings.get", "properties.list", "properties.get", "spaces.options", "drafts.current",
  "tenants.list", "tenants.get", "tenancies.list", "tenancies.get", "rent.month", "rent.receipt",
  "maintenance.list", "maintenance.get", "attachments.list", "dashboard.summary", "search.query",
  "backup.listSafety", "cloud.status", "cloud.list", "channels.list", "channels.get", "channels.pendingBlocks",
  "reservations.list", "reservations.get", "blocks.list", "blocks.get", "turnovers.list", "turnovers.get",
  "stays.day", "stays.calendar", "stays.alerts", "stays.performance", "ledger.list",
]);

interface Host {
  workspaces: Workspaces;
  handlers: Handlers;
  channels: ChannelScheduler;
}

let host: Host | null = null;
let startupError: Error | null = null;

const appVersion = Constants.expoConfig?.version ?? "0.0.0";

export function dataRoot(): string {
  const dir = new Directory(Paths.document, "HavenOS");
  dir.create({ intermediates: true, idempotent: true });
  return toPath(dir.uri).replace(/\/$/, "");
}

function start(): Host {
  const rootDir = dataRoot();
  const workspaces = new Workspaces({ rootDir, appVersion, images: mobileImages });
  const cloud = new CloudService({
    // Cloud backup ships in the desktop app first; on mobile it reports "not available".
    config: null,
    secrets: new MemorySecretStore(),
    stateFile: `${rootDir}/cloud-state.json`,
    tempDir: `${rootDir}/.cloud-tmp`,
    workspaces,
    emitProgress: (p) => emitCoreEvent("cloud-progress", p),
    openExternal: async () => undefined,
  });
  const channels = new ChannelScheduler({
    workspaces,
    secrets: new SecureStoreChannelSecrets(),
    fetcher: new HttpFeedFetcher({ appVersion }),
    emit: emitCoreEvent,
  });
  const handlers = createHandlers(workspaces, createMobilePlatform(), cloud, channels);
  channels.start();
  return { workspaces, handlers, channels };
}

export function core(): Host {
  if (host) return host;
  if (startupError) throw startupError;
  try {
    host = start();
    return host;
  } catch (err) {
    startupError = err instanceof Error ? err : new Error(String(err));
    throw startupError;
  }
}

// ── Attachment URLs ─────────────────────────────────────────────────────────
// The desktop serves photos over a private havenos-file: protocol. A webview
// can't, so images are inlined as data URLs (photos are resized on import).

const ATTACHMENT_URL = /^havenos-file:\/\/(attachment|thumb)\/([A-Za-z0-9_-]{1,64})$/;
const inlined = new Map<string, string>();

function inlineAttachment(url: string): string {
  const m = ATTACHMENT_URL.exec(url);
  if (!m) return url;
  const hit = inlined.get(url);
  if (hit) return hit;
  const file = resolveAttachmentFile(core().workspaces.current, m[2], m[1] === "thumb");
  if (!file || !file.mime.startsWith("image/") || file.mime === "image/heic") return url;
  const bytes = new File(`file://${encodeURI(file.path)}`).bytesSync();
  const data = `data:${file.mime};base64,${Buffer.from(bytes).toString("base64")}`;
  if (inlined.size > 300) inlined.delete(inlined.keys().next().value!);
  inlined.set(url, data);
  return data;
}

function inlineAttachments(value: unknown): unknown {
  if (typeof value === "string") return value.startsWith("havenos-file://") ? inlineAttachment(value) : value;
  if (Array.isArray(value)) return value.map(inlineAttachments);
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = inlineAttachments(v);
    return out;
  }
  return value;
}

// ── Calls ───────────────────────────────────────────────────────────────────

export type CoreResponse = { ok: true; data: unknown; version: number } | { ok: false; error: ApiErrorShape; version: number };

export async function invokeCore(method: string, params: unknown): Promise<CoreResponse> {
  try {
    const { handlers } = core();
    if (!Object.prototype.hasOwnProperty.call(handlers, method)) {
      return { ok: false, error: { code: "NOT_ALLOWED", message: "Unknown request." }, version: currentDataVersion() };
    }
    const data = await handlers[method as ApiMethod](params ?? null);
    await flushPendingShares();
    const version = READS.has(method) ? currentDataVersion() : bumpDataVersion();
    return { ok: true, data: inlineAttachments(data), version };
  } catch (err) {
    const error = toErrorShape(err);
    if (error.code === "INTERNAL") console.error(`[havenos] ${method} failed:`, err);
    return { ok: false, error, version: currentDataVersion() };
  }
}

/** Typed call for native screens. Throws the API error shape on failure. */
export async function call<M extends ApiMethod>(method: M, ...args: ApiParams<M> extends void ? [] : [ApiParams<M>]): Promise<ApiResult<M>> {
  const r = await invokeCore(method, args[0] ?? null);
  if (!r.ok) throw new ApiError(r.error);
  return r.data as ApiResult<M>;
}
