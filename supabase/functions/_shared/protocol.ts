/**
 * Wire protocol between the HavenOS desktop app and the `cloud` edge
 * function. Types only — imported by the desktop main process and by the
 * Deno function, so both sides agree on shapes.
 *
 * Every request carries the landlord's Supabase access token. The function
 * decides entitlement on the server from `cloud_entitlements`; the desktop
 * app never holds a "paid" flag that could unlock anything.
 */

export type CloudAction =
  | "entitlement"
  | "start-upload"
  | "complete-upload"
  | "list"
  | "download"
  | "checkout"
  | "portal";

export type EntitlementStatusWire = "none" | "active" | "grace" | "expired";

export interface EntitlementWire {
  status: EntitlementStatusWire;
  plan: string | null;
  currentPeriodEnd: string | null;
  canUpload: boolean;
  canDownload: boolean;
}

export interface StartUploadRequest {
  action: "start-upload";
  sizeBytes: number;
  sha256: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
}

export interface StartUploadResponse {
  backupId: string;
  /** Signed, single-object upload URL (HTTP PUT). */
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface CloudBackupWire {
  id: string;
  createdAt: string;
  sizeBytes: number;
  appVersion: string;
  counts: Record<string, number>;
}

export type CloudErrorCode =
  | "unauthorized"
  | "not_entitled"
  | "invalid_request"
  | "too_large"
  | "not_found"
  | "billing_not_configured"
  | "server_error";

export interface CloudErrorBody {
  error: { code: CloudErrorCode; message: string };
}

/** Largest single backup the service accepts (2 GiB). */
export const MAX_CLOUD_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;

/** Backups kept per account; older ones are pruned after a successful upload. */
export const CLOUD_BACKUPS_KEPT = 10;
