import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeCore } from "../core/context";
import { dashboardSummary } from "../core/services/dashboard";
import { exportDataset } from "../core/services/export";
import {
  addCharge,
  ensureRentCharges,
  recordDeposit,
  recordPayment,
  rentMonth,
  setSchedule,
  voidCharge,
  voidPayment,
} from "../core/services/rent";
import { createTenancy, getTenancy } from "../core/services/tenancies";
import { clock, makeCore, newTenant, seedProperty, tempDir } from "./helpers";

function setup(opts: { start?: string; rentStartMonth?: string; end?: string | null } = {}) {
  const c = clock();
  const core = makeCore(tempDir(), c.now);
  const p = seedProperty(core);
  const t = createTenancy(core, {
    tenantId: null,
    newTenant: newTenant("Nurul"),
    spaceId: p.unitA2,
    startDate: opts.start ?? "2026-07-01",
    endDate: opts.end === undefined ? "2027-06-30" : opts.end,
    monthlyRentSen: 150000,
    rentDueDay: 7,
    rentStartMonth: opts.rentStartMonth ?? "2026-07",
    securityDepositSen: 300000,
    utilityDepositSen: 75000,
    terms: "",
    stagingKey: null,
  });
  return { core, clock: c, p, t };
}

const pay = (tenancyId: string, receivedOn: string, amountSen: number) => ({
  tenancyId,
  receivedOn,
  amountSen,
  method: "bank_transfer" as const,
  reference: "",
  description: "",
  notes: "",
  stagingKey: null,
});

describe("recurring rent charges", () => {
  it("creates one charge per month up to the current month, and never duplicates", () => {
    const { core, t } = setup();
    let detail = getTenancy(core, t.id);
    assert.deepEqual(detail.charges.map((c) => c.period).sort(), ["2026-07", "2026-08", "2026-09"]);
    assert.equal(ensureRentCharges(core, "2026-09"), 0);
    assert.equal(ensureRentCharges(core, "2026-09"), 0);
    rentMonth(core, "2026-09");
    detail = getTenancy(core, t.id);
    assert.equal(detail.charges.length, 3);
    const n = core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM charges WHERE tenancy_id = ? AND kind = 'rent'", [t.id])?.n;
    assert.equal(n, 3);
    closeCore(core);
  });

  it("keeps generating as time passes, without duplicates", () => {
    const { core, clock: c, t } = setup();
    c.set("2026-11-20T04:00:00Z");
    ensureRentCharges(core, "2026-11");
    ensureRentCharges(core, "2026-11");
    assert.deepEqual(
      getTenancy(core, t.id).charges.map((ch) => ch.period).sort(),
      ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"],
    );
    closeCore(core);
  });

  it("a voided month is not created again", () => {
    const { core, t } = setup();
    const aug = getTenancy(core, t.id).charges.find((c) => c.period === "2026-08")!;
    voidCharge(core, aug.id, "Rent-free month");
    ensureRentCharges(core, "2026-09");
    const augs = getTenancy(core, t.id).charges.filter((c) => c.period === "2026-08");
    assert.equal(augs.length, 1);
    assert.equal(augs[0].state, "void");
    closeCore(core);
  });

  it("a backdated tenancy starts charging from the chosen month, not with arrears", () => {
    const { core, t } = setup({ start: "2026-01-01", rentStartMonth: "2026-09" });
    assert.deepEqual(getTenancy(core, t.id).charges.map((c) => c.period), ["2026-09"]);
    closeCore(core);
  });

  it("rent changes apply from their month, optionally to unpaid charges already created", () => {
    const { core, clock: c, t } = setup();
    recordPayment(core, pay(t.id, "2026-09-01", 300000)); // pays Jul + Aug
    setSchedule(core, { tenancyId: t.id, effectiveMonth: "2026-08", amountSen: 160000, dueDay: 7, applyToUnpaid: true });
    let charges = getTenancy(core, t.id).charges;
    assert.equal(charges.find((x) => x.period === "2026-08")!.amountSen, 150000); // already paid: untouched
    assert.equal(charges.find((x) => x.period === "2026-09")!.amountSen, 160000); // unpaid: updated
    c.set("2026-10-10T04:00:00Z");
    ensureRentCharges(core, "2026-10");
    charges = getTenancy(core, t.id).charges;
    assert.equal(charges.find((x) => x.period === "2026-10")!.amountSen, 160000);
    closeCore(core);
  });
});

describe("partial payments, balances and overdue amounts", () => {
  it("allocates oldest-first and separates overdue from due", () => {
    const { core, t } = setup();
    // Charges: Jul 7, Aug 7, Sep 7 — RM 1,500 each. Today is 23 Sep.
    recordPayment(core, pay(t.id, "2026-07-05", 150000));
    recordPayment(core, pay(t.id, "2026-08-20", 100000));
    const detail = getTenancy(core, t.id);
    const byPeriod = new Map(detail.charges.map((c) => [c.period, c]));
    assert.equal(byPeriod.get("2026-07")!.state, "paid");
    assert.equal(byPeriod.get("2026-08")!.state, "overdue");
    assert.equal(byPeriod.get("2026-08")!.balanceSen, 50000);
    assert.equal(byPeriod.get("2026-09")!.state, "overdue");
    assert.equal(detail.balanceSen, 200000);
    assert.equal(detail.overdueSen, 200000);

    const month = rentMonth(core, "2026-09");
    assert.equal(month.totals.expectedSen, 150000);
    assert.equal(month.totals.collectedSen, 0);
    assert.equal(month.totals.overdueSen, 150000);
    assert.equal(month.totals.receivedInMonthSen, 0);
    const aug = rentMonth(core, "2026-08");
    assert.equal(aug.totals.expectedSen, 150000);
    assert.equal(aug.totals.collectedSen, 100000);
    assert.equal(aug.totals.outstandingSen, 50000);
    assert.equal(aug.totals.receivedInMonthSen, 100000);
    closeCore(core);
  });

  it("a partial payment before the due date is part-paid, not overdue", () => {
    const { core, t } = setup({ start: "2026-09-01", rentStartMonth: "2026-09" });
    // Due 7 Sep has passed; add a charge due later this month to test part-paid.
    addCharge(core, { tenancyId: t.id, kind: "utilities", description: "Electricity (TNB) Aug", amountSen: 12050, dueDate: "2026-09-30" });
    recordPayment(core, pay(t.id, "2026-09-20", 150000 + 5000));
    const utilities = getTenancy(core, t.id).charges.find((c) => c.kind === "utilities")!;
    assert.equal(utilities.state, "part_paid");
    assert.equal(utilities.balanceSen, 7050);
    closeCore(core);
  });

  it("overpayments become credit that pays the next charge", () => {
    const { core, clock: c, t } = setup({ start: "2026-09-01", rentStartMonth: "2026-09" });
    recordPayment(core, pay(t.id, "2026-09-05", 200000));
    assert.equal(getTenancy(core, t.id).creditSen, 50000);
    c.set("2026-10-01T04:00:00Z");
    ensureRentCharges(core, "2026-10");
    const oct = getTenancy(core, t.id).charges.find((x) => x.period === "2026-10")!;
    assert.equal(oct.paidSen, 50000);
    assert.equal(oct.state, "part_paid");
    closeCore(core);
  });

  it("voiding a payment restores the balance", () => {
    const { core, t } = setup({ start: "2026-09-01", rentStartMonth: "2026-09" });
    const payment = recordPayment(core, pay(t.id, "2026-09-05", 150000));
    assert.equal(getTenancy(core, t.id).balanceSen, 0);
    voidPayment(core, payment.id, "Bounced");
    assert.equal(getTenancy(core, t.id).balanceSen, 150000);
    closeCore(core);
  });

  it("describes what a payment covers and numbers receipts sequentially", () => {
    const { core, t } = setup();
    const p1 = recordPayment(core, pay(t.id, "2026-09-10", 200000));
    const p2 = recordPayment(core, pay(t.id, "2026-09-11", 120000));
    assert.equal(p1.receiptNo, "R-00001");
    assert.equal(p2.receiptNo, "R-00002");
    assert.equal(p1.description, "Rent for Jul 2026, Aug 2026 (part)");
    assert.equal(p2.description, "Rent for Aug 2026 (balance), Sep 2026 (part)");
    closeCore(core);
  });
});

describe("deposits are tracked separately from rent", () => {
  it("does not count deposits as rent collected", () => {
    const { core, t } = setup({ start: "2026-09-01", rentStartMonth: "2026-09" });
    recordDeposit(core, { tenancyId: t.id, depositType: "security", kind: "received", amountSen: 300000, occurredOn: "2026-09-01", method: "bank_transfer", reference: "", notes: "" });
    const month = rentMonth(core, "2026-09");
    assert.equal(month.totals.collectedSen, 0);
    assert.equal(month.totals.receivedInMonthSen, 0);
    const dash = dashboardSummary(core, "2026-09");
    assert.equal(dash.depositsHeldSen, 300000);
    assert.equal(dash.rent.collectedSen, 0);
    assert.equal(getTenancy(core, t.id).balanceSen, 150000);
    closeCore(core);
  });
});

describe("dashboard figures come from stored records", () => {
  it("reports occupancy, rent and maintenance from the database", () => {
    const { core, t } = setup();
    recordPayment(core, pay(t.id, "2026-09-08", 150000));
    const d = dashboardSummary(core, "2026-09");
    assert.equal(d.occupancy.lettable, 4);
    assert.equal(d.occupancy.occupied, 1);
    assert.equal(d.rent.expectedSen, 150000);
    assert.equal(d.rent.receivedInMonthSen, 150000);
    assert.equal(d.counts.currentTenancies, 1);
    assert.equal(d.maintenance.open, 0);
    closeCore(core);
  });
});

describe("CSV export", () => {
  it("writes spreadsheet-safe CSV with BOM, ISO dates and plain ringgit", () => {
    const { core, t } = setup();
    recordPayment(core, { ...pay(t.id, "2026-09-08", 150050), reference: "=HYPERLINK(\"x\")" });
    const out = exportDataset(core, "payments");
    assert.ok(out.content.startsWith("﻿"));
    assert.match(out.content, /"2026-09-08","1500\.50","bank_transfer","'=HYPERLINK\(""x""\)"/);
    closeCore(core);
  });
});
