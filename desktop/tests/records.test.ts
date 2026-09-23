import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { emptyDraft, newUnit } from "../../lib/domain/onboarding";
import { closeCore } from "../core/context";
import { AppError } from "../core/errors";
import { importFiles, removeAttachment, reorderAttachments, resolveAttachmentFile } from "../core/services/attachments";
import { completeDraft, currentDraft, saveDraft } from "../core/services/drafts";
import { addMaintenanceNote, createMaintenance, getMaintenance, listMaintenance, updateMaintenance } from "../core/services/maintenance";
import { getProperty, listProperties } from "../core/services/properties";
import { search } from "../core/services/search";
import { Workspaces } from "../core/workspace";
import { FIXED_NOW, makeCore, seedProperty, tempDir, TINY_PDF, TINY_PNG } from "./helpers";

const maintenanceInput = (propertyId: string, spaceId: string | null) => ({
  propertyId,
  spaceId,
  tenantId: null,
  title: "Leaking tap",
  description: "Bathroom basin",
  category: "plumbing" as const,
  priority: "high" as const,
  status: "triage" as const,
  dueDate: "2026-09-20",
  assigneeName: "",
  assigneePhone: "",
  estimatedCostSen: 15000,
  actualCostSen: null,
  reportedOn: "2026-09-18",
});

describe("maintenance", () => {
  it("creates, edits, filters and keeps a history of every change", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const created = createMaintenance(core, { ...maintenanceInput(p.propertyId, p.roomA), stagingKey: null });
    assert.equal(created.ref, "M-0001");
    assert.equal(created.overdue, true); // due 20 Sep, today 23 Sep
    const updated = updateMaintenance(core, created.id, {
      ...maintenanceInput(p.propertyId, p.roomA),
      status: "done",
      assigneeName: "Ah Seng Plumbing",
      actualCostSen: 12000,
    });
    assert.equal(updated.completedOn, "2026-09-23");
    assert.equal(updated.overdue, false);
    addMaintenanceNote(core, created.id, "Replaced cartridge.");
    const detail = getMaintenance(core, created.id);
    const kinds = detail.events.map((e) => e.kind);
    assert.deepEqual(kinds.sort(), ["created", "note", "updated"]);
    const change = detail.events.find((e) => e.kind === "updated")!;
    assert.deepEqual(
      change.changes.map((c) => c.field).sort(),
      ["actualCostSen", "assigneeName", "status"],
    );
    assert.deepEqual(change.changes.find((c) => c.field === "status"), { field: "status", from: "triage", to: "done" });

    createMaintenance(core, { ...maintenanceInput(p.propertyId, null), title: "Gate motor", priority: "low", dueDate: null, stagingKey: null });
    assert.equal(listMaintenance(core, { propertyId: null, status: "open", priority: null, overdueOnly: false, query: "" }).length, 1);
    assert.equal(listMaintenance(core, { propertyId: null, status: "all", priority: null, overdueOnly: false, query: "" }).length, 2);
    assert.equal(listMaintenance(core, { propertyId: null, status: "all", priority: "high", overdueOnly: false, query: "" }).length, 1);
    assert.equal(listMaintenance(core, { propertyId: null, status: "all", priority: null, overdueOnly: false, query: "gate" }).length, 1);
    assert.equal(listMaintenance(core, { propertyId: null, status: "open", priority: null, overdueOnly: true, query: "" }).length, 0);
    closeCore(core);
  });

  it("rejects a unit from a different property", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const q = seedProperty(core);
    assert.throws(() => createMaintenance(core, { ...maintenanceInput(p.propertyId, q.roomA), stagingKey: null }), AppError);
    closeCore(core);
  });

  it("keeps photo attachments on disk, records them in history, and removes files with the row", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const m = createMaintenance(core, { ...maintenanceInput(p.propertyId, null), stagingKey: null });
    const [photo] = importFiles(core, { kind: "maintenance", id: m.id }, "photo", [{ name: "leak.png", bytes: TINY_PNG }]);
    const file = resolveAttachmentFile(core, photo.id, false)!.path;
    assert.ok(fs.existsSync(file));
    assert.equal(getMaintenance(core, m.id).photos.length, 1);
    assert.ok(getMaintenance(core, m.id).events.some((e) => e.kind === "attachment_added"));
    removeAttachment(core, photo.id);
    assert.equal(fs.existsSync(file), false);
    assert.ok(getMaintenance(core, m.id).events.some((e) => e.kind === "attachment_removed"));
    closeCore(core);
  });

  it("claims photos uploaded in the form before the request existed", () => {
    const core = makeCore();
    const p = seedProperty(core);
    importFiles(core, { kind: "staging", id: "form-abcdef12" }, "photo", [{ name: "a.png", bytes: TINY_PNG }]);
    const m = createMaintenance(core, { ...maintenanceInput(p.propertyId, null), stagingKey: "form-abcdef12" });
    assert.equal(m.photos.length, 1);
    closeCore(core);
  });
});

describe("attachments are validated by content", () => {
  it("rejects files that aren't what they claim, and oversized ones", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const owner = { kind: "property" as const, id: p.propertyId };
    assert.throws(() => importFiles(core, owner, "photo", [{ name: "x.jpg", bytes: Buffer.from("not really a jpeg") }]), /isn't a supported file type/);
    assert.throws(() => importFiles(core, owner, "photo", [{ name: "doc.pdf", bytes: TINY_PDF }]), /isn't a supported file type/);
    assert.equal(importFiles(core, { kind: "property", id: p.propertyId }, "document", [{ name: "lease.pdf", bytes: TINY_PDF }]).length, 1);
    assert.throws(() => importFiles(core, owner, "document", [{ name: "big.pdf", bytes: Buffer.concat([TINY_PDF, Buffer.alloc(26 * 1024 * 1024)]) }]), /larger than 25 MB/);
    // A bad file rejects the whole batch without half-importing it.
    const before = fs.readdirSync(core.attachmentsDir).length;
    assert.throws(() => importFiles(core, owner, "photo", [{ name: "ok.png", bytes: TINY_PNG }, { name: "bad.png", bytes: Buffer.from("nope") }]));
    assert.equal(fs.readdirSync(core.attachmentsDir).length, before);
    closeCore(core);
  });
});

describe("photo onboarding creates real inventory", () => {
  it("saves a draft across restarts, then creates the property with ordered photos", () => {
    const dir = tempDir();
    let core = makeCore(dir);
    const data = emptyDraft();
    data.details = { name: "Rumah Melati", propertyType: "terrace", addressLine1: "3 Jalan Melati 2", addressLine2: "", postcode: "43000", city: "Kajang", state: "SGR", notes: "" };
    data.arrangement.defaultMode = "by_room";
    data.arrangement.units = [newUnit("House", "by_room", 3)];
    const [r1, r2, r3] = data.arrangement.units[0].rooms;
    data.rent.rents[r1.key] = "700";
    data.rent.rents[r2.key] = "550";
    data.rent.rents[r3.key] = "";
    const draft = saveDraft(core, { id: null, step: 3, data });
    const photos = importFiles(core, { kind: "draft", id: draft.id }, "photo", [
      { name: "front.png", bytes: TINY_PNG },
      { name: "kitchen.png", bytes: TINY_PNG },
    ]);
    reorderAttachments(core, { kind: "draft", id: draft.id }, [photos[1].id, photos[0].id]);
    closeCore(core);

    core = makeCore(dir); // "restart"
    const resumed = currentDraft(core)!;
    assert.equal(resumed.id, draft.id);
    assert.equal(resumed.step, 3);
    assert.equal(resumed.data.details.name, "Rumah Melati");
    assert.deepEqual(resumed.photos.map((ph) => ph.fileName), ["kitchen.png", "front.png"]);

    const { propertyId } = completeDraft(core, draft.id);
    assert.equal(currentDraft(core), null);
    const property = getProperty(core, propertyId);
    assert.equal(property.units.length, 1);
    assert.equal(property.units[0].rentalMode, "by_room");
    assert.deepEqual(property.units[0].children.map((r) => r.defaultRentSen), [70000, 55000, 0]);
    assert.deepEqual(property.photos.map((ph) => ph.fileName), ["kitchen.png", "front.png"]);
    assert.equal(property.lettable, 3);
    const listed = listProperties(core, { includeArchived: false });
    assert.equal(listed[0].cover?.fileName, "kitchen.png");
    assert.equal(search(core, "melati")[0].title, "Rumah Melati");
    closeCore(core);
  });

  it("refuses to complete an invalid draft", () => {
    const core = makeCore();
    const draft = saveDraft(core, { id: null, step: 0, data: emptyDraft() });
    assert.throws(() => completeDraft(core, draft.id), (e: unknown) => e instanceof AppError && e.code === "VALIDATION");
    assert.equal(listProperties(core, { includeArchived: false }).length, 0);
    closeCore(core);
  });
});

describe("data persists across restarts", () => {
  it("keeps records and attachments after closing and reopening the workspace", () => {
    const root = tempDir();
    let ws = new Workspaces({ rootDir: root, appVersion: "t", now: () => FIXED_NOW });
    const p = seedProperty(ws.current);
    const m = createMaintenance(ws.current, { ...maintenanceInput(p.propertyId, null), stagingKey: null });
    importFiles(ws.current, { kind: "maintenance", id: m.id }, "photo", [{ name: "leak.png", bytes: TINY_PNG }]);
    ws.close();

    ws = new Workspaces({ rootDir: root, appVersion: "t", now: () => FIXED_NOW });
    const again = getMaintenance(ws.current, m.id);
    assert.equal(again.title, "Leaking tap");
    assert.equal(again.photos.length, 1);
    assert.equal(fs.readFileSync(resolveAttachmentFile(ws.current, again.photos[0].id, false)!.path).equals(TINY_PNG), true);
    assert.ok(fs.existsSync(path.join(root, "havenos.db")));
    ws.close();
  });

  it("keeps the sample workspace apart from real records", () => {
    const root = tempDir();
    const ws = new Workspaces({ rootDir: root, appVersion: "t", now: () => FIXED_NOW });
    seedProperty(ws.current);
    ws.switchTo("sample");
    const sampleProps = listProperties(ws.current, { includeArchived: false });
    assert.ok(sampleProps.length >= 2);
    assert.ok(sampleProps.every((sp) => sp.name !== "Test Residences"));
    ws.switchTo("main");
    assert.deepEqual(listProperties(ws.current, { includeArchived: false }).map((x) => x.name), ["Test Residences"]);
    ws.close();
  });
});
