import { t, type MessageKey } from "../i18n";
import { daysBetween, timestampParts, weekday, type IsoDate, type YearMonth } from "./dates";

type MonthKey = "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12";

function monthName(mm: string, style: "long" | "short"): string {
  return t(`months.${style}.${mm as MonthKey}` as MessageKey);
}

/**
 * "23 Sep 2026" — day first, month spelled out, so the date can never be read
 * as US month/day.
 */
export function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${monthName(m, "short")} ${y}`;
}

/** "Wednesday, 23 September 2026" — used to echo a date field's value. */
export function formatDateLong(iso: IsoDate): string {
  const [y, m, d] = iso.split("-");
  const day = t(`weekdays.${weekday(iso)}` as MessageKey);
  return `${day}, ${Number(d)} ${monthName(m, "long")} ${y}`;
}

/** "23/09/2026" — for dense tables and printouts. */
export function formatDateNumeric(iso: IsoDate): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "September 2026" */
export function formatMonth(ym: YearMonth): string {
  const [y, m] = ym.split("-");
  return `${monthName(m, "long")} ${y}`;
}

/** "Sep 2026" */
export function formatMonthShort(ym: YearMonth): string {
  const [y, m] = ym.split("-");
  return `${monthName(m, "short")} ${y}`;
}

/** "23 Sep 2026, 2:31 pm" in Malaysia time. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const { date, hour, minute } = timestampParts(iso);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? t("time.am") : t("time.pm");
  return `${formatDate(date)}, ${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** "in 12 days", "tomorrow", "3 days ago", "today". */
export function formatRelativeDay(iso: IsoDate, today: IsoDate): string {
  const n = daysBetween(today, iso);
  if (n === 0) return t("common.today");
  if (n === 1) return t("common.tomorrow");
  if (n === -1) return t("common.yesterday");
  return n > 0 ? t("common.inDays", { n }) : t("common.daysAgo", { n: -n });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return t("common.bytes", { n: bytes });
  if (bytes < 1024 * 1024) return t("common.kb", { n: Math.round(bytes / 1024) });
  if (bytes < 1024 * 1024 * 1024) return t("common.mb", { n: (bytes / (1024 * 1024)).toFixed(1) });
  return t("common.gb", { n: (bytes / (1024 * 1024 * 1024)).toFixed(2) });
}

/** "2" / "0.5" months from tenths. */
export function formatTenths(tenths: number): string {
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}
