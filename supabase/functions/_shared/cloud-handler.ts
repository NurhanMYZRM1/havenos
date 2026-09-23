/**
 * The `cloud` edge function's logic, written against small ports so it can be
 * tested without Supabase or Stripe (see cloud-handler.test.ts). The Deno
 * entry point (../cloud/index.ts) wires the real implementations.
 *
 * Every action authenticates the caller and every data action re-checks the
 * entitlement on the server. The desktop app's own state is never trusted.
 */
import { evaluateEntitlement, type EntitlementRow } from "./entitlement.ts";
import { CLOUD_BACKUPS_KEPT, MAX_CLOUD_BACKUP_BYTES, type CloudBackupWire, type CloudErrorCode } from "./protocol.ts";

export interface BackupRecord {
  id: string;
  user_id: string;
  object_path: string;
  size_bytes: number;
  sha256: string;
  app_version: string;
  schema_version: number;
  counts: Record<string, number>;
  status: "pending" | "available";
  created_at: string;
}

export interface CloudPorts {
  now(): Date;
  /** Resolve a Supabase access token to a user id, or null. */
  userFromToken(token: string): Promise<{ id: string; email: string | null } | null>;
  getEntitlement(userId: string): Promise<EntitlementRow | null>;
  insertBackup(row: BackupRecord): Promise<void>;
  getBackup(userId: string, id: string): Promise<BackupRecord | null>;
  listBackups(userId: string): Promise<BackupRecord[]>;
  markAvailable(id: string): Promise<void>;
  deleteBackup(row: BackupRecord): Promise<void>;
  signedUploadUrl(path: string): Promise<{ url: string; headers: Record<string, string> }>;
  signedDownloadUrl(path: string): Promise<string>;
  /** Size of the stored object, or null if it isn't there. */
  objectSize(path: string): Promise<number | null>;
  billing: {
    configured(): boolean;
    checkoutUrl(user: { id: string; email: string | null }, plan: "monthly" | "annual"): Promise<string>;
    portalUrl(userId: string): Promise<string | null>;
  };
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

const error = (status: number, code: CloudErrorCode, message: string): HandlerResult => ({ status, body: { error: { code, message } } });
const ok = (body: unknown): HandlerResult => ({ status: 200, body });

export async function handleCloud(authorization: string | null, rawBody: unknown, ports: CloudPorts): Promise<HandlerResult> {
  const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const user = token ? await ports.userFromToken(token) : null;
  if (!user) return error(401, "unauthorized", "Please sign in again.");

  const body = (rawBody ?? {}) as Record<string, unknown>;
  const entitlement = evaluateEntitlement(await ports.getEntitlement(user.id), ports.now());
  const notEntitled = () => error(402, "not_entitled", "Cloud backup needs an active subscription. Your local records are unaffected.");

  switch (body.action) {
    case "entitlement":
      return ok(entitlement);

    case "start-upload": {
      if (!entitlement.canUpload) return notEntitled();
      const size = Number(body.sizeBytes);
      const sha = String(body.sha256 ?? "");
      if (!Number.isSafeInteger(size) || size <= 0 || !/^[0-9a-f]{64}$/.test(sha)) return error(400, "invalid_request", "Invalid backup details.");
      if (size > MAX_CLOUD_BACKUP_BYTES) return error(413, "too_large", "This backup is larger than the cloud limit (2 GB).");
      const id = crypto.randomUUID();
      const path = `${user.id}/${id}.havenos-backup`;
      const counts = typeof body.counts === "object" && body.counts ? (body.counts as Record<string, number>) : {};
      await ports.insertBackup({
        id,
        user_id: user.id,
        object_path: path,
        size_bytes: size,
        sha256: sha,
        app_version: String(body.appVersion ?? "").slice(0, 40),
        schema_version: Number(body.schemaVersion) || 0,
        counts,
        status: "pending",
        created_at: ports.now().toISOString(),
      });
      const signed = await ports.signedUploadUrl(path);
      return ok({ backupId: id, uploadUrl: signed.url, headers: signed.headers });
    }

    case "complete-upload": {
      if (!entitlement.canUpload) return notEntitled();
      const row = await ports.getBackup(user.id, String(body.backupId ?? ""));
      if (!row || row.status !== "pending") return error(404, "not_found", "No such upload.");
      const size = await ports.objectSize(row.object_path);
      if (size !== row.size_bytes) {
        await ports.deleteBackup(row);
        return error(400, "invalid_request", "The upload didn't arrive complete. Please try again.");
      }
      await ports.markAvailable(row.id);
      // Keep only the most recent backups.
      const available = (await ports.listBackups(user.id)).filter((b) => b.status === "available").sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      for (const old of available.slice(CLOUD_BACKUPS_KEPT)) await ports.deleteBackup(old);
      return ok({ ok: true });
    }

    case "list": {
      if (!entitlement.canDownload) return notEntitled();
      const backups: CloudBackupWire[] = (await ports.listBackups(user.id))
        .filter((b) => b.status === "available")
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .map((b) => ({ id: b.id, createdAt: b.created_at, sizeBytes: b.size_bytes, appVersion: b.app_version, counts: b.counts }));
      return ok({ backups });
    }

    case "download": {
      if (!entitlement.canDownload) return notEntitled();
      const row = await ports.getBackup(user.id, String(body.backupId ?? ""));
      if (!row || row.status !== "available") return error(404, "not_found", "No such backup.");
      return ok({ url: await ports.signedDownloadUrl(row.object_path), sha256: row.sha256, sizeBytes: row.size_bytes });
    }

    case "checkout": {
      if (!ports.billing.configured()) return error(503, "billing_not_configured", "Billing isn't set up on the server yet.");
      const plan = body.plan === "annual" ? "annual" : body.plan === "monthly" ? "monthly" : null;
      if (!plan) return error(400, "invalid_request", "Unknown plan.");
      return ok({ url: await ports.billing.checkoutUrl(user, plan) });
    }

    case "portal": {
      if (!ports.billing.configured()) return error(503, "billing_not_configured", "Billing isn't set up on the server yet.");
      const url = await ports.billing.portalUrl(user.id);
      return url ? ok({ url }) : error(404, "not_found", "No billing account yet.");
    }

    default:
      return error(400, "invalid_request", "Unknown action.");
  }
}
