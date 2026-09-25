import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PerformanceRow } from "../../lib/api/contract";
import { FIXED_NOW, makeCore, seedProperty } from "./helpers";
import { createLedgerEntry, voidLedgerEntry } from "../core/services/ledger";
import { performanceReport } from "../core/services/performance";
import { createReservation, insertReservation } from "../core/services/reservations";

const NOW = FIXED_NOW.toISOString();

/**
 * Hand-computed scenario (September 2026, today = 23 Sep):
 *  A-2 (whole unit)
 *   - direct stay 10–13 Sep, 3 nights, entered booking value RM 600
 *   - Airbnb stay 28 Sep–2 Oct, 4 nights (3 in Sep), imported booking RM 800,
 *     fee RM 24, payout RM 776 on 29 Sep; turnover due 2 Oct costs RM 30
 *   - entered cleaning expense RM 50 on 15 Sep; a voided RM 999.99 entry
 *   - maintenance on A-2 done 20 Sep, RM 100; on Room B (never a short stay)
 *     RM 70 and property-level RM 200 — both left out
 *   - blocked 20–21 Sep (2 nights)
 *  Room A: an Airbnb stay 5–7 Sep synced from the calendar, no money.
 */
function scenario() {
  const core = makeCore();
  const p = seedProperty(core);
  createReservation(core, { spaceId: p.unitA2, guestName: "Direct", checkIn: "2026-09-10", checkOut: "2026-09-13", status: "confirmed", channel: "direct", channelReservationId: null, totalSen: 60000, notes: "" });
  const airbnb = insertReservation(core, {
    spaceId: p.unitA2, guestName: "", guestCount: null, checkIn: "2026-09-28", checkOut: "2026-10-02", checkInTime: null, checkOutTime: null,
    status: "confirmed", channel: "airbnb", channelReservationId: "HMPERF0001", connectionId: null, source: "feed", notes: "",
  });
  insertReservation(core, {
    spaceId: p.roomA, guestName: "", guestCount: null, checkIn: "2026-09-05", checkOut: "2026-09-07", checkInTime: null, checkOutTime: null,
    status: "confirmed", channel: "airbnb", channelReservationId: "HMPERF0002", connectionId: null, source: "feed", notes: "",
  });
  // A cancelled stay counts for nothing.
  const cancelled = insertReservation(core, {
    spaceId: p.roomB, guestName: "", guestCount: null, checkIn: "2026-09-01", checkOut: "2026-09-03", checkInTime: null, checkOutTime: null,
    status: "confirmed", channel: "airbnb", channelReservationId: "HMPERF0003", connectionId: null, source: "feed", notes: "",
  });
  core.db.run("UPDATE reservations SET status = 'cancelled', cancelled_at = ? WHERE id = ?", [NOW, cancelled]);
  let n = 0;
  const imported = (kind: string, amount: number, on: string) =>
    core.db.run(
      `INSERT INTO stay_ledger (id, reservation_id, property_id, space_id, channel, kind, amount_sen, occurred_on, source, external_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'airbnb', ?, ?, ?, 'imported', ?, ?, ?)`,
      [`imp${++n}`, airbnb, p.propertyId, p.unitA2, kind, amount, on, `test:${n}`, NOW, NOW],
    );
  imported("booking_value", 80000, "2026-09-29");
  imported("channel_fee", 2400, "2026-09-29");
  imported("payout", 77600, "2026-09-29");
  const base = { reservationId: null, propertyId: p.propertyId, spaceId: p.unitA2, channel: "direct" as const, description: "" };
  createLedgerEntry(core, { ...base, kind: "expense", category: "cleaning", amountSen: 5000, occurredOn: "2026-09-15" });
  voidLedgerEntry(core, createLedgerEntry(core, { ...base, kind: "expense", category: "other", amountSen: 99999, occurredOn: "2026-09-16" }).id);
  const turnover = core.db.get<{ id: string; due_date: string }>("SELECT id, due_date FROM turnovers WHERE reservation_id = ?", [airbnb]);
  assert.equal(turnover?.due_date, "2026-10-02", "turnover created by the ops package");
  core.db.run("UPDATE turnovers SET cost_sen = 3000 WHERE id = ?", [turnover!.id]);
  const maintenance = (ref: string, spaceId: string | null, cost: number) =>
    core.db.run(
      `INSERT INTO maintenance_requests (id, ref, property_id, space_id, title, category, priority, status, reported_on, completed_on, actual_cost_sen, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Fix', 'plumbing', 'standard', 'done', '2026-09-18', '2026-09-20', ?, ?, ?)`,
      [ref, ref, p.propertyId, spaceId, cost, NOW, NOW],
    );
  maintenance("M1", p.unitA2, 10000);
  maintenance("M2", p.roomB, 7000);
  maintenance("M3", null, 20000);
  core.db.run(
    `INSERT INTO availability_blocks (id, space_id, property_id, start_date, end_date, reason, created_at, updated_at) VALUES ('b1', ?, ?, '2026-09-20', '2026-09-21', 'maintenance', ?, ?)`,
    [p.unitA2, p.propertyId, NOW, NOW],
  );
  return { core, p };
}

const fig = (imported: number, entered: number) => ({ importedSen: imported, enteredSen: entered, totalSen: imported + entered });

describe("short-stay performance", () => {
  it("by space: imported and entered apart, expenses, occupancy with a block", () => {
    const { core, p } = scenario();
    const report = performanceReport(core, { from: "2026-09", to: "2026-09", groupBy: "space", propertyId: null });
    assert.deepEqual(report.rows.map((r) => r.key), [p.roomA, p.unitA2], "sorted by label");
    const a2 = report.rows[1];
    assert.equal(a2.label, "Test Residences · A-2");
    assert.deepEqual(
      { ...a2 },
      {
        key: p.unitA2,
        label: "Test Residences · A-2",
        stays: 2,
        nights: 6,
        occupancyPct: 21.4, // 6 ÷ (30 − 2)
        bookingValue: fig(80000, 60000),
        cleaningFees: fig(0, 0),
        channelFees: fig(2400, 0),
        taxes: fig(0, 0),
        payouts: fig(77600, 0),
        adjustments: fig(0, 0),
        expenses: fig(0, 15000), // RM 50 entered + RM 100 maintenance; the turnover is due in October
        estimatedNetSen: 140000 - 2400 - 15000,
        averageNightlySen: 20000, // RM 1,400 ÷ 7 nights
        staysWithoutMoney: 0,
      } satisfies PerformanceRow,
    );
    const roomA = report.rows[0];
    assert.deepEqual([roomA.stays, roomA.nights, roomA.occupancyPct, roomA.averageNightlySen, roomA.staysWithoutMoney, roomA.estimatedNetSen], [1, 2, 6.7, null, 1, 0]);
    assert.equal(report.totals.label, "Total");
    assert.deepEqual([report.totals.stays, report.totals.nights, report.totals.occupancyPct, report.totals.staysWithoutMoney], [3, 8, null, 1]);
    assert.deepEqual(report.totals.expenses, fig(0, 15000));
    assert.equal(report.totals.averageNightlySen, 20000);
  });

  it("by month: nights split across months, turnover cost on its due date", () => {
    const { core } = scenario();
    const report = performanceReport(core, { from: "2026-08", to: "2026-10", groupBy: "month", propertyId: null });
    assert.deepEqual(report.rows.map((r) => [r.key, r.label, r.stays, r.nights]), [
      ["2026-08", "August 2026", 0, 0],
      ["2026-09", "September 2026", 3, 8],
      ["2026-10", "October 2026", 0, 1],
    ]);
    const oct = report.rows[2];
    assert.deepEqual(oct.expenses, fig(0, 3000));
    assert.equal(oct.estimatedNetSen, -3000);
    assert.equal(oct.occupancyPct, null);
    assert.equal(report.totals.estimatedNetSen, 140000 - 2400 - 18000);
  });

  it("by channel and by property, with a property filter", () => {
    const { core, p } = scenario();
    const channel = performanceReport(core, { from: "2026-09", to: "2026-09", groupBy: "channel", propertyId: p.propertyId });
    assert.deepEqual(channel.rows.map((r) => [r.key, r.label, r.stays, r.bookingValue.totalSen, r.expenses.totalSen]), [
      ["direct", "Direct", 1, 60000, 5000],
      ["airbnb", "Airbnb", 2, 80000, 0],
      ["none", "Not tied to a channel", 0, 0, 10000],
    ]);
    const byProperty = performanceReport(core, { from: "2026-09", to: "2026-09", groupBy: "property", propertyId: null });
    assert.equal(byProperty.rows.length, 1);
    assert.equal(byProperty.rows[0].label, "Test Residences");
    assert.equal(byProperty.rows[0].occupancyPct, null);
    assert.equal(byProperty.rows[0].estimatedNetSen, 122600);
    const other = performanceReport(core, { from: "2026-09", to: "2026-09", groupBy: "property", propertyId: "someone-else" });
    assert.deepEqual(other.rows, []);
    assert.equal(other.totals.estimatedNetSen, 0);
  });

  it("attributes stay money to the check-in month, payouts to their own date", () => {
    const { core } = scenario();
    const oct = performanceReport(core, { from: "2026-10", to: "2026-10", groupBy: "space", propertyId: null });
    // The Airbnb stay checked in in September: nothing of its earnings lands in October.
    assert.equal(oct.totals.bookingValue.totalSen, 0);
    assert.equal(oct.totals.payouts.totalSen, 0);
    assert.equal(oct.totals.nights, 1);
    assert.equal(oct.totals.stays, 0);
  });

  it("shows signed imported and entered adjustments separately and counts them in net once", () => {
    const { core, p } = scenario();
    const stay = core.db.get<{ id: string }>("SELECT id FROM reservations WHERE channel_reservation_id = 'HMPERF0001'")!;
    const base = { reservationId: stay.id, propertyId: p.propertyId, spaceId: p.unitA2, channel: "airbnb" as const, description: "", category: "" as const, kind: "adjustment" as const, occurredOn: "2026-10-05" };
    createLedgerEntry(core, { ...base, amountSen: 1500 });
    const imported = createLedgerEntry(core, { ...base, amountSen: -5000 });
    core.db.run("UPDATE stay_ledger SET source = 'imported', external_ref = 'adjustment-test' WHERE id = ?", [imported.id]);
    const september = performanceReport(core, { from: "2026-09", to: "2026-09", groupBy: "month", propertyId: null }).totals;
    assert.deepEqual(september.adjustments, fig(-5000, 1500));
    assert.deepEqual(september.bookingValue, fig(80000, 60000));
    assert.deepEqual(september.payouts, fig(77600, 0));
    assert.equal(september.estimatedNetSen, 122600 - 3500);
    const october = performanceReport(core, { from: "2026-10", to: "2026-10", groupBy: "month", propertyId: null }).totals;
    assert.deepEqual(october.adjustments, fig(0, 0), "stay adjustments follow the check-in month");
    assert.deepEqual(october.payouts, fig(0, 0), "adjustments never also appear as payouts");
  });
});
