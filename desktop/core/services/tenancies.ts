import type {
  MoveInInput,
  MoveOutInput,
  TenancyCreate,
  TenancyDetail,
  TenancyFilter,
  TenancySummary,
  TenancyUpdate,
} from "../../../lib/api/contract";
import { monthOf } from "../../../lib/domain/dates";
import type { SpaceKind } from "../../../lib/domain/enums";
import { formatRM } from "../../../lib/domain/money";
import { t } from "../../../lib/i18n";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { assertAvailable } from "./availability";
import { depositSummary, ensureCurrentCharges, toCharges, toPayment, voidChargesAfterEnd } from "./rent";
import {
  claimStaged,
  listAttachments,
  loadLedgers,
  newId,
  nextRef,
  summarize,
  TENANCY_SELECT,
  type TenancyJoinedRow,
  type TenancyRow,
} from "./shared";
import { insertTenant } from "./tenants";

const STATUS_ORDER: Record<string, number> = { expiring: 0, active: 1, upcoming: 2, ended: 3, cancelled: 4 };

export function listTenancies(
  core: Core,
  params: { filter: TenancyFilter; propertyId: string | null; tenantId: string | null },
): TenancySummary[] {
  const where: string[] = [];
  const args: string[] = [];
  if (params.propertyId) {
    where.push("t.property_id = ?");
    args.push(params.propertyId);
  }
  if (params.tenantId) {
    where.push("t.tenant_id = ?");
    args.push(params.tenantId);
  }
  const rows = core.db.all<TenancyJoinedRow>(`${TENANCY_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`, args);
  const all = summarize(core, rows);
  const filtered = all.filter((s) => {
    if (params.filter === "all") return true;
    if (params.filter === "current") return s.status === "active" || s.status === "expiring" || s.status === "upcoming";
    return s.status === params.filter;
  });
  return filtered.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus) return byStatus;
    if (a.status === "ended" || a.status === "cancelled") return a.startDate < b.startDate ? 1 : -1;
    return (a.endDate ?? "9999") < (b.endDate ?? "9999") ? -1 : 1;
  });
}

function loadRow(core: Core, id: string): TenancyRow {
  const row = core.db.get<TenancyRow>("SELECT * FROM tenancies WHERE id = ?", [id]);
  if (!row) throw notFound();
  return row;
}

export function getTenancy(core: Core, id: string): TenancyDetail {
  const joined = core.db.get<TenancyJoinedRow>(`${TENANCY_SELECT} WHERE t.id = ?`, [id]);
  if (!joined) throw notFound();
  const [summary] = summarize(core, [joined]);
  const ledger = loadLedgers(core, [id]).get(id)!;
  const { charges, creditSen } = toCharges(ledger, core.today());
  return {
    ...summary,
    terms: joined.terms,
    rentStartMonth: joined.rent_start_month,
    securityDepositSen: joined.security_deposit_sen,
    utilityDepositSen: joined.utility_deposit_sen,
    moveInNotes: joined.move_in_notes,
    moveOutNotes: joined.move_out_notes,
    schedule: ledger.schedule.map((s) => ({ id: s.id, effectiveMonth: s.effective_month, amountSen: s.amount_sen, dueDay: s.due_day })),
    charges: charges.sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0)),
    payments: ledger.payments.map((p) => toPayment(core, p)).sort((a, b) => (a.receivedOn < b.receivedOn ? 1 : -1)),
    creditSen,
    deposits: depositSummary(core, joined),
    documents: listAttachments(core, { kind: "tenancy", id }),
    createdAt: joined.created_at,
  };
}

export function createTenancy(core: Core, input: TenancyCreate): TenancyDetail {
  const space = core.db.get<{ id: string; property_id: string; kind: SpaceKind; archived_at: string | null }>(
    "SELECT id, property_id, kind, archived_at FROM spaces WHERE id = ?",
    [input.spaceId],
  );
  if (!space || space.archived_at) throw new AppError("VALIDATION", "validation.notLettable", { fields: { spaceId: "validation.notLettable" } });
  if (input.tenantId && !core.db.get("SELECT 1 FROM tenants WHERE id = ?", [input.tenantId])) {
    throw new AppError("VALIDATION", "validation.chooseTenant", { fields: { tenantId: "validation.chooseTenant" } });
  }
  const id = newId();
  core.db.tx(() => {
    assertAvailable(core, input.spaceId, input.startDate, input.endDate);
    const tenantId = input.tenantId ?? insertTenant(core, input.newTenant!);
    const now = core.nowIso();
    core.db.run(
      `INSERT INTO tenancies (id, ref, tenant_id, space_id, property_id, start_date, end_date, rent_start_month,
         security_deposit_sen, utility_deposit_sen, terms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        nextRef(core, "tenancy", "T"),
        tenantId,
        space.id,
        space.property_id,
        input.startDate,
        input.endDate,
        input.rentStartMonth,
        input.securityDepositSen,
        input.utilityDepositSen,
        input.terms,
        now,
        now,
      ],
    );
    core.db.run("INSERT INTO rent_schedule (id, tenancy_id, effective_month, amount_sen, due_day, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
      newId(),
      id,
      input.rentStartMonth,
      input.monthlyRentSen,
      input.rentDueDay,
      now,
    ]);
    claimStaged(core, input.stagingKey, { kind: "tenancy", id });
  });
  ensureCurrentCharges(core, [id]);
  return getTenancy(core, id);
}

export function updateTenancy(core: Core, input: TenancyUpdate): TenancyDetail {
  const row = loadRow(core, input.id);
  if (row.cancelled_at) throw new AppError("NOT_ALLOWED", "errors.tenancyCancelled");
  if (row.moved_out_on && row.moved_out_on < input.startDate) {
    throw new AppError("VALIDATION", "validation.moveOutBeforeStart", { fields: { startDate: "validation.moveOutBeforeStart" } });
  }
  if (monthOf(input.startDate) > row.rent_start_month) {
    throw new AppError("VALIDATION", "validation.rentStartBeforeTenancy", { fields: { startDate: "validation.rentStartBeforeTenancy" } });
  }
  core.db.tx(() => {
    assertAvailable(core, row.space_id, input.startDate, row.moved_out_on ?? input.endDate, { excludeTenancyId: row.id });
    core.db.run(
      `UPDATE tenancies SET start_date = ?, end_date = ?, security_deposit_sen = ?, utility_deposit_sen = ?, terms = ?, updated_at = ?
       WHERE id = ?`,
      [input.startDate, input.endDate, input.securityDepositSen, input.utilityDepositSen, input.terms, core.nowIso(), row.id],
    );
  });
  ensureCurrentCharges(core, [row.id]);
  return getTenancy(core, row.id);
}

export function moveIn(core: Core, input: MoveInInput): TenancyDetail {
  const row = loadRow(core, input.id);
  if (row.cancelled_at) throw new AppError("NOT_ALLOWED", "errors.tenancyCancelled");
  if (row.moved_in_on) throw new AppError("NOT_ALLOWED", "errors.alreadyMovedIn");
  if (input.movedInOn < row.start_date) {
    throw new AppError("VALIDATION", "validation.moveInBeforeStart", { fields: { movedInOn: "validation.moveInBeforeStart" } });
  }
  core.db.tx(() => {
    core.db.run("UPDATE tenancies SET moved_in_on = ?, move_in_notes = ?, updated_at = ? WHERE id = ?", [
      input.movedInOn,
      input.notes,
      core.nowIso(),
      row.id,
    ]);
    for (const d of input.depositReceived) {
      core.db.run(
        `INSERT INTO deposit_entries (id, tenancy_id, deposit_type, kind, amount_sen, occurred_on, method, reference, notes, created_at)
         VALUES (?, ?, ?, 'received', ?, ?, ?, ?, ?, ?)`,
        [newId(), row.id, d.depositType, d.amountSen, input.movedInOn, d.method, d.reference, t("tenancies.receivedAtMoveIn"), core.nowIso()],
      );
    }
  });
  return getTenancy(core, row.id);
}

export function moveOut(core: Core, input: MoveOutInput): TenancyDetail {
  const row = loadRow(core, input.id);
  if (row.cancelled_at) throw new AppError("NOT_ALLOWED", "errors.tenancyCancelled");
  if (row.moved_out_on) throw new AppError("NOT_ALLOWED", "errors.alreadyMovedOut");
  if (input.movedOutOn < row.start_date) {
    throw new AppError("VALIDATION", "validation.moveOutBeforeStart", { fields: { movedOutOn: "validation.moveOutBeforeStart" } });
  }
  core.db.tx(() => {
    // Staying past the agreed end can collide with the next tenancy.
    assertAvailable(core, row.space_id, row.start_date, input.movedOutOn, { excludeTenancyId: row.id });
    core.db.run("UPDATE tenancies SET moved_out_on = ?, move_out_notes = ?, updated_at = ? WHERE id = ?", [
      input.movedOutOn,
      input.notes,
      core.nowIso(),
      row.id,
    ]);
    const updated = loadRow(core, row.id);
    if (input.voidChargesAfterMoveOut) voidChargesAfterEnd(core, updated, t("tenancies.voidedAfterMoveOut"));
    const d = input.deposit;
    if (d) {
      const summary = depositSummary(core, updated);
      if (d.refundSen + d.deductSen > summary.heldSen) {
        throw new AppError("VALIDATION", "validation.depositExceedsHeld", {
          params: { held: formatRM(summary.heldSen) },
          fields: { "deposit.refundSen": "validation.depositExceedsHeld" },
        });
      }
      // Refunds/deductions come out of the security deposit first, then utility, then other.
      const held = { security: 0, utility: 0, other: 0 };
      for (const e of summary.entries) {
        if (e.voidedAt) continue;
        held[e.depositType] += e.kind === "received" ? e.amountSen : -e.amountSen;
      }
      const take = (amount: number, kind: "refunded" | "deducted", notes: string) => {
        let left = amount;
        for (const type of ["security", "utility", "other"] as const) {
          if (left <= 0) break;
          const part = Math.min(left, held[type]);
          if (part <= 0) continue;
          held[type] -= part;
          left -= part;
          core.db.run(
            `INSERT INTO deposit_entries (id, tenancy_id, deposit_type, kind, amount_sen, occurred_on, method, reference, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [newId(), row.id, type, kind, part, input.movedOutOn, kind === "refunded" ? d.method : null, d.reference, notes, core.nowIso()],
          );
        }
      };
      if (d.deductSen > 0) take(d.deductSen, "deducted", d.deductReason);
      if (d.refundSen > 0) take(d.refundSen, "refunded", t("tenancies.refundedAtMoveOut"));
    }
  });
  return getTenancy(core, row.id);
}

export function cancelTenancy(core: Core, id: string, reason: string): TenancyDetail {
  const row = loadRow(core, id);
  if (row.cancelled_at) throw new AppError("NOT_ALLOWED", "errors.tenancyCancelled");
  const now = core.nowIso();
  core.db.tx(() => {
    core.db.run("UPDATE tenancies SET cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", [now, reason.slice(0, 500), now, id]);
    core.db.run("UPDATE charges SET voided_at = ?, void_reason = ?, updated_at = ? WHERE tenancy_id = ? AND voided_at IS NULL", [
      now,
      t("tenancies.voidedOnCancel"),
      now,
      id,
    ]);
  });
  return getTenancy(core, id);
}

export function deleteTenancy(core: Core, id: string) {
  loadRow(core, id);
  const money = core.db.get<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM payments WHERE tenancy_id = ?) + (SELECT COUNT(*) FROM deposit_entries WHERE tenancy_id = ?) AS n",
    [id, id],
  );
  if ((money?.n ?? 0) > 0) throw new AppError("CONFLICT", "errors.hasPayments");
  core.db.run("DELETE FROM tenancies WHERE id = ?", [id]);
}
