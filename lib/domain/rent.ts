import {
  addDays,
  addMonthsToMonth,
  dueDateInMonth,
  maxDate,
  monthOf,
  monthRange,
  type IsoDate,
  type YearMonth,
} from "./dates";
import type { ChargeState } from "./enums";
import type { Sen } from "./money";

/** A rent change that applies from `effectiveMonth` onwards. */
export interface ScheduleItem {
  effectiveMonth: YearMonth;
  amountSen: Sen;
  dueDay: number;
}

export interface BillableTenancy {
  startDate: IsoDate;
  endDate: IsoDate | null;
  movedOutOn: IsoDate | null;
  cancelledAt: string | null;
  rentStartMonth: YearMonth;
  schedule: readonly ScheduleItem[];
}

/** The last day the tenant occupies the space; null while open-ended. */
export function effectiveEndDate(t: { endDate: IsoDate | null; movedOutOn: IsoDate | null }): IsoDate | null {
  return t.movedOutOn ?? t.endDate;
}

/**
 * The last calendar month rent is charged for.
 *
 * Tenancies are counted in whole months from the start day, so 15 Jan–14 Jan
 * is exactly twelve charges (Jan–Dec) and 1 Jan–31 Dec is also twelve. A
 * trailing partial month (15 Jan–20 Mar) is charged in full; the landlord can
 * adjust that last charge by hand.
 */
export function lastBillableMonth(startDate: IsoDate, end: IsoDate | null): YearMonth | null {
  if (end === null) return null;
  const next = addDays(end, 1);
  const partial = Number(next.slice(8, 10)) > Number(startDate.slice(8, 10));
  const last = partial ? monthOf(next) : addMonthsToMonth(monthOf(next), -1);
  const first = monthOf(startDate);
  return last < first ? first : last;
}

export function scheduleItemFor(schedule: readonly ScheduleItem[], period: YearMonth): ScheduleItem | null {
  let best: ScheduleItem | null = null;
  for (const item of schedule) {
    if (item.effectiveMonth <= period && (!best || item.effectiveMonth > best.effectiveMonth)) best = item;
  }
  return best;
}

export interface PlannedRentCharge {
  period: YearMonth;
  amountSen: Sen;
  dueDate: IsoDate;
}

/**
 * Rent charges the schedule calls for, from the first billed month up to and
 * including `throughMonth`. Pure — the caller inserts them idempotently, one
 * per (tenancy, period), so running this twice can never double-charge.
 */
export function plannedRentCharges(t: BillableTenancy, throughMonth: YearMonth): PlannedRentCharge[] {
  if (t.cancelledAt) return [];
  const last = lastBillableMonth(t.startDate, effectiveEndDate(t));
  const stop = last !== null && last < throughMonth ? last : throughMonth;
  if (stop < t.rentStartMonth) return [];
  const out: PlannedRentCharge[] = [];
  for (const period of monthRange(t.rentStartMonth, stop)) {
    const item = scheduleItemFor(t.schedule, period);
    if (!item || item.amountSen <= 0) continue;
    out.push({
      period,
      amountSen: item.amountSen,
      dueDate: maxDate(dueDateInMonth(period, item.dueDay), t.startDate),
    });
  }
  return out;
}

export interface AllocCharge {
  id: string;
  dueDate: IsoDate;
  amountSen: Sen;
  createdAt: string;
  voided: boolean;
}

export interface AllocPayment {
  amountSen: Sen;
  voided: boolean;
}

export interface Allocation {
  paidByCharge: Map<string, Sen>;
  totalChargedSen: Sen;
  totalPaidSen: Sen;
  /** Money received beyond everything charged so far. */
  creditSen: Sen;
  /** Charged minus paid; negative when in credit. */
  balanceSen: Sen;
}

/**
 * Apply a tenancy's payments to its charges oldest-due first. Allocation is
 * derived, never stored, so voiding or correcting any entry re-balances the
 * whole ledger consistently.
 */
export function allocatePayments(charges: readonly AllocCharge[], payments: readonly AllocPayment[]): Allocation {
  const live = charges
    .filter((c) => !c.voided)
    .sort((a, b) =>
      a.dueDate !== b.dueDate ? (a.dueDate < b.dueDate ? -1 : 1) : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
    );
  const totalPaidSen = payments.filter((p) => !p.voided).reduce((s, p) => s + p.amountSen, 0);
  let pool = totalPaidSen;
  const paidByCharge = new Map<string, Sen>();
  let totalChargedSen = 0;
  for (const c of live) {
    totalChargedSen += c.amountSen;
    const paid = Math.min(c.amountSen, pool);
    pool -= paid;
    paidByCharge.set(c.id, paid);
  }
  for (const c of charges) if (c.voided) paidByCharge.set(c.id, 0);
  return {
    paidByCharge,
    totalChargedSen,
    totalPaidSen,
    creditSen: pool,
    balanceSen: totalChargedSen - totalPaidSen,
  };
}

export function chargeState(args: {
  amountSen: Sen;
  paidSen: Sen;
  dueDate: IsoDate;
  today: IsoDate;
  voided: boolean;
}): ChargeState {
  if (args.voided) return "void";
  if (args.paidSen >= args.amountSen) return "paid";
  if (args.dueDate < args.today) return "overdue";
  if (args.paidSen > 0) return "part_paid";
  return "due";
}
