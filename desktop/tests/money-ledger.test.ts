import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LedgerInput } from "../../lib/api/contract";
import { AppError } from "../core/errors";
import type { HandlerContext } from "../core/handler-utils";
import { moneyHandlers } from "../core/handlers-money";
import { createLedgerEntry, listLedger, validateLedgerInput, voidLedgerEntry } from "../core/services/ledger";
import { insertReservation } from "../core/services/reservations";
import { makeCore, seedProperty } from "./helpers";

function setup() {
  const core = makeCore();
  const p = seedProperty(core);
  const q = seedProperty(core);
  const stay = insertReservation(core, {
    spaceId: p.unitA2, guestName: "Guest", guestCount: null, checkIn: "2026-10-01", checkOut: "2026-10-04", checkInTime: null, checkOutTime: null,
    status: "confirmed", channel: "airbnb", channelReservationId: "HMLEDGER01", connectionId: null, source: "manual", notes: "",
  });
  return { core, p, q, stay };
}

const input = (propertyId: string, extra: Partial<LedgerInput> = {}): LedgerInput => ({
  reservationId: null, propertyId, spaceId: null, channel: "direct", kind: "booking_value", amountSen: 50000, occurredOn: "2026-10-01", category: "", description: "", ...extra,
});

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof AppError && err.code === "VALIDATION", String(err));
    return { ...(err.fields ?? {}) };
  }
  assert.fail("expected a validation error");
}

const validated = (v: unknown) => {
  const r = validateLedgerInput(v);
  if (!r.ok) throw new AppError("VALIDATION", null, { fields: r.fields });
  return r.value;
};

describe("stay ledger", () => {
  it("records entered amounts, takes the stay's space and channel, lists and voids", () => {
    const { core, p, stay } = setup();
    const e = createLedgerEntry(core, input(p.propertyId, { reservationId: stay, channel: "direct", kind: "cleaning_fee", amountSen: 6000 }));
    assert.equal(e.source, "entered");
    assert.equal(e.spaceId, p.unitA2);
    assert.equal(e.channel, "airbnb", "a stay's money belongs to its channel");
    assert.equal(e.spacePath, "A-2");
    assert.equal(e.propertyName, "Test Residences");
    const adj = createLedgerEntry(core, input(p.propertyId, { kind: "adjustment", amountSen: -1500, occurredOn: "2026-10-05" }));
    const exp = createLedgerEntry(core, input(p.propertyId, { kind: "expense", category: "laundry", amountSen: 2000, spaceId: p.roomA, occurredOn: "2026-11-01" }));
    assert.equal(exp.category, "laundry");

    voidLedgerEntry(core, adj.id);
    assert.throws(() => voidLedgerEntry(core, adj.id), (err: unknown) => err instanceof AppError && err.code === "NOT_ALLOWED" && err.messageKey === "errors.money.entryVoided");
    assert.throws(() => voidLedgerEntry(core, "nope"), (err: unknown) => err instanceof AppError && err.code === "NOT_FOUND");

    const october = listLedger(core, { from: "2026-10-01", to: "2026-10-31", propertyId: null, reservationId: null });
    assert.deepEqual(october.map((r) => r.id), [adj.id, e.id]);
    assert.ok(october[0].voidedAt, "voided entries stay listed");
    assert.deepEqual(listLedger(core, { from: "2026-01-01", to: "2026-12-31", propertyId: null, reservationId: stay }).map((r) => r.id), [e.id]);
    assert.equal(listLedger(core, { from: "2026-01-01", to: "2026-12-31", propertyId: p.propertyId, reservationId: null }).length, 3);
  });

  it("validates the input shape", () => {
    const { p } = setup();
    assert.deepEqual(fieldsOf(() => validated(input(p.propertyId, { amountSen: -100 }))), { amountSen: "errors.money.negativeAmount" });
    assert.deepEqual(fieldsOf(() => validated(input(p.propertyId, { amountSen: 0 }))), { amountSen: "validation.amountPositive" });
    assert.deepEqual(fieldsOf(() => validated(input(p.propertyId, { kind: "adjustment", amountSen: 0 }))), { amountSen: "errors.money.amountZero" });
    assert.deepEqual(fieldsOf(() => validated(input(p.propertyId, { amountSen: 12.5 }))), { amountSen: "validation.invalidAmount" });
    assert.deepEqual(fieldsOf(() => validated(input(p.propertyId, { amountSen: 10_000_000_000 }))), { amountSen: "validation.amountTooLarge" });
    assert.deepEqual(fieldsOf(() => validated(input(p.propertyId, { kind: "expense" }))), { category: "errors.money.expenseCategory" });
    assert.deepEqual(fieldsOf(() => validated(input(p.propertyId, { category: "bribes" as never }))), { category: "validation.chooseOne" });
    assert.deepEqual(fieldsOf(() => validated(input(p.propertyId, { description: "x".repeat(501) }))), { description: "validation.tooLong" });
    assert.deepEqual(fieldsOf(() => validated(input(p.propertyId, { occurredOn: "2026-02-30" }))), { occurredOn: "validation.invalidDate" });
    assert.deepEqual(fieldsOf(() => validated({ ...input(p.propertyId), kind: "gift", channel: "tiktok" })), { kind: "validation.chooseOne", channel: "validation.chooseOne" });
    // Category is dropped for kinds other than expense.
    assert.equal(validated(input(p.propertyId, { category: "cleaning" })).category, "");
    assert.equal(validated(input(p.propertyId, { description: "x".repeat(500) })).description.length, 500);
  });

  it("checks links against the database", () => {
    const { core, p, q, stay } = setup();
    assert.deepEqual(fieldsOf(() => createLedgerEntry(core, input(q.propertyId, { reservationId: stay }))), { reservationId: "errors.money.reservationMismatch" });
    assert.deepEqual(fieldsOf(() => createLedgerEntry(core, input(p.propertyId, { reservationId: stay, spaceId: p.roomA }))), { reservationId: "errors.money.reservationMismatch" });
    assert.deepEqual(fieldsOf(() => createLedgerEntry(core, input(p.propertyId, { reservationId: "missing" }))), { reservationId: "errors.notFound" });
    assert.deepEqual(fieldsOf(() => createLedgerEntry(core, input(p.propertyId, { spaceId: q.unitA2 }))), { spaceId: "errors.money.spaceNotInProperty" });
    assert.deepEqual(fieldsOf(() => createLedgerEntry(core, input("nope"))), { propertyId: "errors.money.propertyMissing" });
    assert.equal(core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM stay_ledger")?.n, 0);
  });

  it("handlers validate params strictly", async () => {
    const { core, p } = setup();
    const h = moneyHandlers({ core: () => core } as unknown as HandlerContext);
    const created = await h["ledger.create"](input(p.propertyId, { amountSen: 1000 }));
    assert.equal(created.amountSen, 1000);
    assert.throws(() => h["ledger.create"]({ ...input(p.propertyId), amountSen: "10" }), (e: unknown) => e instanceof AppError && e.fields?.amountSen === "validation.invalidAmount");
    assert.throws(() => h["ledger.list"]({ from: "2026-10-31", to: "2026-10-01", propertyId: null, reservationId: null }), (e: unknown) => e instanceof AppError && e.fields?.to === "validation.endBeforeStart");
    assert.throws(() => h["ledger.list"]({ from: "x", to: "2026-10-01" }), (e: unknown) => e instanceof AppError && e.fields?.from === "validation.invalidDate");
    assert.throws(() => h["ledger.void"]({ id: "../etc" }), (e: unknown) => e instanceof AppError && e.code === "VALIDATION");
    assert.equal(h["ledger.void"]({ id: created.id }), null);
    assert.throws(() => h["stays.performance"]({ from: "2025-01", to: "2027-01", groupBy: "space", propertyId: null }), (e: unknown) => e instanceof AppError && e.fields?.to === "errors.money.rangeTooLong");
    assert.throws(() => h["stays.performance"]({ from: "2026-10", to: "2026-09", groupBy: "space", propertyId: null }), (e: unknown) => e instanceof AppError && e.fields?.to === "validation.endBeforeStart");
    assert.throws(() => h["stays.performance"]({ from: "2026-09", to: "2026-10", groupBy: "guest", propertyId: null }), (e: unknown) => e instanceof AppError && e.fields?.groupBy === "validation.chooseOne");
    const report = h["stays.performance"]({ from: "2025-11", to: "2027-10", groupBy: "month", propertyId: null }) as { rows: unknown[] };
    assert.equal(report.rows.length, 24);
  });
});
