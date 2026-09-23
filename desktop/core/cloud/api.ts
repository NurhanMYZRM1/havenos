import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import type {
  CloudAction,
  CloudBackupWire,
  CloudErrorBody,
  EntitlementWire,
  StartUploadRequest,
  StartUploadResponse,
} from "../../../supabase/functions/_shared/protocol";
import { AppError } from "../errors";

/** Public client configuration — the project URL and publishable (anon) key. */
export interface CloudConfig {
  url: string;
  anonKey: string;
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}

function cloudError(status: number, body: unknown): AppError {
  const err = (body as CloudErrorBody | null)?.error;
  const message = err?.message ?? `Cloud service error (${status}).`;
  switch (err?.code) {
    case "unauthorized":
      return new AppError("CLOUD_AUTH", "cloud.errors.auth", { message });
    case "not_entitled":
      return new AppError("CLOUD_ENTITLEMENT", "cloud.errors.entitlement", { message });
    case "billing_not_configured":
      return new AppError("CLOUD_NOT_CONFIGURED", "cloud.errors.billingNotConfigured", { message });
    default:
      if (status === 401) return new AppError("CLOUD_AUTH", "cloud.errors.auth", { message });
      if (status === 402 || status === 403) return new AppError("CLOUD_ENTITLEMENT", "cloud.errors.entitlement", { message });
      return new AppError("CLOUD_SERVER", "cloud.errors.server", { params: { message }, message });
  }
}

function networkError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  return new AppError("CLOUD_NETWORK", "cloud.errors.network", { params: { message }, message });
}

/**
 * HTTP client for Supabase Auth (email one-time codes) and the HavenOS
 * `cloud` edge function. Runs only in the desktop main process; tokens never
 * reach the UI.
 */
export class CloudApi {
  constructor(private readonly config: CloudConfig) {}

  private async json<T>(path: string, init: { method?: string; body?: unknown; token?: string }): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.config.url}${path}`, {
        method: init.method ?? "POST",
        headers: {
          apikey: this.config.anonKey,
          "content-type": "application/json",
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw networkError(err);
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      // Supabase Auth reports errors as { msg } / { error_description }.
      const auth = body as { msg?: string; error_description?: string; message?: string } | null;
      if (path.startsWith("/auth/")) {
        const message = auth?.msg ?? auth?.error_description ?? auth?.message ?? `Sign-in failed (${res.status}).`;
        throw new AppError("CLOUD_AUTH", "cloud.errors.signIn", { params: { message }, message });
      }
      throw cloudError(res.status, body);
    }
    return body as T;
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  async requestCode(email: string): Promise<void> {
    await this.json("/auth/v1/otp", { body: { email, create_user: true } });
  }

  private toSession(body: { access_token: string; refresh_token: string; expires_in: number; user?: { email?: string } }, fallbackEmail: string): CloudSession {
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      email: body.user?.email ?? fallbackEmail,
    };
  }

  async verifyCode(email: string, code: string): Promise<CloudSession> {
    const body = await this.json<{ access_token: string; refresh_token: string; expires_in: number; user?: { email?: string } }>(
      "/auth/v1/verify",
      { body: { type: "email", email, token: code } },
    );
    return this.toSession(body, email);
  }

  async refresh(session: Pick<CloudSession, "refreshToken" | "email">): Promise<CloudSession> {
    const body = await this.json<{ access_token: string; refresh_token: string; expires_in: number; user?: { email?: string } }>(
      "/auth/v1/token?grant_type=refresh_token",
      { body: { refresh_token: session.refreshToken } },
    );
    return this.toSession(body, session.email);
  }

  async signOut(accessToken: string): Promise<void> {
    await this.json("/auth/v1/logout", { token: accessToken }).catch(() => undefined);
  }

  // ── Cloud function ───────────────────────────────────────────────────────

  private call<T>(token: string, action: CloudAction, extra: Record<string, unknown> = {}): Promise<T> {
    return this.json<T>("/functions/v1/cloud", { token, body: { action, ...extra } });
  }

  entitlement(token: string) {
    return this.call<EntitlementWire>(token, "entitlement");
  }

  startUpload(token: string, req: Omit<StartUploadRequest, "action">) {
    return this.call<StartUploadResponse>(token, "start-upload", req);
  }

  completeUpload(token: string, backupId: string) {
    return this.call<{ ok: true }>(token, "complete-upload", { backupId });
  }

  list(token: string) {
    return this.call<{ backups: CloudBackupWire[] }>(token, "list");
  }

  downloadUrl(token: string, backupId: string) {
    return this.call<{ url: string; sha256: string; sizeBytes: number }>(token, "download", { backupId });
  }

  checkoutUrl(token: string, plan: "monthly" | "annual") {
    return this.call<{ url: string }>(token, "checkout", { plan });
  }

  portalUrl(token: string) {
    return this.call<{ url: string }>(token, "portal");
  }

  // ── Transfers with progress ──────────────────────────────────────────────

  upload(url: string, headers: Record<string, string>, file: string, onProgress: (done: number, total: number) => void): Promise<void> {
    const total = fs.statSync(file).size;
    const target = new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        target,
        { method: "PUT", headers: { ...headers, "content-length": String(total), "content-type": "application/gzip" }, timeout: 120_000 },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            if ((res.statusCode ?? 500) < 300) return resolve();
            let body: unknown = null;
            try {
              body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              /* not JSON */
            }
            reject(cloudError(res.statusCode ?? 500, body));
          });
        },
      );
      req.on("error", (err) => reject(networkError(err)));
      req.on("timeout", () => req.destroy(new Error("Upload timed out")));
      let done = 0;
      const stream = fs.createReadStream(file, { highWaterMark: 1 << 20 });
      stream.on("data", (chunk) => {
        done += chunk.length;
        onProgress(done, total);
      });
      stream.on("error", (err) => req.destroy(err));
      stream.pipe(req);
    });
  }

  download(url: string, dest: string, expectedBytes: number, onProgress: (done: number, total: number) => void): Promise<void> {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.get(target, { timeout: 120_000 }, (res) => {
        if ((res.statusCode ?? 500) >= 300) {
          res.resume();
          return reject(cloudError(res.statusCode ?? 500, null));
        }
        let done = 0;
        const out = fs.createWriteStream(dest, { flush: true });
        res.on("data", (c: Buffer) => {
          done += c.length;
          if (done > expectedBytes) req.destroy(new Error("Download is larger than expected"));
          onProgress(done, expectedBytes);
        });
        res.pipe(out);
        out.on("finish", () => (done === expectedBytes ? resolve() : reject(new AppError("CLOUD_NETWORK", "cloud.errors.incomplete"))));
        out.on("error", reject);
      });
      req.on("error", (err) => reject(networkError(err)));
      req.on("timeout", () => req.destroy(new Error("Download timed out")));
    });
  }
}
