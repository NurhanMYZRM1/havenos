import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMonths, dueDateInMonth, isIsoDate, parseDayMonthYear, todayInMalaysia } from "../../lib/domain/dates";
import { formatDate, formatDateLong, formatMonth } from "../../lib/domain/format";
import { dateRangesOverlap, lettableSpaces, spacesOverlap } from "../../lib/domain/inventory";
import { formatRM, monthsOfRent, parseRinggit, senToDecimal } from "../../lib/domain/money";
import { emptyDraft, newUnit, planFromDraft, validateDraftStep } from "../../lib/domain/onboarding";
import { formatPhone, normalizePhone } from "../../lib/domain/phone";
import { allocatePayments, chargeState, lastBillableMonth, plannedRentCharges } from "../../lib/domain/rent";
import { defaultEndDate, defaultRentStartMonth, tenancyStatus } from "../../lib/domain/tenancy";

describe("money (integer sen)", () => {
  it("parses ringgit input without floating point", () => {
    assert.deepEqual(parseRinggit("1,250"), { ok: true, sen: 125000 });
    assert.deepEqual(parseRinggit("RM 1250.5"), { ok: true, sen: 125050 });
    assert.deepEqual(parseRinggit("0.10"), { ok: true, sen: 10 });
    assert.deepEqual(parseRinggit(".5"), { ok: true, sen: 50 });
    assert.deepEqual(parseRinggit("19.99"), { ok: true, sen: 1999 });
    assert.deepEqual(parseRinggit(""), { ok: false, error: "empty" });
    assert.deepEqual(parseRinggit("-5"), { ok: false, error: "negative" });
    assert.deepEqual(parseRinggit("1.234"), { ok: false, error: "too_precise" });
    assert.deepEqual(parseRinggit("abc"), { ok: false, error: "invalid" });
    assert.deepEqual(parseRinggit("123456789"), { ok: false, error: "too_large" });
  });

  it("formats as RM with grouping and two decimals", () => {
    assert.equal(formatRM(123450), "RM 1,234.50");
    assert.equal(formatRM(5), "RM 0.05");
    assert.equal(formatRM(100000000), "RM 1,000,000.00");
    assert.equal(formatRM(-2500), "−RM 25.00");
    assert.equal(formatRM(150000, { cents: "auto" }), "RM 1,500");
    assert.equal(senToDecimal(123405), "1234.05");
  });

  it("computes deposits as months of rent in integer arithmetic", () => {
    assert.equal(monthsOfRent(150000, 20), 300000); // 2 months
    assert.equal(monthsOfRent(150000, 5), 75000); // half a month
    assert.equal(monthsOfRent(33333, 5), 16667); // rounds half up to the sen
  });
});

describe("Malaysian phone numbers", () => {
  it("normalises common local formats to +60", () => {
    assert.deepEqual(normalizePhone("012-345 6789"), { ok: true, e164: "+60123456789" });
    assert.deepEqual(normalizePhone("+60 12 345 6789"), { ok: true, e164: "+60123456789" });
    assert.deepEqual(normalizePhone("60123456789"), { ok: true, e164: "+60123456789" });
    assert.deepEqual(normalizePhone("011-1234 5678"), { ok: true, e164: "+601112345678" });
    assert.deepEqual(normalizePhone("03-1234 5678"), { ok: true, e164: "+60312345678" });
    assert.deepEqual(normalizePhone("+44 20 7946 0958"), { ok: true, e164: "+442079460958" });
    assert.equal(normalizePhone("12345").ok, false);
    assert.equal(normalizePhone("call me").ok, false);
  });

  it("displays numbers in familiar groupings", () => {
    assert.equal(formatPhone("+60123456789"), "+60 12-345 6789");
    assert.equal(formatPhone("+601112345678"), "+60 11-1234 5678");
    assert.equal(formatPhone("+60312345678"), "+60 3-1234 5678");
  });
});

describe("dates in Malaysia", () => {
  it("computes today in Asia/Kuala_Lumpur regardless of the machine timezone", () => {
    // 20:00 UTC on 22 Sep is already 04:00 on 23 Sep in Kuala Lumpur.
    assert.equal(todayInMalaysia(new Date("2026-09-22T20:00:00Z")), "2026-09-23");
    assert.equal(todayInMalaysia(new Date("2026-09-22T15:59:00Z")), "2026-09-22");
  });

  it("validates, clamps and formats unambiguously", () => {
    assert.equal(isIsoDate("2026-02-29"), false);
    assert.equal(isIsoDate("2028-02-29"), true);
    assert.equal(dueDateInMonth("2026-02", 31), "2026-02-28");
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(parseDayMonthYear("7/3/2026"), "2026-03-07");
    assert.equal(formatDate("2026-03-07"), "7 Mar 2026");
    assert.equal(formatDateLong("2026-09-23"), "Wednesday, 23 September 2026");
    assert.equal(formatMonth("2026-09"), "September 2026");
  });
});

describe("rent schedule", () => {
  it("counts whole months from the start day", () => {
    assert.equal(lastBillableMonth("2026-01-15", "2027-01-14"), "2026-12");
    assert.equal(lastBillableMonth("2026-01-01", "2026-12-31"), "2026-12");
    assert.equal(lastBillableMonth("2026-01-15", "2026-03-20"), "2026-03");
    assert.equal(lastBillableMonth("2026-01-01", null), null);
  });

  it("plans one charge per month with the right due date", () => {
    const planned = plannedRentCharges(
      {
        startDate: "2026-01-15",
        endDate: "2027-01-14",
        movedOutOn: null,
        cancelledAt: null,
        rentStartMonth: "2026-01",
        schedule: [
          { effectiveMonth: "2026-01", amountSen: 100000, dueDay: 7 },
          { effectiveMonth: "2026-07", amountSen: 110000, dueDay: 7 },
        ],
      },
      "2027-06",
    );
    assert.equal(planned.length, 12);
    assert.equal(planned[0].dueDate, "2026-01-15"); // never due before the tenancy starts
    assert.equal(planned[1].dueDate, "2026-02-07");
    assert.equal(planned[5].amountSen, 100000);
    assert.equal(planned[6].amountSen, 110000);
    assert.equal(planned[11].period, "2026-12");
  });

  it("allocates payments oldest-first and derives charge states", () => {
    const charges = [
      { id: "a", dueDate: "2026-08-07", amountSen: 100000, createdAt: "1", voided: false },
      { id: "b", dueDate: "2026-09-07", amountSen: 100000, createdAt: "2", voided: false },
      { id: "c", dueDate: "2026-10-07", amountSen: 100000, createdAt: "3", voided: false },
    ];
    const alloc = allocatePayments(charges, [{ amountSen: 150000, voided: false }, { amountSen: 999999, voided: true }]);
    assert.equal(alloc.paidByCharge.get("a"), 100000);
    assert.equal(alloc.paidByCharge.get("b"), 50000);
    assert.equal(alloc.paidByCharge.get("c"), 0);
    assert.equal(alloc.balanceSen, 150000);
    const today = "2026-09-23";
    assert.equal(chargeState({ amountSen: 100000, paidSen: 100000, dueDate: "2026-08-07", today, voided: false }), "paid");
    assert.equal(chargeState({ amountSen: 100000, paidSen: 50000, dueDate: "2026-09-07", today, voided: false }), "overdue");
    assert.equal(chargeState({ amountSen: 100000, paidSen: 50000, dueDate: "2026-10-07", today, voided: false }), "part_paid");
    assert.equal(chargeState({ amountSen: 100000, paidSen: 0, dueDate: "2026-10-07", today, voided: false }), "due");
  });
});

describe("inventory overlap rules", () => {
  const unit = { id: "u", kind: "unit" as const, unitId: "u", roomId: null };
  const roomA = { id: "ra", kind: "room" as const, unitId: "u", roomId: "ra" };
  const roomB = { id: "rb", kind: "room" as const, unitId: "u", roomId: "rb" };
  const bedA1 = { id: "b1", kind: "bed" as const, unitId: "u", roomId: "ra" };
  const bedA2 = { id: "b2", kind: "bed" as const, unitId: "u", roomId: "ra" };
  const other = { id: "x", kind: "unit" as const, unitId: "x", roomId: null };

  it("a whole unit overlaps its rooms and beds; siblings do not", () => {
    assert.equal(spacesOverlap(unit, roomA), true);
    assert.equal(spacesOverlap(unit, bedA1), true);
    assert.equal(spacesOverlap(roomA, bedA1), true);
    assert.equal(spacesOverlap(roomA, roomB), false);
    assert.equal(spacesOverlap(bedA1, bedA2), false);
    assert.equal(spacesOverlap(roomB, bedA1), false);
    assert.equal(spacesOverlap(unit, other), false);
  });

  it("compares inclusive date ranges with open ends", () => {
    assert.equal(dateRangesOverlap("2026-01-01", "2026-06-30", "2026-06-30", null), true);
    assert.equal(dateRangesOverlap("2026-01-01", "2026-06-30", "2026-07-01", null), false);
    assert.equal(dateRangesOverlap("2026-01-01", null, "2030-01-01", "2030-02-01"), true);
  });

  it("counts lettable spaces by each unit's arrangement", () => {
    const spaces = lettableSpaces([
      { id: "u1", rentalMode: "whole_unit", archived: false, rooms: [{ id: "r", archived: false, beds: [] }] },
      { id: "u2", rentalMode: "by_room", archived: false, rooms: [{ id: "r1", archived: false, beds: [] }, { id: "r2", archived: true, beds: [] }] },
      { id: "u3", rentalMode: "by_bed", archived: false, rooms: [{ id: "r3", archived: false, beds: [{ id: "b1", archived: false }, { id: "b2", archived: false }] }] },
    ]);
    assert.deepEqual(spaces.map((s) => s.id), ["u1", "r1", "b1", "b2"]);
  });
});

describe("tenancy status", () => {
  const today = "2026-09-23";
  const base = { movedInOn: null, movedOutOn: null, cancelledAt: null };
  it("derives upcoming / active / expiring / ended / cancelled", () => {
    assert.equal(tenancyStatus({ ...base, startDate: "2026-10-01", endDate: null }, today), "upcoming");
    assert.equal(tenancyStatus({ ...base, startDate: "2026-01-01", endDate: "2026-12-31" }, today), "active");
    assert.equal(tenancyStatus({ ...base, startDate: "2026-01-01", endDate: "2026-11-15" }, today), "expiring");
    assert.equal(tenancyStatus({ ...base, startDate: "2025-01-01", endDate: "2025-12-31" }, today), "ended");
    assert.equal(tenancyStatus({ ...base, startDate: "2026-01-01", endDate: null, movedOutOn: "2026-09-01" }, today), "ended");
    assert.equal(tenancyStatus({ ...base, startDate: "2026-01-01", endDate: null, cancelledAt: "x" }, today), "cancelled");
  });
  it("suggests sensible defaults", () => {
    assert.equal(defaultEndDate("2026-01-15", 12), "2027-01-14");
    assert.equal(defaultRentStartMonth("2026-03-01", today), "2026-09");
    assert.equal(defaultRentStartMonth("2026-10-01", today), "2026-10");
  });
});

describe("onboarding draft validation", () => {
  it("flags each step's problems and builds a plan when complete", () => {
    const d = emptyDraft();
    assert.ok(validateDraftStep(d, 0)["details.name"]);
    assert.ok(validateDraftStep(d, 1)["arrangement.units"]);
    d.details = { name: "Home", propertyType: "terrace", addressLine1: "1 Jalan A", addressLine2: "", postcode: "4000", city: "Shah Alam", state: "SGR", notes: "" };
    assert.equal(validateDraftStep(d, 0)["details.postcode"], "validation.invalidPostcode");
    d.details.postcode = "40000";
    d.arrangement.defaultMode = "by_bed";
    d.arrangement.units = [newUnit("House", "by_bed", 2, 2)];
    assert.deepEqual(validateDraftStep(d, 1), {});
    const bedKey = d.arrangement.units[0].rooms[0].beds[0].key;
    d.rent.rents[bedKey] = "12.345";
    assert.equal(validateDraftStep(d, 2)[`rent.rents.${bedKey}`], "validation.amountTooPrecise");
    d.rent.rents[bedKey] = "350";
    const plan = planFromDraft(d);
    assert.ok(plan.ok);
    if (plan.ok) {
      assert.equal(plan.value.units[0].children.length, 2);
      assert.equal(plan.value.units[0].children[0].children[0].defaultRentSen, 35000);
      assert.equal(plan.value.property.securityDepositTenths, 20);
    }
  });
});
