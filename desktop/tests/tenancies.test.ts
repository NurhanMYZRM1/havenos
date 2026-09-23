import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TenancyCreate } from "../../lib/api/contract";
import { closeCore } from "../core/context";
import { AppError } from "../core/errors";
import { getProperty, spaceOptions } from "../core/services/properties";
import { cancelReservation, createReservation } from "../core/services/reservations";
import { cancelTenancy, createTenancy, listTenancies, moveIn, moveOut } from "../core/services/tenancies";
import { makeCore, newTenant, seedProperty } from "./helpers";

function tenancy(spaceId: string, startDate: string, endDate: string | null, name = "Tenant"): TenancyCreate {
  return {
    tenantId: null,
    newTenant: newTenant(name),
    spaceId,
    startDate,
    endDate,
    monthlyRentSen: 100000,
    rentDueDay: 7,
    rentStartMonth: startDate.slice(0, 7),
    securityDepositSen: 200000,
    utilityDepositSen: 50000,
    terms: "",
    stagingKey: null,
  };
}

function rejectsOverlap(fn: () => unknown) {
  assert.throws(fn, (err: unknown) => err instanceof AppError && err.code === "CONFLICT");
}

describe("overlapping rentals are rejected", () => {
  it("a whole-unit tenancy blocks its rooms and beds, and vice versa", () => {
    const core = makeCore();
    const p = seedProperty(core);
    createTenancy(core, tenancy(p.roomA, "2026-10-01", "2027-09-30", "Room tenant"));
    // Whole unit over an existing room tenancy.
    rejectsOverlap(() => createTenancy(core, tenancy(p.unitA1, "2027-01-01", "2027-12-31")));
    // Same room, overlapping dates.
    rejectsOverlap(() => createTenancy(core, tenancy(p.roomA, "2027-09-30", null)));
    // A sibling room is fine, as is the same room after the first tenancy ends.
    createTenancy(core, tenancy(p.roomB, "2026-10-01", "2027-09-30"));
    createTenancy(core, tenancy(p.roomA, "2027-10-01", null, "Next tenant"));
    // Bed inside room C, then the room itself.
    createTenancy(core, tenancy(p.bed1, "2026-10-01", "2027-03-31"));
    createTenancy(core, tenancy(p.bed2, "2026-10-01", "2027-03-31"));
    rejectsOverlap(() => createTenancy(core, tenancy(p.roomC, "2027-03-31", "2027-06-30")));
    createTenancy(core, tenancy(p.roomC, "2027-04-01", "2027-06-30"));
    closeCore(core);
  });

  it("explains the clash in plain English", () => {
    const core = makeCore();
    const p = seedProperty(core);
    createTenancy(core, tenancy(p.unitA2, "2026-01-01", "2026-12-31", "Siti"));
    try {
      createTenancy(core, tenancy(p.unitA2, "2026-12-01", null));
      assert.fail("expected a conflict");
    } catch (err) {
      assert.ok(err instanceof AppError);
      assert.match(err.message, /A-2 is already let to Siti from 1 Jan 2026 to 31 Dec 2026/);
    }
    closeCore(core);
  });

  it("an open-ended tenancy blocks everything after it until the move-out is recorded", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const t = createTenancy(core, tenancy(p.unitA2, "2026-01-01", null, "Open"));
    rejectsOverlap(() => createTenancy(core, tenancy(p.unitA2, "2030-01-01", "2030-12-31")));
    moveIn(core, { id: t.id, movedInOn: "2026-01-01", notes: "", depositReceived: [] });
    moveOut(core, { id: t.id, movedOutOn: "2026-09-30", notes: "", voidChargesAfterMoveOut: true, deposit: null });
    createTenancy(core, tenancy(p.unitA2, "2026-10-01", "2027-09-30", "Next"));
    closeCore(core);
  });

  it("cancelled tenancies free the space", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const t = createTenancy(core, tenancy(p.unitA2, "2026-10-01", "2027-09-30"));
    rejectsOverlap(() => createTenancy(core, tenancy(p.unitA2, "2026-10-01", "2027-09-30")));
    cancelTenancy(core, t.id, "Tenant backed out");
    createTenancy(core, tenancy(p.unitA2, "2026-10-01", "2027-09-30", "Replacement"));
    closeCore(core);
  });

  it("the database itself rejects overlaps even if the app's check were bypassed", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const t = createTenancy(core, tenancy(p.unitA1, "2026-01-01", "2026-12-31"));
    const tenantId = listTenancies(core, { filter: "all", propertyId: null, tenantId: null })[0].tenantId;
    assert.throws(
      () =>
        core.db.run(
          `INSERT INTO tenancies (id, ref, tenant_id, space_id, property_id, start_date, end_date, rent_start_month, created_at, updated_at)
           VALUES ('raw', 'T-X', ?, ?, ?, '2026-06-01', NULL, '2026-06', 'x', 'x')`,
          [tenantId, p.bed1, p.propertyId],
        ),
      /HAVENOS:OVERLAP/,
    );
    // Extending an existing tenancy into a clash is caught too.
    createTenancy(core, tenancy(p.roomA, "2027-01-01", "2027-12-31"));
    assert.throws(() => core.db.run("UPDATE tenancies SET end_date = '2027-03-01' WHERE id = ?", [t.id]), /HAVENOS:OVERLAP/);
    closeCore(core);
  });

  it("space options report availability for a date range", () => {
    const core = makeCore();
    const p = seedProperty(core);
    createTenancy(core, tenancy(p.roomA, "2026-10-01", "2027-09-30", "Amir"));
    const options = spaceOptions(core, { propertyId: p.propertyId, startDate: "2026-11-01", endDate: "2027-10-31", excludeTenancyId: null });
    const byId = new Map(options.map((o) => [o.id, o]));
    assert.equal(byId.get(p.roomA)?.available, false);
    assert.equal(byId.get(p.roomA)?.conflict, "Amir");
    assert.equal(byId.get(p.unitA1)?.available, false);
    assert.equal(byId.get(p.roomB)?.available, true);
    assert.equal(byId.get(p.roomA)?.lettable, true);
    assert.equal(byId.get(p.bed1)?.lettable, false);
    assert.deepEqual(options.map((o) => o.path).slice(0, 4), ["A-1", "A-1 › Room A", "A-1 › Room B", "A-1 › Room C"]);
    closeCore(core);
  });

  it("occupancy follows each unit's arrangement", () => {
    const core = makeCore();
    const p = seedProperty(core);
    createTenancy(core, tenancy(p.roomA, "2026-09-01", "2027-08-31"));
    createTenancy(core, tenancy(p.unitA2, "2026-12-01", "2027-11-30"));
    const detail = getProperty(core, p.propertyId);
    assert.equal(detail.lettable, 4); // rooms A, B, C of A-1 plus whole unit A-2
    assert.equal(detail.occupied, 1);
    const a1 = detail.units[0];
    assert.equal(a1.occupancy.state, "part_let");
    assert.equal(a1.children[0].occupancy.state, "let");
    assert.equal(detail.units[1].occupancy.state, "upcoming");
    closeCore(core);
  });
});

describe("move-in and move-out", () => {
  it("records deposits at move-in and refunds/deductions at move-out", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const t = createTenancy(core, tenancy(p.unitA2, "2026-01-01", "2026-12-31"));
    const afterIn = moveIn(core, {
      id: t.id,
      movedInOn: "2026-01-01",
      notes: "Keys x2",
      depositReceived: [
        { depositType: "security", amountSen: 200000, method: "bank_transfer", reference: "D1" },
        { depositType: "utility", amountSen: 50000, method: "cash", reference: "" },
      ],
    });
    assert.equal(afterIn.deposits.heldSen, 250000);
    assert.throws(() => moveOut(core, { id: t.id, movedOutOn: "2026-09-30", notes: "", voidChargesAfterMoveOut: true, deposit: { refundSen: 300000, deductSen: 0, deductReason: "", method: "bank_transfer", reference: "" } }), /more than the deposit held/);
    const afterOut = moveOut(core, {
      id: t.id,
      movedOutOn: "2026-09-30",
      notes: "",
      voidChargesAfterMoveOut: true,
      deposit: { refundSen: 220000, deductSen: 30000, deductReason: "Repaint", method: "bank_transfer", reference: "R1" },
    });
    assert.equal(afterOut.deposits.heldSen, 0);
    assert.equal(afterOut.deposits.deductedSen, 30000);
    assert.equal(afterOut.deposits.refundedSen, 220000);
    assert.equal(afterOut.status, "expiring"); // leaving on 30 Sep, a week from "today"
    closeCore(core);
  });
});

describe("short-stay reservations share availability but stay separate from tenancies", () => {
  const stay = (spaceId: string, checkIn: string, checkOut: string) => ({
    spaceId,
    guestName: "Guest",
    checkIn,
    checkOut,
    status: "confirmed" as const,
    channel: "direct" as const,
    channelReservationId: null,
    totalSen: 45000,
    notes: "",
  });

  it("a tenancy blocks short stays on the same room, its beds and its unit, and vice versa", () => {
    const core = makeCore();
    const p = seedProperty(core);
    createTenancy(core, tenancy(p.roomC, "2026-10-01", "2026-12-31"));
    rejectsOverlap(() => createReservation(core, stay(p.bed1, "2026-11-10", "2026-11-12")));
    rejectsOverlap(() => createReservation(core, stay(p.unitA1, "2026-12-30", "2027-01-02")));
    createReservation(core, stay(p.roomB, "2026-11-10", "2026-11-12"));
    // Check-out day is free: a stay ending the day the next tenancy starts is fine.
    const r = createReservation(core, stay(p.unitA2, "2027-01-28", "2027-02-01"));
    createTenancy(core, tenancy(p.unitA2, "2027-02-01", null));
    rejectsOverlap(() => createTenancy(core, tenancy(p.unitA2, "2027-01-30", "2027-01-31")));
    cancelReservation(core, r);
    // Reservations never appear as tenancies.
    assert.equal(listTenancies(core, { filter: "all", propertyId: null, tenantId: null }).length, 2);
    closeCore(core);
  });
});
