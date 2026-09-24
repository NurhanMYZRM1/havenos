import type { ChannelConnection, ChannelErrorCode, ReservationSummary } from "@/lib/api/contract";
import { daysBetween, type IsoDate } from "@/lib/domain/dates";
import type { ChannelId, ReservationChannel } from "@/lib/domain/enums";
import { formatDate, formatTimestamp } from "@/lib/domain/format";
import { CHANNEL_SYNC_INTERVAL_MINUTES } from "@/lib/domain/short-stay";
import { plural, t, type MessageKey } from "@/lib/i18n";

/** "15:00" → "3:00 pm". Empty or malformed values come back as "—". */
export function formatClock(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return value;
  const hour = Number(m[1]);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m[2]} ${hour < 12 ? t("time.am") : t("time.pm")}`;
}

export function nightsLabel(n: number): string {
  return plural(n, "shortStays.time.nightOne", "shortStays.time.nightMany");
}

export function guestsLabel(n: number): string {
  return plural(n, "shortStays.time.guestOne", "shortStays.time.guestMany");
}

/** "12 Sep 2026 – 15 Sep 2026". */
export function formatRange(start: IsoDate, end: IsoDate): string {
  return t("shortStays.time.range", { start: formatDate(start), end: formatDate(end) });
}

/** A stay: check-in – check-out (the check-out day is free). */
export function formatStay(checkIn: IsoDate, checkOut: IsoDate): string {
  return `${formatRange(checkIn, checkOut)} · ${nightsLabel(Math.max(0, daysBetween(checkIn, checkOut)))}`;
}

/** "3 h", "1 h 30 min", "45 min". */
export function formatHours(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return t("shortStays.time.minutes", { n: m });
  if (m === 0) return t("shortStays.time.hours", { n: h });
  return t("shortStays.time.hoursMinutes", { h, m });
}

/** "5 min ago", "in 12 min", "3 days ago". */
export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return t("shortStays.connections.never");
  const diff = Date.parse(iso) - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  if (diff > 0) {
    if (minutes < 1) return t("shortStays.time.soon");
    if (minutes < 90) return t("shortStays.time.inMinutes", { n: minutes });
    return t("shortStays.time.inHours", { n: Math.round(minutes / 60) });
  }
  if (minutes < 1) return t("shortStays.time.justNow");
  if (minutes < 90) return t("shortStays.time.minutesAgo", { n: minutes });
  if (minutes < 48 * 60) return t("shortStays.time.hoursAgo", { n: Math.round(minutes / 60) });
  return t("shortStays.time.daysAgo", { n: Math.round(minutes / 1440) });
}

/** "23 Sep 2026, 2:31 pm (5 min ago)". */
export function formatWhen(iso: string | null | undefined, now?: number): string {
  if (!iso) return t("shortStays.connections.never");
  return `${formatTimestamp(iso)} (${formatAgo(iso, now)})`;
}

/** Channel name for use inside a sentence ("Airbnb", "the other website"). */
export function channelName(channel: ReservationChannel | ChannelId): string {
  return t(`shortStays.enums.channelName.${channel}` as MessageKey);
}

export function channelLabel(channel: ReservationChannel): string {
  return t(`shortStays.enums.reservationChannel.${channel}` as MessageKey);
}

/**
 * How a connection syncs, described from its capabilities — never assumed:
 * "Airbnb calendar (iCal) · dates only".
 */
export function methodLabel(c: Pick<ChannelConnection, "channel" | "capabilities">): string {
  const calendar = t(`shortStays.enums.channelCalendar.${c.channel}` as MessageKey);
  const base = t("shortStays.method.ical", { calendar });
  const datesOnly = !c.capabilities.guestDetails && !c.capabilities.money;
  return datesOnly ? `${base} · ${t("shortStays.method.datesOnly")}` : base;
}

/** "Airbnb calendar linked · dates only". */
export function linkedLabel(c: Pick<ChannelConnection, "channel" | "capabilities">): string {
  const calendar = t(`shortStays.enums.channelCalendar.${c.channel}` as MessageKey);
  const base = t("shortStays.method.linked", { calendar });
  const datesOnly = !c.capabilities.guestDetails && !c.capabilities.money;
  return datesOnly ? `${base} · ${t("shortStays.method.datesOnly")}` : base;
}

export function channelErrorText(code: ChannelErrorCode, channel: ChannelId): string {
  return t(`shortStays.channelErrors.${code}` as MessageKey, { channel: channelName(channel), interval: CHANNEL_SYNC_INTERVAL_MINUTES });
}

/** Guest name, or an honest placeholder: calendar feeds don't share names. */
export function guestDisplay(r: Pick<ReservationSummary, "guestName" | "source" | "channel">): string {
  if (r.guestName.trim()) return r.guestName;
  if (r.source === "feed") return t("shortStays.guest.noNameChannel", { channel: channelLabel(r.channel) });
  return t("shortStays.guest.noName");
}

export function whereLabel(spacePath: string | null, propertyName: string): string {
  return spacePath ? `${spacePath} · ${propertyName}` : propertyName;
}

/** Copy text to the clipboard, with a fallback for when the async API is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
