import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BackupInspection, CloudBackupItem, CloudEntitlement, CloudProgress, CloudStatus } from "../../../lib/api/contract";
import { backupFileName, createBackup } from "../backup/archive";
import { AppError } from "../errors";
import type { Workspaces } from "../workspace";
import { CloudApi, type CloudConfig, type CloudSession } from "./api";
import { MAX_CLOUD_BACKUP_BYTES } from "../../../supabase/functions/_shared/protocol";

/** Encrypted-at-rest storage for the sign-in refresh token (OS keychain in the app). */
export interface SecretStore {
  readonly available: boolean;
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

interface CloudState {
  optedIn: boolean;
  optedInAt: string | null;
  optedInEmail: string | null;
  lastSuccessAt: string | null;
  lastAttempt: { at: string; ok: boolean; error: string | null } | null;
}

async function hashFile(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const EMPTY_STATE: CloudState = { optedIn: false, optedInAt: null, optedInEmail: null, lastSuccessAt: null, lastAttempt: null };

export interface CloudServiceOptions {
  config: CloudConfig | null;
  secrets: SecretStore;
  /** Where opt-in and last-backup status are kept (outside any workspace). */
  stateFile: string;
  tempDir: string;
  workspaces: Workspaces;
  emitProgress: (p: CloudProgress) => void;
  openExternal: (url: string) => Promise<void>;
  now?: () => Date;
}

/** Hosts a checkout / billing link from our server may open in the browser. */
const BILLING_HOSTS = [/^checkout\.stripe\.com$/, /^billing\.stripe\.com$/];

/**
 * Optional paid cloud backup. Everything here is additive: when the
 * subscription lapses, or the service is unreachable, local records,
 * local backup and export keep working untouched.
 */
export class CloudService {
  private readonly api: CloudApi | null;
  private session: CloudSession | null = null;
  private entitlement: CloudEntitlement | null = null;
  private entitlementError: string | null = null;
  private progress: CloudProgress | null = null;
  private running = false;
  private state: CloudState;

  constructor(private readonly opts: CloudServiceOptions) {
    this.api = opts.config ? new CloudApi(opts.config) : null;
    this.state = this.loadState();
    const saved = opts.secrets.available ? opts.secrets.read() : null;
    if (saved && this.api) {
      try {
        const parsed = JSON.parse(saved) as { refreshToken: string; email: string };
        if (parsed.refreshToken) this.session = { accessToken: "", refreshToken: parsed.refreshToken, expiresAt: 0, email: parsed.email };
      } catch {
        opts.secrets.clear();
      }
    }
  }

  private now() {
    return (this.opts.now ?? (() => new Date()))();
  }

  private loadState(): CloudState {
    try {
      return { ...EMPTY_STATE, ...JSON.parse(fs.readFileSync(this.opts.stateFile, "utf8")) };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  private saveState() {
    fs.mkdirSync(path.dirname(this.opts.stateFile), { recursive: true });
    fs.writeFileSync(`${this.opts.stateFile}.tmp`, JSON.stringify(this.state, null, 2));
    fs.renameSync(`${this.opts.stateFile}.tmp`, this.opts.stateFile);
  }

  private requireApi(): CloudApi {
    if (!this.api) throw new AppError("CLOUD_NOT_CONFIGURED", "cloud.errors.notConfigured");
    return this.api;
  }

  private persistSession(session: CloudSession) {
    this.session = session;
    if (this.opts.secrets.available) this.opts.secrets.write(JSON.stringify({ refreshToken: session.refreshToken, email: session.email }));
  }

  /** A fresh access token, refreshing (and re-persisting) when close to expiry. */
  private async token(): Promise<string> {
    const api = this.requireApi();
    if (!this.session) throw new AppError("CLOUD_AUTH", "cloud.errors.signedOut");
    if (this.session.accessToken && this.session.expiresAt - Date.now() > 60_000) return this.session.accessToken;
    try {
      this.persistSession(await api.refresh(this.session));
    } catch (err) {
      if (err instanceof AppError && err.code === "CLOUD_AUTH") this.forgetSession();
      throw err;
    }
    return this.session!.accessToken;
  }

  private forgetSession() {
    this.session = null;
    this.entitlement = null;
    this.opts.secrets.clear();
  }

  private async refreshEntitlement() {
    try {
      const e = await this.requireApi().entitlement(await this.token());
      this.entitlement = { ...e, checkedAt: this.now().toISOString() };
      this.entitlementError = null;
    } catch (err) {
      this.entitlementError = err instanceof Error ? err.message : String(err);
    }
  }

  async status(refresh = false): Promise<CloudStatus> {
    if (refresh && this.api && this.session) await this.refreshEntitlement();
    return {
      configured: !!this.api,
      credentialStorage: this.opts.secrets.available ? "os" : "unavailable",
      signedIn: !!this.session,
      email: this.session?.email ?? null,
      optedIn: this.state.optedIn && !!this.session && this.state.optedInEmail === this.session.email,
      optedInAt: this.state.optedInAt,
      entitlement: this.entitlement,
      entitlementError: this.entitlementError,
      lastSuccessAt: this.state.lastSuccessAt,
      lastAttempt: this.state.lastAttempt,
      progress: this.progress,
    };
  }

  async requestCode(email: string): Promise<CloudStatus> {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      throw new AppError("VALIDATION", "validation.invalidEmail", { fields: { email: "validation.invalidEmail" } });
    }
    await this.requireApi().requestCode(clean);
    return this.status();
  }

  async verifyCode(email: string, code: string): Promise<CloudStatus> {
    const clean = code.replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(clean)) throw new AppError("VALIDATION", "cloud.errors.codeFormat", { fields: { code: "cloud.errors.codeFormat" } });
    this.persistSession(await this.requireApi().verifyCode(email.trim().toLowerCase(), clean));
    await this.refreshEntitlement();
    return this.status();
  }

  async signOut(): Promise<CloudStatus> {
    if (this.api && this.session?.accessToken) await this.api.signOut(this.session.accessToken);
    this.forgetSession();
    this.state = { ...this.state, optedIn: false, optedInAt: null, optedInEmail: null };
    this.saveState();
    return this.status();
  }

  /** Explicit, recorded consent before anything is uploaded. */
  async setOptIn(optedIn: boolean, consent: boolean): Promise<CloudStatus> {
    if (optedIn) {
      if (!consent) throw new AppError("CLOUD_CONSENT", "cloud.errors.consent");
      if (!this.session) throw new AppError("CLOUD_AUTH", "cloud.errors.signedOut");
      this.state = { ...this.state, optedIn: true, optedInAt: this.now().toISOString(), optedInEmail: this.session.email };
    } else {
      this.state = { ...this.state, optedIn: false, optedInAt: null, optedInEmail: null };
    }
    this.saveState();
    return this.status();
  }

  private setProgress(p: CloudProgress | null) {
    this.progress = p;
    if (p) this.opts.emitProgress(p);
  }

  /**
   * Start a cloud backup in the background and return immediately; progress
   * arrives as `cloud-progress` events. The server re-checks the
   * subscription before issuing an upload URL.
   */
  async backupNow(): Promise<CloudStatus> {
    this.requireApi();
    if (!this.session) throw new AppError("CLOUD_AUTH", "cloud.errors.signedOut");
    if (!(await this.status()).optedIn) throw new AppError("CLOUD_CONSENT", "cloud.errors.consent");
    if (this.opts.workspaces.workspace !== "main") throw new AppError("NOT_ALLOWED", "errors.sampleNoBackup");
    if (this.running) return this.status();
    this.running = true;
    this.setProgress({ operation: "backup", phase: "preparing", bytesDone: 0, bytesTotal: 0, error: null });
    void this.runBackup().finally(() => {
      this.running = false;
    });
    return this.status();
  }

  /** Awaitable form, for tests. */
  async runBackup(): Promise<void> {
    const api = this.requireApi();
    fs.mkdirSync(this.opts.tempDir, { recursive: true });
    const file = path.join(this.opts.tempDir, backupFileName(this.now(), "cloud"));
    try {
      const summary = await createBackup(this.opts.workspaces.current, file, {
        onProgress: (done, total) => this.setProgress({ operation: "backup", phase: "preparing", bytesDone: done, bytesTotal: total, error: null }),
      });
      if (summary.sizeBytes > MAX_CLOUD_BACKUP_BYTES) throw new AppError("CLOUD_SERVER", "cloud.errors.tooLarge");
      const sha256 = await hashFile(file);
      const started = await api.startUpload(await this.token(), {
        sizeBytes: summary.sizeBytes,
        sha256,
        appVersion: summary.appVersion,
        schemaVersion: summary.schemaVersion,
        counts: summary.counts,
      });
      await api.upload(started.uploadUrl, started.headers, file, (done, total) =>
        this.setProgress({ operation: "backup", phase: "uploading", bytesDone: done, bytesTotal: total, error: null }),
      );
      this.setProgress({ operation: "backup", phase: "finalizing", bytesDone: summary.sizeBytes, bytesTotal: summary.sizeBytes, error: null });
      await api.completeUpload(await this.token(), started.backupId);
      const at = this.now().toISOString();
      this.state = { ...this.state, lastSuccessAt: at, lastAttempt: { at, ok: true, error: null } };
      this.saveState();
      this.setProgress({ operation: "backup", phase: "done", bytesDone: summary.sizeBytes, bytesTotal: summary.sizeBytes, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = { ...this.state, lastAttempt: { at: this.now().toISOString(), ok: false, error: message } };
      this.saveState();
      this.setProgress({ operation: "backup", phase: "error", bytesDone: 0, bytesTotal: 0, error: message });
      if (err instanceof AppError && err.code === "CLOUD_ENTITLEMENT") await this.refreshEntitlement();
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  async list(): Promise<CloudBackupItem[]> {
    const { backups } = await this.requireApi().list(await this.token());
    return backups;
  }

  /** Download a cloud backup and validate it; the UI then confirms the restore. */
  async restore(id: string): Promise<BackupInspection> {
    const api = this.requireApi();
    if (this.running) throw new AppError("NOT_ALLOWED", "cloud.errors.busy");
    this.running = true;
    fs.mkdirSync(this.opts.tempDir, { recursive: true });
    const file = path.join(this.opts.tempDir, `download-${crypto.randomUUID()}.havenos-backup`);
    try {
      const { url, sha256, sizeBytes } = await api.downloadUrl(await this.token(), id);
      this.setProgress({ operation: "restore", phase: "downloading", bytesDone: 0, bytesTotal: sizeBytes, error: null });
      await api.download(url, file, sizeBytes, (done, total) =>
        this.setProgress({ operation: "restore", phase: "downloading", bytesDone: done, bytesTotal: total, error: null }),
      );
      this.setProgress({ operation: "restore", phase: "verifying", bytesDone: sizeBytes, bytesTotal: sizeBytes, error: null });
      const actual = await hashFile(file);
      if (actual !== sha256) throw new AppError("BACKUP_INVALID", "backup.invalid", { params: { reason: "the download is damaged (checksum mismatch)" } });
      const inspection = await this.opts.workspaces.inspect(file);
      this.setProgress({ operation: "restore", phase: "done", bytesDone: sizeBytes, bytesTotal: sizeBytes, error: null });
      return inspection;
    } catch (err) {
      this.setProgress({ operation: "restore", phase: "error", bytesDone: 0, bytesTotal: 0, error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      this.running = false;
      fs.rmSync(file, { force: true });
    }
  }

  private async openBillingUrl(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError("CLOUD_SERVER", "cloud.errors.server", { params: { message: "invalid billing link" } });
    }
    if (parsed.protocol !== "https:" || !BILLING_HOSTS.some((h) => h.test(parsed.hostname))) {
      throw new AppError("CLOUD_SERVER", "cloud.errors.server", { params: { message: "unexpected billing link" } });
    }
    await this.opts.openExternal(parsed.toString());
  }

  async openCheckout(plan: "monthly" | "annual") {
    const { url } = await this.requireApi().checkoutUrl(await this.token(), plan);
    await this.openBillingUrl(url);
  }

  async openBillingPortal() {
    const { url } = await this.requireApi().portalUrl(await this.token());
    await this.openBillingUrl(url);
  }
}

export class MemorySecretStore implements SecretStore {
  private value: string | null = null;
  readonly available = true;
  read() {
    return this.value;
  }
  write(v: string) {
    this.value = v;
  }
  clear() {
    this.value = null;
  }
}
