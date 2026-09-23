import type {
  Charge,
  ChargeInput,
  ChargeUpdate,
  DepositEntry,
  DepositInput,
  DepositSummary,
  Payment,
  PaymentInput,
  PaymentListItem,
  ReceiptView,
  RentMonthView,
  RentRow,
  ScheduleChangeInput,
} from "../../../lib/api/contract";
import { firstOfMonth, lastOfMonth, monthOf, type IsoDate, type YearMonth } from "../../../lib/domain/dates";
import type { DepositType, PaymentMethod } from "../../../lib/domain/enums";
import { formatMonth, formatMonthShort } from "../../../lib/domain/format";
import { formatRM } from "../../../lib/domain/money";
import { chargeState, lastBillableMonth, plannedRentCharges, scheduleItemFor } from "../../../lib/domain/rent";
import { t } from "../../../lib/i18n";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { getSettings } from "./settings";
import {
  allocate,
  allSpacePaths,
  claimStaged,
  listAttachments,
  loadLedgers,
  newId,
  nextRef,
  spacePath,
  TENANCY_SELECT,
  type ChargeRow,
  type Ledger,
  type PaymentRow,
  type TenancyJoinedRow,
  type TenancyRow,
} from "./shared";

// ── Recurring rent ─────────────────────────────────────────────────────────

/**
 * Create any rent charges the schedules call for up to `throughMonth`.
 * Idempotent: the unique index on (tenancy, period) makes a second run a
 * no-op, and a period the landlord voided stays voided rather than being
 * re-created.
 */
export function ensureRentCharges(core: Core, throughMonth: YearMonth, tenancyIds?: readonly string[]): number {
  const tenancies = tenancyIds
    ? tenancyIds.map((id) => core.db.get<TenancyRow>("SELECT * FROM tenancies WHERE id = ?", [id])).filter((r): r is TenancyRow => !!r)
    : core.db.all<TenancyRow>("SELECT * FROM tenancies WHERE cancelled_at IS NULL AND rent_start_month <= ?", [throughMonth]);
  const ledgers = loadLedgers(core, tenancies.map((r) => r.id));
  let created = 0;
  const now = core.nowIso();
  core.db.tx(() => {
    for (const r of tenancies) {
      const planned = plannedRentCharges(
        {
          startDate: r.start_date,
          endDate: r.end_date,
          movedOutOn: r.moved_out_on,
          cancelledAt: r.cancelled_at,
          rentStartMonth: r.rent_start_month,
          schedule: ledgers.get(r.id)!.schedule.map((s) => ({ effectiveMonth: s.effective_month, amountSen: s.amount_sen, dueDay: s.due_day })),
        },
        throughMonth,
      );
      for (const p of planned) {
        created += core.db.run(
          `INSERT OR IGNORE INTO charges (id, tenancy_id, kind, period, description, amount_sen, due_date, created_at, updated_at)
           VALUES (?, ?, 'rent', ?, '', ?, ?, ?, ?)`,
          [newId(), r.id, p.period, p.amountSen, p.dueDate, now, now],
        ).changes;
      }
    }
  });
  return created;
}

export function ensureCurrentCharges(core: Core, tenancyIds?: readonly string[]) {
  return ensureRentCharges(core, monthOf(core.today()), tenancyIds);
}

export function chargeLabel(c: Pick<ChargeRow, "kind" | "period" | "description">): string {
  if (c.kind === "rent" && c.period) return c.description || t("rent.rentFor", { month: formatMonth(c.period) });
  return c.description;
}

export function toCharges(ledger: Ledger, today: IsoDate): { charges: Charge[]; creditSen: number } {
  const alloc = allocate(ledger);
  const charges = ledger.charges.map((c): Charge => {
    const paid = alloc.paidByCharge.get(c.id) ?? 0;
    return {
      id: c.id,
      tenancyId: c.tenancy_id,
      kind: c.kind,
      period: c.period,
      description: chargeLabel(c),
      amountSen: c.amount_sen,
      paidSen: paid,
      balanceSen: c.voided_at ? 0 : c.amount_sen - paid,
      dueDate: c.due_date,
      state: chargeState({ amountSen: c.amount_sen, paidSen: paid, dueDate: c.due_date, today, voided: !!c.voided_at }),
      voidedAt: c.voided_at,
      voidReason: c.void_reason,
      createdAt: c.created_at,
    };
  });
  return { charges, creditSen: alloc.creditSen };
}

export function toPayment(core: Core, p: PaymentRow): Payment {
  return {
    id: p.id,
    tenancyId: p.tenancy_id,
    receiptNo: p.receipt_no,
    receivedOn: p.received_on,
    amountSen: p.amount_sen,
    method: p.method,
    reference: p.reference,
    description: p.description,
    notes: p.notes,
    voidedAt: p.voided_at,
    voidReason: p.void_reason,
    createdAt: p.created_at,
    attachments: listAttachments(core, { kind: "payment", id: p.id }),
  };
}

function loadTenancy(core: Core, id: string): TenancyRow {
  const row = core.db.get<TenancyRow>("SELECT * FROM tenancies WHERE id = ?", [id]);
  if (!row) throw notFound();
  return row;
}

// ── Month view ─────────────────────────────────────────────────────────────

export function rentMonth(core: Core, month: YearMonth): RentMonthView {
  const today = core.today();
  const currentMonth = monthOf(today);
  ensureCurrentCharges(core);
  const from = firstOfMonth(month);
  const to = lastOfMonth(month);
  const projected = month > currentMonth;
  const tenancyRows = core.db.all<TenancyJoinedRow>(`${TENANCY_SELECT} WHERE t.cancelled_at IS NULL OR t.id IN (
    SELECT tenancy_id FROM charges WHERE due_date BETWEEN ? AND ?)`, [from, to]);
  const byId = new Map(tenancyRows.map((r) => [r.id, r]));
  const ledgers = loadLedgers(core, tenancyRows.map((r) => r.id));
  const paths = allSpacePaths(core);
  const rows: RentRow[] = [];

  for (const r of tenancyRows) {
    const ledger = ledgers.get(r.id)!;
    const { charges } = toCharges(ledger, today);
    for (const c of charges) {
      if (c.dueDate < from || c.dueDate > to || c.voidedAt) continue;
      rows.push({
        chargeId: c.id,
        tenancyId: r.id,
        tenantName: r.tenant_name,
        propertyName: r.property_name,
        spacePath: paths.get(r.space_id) ?? "",
        description: c.description,
        dueDate: c.dueDate,
        amountSen: c.amountSen,
        paidSen: c.paidSen,
        balanceSen: c.balanceSen,
        state: c.state,
      });
    }
    if (projected && !r.cancelled_at) {
      const planned = plannedRentCharges(
        {
          startDate: r.start_date,
          endDate: r.end_date,
          movedOutOn: r.moved_out_on,
          cancelledAt: r.cancelled_at,
          rentStartMonth: r.rent_start_month,
          schedule: ledger.schedule.map((s) => ({ effectiveMonth: s.effective_month, amountSen: s.amount_sen, dueDay: s.due_day })),
        },
        month,
      ).filter((p) => p.period === month && !ledger.charges.some((c) => c.kind === "rent" && c.period === month));
      for (const p of planned) {
        rows.push({
          chargeId: null,
          tenancyId: r.id,
          tenantName: r.tenant_name,
          propertyName: r.property_name,
          spacePath: paths.get(r.space_id) ?? "",
          description: t("rent.rentFor", { month: formatMonth(month) }),
          dueDate: p.dueDate,
          amountSen: p.amountSen,
          paidSen: 0,
          balanceSen: p.amountSen,
          state: "due",
        });
      }
    }
  }
  rows.sort((a, b) => (a.dueDate !== b.dueDate ? (a.dueDate < b.dueDate ? -1 : 1) : a.tenantName.localeCompare(b.tenantName)));

  const payments = core.db
    .all<PaymentRow>("SELECT * FROM payments WHERE received_on BETWEEN ? AND ? ORDER BY received_on DESC, created_at DESC", [from, to])
    .map((p): PaymentListItem => {
      const tr = byId.get(p.tenancy_id) ?? core.db.get<TenancyJoinedRow>(`${TENANCY_SELECT} WHERE t.id = ?`, [p.tenancy_id]);
      return {
        id: p.id,
        tenancyId: p.tenancy_id,
        receiptNo: p.receipt_no,
        receivedOn: p.received_on,
        amountSen: p.amount_sen,
        method: p.method,
        reference: p.reference,
        tenantName: tr?.tenant_name ?? "",
        spacePath: tr ? paths.get(tr.space_id) ?? "" : "",
        voided: !!p.voided_at,
      };
    });

  const expectedSen = rows.reduce((s, r) => s + r.amountSen, 0);
  const collectedSen = rows.reduce((s, r) => s + r.paidSen, 0);
  return {
    month,
    today,
    projected,
    totals: {
      expectedSen,
      collectedSen,
      outstandingSen: expectedSen - collectedSen,
      overdueSen: rows.filter((r) => r.state === "overdue").reduce((s, r) => s + r.balanceSen, 0),
      receivedInMonthSen: payments.filter((p) => !p.voided).reduce((s, p) => s + p.amountSen, 0),
    },
    rows,
    payments,
  };
}

// ── Schedule & charges ─────────────────────────────────────────────────────

export function setSchedule(core: Core, input: ScheduleChangeInput) {
  const tenancy = loadTenancy(core, input.tenancyId);
  if (tenancy.cancelled_at) throw new AppError("NOT_ALLOWED", "errors.tenancyCancelled");
  if (input.effectiveMonth < tenancy.rent_start_month) {
    throw new AppError("VALIDATION", "validation.rentStartBeforeTenancy", { fields: { effectiveMonth: "validation.rentStartBeforeTenancy" } });
  }
  core.db.tx(() => {
    core.db.run(
      `INSERT INTO rent_schedule (id, tenancy_id, effective_month, amount_sen, due_day, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenancy_id, effective_month) DO UPDATE SET amount_sen = excluded.amount_sen, due_day = excluded.due_day`,
      [newId(), tenancy.id, input.effectiveMonth, input.amountSen, input.dueDay, core.nowIso()],
    );
    if (input.applyToUnpaid) {
      const ledger = loadLedgers(core, [tenancy.id]).get(tenancy.id)!;
      const alloc = allocate(ledger);
      const schedule = ledger.schedule.map((s) => ({ effectiveMonth: s.effective_month, amountSen: s.amount_sen, dueDay: s.due_day }));
      for (const c of ledger.charges) {
        if (c.kind !== "rent" || c.voided_at || !c.period || c.period < input.effectiveMonth) continue;
        if ((alloc.paidByCharge.get(c.id) ?? 0) > 0) continue;
        const item = scheduleItemFor(schedule, c.period)!;
        const planned = plannedRentCharges(
          { startDate: tenancy.start_date, endDate: tenancy.end_date, movedOutOn: tenancy.moved_out_on, cancelledAt: null, rentStartMonth: c.period, schedule: [item] },
          c.period,
        )[0];
        if (!planned) continue;
        core.db.run("UPDATE charges SET amount_sen = ?, due_date = ?, updated_at = ? WHERE id = ?", [
          planned.amountSen,
          planned.dueDate,
          core.nowIso(),
          c.id,
        ]);
      }
    }
  });
  ensureCurrentCharges(core, [tenancy.id]);
}

export function addCharge(core: Core, input: ChargeInput) {
  const tenancy = loadTenancy(core, input.tenancyId);
  if (tenancy.cancelled_at) throw new AppError("NOT_ALLOWED", "errors.tenancyCancelled");
  const now = core.nowIso();
  core.db.run(
    `INSERT INTO charges (id, tenancy_id, kind, period, description, amount_sen, due_date, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [newId(), input.tenancyId, input.kind, input.description, input.amountSen, input.dueDate, now, now],
  );
  return input.tenancyId;
}

function loadCharge(core: Core, id: string): ChargeRow {
  const row = core.db.get<ChargeRow>("SELECT * FROM charges WHERE id = ?", [id]);
  if (!row) throw notFound();
  return row;
}

export function updateCharge(core: Core, input: ChargeUpdate): string {
  const c = loadCharge(core, input.id);
  if (c.voided_at) throw new AppError("NOT_ALLOWED", "errors.chargeVoided");
  const description = c.kind === "rent" && input.description === chargeLabel({ ...c, description: "" }) ? "" : input.description;
  core.db.run("UPDATE charges SET description = ?, amount_sen = ?, due_date = ?, updated_at = ? WHERE id = ?", [
    description,
    input.amountSen,
    input.dueDate,
    core.nowIso(),
    c.id,
  ]);
  return c.tenancy_id;
}

export function voidCharge(core: Core, id: string, reason: string): string {
  const c = loadCharge(core, id);
  if (c.voided_at) throw new AppError("NOT_ALLOWED", "errors.chargeVoided");
  core.db.run("UPDATE charges SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?", [core.nowIso(), reason.slice(0, 200), core.nowIso(), id]);
  return c.tenancy_id;
}

// ── Payments ───────────────────────────────────────────────────────────────

/** "Rent for August 2026 (balance), September 2026 (part)". */
function describeApplication(core: Core, tenancyId: string, newAmount: number): string {
  const ledger = loadLedgers(core, [tenancyId]).get(tenancyId)!;
  const before = allocate(ledger);
  const after = allocate({ ...ledger, payments: [...ledger.payments, { amount_sen: newAmount, voided_at: null } as PaymentRow] });
  const parts: string[] = [];
  for (const c of ledger.charges) {
    if (c.voided_at) continue;
    const gained = (after.paidByCharge.get(c.id) ?? 0) - (before.paidByCharge.get(c.id) ?? 0);
    if (gained <= 0) continue;
    const label = c.kind === "rent" && c.period ? formatMonthShort(c.period) : c.description;
    const full = (after.paidByCharge.get(c.id) ?? 0) >= c.amount_sen;
    const partial = !full ? ` (${t("rent.partLabel")})` : (before.paidByCharge.get(c.id) ?? 0) > 0 ? ` (${t("rent.balanceLabel")})` : "";
    parts.push(`${label}${partial}`);
  }
  const hasRent = ledger.charges.some((c) => c.kind === "rent");
  if (parts.length === 0) return t("rent.advancePayment");
  return hasRent ? t("rent.paymentFor", { items: parts.join(", ") }) : parts.join(", ");
}

export function recordPayment(core: Core, input: PaymentInput): Payment {
  const tenancy = loadTenancy(core, input.tenancyId);
  ensureCurrentCharges(core, [tenancy.id]);
  const id = newId();
  core.db.tx(() => {
    const description = input.description || describeApplication(core, tenancy.id, input.amountSen);
    const receiptNo = nextRef(core, "receipt", "R", 5);
    const now = core.nowIso();
    core.db.run(
      `INSERT INTO payments (id, tenancy_id, receipt_no, received_on, amount_sen, method, reference, description, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, tenancy.id, receiptNo, input.receivedOn, input.amountSen, input.method, input.reference, description, input.notes, now, now],
    );
    claimStaged(core, input.stagingKey, { kind: "payment", id });
  });
  return toPayment(core, core.db.get<PaymentRow>("SELECT * FROM payments WHERE id = ?", [id])!);
}

export function voidPayment(core: Core, id: string, reason: string): string {
  const p = core.db.get<PaymentRow>("SELECT * FROM payments WHERE id = ?", [id]);
  if (!p) throw notFound();
  if (p.voided_at) throw new AppError("NOT_ALLOWED", "errors.paymentVoided");
  core.db.run("UPDATE payments SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?", [core.nowIso(), reason.slice(0, 200), core.nowIso(), id]);
  return p.tenancy_id;
}

export function receipt(core: Core, paymentId: string): ReceiptView {
  const p = core.db.get<PaymentRow>("SELECT * FROM payments WHERE id = ?", [paymentId]);
  if (!p) throw notFound();
  const tr = core.db.get<TenancyJoinedRow & { address_line1: string; address_line2: string; postcode: string; city: string }>(
    `SELECT t.*, tn.full_name AS tenant_name, tn.phone AS tenant_phone, p.name AS property_name, s.kind AS space_kind,
       p.address_line1, p.address_line2, p.postcode, p.city
     FROM tenancies t JOIN tenants tn ON tn.id = t.tenant_id JOIN properties p ON p.id = t.property_id JOIN spaces s ON s.id = t.space_id
     WHERE t.id = ?`,
    [p.tenancy_id],
  )!;
  return {
    payment: toPayment(core, p),
    tenantName: tr.tenant_name,
    tenantPhone: tr.tenant_phone,
    propertyName: tr.property_name,
    propertyAddress: [tr.address_line1, tr.address_line2, `${tr.postcode} ${tr.city}`].filter(Boolean).join(", "),
    spacePath: spacePath(core, tr.space_id),
    tenancyRef: tr.ref,
    landlord: getSettings(core),
  };
}

// ── Deposits ───────────────────────────────────────────────────────────────

interface DepositRow {
  id: string;
  tenancy_id: string;
  deposit_type: DepositType;
  kind: "received" | "refunded" | "deducted";
  amount_sen: number;
  occurred_on: IsoDate;
  method: PaymentMethod | null;
  reference: string;
  notes: string;
  voided_at: string | null;
  created_at: string;
}

function toDeposit(r: DepositRow): DepositEntry {
  return {
    id: r.id,
    tenancyId: r.tenancy_id,
    depositType: r.deposit_type,
    kind: r.kind,
    amountSen: r.amount_sen,
    occurredOn: r.occurred_on,
    method: r.method,
    reference: r.reference,
    notes: r.notes,
    voidedAt: r.voided_at,
    createdAt: r.created_at,
  };
}

function heldByType(rows: readonly DepositRow[]): Record<DepositType, number> {
  const held: Record<DepositType, number> = { security: 0, utility: 0, other: 0 };
  for (const r of rows) {
    if (r.voided_at) continue;
    held[r.deposit_type] += r.kind === "received" ? r.amount_sen : -r.amount_sen;
  }
  return held;
}

export function depositSummary(core: Core, tenancy: TenancyRow): DepositSummary {
  const rows = core.db.all<DepositRow>("SELECT * FROM deposit_entries WHERE tenancy_id = ? ORDER BY occurred_on, created_at", [tenancy.id]);
  const live = rows.filter((r) => !r.voided_at);
  const sum = (kind: DepositRow["kind"]) => live.filter((r) => r.kind === kind).reduce((s, r) => s + r.amount_sen, 0);
  const received = sum("received");
  const refunded = sum("refunded");
  const deducted = sum("deducted");
  return {
    agreedSecuritySen: tenancy.security_deposit_sen,
    agreedUtilitySen: tenancy.utility_deposit_sen,
    receivedSen: received,
    refundedSen: refunded,
    deductedSen: deducted,
    heldSen: received - refunded - deducted,
    entries: rows.map(toDeposit),
  };
}

export function totalDepositsHeld(core: Core): number {
  return (
    core.db.get<{ n: number }>(
      `SELECT COALESCE(SUM(CASE kind WHEN 'received' THEN amount_sen ELSE -amount_sen END), 0) AS n
       FROM deposit_entries WHERE voided_at IS NULL`,
    )?.n ?? 0
  );
}

export function recordDeposit(core: Core, input: DepositInput): string {
  const tenancy = loadTenancy(core, input.tenancyId);
  core.db.tx(() => {
    if (input.kind !== "received") {
      const rows = core.db.all<DepositRow>("SELECT * FROM deposit_entries WHERE tenancy_id = ?", [tenancy.id]);
      const held = heldByType(rows)[input.depositType];
      if (input.amountSen > held) {
        throw new AppError("VALIDATION", "validation.depositExceedsHeld", {
          params: { held: formatRM(held) },
          fields: { amountSen: "validation.depositExceedsHeld" },
        });
      }
    }
    core.db.run(
      `INSERT INTO deposit_entries (id, tenancy_id, deposit_type, kind, amount_sen, occurred_on, method, reference, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), tenancy.id, input.depositType, input.kind, input.amountSen, input.occurredOn, input.method, input.reference, input.notes, core.nowIso()],
    );
  });
  return tenancy.id;
}

export function voidDeposit(core: Core, id: string): string {
  const row = core.db.get<DepositRow>("SELECT * FROM deposit_entries WHERE id = ?", [id]);
  if (!row) throw notFound();
  core.db.tx(() => {
    core.db.run("UPDATE deposit_entries SET voided_at = ? WHERE id = ?", [core.nowIso(), id]);
    // Voiding a receipt of money must not leave more refunded than received.
    const held = heldByType(core.db.all<DepositRow>("SELECT * FROM deposit_entries WHERE tenancy_id = ?", [row.tenancy_id]));
    if (held[row.deposit_type] < 0) {
      throw new AppError("VALIDATION", "validation.depositExceedsHeld", { params: { held: formatRM(0) } });
    }
  });
  return row.tenancy_id;
}

/** Rent charges beyond the last month a (shortened) tenancy should pay for. */
export function voidChargesAfterEnd(core: Core, tenancy: TenancyRow, reason: string) {
  const last = lastBillableMonth(tenancy.start_date, tenancy.moved_out_on ?? tenancy.end_date);
  if (!last) return 0;
  const ledger = loadLedgers(core, [tenancy.id]).get(tenancy.id)!;
  const alloc = allocate(ledger);
  let voided = 0;
  for (const c of ledger.charges) {
    if (c.kind !== "rent" || c.voided_at || !c.period || c.period <= last) continue;
    if ((alloc.paidByCharge.get(c.id) ?? 0) > 0) continue;
    core.db.run("UPDATE charges SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?", [core.nowIso(), reason, core.nowIso(), c.id]);
    voided++;
  }
  return voided;
}
