import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeCore } from "../core/context";
import { AppError } from "../core/errors";
import { cancelBlock, createBlock, listBlocks, updateBlock } from "../core/services/blocks";
import { createMaintenance } from "../core/services/maintenance";
import { createPropertyFromPlan, getProperty } from "../core/services/properties";
import { markReservationMissing } from "../core/services/reservations";
import { validateBlockInput, validateCalendarParams, validateReservationCreate } from "../core/services/stay-validate";
import { cancelManualReservation, createManualReservation, getReservation, listReservations, updateManualReservation } from "../core/services/stays";
import { createTenancy } from "../core/services/tenancies";
import { FIXED_NOW, makeCore, PROPERTY_BASE, seedProperty } from "./helpers";
import { addConnection, maintenanceInput, stay, tenancyInput } from "./stays-helpers";

const blockInput = (spaceId: string, startDate: string, endDate: string) => ({
  spaceId,
  startDate,
  endDate,
  reason: "maintenance" as const,
  maintenanceId: null,
  notes: "",
});

const manual = (spaceId: string, checkIn: string, checkOut: string, over: Record<string, unknown> = {}) => ({
  spaceId,
  guestName: "Walk-in Guest",
  guestCount: 2,
  checkIn,
  checkOut,
  checkInTime: null,
  checkOutTime: null,
  status: "confirmed" as const,
  channel: "direct" as const,
  channelReservationId: null,
  notes: "",
  ...over,
});

const conflict = (key?: string) => (err: unknown) => err instanceof AppError && err.code === "CONFLICT" && (!key || err.messageKey === key);

describe("availability blocks", () => {
  it("reject overlaps with tenancies and reservations across parent/child spaces, and vice versa", () => {
    const core = makeCore();
    const p = seedProperty(core);
    createTenancy(core, tenancyInput(p.roomA, "2026-10-01", "2026-10-31"));
    stay(core, { spaceId: p.bed1, checkIn: "2026-11-05", checkOut: "2026-11-08" });
    // Block on the unit containing a let room; on the room containing a booked bed.
    assert.throws(() => createBlock(core, blockInput(p.unitA1, "2026-10-30", "2026-11-02")), conflict("errors.overlap"));
    assert.throws(() => createBlock(core, blockInput(p.roomC, "2026-11-07", "2026-11-07")), conflict("errors.overlapReservation"));
    // The check-out day is free.
    const k = createBlock(core, blockInput(p.roomC, "2026-11-08", "2026-11-10"));
    assert.equal(k.spacePath, "A-1 › Room C");
    // Vice versa: a stay on the unit, or a tenancy on the bed, hits the room's block.
    assert.throws(() => createManualReservation(core, manual(p.unitA1, "2026-11-09", "2026-11-11")), conflict());
    assert.throws(() => createTenancy(core, tenancyInput(p.bed2, "2026-11-10", null)), conflict("errors.overlapBlock"));
    // Update may keep its own dates, can't move onto a clash; cancel frees the dates.
    updateBlock(core, { ...blockInput(p.roomC, "2026-11-08", "2026-11-12"), id: k.id, reason: "owner_stay" });
    assert.throws(() => updateBlock(core, { ...blockInput(p.roomC, "2026-11-06", "2026-11-12"), id: k.id }), conflict());
    const cancelled = cancelBlock(core, k.id);
    assert.ok(cancelled.cancelledAt);
    assert.throws(() => cancelBlock(core, k.id), (err: unknown) => err instanceof AppError && err.messageKey === "errors.stays.blockCancelled");
    assert.throws(() => updateBlock(core, { ...blockInput(p.roomC, "2026-11-08", "2026-11-12"), id: k.id }), /removed/);
    createManualReservation(core, manual(p.unitA2, "2026-11-09", "2026-11-11"));
    createTenancy(core, tenancyInput(p.bed2, "2026-11-10", null));
    closeCore(core);
  });

  it("checks the maintenance link and lists by overlapping range", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const other = createPropertyFromPlan(core, {
      property: { ...PROPERTY_BASE, name: "Other" },
      units: [{ kind: "unit", label: "X", rentalMode: "whole_unit", floor: "", sizeSqft: null, bedrooms: null, roomType: null, defaultRentSen: 0, children: [] }],
    });
    const mOther = createMaintenance(core, maintenanceInput(other, null, "high"));
    const mHere = createMaintenance(core, maintenanceInput(p.propertyId, p.unitA2, "high"));
    assert.throws(() => createBlock(core, { ...blockInput(p.unitA2, "2026-10-01", "2026-10-02"), maintenanceId: mOther.id }), /same property/);
    const k1 = createBlock(core, { ...blockInput(p.unitA2, "2026-10-01", "2026-10-02"), maintenanceId: mHere.id });
    const k2 = createBlock(core, blockInput(getProperty(core, other).units[0].id, "2026-10-05", "2026-10-06"));
    cancelBlock(core, k2.id);
    assert.deepEqual(listBlocks(core, { from: "2026-10-02", to: "2026-10-05", propertyId: null, includeCancelled: false }).map((b) => b.id), [k1.id]);
    assert.deepEqual(listBlocks(core, { from: "2026-10-02", to: "2026-10-05", propertyId: null, includeCancelled: true }).map((b) => b.id), [k1.id, k2.id]);
    assert.deepEqual(listBlocks(core, { from: "2026-10-03", to: "2026-10-04", propertyId: null, includeCancelled: true }), []);
    assert.deepEqual(listBlocks(core, { from: "2026-10-01", to: "2026-10-30", propertyId: other, includeCancelled: true }).map((b) => b.id), [k2.id]);
    assert.ok(!validateBlockInput(blockInput(p.unitA2, "2026-10-05", "2026-10-04")).ok);
    closeCore(core);
  });
});

describe("reservations", () => {
  it("creates, lists, edits and cancels a manual booking with history", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const v = validateReservationCreate({ ...manual(p.unitA2, "2026-10-01", "2026-10-04"), channelReservationId: " REF-1 ", checkInTime: "14:00" });
    assert.ok(v.ok);
    const r = createManualReservation(core, v.value);
    assert.equal(r.source, "manual");
    assert.equal(r.nights, 3);
    assert.equal(r.datesLocked, false);
    assert.equal(r.channelReservationId, "REF-1");
    assert.ok(r.turnoverId);
    assert.deepEqual(r.events.map((e) => e.kind), ["created"]);
    assert.throws(() => createManualReservation(core, { ...v.value, checkIn: "2026-11-01", checkOut: "2026-11-02" }), conflict("errors.stays.duplicateReference"));

    const u = updateManualReservation(core, { id: r.id, guestName: "Renamed", guestCount: 3, checkIn: "2026-10-02", checkOut: "2026-10-05", checkInTime: "14:00", checkOutTime: null, status: "tentative", notes: "Late arrival" });
    assert.deepEqual([u.guestName, u.checkIn, u.status, u.notes], ["Renamed", "2026-10-02", "tentative", "Late arrival"]);
    assert.deepEqual(u.events.map((e) => e.kind), ["updated", "dates_changed", "created"]);

    assert.deepEqual(listReservations(core, { from: "2026-10-05", to: "2026-10-31", propertyId: null, spaceId: null, includeCancelled: false }).map((x) => x.id), [r.id], "a check-out on `from` is listed");
    assert.deepEqual(listReservations(core, { from: "2026-10-06", to: "2026-10-31", propertyId: null, spaceId: null, includeCancelled: false }), []);
    assert.deepEqual(listReservations(core, { from: "2026-10-01", to: "2026-10-31", propertyId: null, spaceId: p.roomA, includeCancelled: false }), []);

    const c = cancelManualReservation(core, r.id, "Changed plans");
    assert.deepEqual([c.status, c.cancelReason, c.turnoverStatus], ["cancelled", "Changed plans", "skipped"]);
    assert.throws(() => cancelManualReservation(core, r.id, ""), /already cancelled/);
    assert.deepEqual(listReservations(core, { from: "2026-10-01", to: "2026-10-31", propertyId: p.propertyId, spaceId: null, includeCancelled: false }), []);
    assert.equal(listReservations(core, { from: "2026-10-01", to: "2026-10-31", propertyId: p.propertyId, spaceId: null, includeCancelled: true }).length, 1);
    closeCore(core);
  });

  it("locks the dates of a booking synced from a live feed", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const conn = addConnection(core, p.unitA2, { name: "Airbnb A-2" });
    const id = stay(core, { spaceId: p.unitA2, guestName: "", checkIn: "2026-10-01", checkOut: "2026-10-04", connectionId: conn, source: "feed", channel: "airbnb", channelReservationId: "HM123" });
    const r = getReservation(core, id);
    assert.deepEqual([r.datesLocked, r.connectionName], [true, "Airbnb A-2"]);
    const base = { id, guestName: "", guestCount: null, checkIn: r.checkIn, checkOut: r.checkOut, checkInTime: null, checkOutTime: null, status: "confirmed" as const, notes: "" };
    assert.throws(
      () => updateManualReservation(core, { ...base, checkOut: "2026-10-05" }),
      (err: unknown) => err instanceof AppError && err.messageKey === "errors.stays.datesLocked" && err.params?.channel === "Airbnb",
    );
    assert.throws(() => updateManualReservation(core, { ...base, status: "tentative" }), /status comes from Airbnb/);
    const named = updateManualReservation(core, { ...base, guestName: "Aiko", guestCount: 2, checkInTime: "16:00" });
    assert.deepEqual([named.guestName, named.guestCount, named.checkInTime], ["Aiko", 2, "16:00"]);
    // A booking that vanished from the feed: the landlord confirms it was cancelled.
    markReservationMissing(core, id);
    assert.ok(getReservation(core, id).missingSince);
    assert.equal(cancelManualReservation(core, id, "Cancelled on Airbnb").status, "cancelled");
    // Once the connection is removed, a synced booking is editable.
    const id2 = stay(core, { spaceId: p.unitA2, checkIn: "2026-10-10", checkOut: "2026-10-12", connectionId: conn, source: "feed", channel: "airbnb", channelReservationId: "HM124" });
    core.db.run("UPDATE channel_connections SET removed_at = ? WHERE id = ?", [FIXED_NOW.toISOString(), conn]);
    const r2 = getReservation(core, id2);
    assert.equal(r2.datesLocked, false);
    updateManualReservation(core, { ...base, id: id2, checkIn: "2026-10-10", checkOut: "2026-10-13" });
    closeCore(core);
  });

  it("returns the ledger with voided rows, and validates input", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const r = createManualReservation(core, manual(p.unitA2, "2026-10-01", "2026-10-03"));
    const now = FIXED_NOW.toISOString();
    for (const [id, voided] of [["l1", null], ["l2", now]] as const) {
      core.db.run(
        `INSERT INTO stay_ledger (id, reservation_id, property_id, space_id, channel, kind, amount_sen, occurred_on, source, voided_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'direct', 'booking_value', 30000, '2026-10-01', 'entered', ?, ?, ?)`,
        [id, r.id, p.propertyId, p.unitA2, voided, now, now],
      );
    }
    const ledger = getReservation(core, r.id).ledger;
    assert.deepEqual(ledger.map((l) => [l.id, l.voidedAt, l.spacePath, l.source]), [["l1", null, "A-2", "entered"], ["l2", now, "A-2", "entered"]]);

    const bad = validateReservationCreate({ ...manual(p.unitA2, "2026-10-03", "2026-10-03"), guestCount: 0, checkInTime: "3pm", channel: "booking_com", status: "cancelled" });
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.fields).sort(), ["channel", "checkInTime", "checkOut", "guestCount", "status"]);
    assert.ok(!validateReservationCreate(manual(p.unitA2, "2026-01-01", "2027-01-02")).ok, "more than 365 nights");
    assert.ok(validateCalendarParams({ from: "2026-10-01", to: "2027-01-28", propertyId: null }).ok);
    assert.ok(!validateCalendarParams({ from: "2026-10-01", to: "2027-01-29", propertyId: null }).ok);
    closeCore(core);
  });
});
