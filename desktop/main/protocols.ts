import { protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { resolveAttachmentFile } from "../core/services/attachments";
import type { Workspaces } from "../core/workspace";

export const APP_ORIGIN = "app://havenos";

/**
 * Content Security Policy for the packaged UI. Everything is local: no
 * remote scripts, styles, fonts, images or network calls from the page
 * (cloud requests happen in the main process). Inline scripts are needed
 * by Next.js's static export.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: havenos-file:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' havenos-file:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
};

/** Must run before app `ready`. */
export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
    { scheme: "havenos-file", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

function resolveStatic(outDir: string, pathname: string): { file: string; status: number } {
  const rel = decodeURIComponent(pathname);
  const candidate = path.normalize(path.join(outDir, rel));
  if (candidate !== outDir && !candidate.startsWith(outDir + path.sep)) return { file: path.join(outDir, "404.html"), status: 404 };
  const tries = path.extname(candidate)
    ? [candidate]
    : [path.join(candidate, "index.html"), `${candidate}.html`];
  for (const f of tries) {
    try {
      if (fs.statSync(f).isFile()) return { file: f, status: 200 };
    } catch {
      /* try next */
    }
  }
  return { file: path.join(outDir, "404.html"), status: 404 };
}

/**
 * `app://havenos/…` serves the static UI from the packaged `out/` folder —
 * no development server and no localhost port in installed builds.
 * `havenos-file://attachment/<id>` serves attachment bytes looked up by id,
 * so the page can never name an arbitrary path on disk.
 */
export function registerProtocols(outDir: string, workspaces: Workspaces) {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "havenos") return new Response("Not found", { status: 404 });
    const { file, status } = resolveStatic(outDir, url.pathname);
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, {
        status,
        headers: {
          "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
          "content-security-policy": CSP,
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  protocol.handle("havenos-file", async (request) => {
    const url = new URL(request.url);
    const id = url.pathname.replace(/^\//, "");
    if ((url.host !== "attachment" && url.host !== "thumb") || !/^[0-9a-f-]{36}$/.test(id)) {
      return new Response("Not found", { status: 404 });
    }
    const resolved = resolveAttachmentFile(workspaces.current, id, url.host === "thumb");
    if (!resolved) return new Response("Not found", { status: 404 });
    try {
      const body = await fs.promises.readFile(resolved.path);
      return new Response(body, {
        headers: {
          "content-type": resolved.mime,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
