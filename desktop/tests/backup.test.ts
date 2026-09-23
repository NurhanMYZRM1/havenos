import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, it } from "node:test";
import { AppError } from "../core/errors";
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

describe("local backup and restore", () => {
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
