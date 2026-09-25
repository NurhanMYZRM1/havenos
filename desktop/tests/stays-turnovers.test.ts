import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays } from "../../lib/domain/dates";
import { DEFAULT_TURNOVER_CHECKLIST } from "../../lib/domain/short-stay";
import { closeCore } from "../core/context";
import { AppError } from "../core/errors";
import { importFiles } from "../core/services/attachments";
import { cancelReservation, changeReservationDates, updateReservationDetails } from "../core/services/reservations";
import { validateTurnoverUpdate } from "../core/services/stay-validate";
import { getTurnover, listTurnovers, updateTurnover } from "../core/services/turnovers";
import { stayDay } from "../core/services/stay-views";
import { NO_CHANNEL_RUNTIME } from "../core/services/stay-channels";
import { clock, makeCore, seedProperty, TINY_PNG } from "./helpers";
import { addConnection, stay, turnoverIdFor } from "./stays-helpers";

const turnoverRow = (core: ReturnType<typeof makeCore>, reservationId: string) =>
  core.db.get<{ due_date: string; checkout_time: string; status: string; checklist: string; completed_at: string | null }>(
    "SELECT due_date, checkout_time, status, checklist, completed_at FROM turnovers WHERE reservation_id = ?",
    [reservationId],
  );

describe("turnovers follow their reservation", () => {
  it("is created on insert with the right due date, time and checklist", () => {
    const core = makeCore();
    const p = seedProperty(core);
    // Direct booking, no times: default 11:00 and the default checklist.
    const a = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-24", checkOut: "2026-09-26" });
    const ta = turnoverRow(core, a)!;
    assert.equal(ta.due_date, "2026-09-26");
    assert.equal(ta.checkout_time, "11:00");
    assert.equal(ta.status, "pending");
    assert.deepEqual(JSON.parse(ta.checklist), DEFAULT_TURNOVER_CHECKLIST.map((label) => ({ label, done: false })));
    // Feed booking: the connection's check-out time and checklist.
    const conn = addConnection(core, p.roomA, { checkOut: "10:30", checklist: ["Linen", "Floors"] });
    const b = stay(core, { spaceId: p.roomA, checkIn: "2026-09-24", checkOut: "2026-09-25", connectionId: conn, source: "feed", channel: "airbnb" });
    const tb = turnoverRow(core, b)!;
    assert.equal(tb.checkout_time, "10:30");
    assert.deepEqual(JSON.parse(tb.checklist), [{ label: "Linen", done: false }, { label: "Floors", done: false }]);
    // The stay's own time wins.
    const c = stay(core, { spaceId: p.roomB, checkIn: "2026-09-24", checkOut: "2026-09-25", checkOutTime: "09:00" });
    assert.equal(turnoverRow(core, c)!.checkout_time, "09:00");
    closeCore(core);
  });

  it("gives none to a stay that had already ended, but one to a stay ending today", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const old = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-10", checkOut: "2026-09-22" });
    assert.equal(turnoverRow(core, old), undefined);
    const endingToday = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-22", checkOut: "2026-09-23" });
    assert.equal(turnoverRow(core, endingToday)!.due_date, "2026-09-23");
    closeCore(core);
  });

  it("moves with date and time changes, skips on cancel, and a done turnover stays put", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const id = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-24", checkOut: "2026-09-26" });
    changeReservationDates(core, id, { checkIn: "2026-09-24", checkOut: "2026-09-28" }, "manual");
    assert.equal(turnoverRow(core, id)!.due_date, "2026-09-28");
    updateReservationDetails(core, id, { checkOutTime: "12:30" }, "manual");
    assert.equal(turnoverRow(core, id)!.checkout_time, "12:30");
    cancelReservation(core, id, "", "manual");
    assert.equal(turnoverRow(core, id)!.status, "skipped");

    const done = stay(core, { spaceId: p.roomA, checkIn: "2026-09-24", checkOut: "2026-09-25" });
    const t = getTurnover(core, turnoverIdFor(core, done));
    updateTurnover(core, { ...t, status: "done" });
    changeReservationDates(core, done, { checkIn: "2026-09-24", checkOut: "2026-09-26" }, "manual");
    cancelReservation(core, done, "", "manual");
    const row = turnoverRow(core, done)!;
    assert.deepEqual([row.due_date, row.status], ["2026-09-25", "done"]);
    closeCore(core);
  });
});

describe("turnover computed fields", () => {
  it("reads 2,000 reservations with one windowed next-arrival query", () => {
    const core = makeCore();
    try {
      const p = seedProperty(core);
      const ids: string[] = [];
      core.db.tx(() => {
        for (let i = 0; i < 2000; i++) {
          ids.push(stay(core, { spaceId: p.unitA2, checkIn: addDays(core.today(), i), checkOut: addDays(core.today(), i + 1) }));
        }
      });
      const started = performance.now();
      const items = listTurnovers(core, { from: null, to: null, status: "all", propertyId: null });
      const listMs = performance.now() - started;
      assert.equal(items.length, 2000);
      for (let i = 0; i < 1999; i++) assert.equal(items[i].nextCheckIn?.reservationId, ids[i + 1]);
      assert.equal(items[1999].nextCheckIn, null);
      assert.ok(listMs < 2000, `Turnover list took ${listMs.toFixed(0)}ms`);
      const dayStarted = performance.now();
      const day = stayDay(core, addDays(core.today(), 1000), NO_CHANNEL_RUNTIME);
      assert.ok(day.turnovers.length > 0);
      assert.ok(performance.now() - dayStarted < 2000, "Day view must stay responsive with 2,000 stays");
    } finally {
      closeCore(core);
    }
  });

  it("finds the next check-in on the same or an overlapping space, the window, late and unassigned", () => {
    const c = clock();
    const core = makeCore(undefined, c.now);
    const p = seedProperty(core);
    const conn = addConnection(core, p.unitA2, { checkIn: "14:00", checkOut: "11:00" });
    const a = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-21", checkOut: "2026-09-25", connectionId: conn, source: "feed", channel: "airbnb" });
    const b = stay(core, { spaceId: p.unitA2, guestName: "Next Guest", checkIn: "2026-09-25", checkOut: "2026-09-27", connectionId: conn, source: "feed", channel: "airbnb" });
    let t = getTurnover(core, turnoverIdFor(core, a));
    assert.deepEqual(t.nextCheckIn, { reservationId: b, date: "2026-09-25", time: "14:00", guestName: "Next Guest" });
    assert.equal(t.windowHours, 3);
    assert.equal(t.unassigned, true);
    assert.equal(t.late, false);
    // 25 Sep 13:59 KL: not late; 14:01: late (the next guest has arrived).
    c.set("2026-09-25T05:59:00.000Z");
    assert.equal(getTurnover(core, t.id).late, false);
    c.set("2026-09-25T06:01:00.000Z");
    t = getTurnover(core, t.id);
    assert.equal(t.late, true);
    t = updateTurnover(core, { ...t, assigneeName: "Kak Ros" });
    assert.equal(t.unassigned, false);
    t = updateTurnover(core, { ...t, status: "done" });
    assert.deepEqual([t.late, t.unassigned], [false, false]);

    // Room A stay; the next arrival is on the unit containing it. No time → 15:00.
    const r = stay(core, { spaceId: p.roomA, checkIn: "2026-09-25", checkOut: "2026-09-28" });
    const u = stay(core, { spaceId: p.unitA1, checkIn: "2026-09-29", checkOut: "2026-09-30" });
    const tr = getTurnover(core, turnoverIdFor(core, r));
    assert.equal(tr.nextCheckIn?.reservationId, u);
    assert.equal(tr.nextCheckIn?.time, null);
    assert.equal(tr.windowHours, 28);

    // No next check-in: late once its due day is over.
    const last = getTurnover(core, turnoverIdFor(core, u));
    assert.equal(last.nextCheckIn, null);
    assert.equal(last.windowHours, null);
    c.set("2026-09-30T15:59:00.000Z"); // 23:59 KL on the due day
    assert.equal(getTurnover(core, last.id).late, false);
    c.set("2026-09-30T16:01:00.000Z"); // 00:01 KL next day
    assert.equal(getTurnover(core, last.id).late, true);
    closeCore(core);
  });

  it("lists by due date and status, and counts photos", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const a = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-24", checkOut: "2026-09-26" });
    const b = stay(core, { spaceId: p.roomA, checkIn: "2026-09-24", checkOut: "2026-09-25" });
    const tb = getTurnover(core, turnoverIdFor(core, b));
    updateTurnover(core, { ...tb, status: "done" });
    importFiles(core, { kind: "turnover", id: turnoverIdFor(core, a) }, "photo", [{ name: "bed.png", bytes: TINY_PNG }]);
    const open = listTurnovers(core, { from: null, to: null, status: "open", propertyId: null });
    assert.deepEqual(open.map((t) => t.reservationId), [a]);
    assert.equal(open[0].photoCount, 1);
    assert.equal(getTurnover(core, open[0].id).photos.length, 1);
    const all = listTurnovers(core, { from: "2026-09-25", to: "2026-09-26", status: "all", propertyId: p.propertyId });
    assert.deepEqual(all.map((t) => t.reservationId), [b, a]);
    assert.deepEqual(listTurnovers(core, { from: null, to: null, status: "done", propertyId: null }).map((t) => t.reservationId), [b]);
    closeCore(core);
  });
});

describe("turnover updates", () => {
  it("stamps completion, normalises the phone, and validates input", () => {
    const c = clock();
    const core = makeCore(undefined, c.now);
    const p = seedProperty(core);
    const id = stay(core, { spaceId: p.unitA2, checkIn: "2026-09-24", checkOut: "2026-09-26" });
    const t = getTurnover(core, turnoverIdFor(core, id));
    const input = (over: Record<string, unknown>) => validateTurnoverUpdate({ ...t, assigneePhone: "012-345 6789", ...over });
    const v = input({ status: "done" });
    assert.ok(v.ok);
    const done = updateTurnover(core, v.value);
    assert.equal(done.assigneePhone, "+60123456789");
    assert.equal(done.completedAt, c.now().toISOString());
    c.advanceDays(1);
    assert.equal(updateTurnover(core, { ...done, notes: "again" }).completedAt, done.completedAt, "staying done keeps the time");
    assert.equal(updateTurnover(core, { ...done, status: "in_progress" }).completedAt, null);

    const bad = input({ checklist: Array.from({ length: 41 }, (_, i) => ({ label: `Item ${i}`, done: false })), costSen: -1, checkoutTime: "25:00", status: "nope" });
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(bad.fields).sort(), ["checklist", "checkoutTime", "costSen", "status"]);
    const badLabel = input({ checklist: [{ label: "", done: false }, { label: "x".repeat(121), done: true }] });
    assert.ok(!badLabel.ok);
    assert.deepEqual(Object.keys(badLabel.fields).sort(), ["checklist.0.label", "checklist.1.label"]);
    assert.ok(!input({ assigneePhone: "call me" }).ok);

    // A cancelled stay's turnover can't be reopened.
    cancelReservation(core, id, "", "manual");
    assert.throws(
      () => updateTurnover(core, { ...done, status: "pending" }),
      (err: unknown) => err instanceof AppError && err.messageKey === "errors.stays.turnoverSkipped",
    );
    closeCore(core);
  });
});
