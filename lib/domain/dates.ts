/**
 * Calendar dates are stored as ISO strings ("2026-09-23") and months as
 * "2026-09". They are *local calendar days in Malaysia*: "today" is always
 * computed in Asia/Kuala_Lumpur, never the machine's own timezone, so a
 * landlord travelling abroad still sees rent fall due on the right day.
 *
 * All arithmetic happens on UTC midnights, which has no DST and so no
 * off-by-one-hour drift.
 */

export const APP_TIMEZONE = "Asia/Kuala_Lumpur";

export type IsoDate = string;
export type YearMonth = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(`${m[1]}-${m[2]}`);
}

export function isYearMonth(value: unknown): value is YearMonth {
  if (typeof value !== "string") return false;
  const m = YEAR_MONTH.exec(value);
  if (!m) return false;
  const mo = Number(m[2]);
  return Number(m[1]) >= 1900 && Number(m[1]) <= 2200 && mo >= 1 && mo <= 12;
}

function toUtc(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's date in Malaysia. */
export function todayInMalaysia(now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

export function daysInMonth(ym: YearMonth): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthOf(date: IsoDate): YearMonth {
  return date.slice(0, 7);
}

export function addMonthsToMonth(ym: YearMonth, n: number): YearMonth {
  const [y, m] = ym.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/** Same day-of-month N months later, clamped (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(date: IsoDate, n: number): IsoDate {
  const ym = addMonthsToMonth(monthOf(date), n);
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(ym));
  return `${ym}-${String(day).padStart(2, "0")}`;
}

export function monthRange(from: YearMonth, to: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  for (let ym = from; ym <= to; ym = addMonthsToMonth(ym, 1)) out.push(ym);
  return out;
}

/** The due date for a month, clamping day 29–31 to the month's last day. */
export function dueDateInMonth(ym: YearMonth, dueDay: number): IsoDate {
  const day = Math.min(Math.max(1, Math.trunc(dueDay)), daysInMonth(ym));
  return `${ym}-${String(day).padStart(2, "0")}`;
}

export function firstOfMonth(ym: YearMonth): IsoDate {
  return `${ym}-01`;
}

export function lastOfMonth(ym: YearMonth): IsoDate {
  return `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

/** Accept "23/09/2026", "23-9-2026" or ISO; returns ISO or null. */
export function parseDayMonthYear(input: string): IsoDate | null {
  const s = input.trim();
  if (isIsoDate(s)) return s;
  const m = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

/** Hour/minute of an ISO timestamp as seen in Malaysia. */
export function timestampParts(iso: string): { date: IsoDate; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: IsoDate): number {
  return new Date(toUtc(date)).getUTCDay();
}
