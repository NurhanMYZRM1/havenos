import { addDays, addMonths, monthOf, type IsoDate, type YearMonth } from "./dates";
import type { TenancyStatus } from "./enums";

/** A tenancy counts as "expiring" once its end date is this close. */
export const EXPIRING_WITHIN_DAYS = 60;
/** Dashboard look-ahead for move-ins and move-outs. */
export const UPCOMING_WITHIN_DAYS = 30;

export interface TenancyDates {
  startDate: IsoDate;
  endDate: IsoDate | null;
  movedInOn: IsoDate | null;
  movedOutOn: IsoDate | null;
  cancelledAt: string | null;
}

export function tenancyStatus(t: TenancyDates, today: IsoDate): TenancyStatus {
  if (t.cancelledAt) return "cancelled";
  if (t.movedOutOn && t.movedOutOn < today) return "ended";
  if (t.endDate && t.endDate < today && !t.movedOutOn) return "ended";
  if (t.startDate > today) return "upcoming";
  const end = t.movedOutOn ?? t.endDate;
  if (end && end <= addDays(today, EXPIRING_WITHIN_DAYS)) return "expiring";
  return "active";
}

/** Ended by date, but nobody recorded the move-out yet. */
export function needsMoveOut(t: TenancyDates, today: IsoDate): boolean {
  return !t.cancelledAt && !t.movedOutOn && t.endDate !== null && t.endDate < today;
}

/** Started, but nobody recorded the move-in yet. */
export function needsMoveIn(t: TenancyDates, today: IsoDate): boolean {
  return !t.cancelledAt && !t.movedInOn && !t.movedOutOn && t.startDate <= today;
}

/** A 12-month tenancy starting 15 Jan ends 14 Jan the following year. */
export function defaultEndDate(start: IsoDate, months: number): IsoDate {
  return addDays(addMonths(start, months), -1);
}

/**
 * First month to charge rent for. A tenancy entered after it began (a
 * landlord moving existing tenants into HavenOS) starts charging from the
 * current month instead of creating months of historical arrears.
 */
export function defaultRentStartMonth(start: IsoDate, today: IsoDate): YearMonth {
  const startMonth = monthOf(start);
  const currentMonth = monthOf(today);
  return startMonth < currentMonth ? currentMonth : startMonth;
}
