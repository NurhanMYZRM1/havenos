import { ChannelSyncError, type FeedFetcher } from "../integrations/channels";
import { safeSyncDiagnostic } from "./diagnostics";

/**
 * Reads a calendar feed over HTTPS from the main process.
 *
 * The link is a secret (Airbnb's `s=` token grants read access to the
 * calendar), so nothing here ever logs it or puts it in an error: failures
 * become a ChannelSyncError code with sanitized diagnostics.
 */

export const FEED_TIMEOUT_MS = 30_000;
export const FEED_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** A non-2xx response as a sync error code. */
export function statusError(status: number): ChannelSyncError {
  if (status === 404 || status === 410) return new ChannelSyncError("not_found", String(status));
  if (status === 401 || status === 403) return new ChannelSyncError("forbidden", String(status));
  if (status === 429) return new ChannelSyncError("rate_limited", "429");
  return new ChannelSyncError("http_error", String(status));
}

const TIMEOUT_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ETIMEDOUT"]);

function errorCode(err: unknown): string {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return "";
}

/** Map a thrown network error to a code and a diagnostic with all link secrets removed. */
function networkError(err: unknown, timedOut: boolean, url: string): ChannelSyncError {
  if (err instanceof ChannelSyncError) return err;
  const diagnostic = safeSyncDiagnostic(err, url);
  if (timedOut) return new ChannelSyncError("timeout", "", diagnostic);
  const code = errorCode(err);
  if (TIMEOUT_CODES.has(code)) return new ChannelSyncError("timeout", "", diagnostic);
  if (/^(ERR_TLS|CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED|ERR_SSL)/.test(code)) return new ChannelSyncError("http_error", "tls", diagnostic);
  return new ChannelSyncError("offline", "", diagnostic);
}

export interface HttpFeedFetcherOptions {
  appVersion?: string;
  /** For tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export class HttpFeedFetcher implements FeedFetcher {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(opts: HttpFeedFetcherOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.userAgent = `HavenOS/${opts.appVersion ?? "1"} (calendar sync; +https://havenos.co)`;
  }

  async fetch(url: string, opts: { timeoutMs: number; maxBytes: number }): Promise<{ status: number; body: string }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs);
    try {
      let current = url;
      for (let hop = 0; ; hop++) {
        let target: URL;
        try {
          target = new URL(current);
        } catch {
          throw new ChannelSyncError("http_error", "redirect");
        }
        if (target.protocol !== "https:") throw new ChannelSyncError("http_error", hop === 0 ? "not_https" : "redirect");
        let res: Response;
        try {
          res = await this.fetchImpl(target, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: { Accept: "text/calendar", "User-Agent": this.userAgent },
          });
        } catch (err) {
          throw networkError(err, timedOut, current);
        }
        if (res.status >= 300 && res.status < 400 && res.status !== 304) {
          const location = res.headers.get("location");
          await res.body?.cancel().catch(() => undefined);
          if (!location || hop >= MAX_REDIRECTS) throw new ChannelSyncError("http_error", "redirect");
          try {
            current = new URL(location, target).toString();
          } catch {
            throw new ChannelSyncError("http_error", "redirect");
          }
          continue;
        }
        if (res.status < 200 || res.status >= 300) {
          await res.body?.cancel().catch(() => undefined);
          throw statusError(res.status);
        }
        const length = Number(res.headers.get("content-length") ?? "");
        if (Number.isFinite(length) && length > opts.maxBytes) {
          await res.body?.cancel().catch(() => undefined);
          throw new ChannelSyncError("too_large");
        }
        const body = await this.readBody(res, opts.maxBytes, controller, () => timedOut, current);
        return { status: res.status, body };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async readBody(res: Response, maxBytes: number, controller: AbortController, timedOut: () => boolean, url: string): Promise<string> {
    if (!res.body) return "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          throw new ChannelSyncError("too_large");
        }
        chunks.push(value);
      }
    } catch (err) {
      throw networkError(err, timedOut(), url);
    }
    return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
  }
}
