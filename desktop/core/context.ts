import fs from "node:fs";
import path from "node:path";
import { todayInMalaysia, type IsoDate } from "../../lib/domain/dates";
import { Db } from "./db";
import { AppError } from "./errors";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema";

/** Decodes, downsizes and thumbnails photos. Electron supplies a real one. */
export interface ImageProcessor {
  process(bytes: Buffer, mime: string): { bytes: Buffer; mime: string; width: number; height: number; thumb: Buffer | null } | null;
}

export const passthroughImages: ImageProcessor = { process: () => null };

export interface CoreOptions {
  /** Folder holding havenos.db and attachments/ for this workspace. */
  dir: string;
  appVersion: string;
  now?: () => Date;
  images?: ImageProcessor;
  /** Where automatic pre-upgrade copies go (defaults to <dir>/backups). */
  backupsDir?: string;
}

export interface Core {
  db: Db;
  dir: string;
  dbPath: string;
  attachmentsDir: string;
  backupsDir: string;
  appVersion: string;
  images: ImageProcessor;
  now(): Date;
  nowIso(): string;
  today(): IsoDate;
}

export const DB_FILE = "havenos.db";
export const ATTACHMENTS_DIR = "attachments";

function readUserVersion(db: Db): number {
  return Number(db.get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0);
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

/**
 * Bring the schema up to date. Before upgrading an existing database a full
 * copy is written next to it, so an app update can never strand a landlord's
 * records. A database from a *newer* HavenOS is refused rather than touched.
 */
export function migrate(db: Db, opts: { backupsDir: string; now: Date }): { from: number; to: number } {
  const from = readUserVersion(db);
  if (from > SCHEMA_VERSION) {
    throw new AppError("UNSUPPORTED", null, {
      message: `This data was saved by a newer version of HavenOS (schema ${from}). Please update the app.`,
    });
  }
  if (from === SCHEMA_VERSION) return { from, to: from };
  if (from > 0 && db.path !== ":memory:") {
    fs.mkdirSync(opts.backupsDir, { recursive: true });
    const copy = path.join(opts.backupsDir, `pre-upgrade-v${from}-${stamp(opts.now)}.db`);
    db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  }
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    db.tx(() => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return { from, to: SCHEMA_VERSION };
}

export function openCore(opts: CoreOptions): Core {
  fs.mkdirSync(opts.dir, { recursive: true });
  const attachmentsDir = path.join(opts.dir, ATTACHMENTS_DIR);
  fs.mkdirSync(attachmentsDir, { recursive: true });
  const dbPath = path.join(opts.dir, DB_FILE);
  const now = opts.now ?? (() => new Date());
  const backupsDir = opts.backupsDir ?? path.join(opts.dir, "backups");
  const db = new Db(dbPath);
  try {
    migrate(db, { backupsDir, now: now() });
    const fk = db.all("PRAGMA foreign_key_check");
    if (fk.length) throw new Error(`Database integrity problem: ${fk.length} broken references.`);
  } catch (err) {
    db.close();
    throw err;
  }
  return {
    db,
    dir: opts.dir,
    dbPath,
    attachmentsDir,
    backupsDir,
    appVersion: opts.appVersion,
    images: opts.images ?? passthroughImages,
    now,
    nowIso: () => now().toISOString(),
    today: () => todayInMalaysia(now()),
  };
}

export function closeCore(core: Core) {
  core.db.close();
}
