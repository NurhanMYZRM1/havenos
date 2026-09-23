/**
 * Launches the built desktop app (dist-desktop + out/) with Playwright's
 * Electron driver, against a throwaway data folder. Used by the end-to-end
 * checks; never touches the real HavenOS data folder.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function tempDataDir(label = "havenos-e2e") {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

/** Start the app; returns { app, page, close }. */
export async function launch(dataDir, env = {}) {
  const app = await electron.launch({
    args: [ROOT],
    cwd: ROOT,
    env: { ...process.env, HAVENOS_DATA_DIR: dataDir, HAVENOS_FAKE_NOW: "2026-09-23T04:00:00.000Z", ...env },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return {
    app,
    page,
    close: async () => {
      await app.close();
    },
  };
}

/** Call the desktop API from the page, exactly as the UI does. */
export async function invoke(page, method, params) {
  const res = await page.evaluate(([m, p]) => window.havenos.invoke(m, p), [method, params ?? null]);
  if (!res.ok) throw new Error(`${method}: ${res.error.message}`);
  return res.data;
}

export async function shot(page, name) {
  const dir = path.join(ROOT, "desktop", "e2e", "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
  return path.join(dir, `${name}.png`);
}
