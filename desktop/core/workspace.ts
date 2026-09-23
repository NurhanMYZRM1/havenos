import fs from "node:fs";
import path from "node:path";
import type { BackupInspection, SafetyBackup, Workspace } from "../../lib/api/contract";
import { backupFileName, BACKUP_EXTENSION, createBackup, inspectBackup, type InspectedBackup } from "./backup/archive";
import { ATTACHMENTS_DIR, closeCore, DB_FILE, openCore, type Core, type ImageProcessor } from "./context";
import { AppError } from "./errors";
import { sweepAttachments } from "./files";
import { seedSampleWorkspace } from "./sample";
import { ensureCurrentCharges } from "./services/rent";
import { setSetting } from "./services/settings";

export interface WorkspaceOptions {
  /** The app's data folder (Electron userData, or a temp dir in tests). */
  rootDir: string;
  appVersion: string;
  now?: () => Date;
  images?: ImageProcessor;
}

/**
 * Owns the open database. "main" is the landlord's real records in the data
 * folder itself; "sample" is a separate database in <data>/sample so demo
 * records can never mix with real ones.
 */
export class Workspaces {
  private core: Core;
  private name: Workspace = "main";
  private readonly inspections = new Map<string, InspectedBackup>();

  constructor(private readonly opts: WorkspaceOptions) {
    fs.mkdirSync(opts.rootDir, { recursive: true });
    this.recoverInterruptedRestore();
    this.core = this.open("main");
  }

  get current(): Core {
    return this.core;
  }

  get workspace(): Workspace {
    return this.name;
  }

  get backupsDir(): string {
    return path.join(this.opts.rootDir, "backups");
  }

  private dirFor(ws: Workspace): string {
    return ws === "main" ? this.opts.rootDir : path.join(this.opts.rootDir, "sample");
  }

  private open(ws: Workspace): Core {
    const core = openCore({
      dir: this.dirFor(ws),
      appVersion: this.opts.appVersion,
      now: this.opts.now,
      images: this.opts.images,
      backupsDir: this.backupsDir,
    });
    fs.rmSync(path.join(core.dir, ".staging"), { recursive: true, force: true });
    sweepAttachments(core);
    ensureCurrentCharges(core);
    return core;
  }

  switchTo(ws: Workspace, opts: { reset?: boolean } = {}) {
    if (ws === this.name && !opts.reset) return;
    closeCore(this.core);
    if (ws === "sample") {
      const dir = this.dirFor("sample");
      const fresh = opts.reset || !fs.existsSync(path.join(dir, DB_FILE));
      if (fresh) fs.rmSync(dir, { recursive: true, force: true });
      this.core = this.open("sample");
      if (fresh) seedSampleWorkspace(this.core);
    } else {
      this.core = this.open("main");
    }
    this.name = ws;
  }

  // ── Local backup & restore ───────────────────────────────────────────────

  async backupTo(file: string, onProgress?: (done: number, total: number) => void) {
    if (this.name !== "main") throw new AppError("NOT_ALLOWED", "errors.sampleNoBackup");
    const summary = await createBackup(this.core, file, { onProgress });
    setSetting(this.core, "lastLocalBackupAt", summary.createdAt);
    return summary;
  }

  async inspect(file: string): Promise<BackupInspection> {
    const inspected = await inspectBackup(this.core, file);
    const token = path.basename(inspected.dir);
    this.inspections.set(token, inspected);
    return { token, summary: inspected.summary };
  }

  discardInspection(token: string) {
    const insp = this.inspections.get(token);
    if (insp) fs.rmSync(insp.dir, { recursive: true, force: true });
    this.inspections.delete(token);
  }

  listSafetyBackups(): SafetyBackup[] {
    if (!fs.existsSync(this.backupsDir)) return [];
    return fs
      .readdirSync(this.backupsDir)
      .filter((f) => f.endsWith(`.${BACKUP_EXTENSION}`))
      .map((f) => {
        const full = path.join(this.backupsDir, f);
        const stat = fs.statSync(full);
        return { path: full, fileName: f, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /**
   * Replace the current records with an inspected backup. First a safety
   * backup of the current records is written to <data>/backups; the old
   * files are then moved aside (not deleted) until the restored database
   * has opened and migrated successfully, and are put back on any failure.
   */
  async restore(token: string): Promise<{ safetyBackupPath: string }> {
    if (this.name !== "main") throw new AppError("NOT_ALLOWED", "errors.sampleNoBackup");
    const insp = this.inspections.get(token);
    if (!insp || !fs.existsSync(insp.dir)) throw new AppError("NOT_FOUND", "backup.inspectionExpired");
    const now = (this.opts.now ?? (() => new Date()))();
    const root = this.opts.rootDir;
    const safetyBackupPath = path.join(this.backupsDir, backupFileName(now, "HavenOS-before-restore"));
    await createBackup(this.core, safetyBackupPath);

    closeCore(this.core);
    const aside = path.join(root, `.previous-${now.getTime()}`);
    fs.mkdirSync(aside, { recursive: true });
    const live = [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, ATTACHMENTS_DIR];
    for (const name of live) {
      const from = path.join(root, name);
      if (fs.existsSync(from)) fs.renameSync(from, path.join(aside, name));
    }
    fs.writeFileSync(path.join(aside, "RESTORE_IN_PROGRESS"), safetyBackupPath);
    try {
      fs.renameSync(path.join(insp.dir, DB_FILE), path.join(root, DB_FILE));
      fs.renameSync(path.join(insp.dir, ATTACHMENTS_DIR), path.join(root, ATTACHMENTS_DIR));
      this.core = this.open("main");
    } catch (err) {
      for (const name of live) fs.rmSync(path.join(root, name), { recursive: true, force: true });
      for (const name of live) {
        const from = path.join(aside, name);
        if (fs.existsSync(from)) fs.renameSync(from, path.join(root, name));
      }
      fs.rmSync(aside, { recursive: true, force: true });
      this.core = this.open("main");
      throw err;
    } finally {
      this.discardInspection(token);
    }
    fs.rmSync(aside, { recursive: true, force: true });
    return { safetyBackupPath };
  }

  /**
   * If the app died mid-restore, the moved-aside originals are still in a
   * .previous-* folder with a marker. Put them back so the landlord's data is
   * exactly as it was before they clicked Restore.
   */
  private recoverInterruptedRestore() {
    const root = this.opts.rootDir;
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith(".previous-")) continue;
      const aside = path.join(root, entry);
      if (!fs.existsSync(path.join(aside, "RESTORE_IN_PROGRESS"))) {
        fs.rmSync(aside, { recursive: true, force: true });
        continue;
      }
      for (const name of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, ATTACHMENTS_DIR]) {
        const from = path.join(aside, name);
        if (!fs.existsSync(from)) continue;
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
        fs.renameSync(from, path.join(root, name));
      }
      fs.rmSync(aside, { recursive: true, force: true });
    }
  }

  close() {
    for (const token of [...this.inspections.keys()]) this.discardInspection(token);
    closeCore(this.core);
  }
}
