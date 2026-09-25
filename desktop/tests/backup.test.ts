import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, it } from "node:test";
import { AppError } from "../core/errors";
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, type BackupManifest } from "../core/backup/archive";
import { writeTarGz } from "../core/backup/tar";
import { DB_FILE } from "../core/context";
import { Db } from "../core/db";
import { MIGRATIONS, SCHEMA_VERSION } from "../core/schema";
import { importFiles, resolveAttachmentFile } from "../core/services/attachments";
import { createMaintenance, getMaintenance, listMaintenance } from "../core/services/maintenance";
import { listProperties } from "../core/services/properties";
import { recordPayment } from "../core/services/rent";
import { createTenancy, getTenancy } from "../core/services/tenancies";
import { Workspaces } from "../core/workspace";
import { FIXED_NOW, newTenant, seedProperty, tempDir, TINY_PNG } from "./helpers";

function populated(root = tempDir()) {
  const ws = new Workspaces({ rootDir: root, appVersion: "9.9.9", now: () => FIXED_NOW });
  const p = seedProperty(ws.current);
  const t = createTenancy(ws.current, {
    tenantId: null,
    newTenant: newTenant("Farah"),
    spaceId: p.unitA2,
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    monthlyRentSen: 180000,
    rentDueDay: 1,
    rentStartMonth: "2026-09",
    securityDepositSen: 0,
    utilityDepositSen: 0,
    terms: "",
    stagingKey: null,
  });
  recordPayment(ws.current, { tenancyId: t.id, receivedOn: "2026-09-02", amountSen: 180000, method: "cash", reference: "", description: "", notes: "", stagingKey: null });
  const m = createMaintenance(ws.current, {
    propertyId: p.propertyId,
    spaceId: null,
    tenantId: null,
    title: "Broken window",
    description: "",
    category: "structural",
    priority: "standard",
    status: "triage",
    dueDate: null,
    assigneeName: "",
    assigneePhone: "",
    estimatedCostSen: null,
    actualCostSen: null,
    reportedOn: "2026-09-20",
    stagingKey: null,
  });
  importFiles(ws.current, { kind: "maintenance", id: m.id }, "photo", [{ name: "window.png", bytes: TINY_PNG }]);
  return { ws, root, p, t, m };
}

/** Build the archive an older app wrote, without opening its database through today's migration code. */
async function legacyBackup(version: 1 | 2) {
  const dir = tempDir(`havenos-backup-v${version}`);
  const dbPath = path.join(dir, DB_FILE);
  const db = new Db(dbPath);
  const now = FIXED_NOW.toISOString();
  const storedName = `${crypto.randomUUID()}.png`;
  const checksum = crypto.createHash("sha256").update(TINY_PNG).digest("hex");
  try {
    db.exec(MIGRATIONS[0].sql);
    db.run("INSERT INTO properties (id, name, property_type, address_line1, postcode, city, state, created_at, updated_at) VALUES ('old-property', 'Older backup property', 'condominium', '1 Jalan', '50450', 'KL', 'KUL', ?, ?)", [now, now]);
    db.run("INSERT INTO spaces (id, property_id, kind, unit_id, label, rental_mode, created_at, updated_at) VALUES ('old-space', 'old-property', 'unit', 'old-space', 'A-1', 'whole_unit', ?, ?)", [now, now]);
    db.run(
      `INSERT INTO reservations (id, space_id, property_id, guest_name, check_in, check_out, status, channel, total_sen, notes, created_at, updated_at)
       VALUES ('old-stay', 'old-space', 'old-property', 'Older guest', '2026-10-01', '2026-10-04', 'confirmed', 'direct', 45000, 'Keep this note', ?, ?)`,
      [now, now],
    );
    db.run(
      `INSERT INTO attachments (id, property_id, purpose, file_name, stored_name, mime_type, size_bytes, sha256, created_at)
       VALUES ('old-photo', 'old-property', 'photo', 'original.png', ?, 'image/png', ?, ?, ?)`,
      [storedName, TINY_PNG.length, checksum, now],
    );
    if (version === 2) {
      db.exec(MIGRATIONS[1].sql);
      db.run("INSERT INTO channel_connections (id, channel, method, name, space_id, property_id, created_at, updated_at) VALUES ('old-channel', 'airbnb', 'ical', 'Older calendar', 'old-space', 'old-property', ?, ?)", [now, now]);
      db.run("INSERT INTO reservation_events (id, reservation_id, kind, source, note, created_at) VALUES ('old-history', 'old-stay', 'note', 'manual', 'Keep this history', ?)", [now]);
      db.run("INSERT INTO channel_sync_runs (id, connection_id, trigger, started_at, finished_at, outcome, error_code) VALUES ('old-run', 'old-channel', 'manual', ?, ?, 'failed', 'internal')", [now, now]);
    }
    db.exec(`PRAGMA user_version = ${version}`);
  } finally {
    db.close();
  }
  const file = path.join(dir, `schema-${version}.havenos-backup`);
  await writeTarGz(file, [{ name: DB_FILE, path: dbPath }, { name: `attachments/${storedName}`, data: TINY_PNG }], {
    last: (written) => {
      const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt: now,
        appVersion: `0.${version}.0`,
        schemaVersion: version,
        counts: { properties: 1, spaces: 1, reservations: 1, attachments: 1 },
        files: written.map((entry) => ({ path: entry.name, size: entry.size, sha256: entry.sha256 })),
      };
      return { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) };
    },
  });
  return file;
}

describe("local backup and restore", () => {
  for (const version of [1, 2] as const) {
    it(`restores a schema-${version} archive and migrates records, attachments and history to schema 3`, async () => {
      const backupFile = await legacyBackup(version);
      const originalArchive = fs.readFileSync(backupFile);
      const { ws, root } = populated();
      try {
        const inspection = await ws.inspect(backupFile);
        assert.equal(inspection.summary.schemaVersion, version);
        assert.equal(inspection.summary.counts.reservations, 1);
        assert.equal(inspection.summary.attachmentCount, 1);
        assert.equal(ws.current.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tenancies")!.n, 1, "inspection leaves current records intact");
        const { safetyBackupPath } = await ws.restore(inspection.token);
        assert.equal(ws.current.db.get<{ user_version: number }>("PRAGMA user_version")!.user_version, SCHEMA_VERSION);
        assert.deepEqual(ws.current.db.all("PRAGMA foreign_key_check"), []);
        assert.equal(ws.current.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tenancies")!.n, 0, "the restored workspace replaces the old one");
        const stay = ws.current.db.get<Record<string, unknown>>("SELECT id, guest_name, check_in, check_out, notes FROM reservations");
        assert.deepEqual({ ...stay }, { id: "old-stay", guest_name: "Older guest", check_in: "2026-10-01", check_out: "2026-10-04", notes: "Keep this note" });
        const money = ws.current.db.get<Record<string, unknown>>("SELECT reservation_id, kind, amount_sen, source FROM stay_ledger");
        assert.deepEqual({ ...money }, { reservation_id: "old-stay", kind: "booking_value", amount_sen: 45000, source: "entered" });
        const restoredPhoto = resolveAttachmentFile(ws.current, "old-photo", false)!.path;
        assert.ok(fs.readFileSync(restoredPhoto).equals(TINY_PNG));
        assert.equal(ws.current.db.get<{ name: string }>("SELECT name FROM properties")!.name, "Older backup property");
        if (version === 2) {
          assert.equal(ws.current.db.get<{ note: string }>("SELECT note FROM reservation_events WHERE id = 'old-history'")!.note, "Keep this history");
          assert.equal(ws.current.db.get<{ name: string }>("SELECT name FROM channel_connections WHERE id = 'old-channel'")!.name, "Older calendar");
          const run = ws.current.db.get<Record<string, unknown>>("SELECT id, error_code, diagnostic FROM channel_sync_runs");
          assert.deepEqual({ ...run }, { id: "old-run", error_code: "internal", diagnostic: null });
        }
        assert.ok(fs.existsSync(safetyBackupPath));
        assert.ok(safetyBackupPath.startsWith(path.join(root, "backups")));
        assert.ok(fs.readdirSync(path.join(root, "backups")).some((name) => name.startsWith(`pre-upgrade-v${version}`)));
        const safety = await ws.inspect(safetyBackupPath);
        assert.equal(safety.summary.schemaVersion, SCHEMA_VERSION);
        assert.equal(safety.summary.counts.tenancies, 1);
        assert.equal(safety.summary.counts.maintenance_requests, 1);
        assert.equal(safety.summary.attachmentCount, 1);
        ws.discardInspection(safety.token);
        assert.ok(fs.readFileSync(backupFile).equals(originalArchive), "the source archive remains unchanged");
      } finally {
        ws.close();
      }
    });
  }

  it("round-trips records and attachments, keeping a safety copy of the replaced data", async () => {
    const { ws, root, t, m } = populated();
    const backupFile = path.join(tempDir("backups"), "HavenOS-backup.havenos-backup");
    const summary = await ws.backupTo(backupFile);
    assert.equal(summary.counts.properties, 1);
    assert.equal(summary.counts.payments, 1);
    assert.equal(summary.attachmentCount, 1);

    // Change things after the backup…
    createMaintenance(ws.current, { ...getMaintenance(ws.current, m.id), title: "Made after backup", stagingKey: null });
    assert.equal(listMaintenance(ws.current, { propertyId: null, status: "all", priority: null, overdueOnly: false, query: "" }).length, 2);

    // …then restore.
    const inspection = await ws.inspect(backupFile);
    assert.equal(inspection.summary.appVersion, "9.9.9");
    assert.equal(inspection.summary.counts.maintenance_requests, 1);
    const { safetyBackupPath } = await ws.restore(inspection.token);
    assert.ok(fs.existsSync(safetyBackupPath));
    assert.ok(safetyBackupPath.startsWith(path.join(root, "backups")));

    const items = listMaintenance(ws.current, { propertyId: null, status: "all", priority: null, overdueOnly: false, query: "" });
    assert.deepEqual(items.map((i) => i.title), ["Broken window"]);
    const restored = getMaintenance(ws.current, m.id);
    const file = resolveAttachmentFile(ws.current, restored.photos[0].id, false)!.path;
    assert.ok(fs.readFileSync(file).equals(TINY_PNG));
    assert.equal(getTenancy(ws.current, t.id).balanceSen, 0);

    // The safety copy holds the pre-restore state (two requests), so the restore can be undone.
    const undo = await ws.inspect(safetyBackupPath);
    assert.equal(undo.summary.counts.maintenance_requests, 2);
    ws.discardInspection(undo.token);
    ws.close();
  });

  it("rejects a damaged backup before touching current records", async () => {
    const { ws } = populated();
    const good = path.join(tempDir("backups"), "good.havenos-backup");
    await ws.backupTo(good);
    // Flip bytes inside the database payload (after gunzip), then re-gzip.
    const tar = zlib.gunzipSync(fs.readFileSync(good));
    tar[512 + 2000] ^= 0xff;
    const bad = path.join(path.dirname(good), "bad.havenos-backup");
    fs.writeFileSync(bad, zlib.gzipSync(tar));
    await assert.rejects(ws.inspect(bad), (err: unknown) => err instanceof AppError && err.code === "BACKUP_INVALID" && /checksum/.test(err.message));
    // Not a backup at all.
    const junk = path.join(path.dirname(good), "junk.havenos-backup");
    fs.writeFileSync(junk, "hello");
    await assert.rejects(ws.inspect(junk), (err: unknown) => err instanceof AppError && err.code === "BACKUP_INVALID");
    assert.equal(listProperties(ws.current, { includeArchived: false }).length, 1);
    ws.close();
  });

  it("refuses path-traversal entries in a crafted archive", async () => {
    const { ws } = populated();
    const header = Buffer.alloc(512);
    header.write("../evil.txt", 0);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write("00000000004\0", 124);
    header.write("00000000000\0", 136);
    header.write("        ", 148);
    header.write("0", 156);
    header.write("ustar\0", 257);
    let sum = 0;
    for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    const body = Buffer.alloc(512);
    body.write("evil");
    const crafted = path.join(tempDir("crafted"), "x.havenos-backup");
    fs.writeFileSync(crafted, zlib.gzipSync(Buffer.concat([header, body, Buffer.alloc(1024)])));
    await assert.rejects(ws.inspect(crafted), /Unexpected file/);
    assert.equal(fs.existsSync(path.join(path.dirname(crafted), "..", "evil.txt")), false);
    ws.close();
  });

  it("puts the original data back if the app stopped mid-restore", () => {
    const { ws, root } = populated();
    ws.close();
    // Simulate a crash after the originals were moved aside.
    const aside = path.join(root, ".previous-123");
    fs.mkdirSync(aside);
    fs.renameSync(path.join(root, "havenos.db"), path.join(aside, "havenos.db"));
    fs.renameSync(path.join(root, "attachments"), path.join(aside, "attachments"));
    fs.writeFileSync(path.join(aside, "RESTORE_IN_PROGRESS"), "x");
    const reopened = new Workspaces({ rootDir: root, appVersion: "t", now: () => FIXED_NOW });
    assert.equal(listProperties(reopened.current, { includeArchived: false }).length, 1);
    assert.equal(fs.existsSync(aside), false);
    reopened.close();
  });

  it("does not back up the sample workspace", async () => {
    const { ws } = populated();
    ws.switchTo("sample");
    await assert.rejects(ws.backupTo(path.join(tempDir(), "x.havenos-backup")), (e: unknown) => e instanceof AppError && e.code === "NOT_ALLOWED");
    ws.close();
  });
});
