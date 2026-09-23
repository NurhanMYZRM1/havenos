import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BackupSummary } from "../../../lib/api/contract";
import type { Core } from "../context";
import { ATTACHMENTS_DIR, DB_FILE } from "../context";
import { Db } from "../db";
import { AppError } from "../errors";
import { SCHEMA_VERSION } from "../schema";
import { extractTarGz, writeTarGz } from "./tar";

export const BACKUP_EXTENSION = "havenos-backup";
export const BACKUP_FORMAT = "havenos-backup";
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
  files: { path: string; size: number; sha256: string }[];
}

const COUNTED_TABLES = ["properties", "spaces", "tenants", "tenancies", "charges", "payments", "deposit_entries", "maintenance_requests", "attachments"];

function countRecords(db: Db): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) counts[table] = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
  return counts;
}

function stagingDir(core: Core, label: string): string {
  const dir = path.join(core.dir, ".staging", `${label}-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function backupFileName(now: Date, prefix = "HavenOS-backup"): string {
  const stamp = now.toISOString().replace(/[:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return `${prefix}-${stamp}.${BACKUP_EXTENSION}`;
}

/**
 * Write a complete backup: a consistent snapshot of the database (SQLite's
 * VACUUM INTO, safe while the app is running) plus every attachment the
 * snapshot references, with a manifest of SHA-256 hashes.
 */
export async function createBackup(
  core: Core,
  outFile: string,
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<BackupSummary> {
  const dir = stagingDir(core, "backup");
  try {
    const snapshot = path.join(dir, DB_FILE);
    core.db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    const snap = new Db(snapshot);
    let counts: Record<string, number>;
    let files: string[];
    try {
      counts = countRecords(snap);
      files = snap
        .all<{ stored_name: string; thumb_name: string | null }>("SELECT stored_name, thumb_name FROM attachments")
        .flatMap((r) => (r.thumb_name ? [r.stored_name, r.thumb_name] : [r.stored_name]));
    } finally {
      snap.close();
    }
    const sources = [
      { name: DB_FILE, path: snapshot },
      ...files.map((f) => ({ name: `${ATTACHMENTS_DIR}/${f}`, path: path.join(core.attachmentsDir, f) })),
    ];
    for (const s of sources) {
      if (!fs.existsSync(s.path)) throw new AppError("BACKUP_INVALID", "backup.missingFile", { params: { name: s.name } });
    }
    const total = sources.reduce((sum, s) => sum + fs.statSync(s.path).size, 0);
    let done = 0;
    const createdAt = core.nowIso();
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await writeTarGz(outFile, sources, {
      onBytes: (n) => {
        done += n;
        opts.onProgress?.(done, total);
      },
      last: (written) => {
        const manifest: BackupManifest = {
          format: BACKUP_FORMAT,
          formatVersion: BACKUP_FORMAT_VERSION,
          createdAt,
          appVersion: core.appVersion,
          schemaVersion: SCHEMA_VERSION,
          counts,
          files: written.map((w) => ({ path: w.name, size: w.size, sha256: w.sha256 })),
        };
        return { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) };
      },
    });
    return {
      fileName: path.basename(outFile),
      createdAt,
      appVersion: core.appVersion,
      schemaVersion: SCHEMA_VERSION,
      counts,
      attachmentCount: counts.attachments,
      sizeBytes: fs.statSync(outFile).size,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function invalid(reason: string): AppError {
  return new AppError("BACKUP_INVALID", "backup.invalid", { params: { reason } });
}

function parseManifest(text: string): BackupManifest {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    throw invalid("the manifest can't be read");
  }
  const o = m as Partial<BackupManifest>;
  if (o?.format !== BACKUP_FORMAT) throw invalid("it isn't a HavenOS backup");
  if (typeof o.formatVersion !== "number" || o.formatVersion > BACKUP_FORMAT_VERSION) throw invalid("it was made by a newer version of HavenOS");
  if (typeof o.schemaVersion !== "number" || !Number.isInteger(o.schemaVersion)) throw invalid("the manifest is incomplete");
  if (!Array.isArray(o.files) || typeof o.createdAt !== "string" || typeof o.appVersion !== "string") throw invalid("the manifest is incomplete");
  for (const f of o.files) {
    if (typeof f?.path !== "string" || typeof f.size !== "number" || typeof f.sha256 !== "string") throw invalid("the manifest is incomplete");
  }
  return { ...(o as BackupManifest), counts: typeof o.counts === "object" && o.counts ? o.counts : {} };
}

export interface InspectedBackup {
  dir: string;
  summary: BackupSummary;
}

/**
 * Unpack a backup into a private staging folder and prove it is whole
 * before anything is restored: expected files only, every hash matches the
 * manifest, the database passes SQLite's integrity and foreign-key checks,
 * and every attachment it references is present.
 */
export async function inspectBackup(core: Core, file: string): Promise<InspectedBackup> {
  const dir = stagingDir(core, "restore");
  try {
    let entries;
    try {
      entries = await extractTarGz(file, dir, {
        maxEntries: 200_000,
        maxTotalBytes: 50 * 1024 * 1024 * 1024,
        allowedName: /^(manifest\.json|havenos\.db|attachments\/[0-9a-f-]{36}(\.thumb)?\.[a-z0-9]{2,5})$/,
      });
    } catch (err) {
      throw invalid(err instanceof Error ? err.message : "the file can't be read");
    }
    const manifestEntry = entries.find((e) => e.name === "manifest.json");
    if (!manifestEntry) throw invalid("the manifest is missing");
    const manifest = parseManifest(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    if (manifest.schemaVersion > SCHEMA_VERSION) throw invalid("it was made by a newer version of HavenOS — update the app first");

    const byName = new Map(entries.map((e) => [e.name, e]));
    if (manifest.files.length !== entries.length - 1) throw invalid("files are missing or extra");
    for (const f of manifest.files) {
      const e = byName.get(f.path);
      if (!e) throw invalid(`${f.path} is missing`);
      if (e.size !== f.size || e.sha256 !== f.sha256) throw invalid(`${f.path} is damaged (checksum mismatch)`);
    }
    if (!byName.has(DB_FILE)) throw invalid("the database is missing");

    const db = new Db(path.join(dir, DB_FILE));
    let counts: Record<string, number>;
    try {
      const integrity = db.all<{ integrity_check: string }>("PRAGMA integrity_check");
      if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw invalid("the database failed its integrity check");
      if (db.all("PRAGMA foreign_key_check").length) throw invalid("the database has broken references");
      const version = db.get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0;
      if (version !== manifest.schemaVersion || version < 1) throw invalid("the database version doesn't match its manifest");
      counts = countRecords(db);
      for (const r of db.all<{ stored_name: string; thumb_name: string | null }>("SELECT stored_name, thumb_name FROM attachments")) {
        if (!byName.has(`${ATTACHMENTS_DIR}/${r.stored_name}`)) throw invalid(`attachment ${r.stored_name} is missing`);
        if (r.thumb_name && !byName.has(`${ATTACHMENTS_DIR}/${r.thumb_name}`)) throw invalid(`attachment ${r.thumb_name} is missing`);
      }
    } finally {
      db.close();
    }
    fs.mkdirSync(path.join(dir, ATTACHMENTS_DIR), { recursive: true });
    return {
      dir,
      summary: {
        fileName: path.basename(file),
        createdAt: manifest.createdAt,
        appVersion: manifest.appVersion,
        schemaVersion: manifest.schemaVersion,
        counts,
        attachmentCount: counts.attachments ?? 0,
        sizeBytes: fs.statSync(file).size,
      },
    };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}
