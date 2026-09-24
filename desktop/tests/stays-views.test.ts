import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiErrorShape } from "../../lib/api/contract";
import { acknowledgeBlock } from "../core/channels/pending";
import { closeCore } from "../core/context";
import { AppError } from "../core/errors";
import type { HandlerContext } from "../core/handler-utils";
import { stayHandlers } from "../core/handlers-stays";
import { MemorySecretStore } from "../core/integrations/channels";
import { seedSampleWorkspace } from "../core/sample";
import { createBlock } from "../core/services/blocks";
import { createMaintenance } from "../core/services/maintenance";
import { createPropertyFromPlan, getProperty } from "../core/services/properties";
import { changeReservationDates, markReservationMissing } from "../core/services/reservations";
import { stayAlerts } from "../core/services/stay-alerts";
import { NO_CHANNEL_RUNTIME, type ChannelRuntime } from "../core/services/stay-channels";
import { stayCalendar, stayDay } from "../core/services/stay-views";
import { createTenancy } from "../core/services/tenancies";
import { FIXED_NOW, makeCore, PROPERTY_BASE, seedProperty } from "./helpers";
import { addChannelEvent, addConnection, maintenanceInput, stay, tenancyInput } from "./stays-helpers";

const withLinks: ChannelRuntime = { hasFeedLink: () => true, isRunning: () => false };
const hoursAgo = (h: number) => new Date(FIXED_NOW.getTime() - h * 3_600_000).toISOString();

function otherProperty(core: ReturnType<typeof makeCore>) {
  const id = createPropertyFromPlan(core, {
    property: { ...PROPERTY_BASE, name: "Zeta House" },
    units: [{ kind: "unit", label: "Z-1", rentalMode: "whole_unit", floor: "", sizeSqft: null, bedrooms: null, roomType: null, defaultRentSen: 0, children: [] }],
  });
  return { propertyId: id, unit: getProperty(core, id).units[0].id };
}

describe("day view", () => {
  it("buckets arrivals, departures, in-house, turnovers and relevant maintenance", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const z = otherProperty(core);
    addConnection(core, p.unitA2);
    const arriving = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-23", checkOut: "2026-09-25" });
    const leaving = stay(core, { spaceId: p.roomA, checkIn: "2026-09-20", checkOut: "2026-09-23" });
    const staying = stay(core, { spaceId: p.roomB, checkIn: "2026-09-21", checkOut: "2026-09-26" });
    const earlier = stay(core, { spaceId: p.bed1, checkIn: "2026-09-19", checkOut: "2026-09-23" });
    changeReservationDates(core, earlier, { checkIn: "2026-09-19", checkOut: "2026-09-22" }, "manual");
    stay(core, { spaceId: p.bed2, checkIn: "2026-09-24", checkOut: "2026-09-26" });
    const mUnit = createMaintenance(core, maintenanceInput(p.propertyId, p.unitA1, "standard", "Unit repair"));
    const mProperty = createMaintenance(core, maintenanceInput(p.propertyId, null, "low", "Lift"));
    createMaintenance(core, maintenanceInput(z.propertyId, z.unit, "critical", "Elsewhere"));

    const day = stayDay(core, "2026-09-23", withLinks);
    assert.deepEqual(day.arrivals.map((r) => r.id), [arriving]);
    assert.deepEqual(day.departures.map((r) => r.id), [leaving]);
    assert.deepEqual(day.inHouse.map((r) => r.id), [staying]);
    assert.deepEqual(day.turnovers.map((t) => t.reservationId), [earlier, leaving]);
    assert.deepEqual(day.maintenance.map((m) => m.id).sort(), [mUnit.id, mProperty.id].sort());
    assert.deepEqual(day.channels, { total: 1, active: 1, stale: 0, failing: 0, oldestSuccessAt: FIXED_NOW.toISOString() });
    assert.equal(day.today, "2026-09-23");
    closeCore(core);
  });
});

describe("calendar", () => {
  it("builds rows with own and inherited items, channel events and tenancies", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const conn = addConnection(core, p.unitA2);
    const r1 = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-24", checkOut: "2026-09-27", guestName: "", channel: "airbnb", connectionId: conn, source: "feed" });
    markReservationMissing(core, r1);
    const r2 = stay(core, { spaceId: p.bed1, checkIn: "2026-09-25", checkOut: "2026-09-28", guestName: "Bed Guest" });
    const tn = createTenancy(core, tenancyInput(p.roomC, "2026-10-01", null));
    const k = createBlock(core, { spaceId: p.unitA1, startDate: "2026-09-29", endDate: "2026-09-30", reason: "owner_stay", maintenanceId: null, notes: "" });
    const cb = addChannelEvent(core, conn, { kind: "block", state: "applied", start: "2026-10-03", end: "2026-10-05" });
    const cf = addChannelEvent(core, conn, { kind: "reservation", state: "conflict", start: "2026-10-06", end: "2026-10-08", code: "HMCLASH" });
    addChannelEvent(core, conn, { kind: "block", state: "dismissed", start: "2026-10-06", end: "2026-10-08" });

    const cal = stayCalendar(core, { from: "2026-09-20", to: "2026-10-10", propertyId: null }, withLinks);
    assert.deepEqual(cal.rows.map((r) => r.spacePath), ["A-1", "A-1 › Room C › Bed 1", "A-2"]);
    const [unitRow, bedRow, a2] = cal.rows;
    assert.deepEqual(a2.connection && { id: a2.connection.id, health: a2.connection.health }, { id: conn, health: "ok" });
    assert.deepEqual(a2.items.map((i) => [i.kind, i.id, i.start, i.endExclusive]), [
      ["reservation", r1, "2026-09-24", "2026-09-27"],
      ["channel_block", cb, "2026-10-03", "2026-10-05"],
      ["conflict", cf, "2026-10-06", "2026-10-08"],
    ]);
    assert.equal(a2.items[0].missing, true);
    assert.equal(a2.items[0].label, "Airbnb guest");
    assert.equal(a2.items[2].label, "HMCLASH");
    // Bed 1: its own stay, the unit's block and the room's open-ended tenancy (capped at to + 1).
    assert.deepEqual(bedRow.items.map((i) => [i.kind, i.id, i.endExclusive, i.viaSpacePath]), [
      ["reservation", r2, "2026-09-28", null],
      ["block", k.id, "2026-10-01", "A-1"],
      ["tenancy", tn.id, "2026-10-11", "A-1 › Room C"],
    ]);
    assert.equal(bedRow.items[1].label, "Owner stay");
    assert.deepEqual(unitRow.items.map((i) => [i.kind, i.viaSpacePath]), [["reservation", "A-1 › Room C › Bed 1"], ["block", null], ["tenancy", "A-1 › Room C"]]);

    // With a property filter every lettable space is a row.
    const byProperty = stayCalendar(core, { from: "2026-09-20", to: "2026-10-10", propertyId: p.propertyId }, NO_CHANNEL_RUNTIME);
    assert.deepEqual(byProperty.rows.map((r) => r.spacePath), ["A-1", "A-1 › Room A", "A-1 › Room B", "A-1 › Room C", "A-1 › Room C › Bed 1", "A-2"]);
    assert.equal(byProperty.rows.at(-1)!.connection!.health, "feed_link_missing");
    assert.throws(
      () => stayCalendar(core, { from: "2026-09-01", to: "2026-12-30", propertyId: null }, withLinks),
      (err: unknown) => err instanceof AppError && err.messageKey === "errors.stays.calendarRange",
    );
    closeCore(core);
  });
});

describe("alerts", () => {
  it("fires each kind with a stable id, most urgent first", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const z = otherProperty(core);
    const good = addConnection(core, p.unitA2, { name: "A-2 listing" });
    const stale = addConnection(core, p.roomB, { name: "Room B listing", lastSuccessAt: hoursAgo(3) });
    const noLink = addConnection(core, z.unit, { name: "Zeta listing" });
    addConnection(core, p.roomC, { status: "paused", lastSuccessAt: null });
    const runtime: ChannelRuntime = { hasFeedLink: (id) => id !== noLink, isRunning: () => false };

    const clash = addChannelEvent(core, good, { kind: "reservation", state: "conflict", start: "2026-10-01", end: "2026-10-03" });
    addChannelEvent(core, good, { kind: "reservation", state: "conflict", start: "2026-09-01", end: "2026-09-03" }); // over
    const missing = stay(core, { spaceId: p.unitA2, checkIn: "2026-10-10", checkOut: "2026-10-12", connectionId: good, source: "feed", channel: "airbnb", guestName: "" });
    markReservationMissing(core, missing);
    const today = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-21", checkOut: "2026-09-23" });
    const later = stay(core, { spaceId: z.unit, checkIn: "2026-09-24", checkOut: "2026-09-26" });
    const early = stay(core, { spaceId: p.bed1, checkIn: "2026-09-19", checkOut: "2026-09-23" });
    changeReservationDates(core, early, { checkIn: "2026-09-19", checkOut: "2026-09-22" }, "manual");
    const arrival = stay(core, { spaceId: p.roomA, guestName: "Arriving", checkIn: "2026-09-25", checkOut: "2026-09-27" });
    const m = createMaintenance(core, maintenanceInput(p.propertyId, p.unitA1, "critical", "No water"));
    stay(core, { spaceId: p.unitA2, checkIn: "2026-09-26", checkOut: "2026-09-27" }); // beyond the 2-day lookahead

    const all = stayAlerts(core, runtime);
    // Dates taken in HavenOS that the channel still shows open (channels/pending.ts): the
    // direct stay on A-2 and the stay on Zeta's unit. Acknowledged ranges drop out.
    assert.deepEqual(
      all.filter((a) => a.kind === "block_not_on_channel").map((a) => [a.id, a.severity, a.params.connection]),
      [
        [`block_not_on_channel:${noLink}:2026-09-24:2026-09-25`, "warning", "Zeta listing"],
        [`block_not_on_channel:${good}:2026-09-26:2026-09-26`, "warning", "A-2 listing"],
      ],
    );
    acknowledgeBlock(core, good, "2026-09-26", "2026-09-26", true);
    assert.equal(stayAlerts(core, runtime).filter((a) => a.kind === "block_not_on_channel").length, 1);
    const alerts = all.filter((a) => a.kind !== "block_not_on_channel");
    const tv = (rid: string) => core.db.get<{ id: string }>("SELECT id FROM turnovers WHERE reservation_id = ?", [rid])!.id;
    assert.deepEqual(
      alerts.map((a) => [a.id, a.severity]),
      [
        [`late_turnover:${tv(early)}`, "critical"],
        [`unassigned_turnover:${tv(early)}`, "critical"],
        [`unassigned_turnover:${tv(today)}`, "critical"],
        [`arrival_with_critical_maintenance:${arrival}`, "critical"],
        [`conflict:${clash}`, "critical"],
        [`unassigned_turnover:${tv(later)}`, "warning"],
        [`missing_from_feed:${missing}`, "warning"],
        [`stale_feed:${stale}`, "warning"],
        [`sync_failed:${noLink}`, "warning"],
      ],
    );
    const byKind = Object.fromEntries(alerts.map((a) => [a.id.split(":")[0], a]));
    assert.equal(byKind.arrival_with_critical_maintenance.href, `/maintenance/view/?id=${m.id}`);
    assert.equal(byKind.arrival_with_critical_maintenance.params.title, "No water");
    assert.equal(byKind.sync_failed.params.error, "feed_link_missing");
    assert.equal(byKind.conflict.href, `/settings/channels/?id=${good}`);
    assert.equal(byKind.missing_from_feed.href, `/stays/reservation/?id=${missing}`);
    closeCore(core);
  });
});

describe("sample workspace", () => {
  it("seeds a short-stay slice the views can show", () => {
    const core = makeCore();
    seedSampleWorkspace(core);
    const day = stayDay(core, core.today(), NO_CHANNEL_RUNTIME);
    assert.ok(day.arrivals.length >= 1 && day.departures.length >= 1 && day.inHouse.length >= 1);
    assert.ok(day.turnovers.some((t) => t.status === "done") && day.turnovers.some((t) => t.late));
    const kinds = new Set(stayAlerts(core, NO_CHANNEL_RUNTIME).map((a) => a.kind));
    for (const k of ["conflict", "missing_from_feed", "late_turnover", "unassigned_turnover", "sync_failed", "arrival_with_critical_maintenance"] as const) {
      assert.ok(kinds.has(k), `sample shows a ${k} alert`);
    }
    const cal = stayCalendar(core, { from: core.today(), to: "2026-11-20", propertyId: null }, NO_CHANNEL_RUNTIME);
    assert.ok(cal.rows.filter((r) => r.connection).length === 3);
    assert.ok(cal.rows.some((r) => r.items.some((i) => i.kind === "conflict")));
    assert.equal(core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM stay_ledger WHERE source = 'imported' AND import_id IS NOT NULL")!.n, 4);
    assert.equal(core.db.all("PRAGMA foreign_key_check").length, 0);
    closeCore(core);
  });
});

describe("stay handlers", () => {
  it("validate untrusted params and use the scheduler's view of each feed", async () => {
    const core = makeCore();
    const p = seedProperty(core);
    const conn = addConnection(core, p.unitA2);
    const secrets = new MemorySecretStore();
    secrets.set(conn, "https://example.invalid/feed.ics");
    const ctx = { core: () => core, channels: { secrets, running: () => [conn], nextSyncAt: () => null, syncNow: async () => {} } } as unknown as HandlerContext;
    const h = stayHandlers(ctx);
    const fails = (fn: () => unknown, code = "VALIDATION") =>
      assert.throws(fn, (err: unknown) => err instanceof AppError && (err.toShape() as ApiErrorShape).code === code);
    fails(() => h["reservations.list"]({ from: "2026-13-01", to: "2026-10-01" }));
    fails(() => h["reservations.create"]({ spaceId: "../../etc", checkIn: "2026-10-01", checkOut: "2026-10-02", status: "confirmed", channel: "direct" }));
    fails(() => h["reservations.get"]({ id: 42 }));
    fails(() => h["blocks.create"]({ spaceId: p.unitA2, startDate: "2026-10-02", endDate: "2026-10-01", reason: "maintenance" }));
    fails(() => h["turnovers.list"]({ status: "whatever" }));
    fails(() => h["stays.day"]({}));
    fails(() => h["stays.calendar"]({ from: "2026-09-01", to: "2027-09-01" }));
    fails(() => h["reservations.get"]({ id: "missing" }), "NOT_FOUND");
    const created = h["reservations.create"]({ spaceId: p.unitA2, guestName: "IPC Guest", checkIn: "2026-10-01", checkOut: "2026-10-02", status: "confirmed", channel: "direct", notes: "" });
    assert.equal((await created).guestName, "IPC Guest");
    const cal = await h["stays.calendar"]({ from: "2026-09-20", to: "2026-10-10", propertyId: null });
    assert.equal(cal.rows.find((r) => r.spaceId === p.unitA2)!.connection!.health, "syncing");
    assert.deepEqual(await h["turnovers.list"]({}), await h["turnovers.list"]({ status: "open" }));
    assert.ok(Array.isArray(await h["stays.alerts"](undefined)));
    closeCore(core);
  });
});
