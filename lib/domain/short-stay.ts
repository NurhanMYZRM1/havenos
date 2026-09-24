import { addDays, daysBetween, type IsoDate } from "./dates";

/**
 * Short-stay rules shared by the UI, the main process and the tests.
 *
 * Reservation dates follow hotel convention: nights run check-in … check-out
 * − 1, and the check-out day is free for the next arrival. Tenancies and
 * availability blocks store an inclusive last day instead.
 */

/** HavenOS re-reads every active calendar feed this often while it is open (and once at launch). */
export const CHANNEL_SYNC_INTERVAL_MINUTES = 20;

/** A feed is stale when its last successful read is older than this (three missed refreshes). */
export const CHANNEL_STALE_AFTER_MINUTES = 60;

/**
 * How often Airbnb says it refreshes calendars *it* imports (help article 99:
 * "automatically updates every 3 hours"). Dates blocked in HavenOS can take
 * this long to reach Airbnb even after the landlord adds them there.
 */
export const AIRBNB_IMPORT_DELAY_MINUTES = 180;

/** Days ahead the day view looks for arrivals that need attention. */
export const ARRIVAL_LOOKAHEAD_DAYS = 2;

/** Default turnover checklist, used when a connection doesn't define its own. */
export const DEFAULT_TURNOVER_CHECKLIST: readonly string[] = [
  "Strip beds and replace linen",
  "Clean bathroom(s) and restock toiletries",
  "Clean kitchen, empty fridge, wash dishes",
  "Vacuum and mop floors",
  "Take out rubbish",
  "Check for damage or missing items",
  "Check air-cond, lights and Wi-Fi",
  "Restock drinking water, coffee and tissue",
  "Lock up and return keys / reset door code",
];

export function nights(checkIn: IsoDate, checkOut: IsoDate): number {
  return daysBetween(checkIn, checkOut);
}

/** The last night of a stay (inclusive), for comparing with tenancy/block days. */
export function lastNight(checkOut: IsoDate): IsoDate {
  return addDays(checkOut, -1);
}

export function isFeedStale(lastSuccessAt: string | null, now: Date): boolean {
  if (!lastSuccessAt) return true;
  return now.getTime() - Date.parse(lastSuccessAt) > CHANNEL_STALE_AFTER_MINUTES * 60_000;
}

/** "HH:MM", 00:00–23:59. */
export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export type ChannelHealthInput = {
  status: "active" | "paused";
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  hasFeedLink: boolean;
  running: boolean;
};

/** One rule for a connection's health, used by Settings, the calendar and alerts. */
export function channelHealth(c: ChannelHealthInput, now: Date): "ok" | "syncing" | "stale" | "error" | "paused" | "never_synced" | "feed_link_missing" {
  if (c.status === "paused") return "paused";
  if (!c.hasFeedLink) return "feed_link_missing";
  if (c.running) return "syncing";
  if (c.lastErrorAt && (!c.lastSuccessAt || c.lastErrorAt > c.lastSuccessAt)) return "error";
  if (!c.lastSuccessAt) return "never_synced";
  if (isFeedStale(c.lastSuccessAt, now)) return "stale";
  return "ok";
}
