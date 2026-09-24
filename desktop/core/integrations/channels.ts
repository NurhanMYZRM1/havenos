/**
 * The channel adapter boundary. Everything provider-specific (Airbnb,
 * Booking.com, a generic calendar) lives behind these interfaces; the sync
 * engine, services and UI only see normalized events and `capabilities`.
 *
 * WHAT IS CONNECTED TODAY: calendar (iCal) feeds only. Airbnb's API is
 * invitation-only for approved software partners, and HavenOS has no partner
 * approval or credentials (see docs/short-stays.md). A calendar feed gives
 * dates only — no guest details, prices or payouts — and HavenOS cannot write
 * to the channel, so dates HavenOS knows are taken are shown to the landlord
 * as a "block these on Airbnb" list instead of being pushed.
 *
 * Rules every adapter follows:
 *  - A listing maps to ONE lettable space (unit, room or bed) via
 *    channel_connections. Imported bookings become rows in `reservations`
 *    (never `tenancies`), keyed by channel + channel_reservation_id.
 *  - Availability is decided only by services/availability.ts, which covers
 *    tenancies, reservations and blocks across the unit → room → bed tree.
 *  - Feed links and credentials are secrets: held in the OS credential store
 *    (ChannelSecretStore), never in the database, backups, logs or errors.
 */
import type { ChannelCapabilities, ChannelErrorCode, ChannelSyncTrigger } from "../../../lib/api/contract";
import type { IsoDate } from "../../../lib/domain/dates";
import type { ChannelId, ChannelMethod } from "../../../lib/domain/enums";
import type { MessageKey } from "../../../lib/i18n";

/** One event from a channel calendar, normalized. */
export interface FeedEvent {
  /** The feed's UID for the event. */
  uid: string;
  /** A booking, or dates the channel shows as unavailable for another reason. */
  kind: "reservation" | "block";
  /** The channel's booking reference when the feed carries one (Airbnb: HM…). */
  confirmationCode: string | null;
  /** Check-in / first unavailable night. */
  start: IsoDate;
  /** Check-out / the day after the last unavailable night (exclusive). */
  endExclusive: IsoDate;
  /** Short label, e.g. "Reserved". Never contains guest contact details. */
  summary: string;
}

/** A whole calendar as read at one moment. Calendar feeds have no change log. */
export interface FeedSnapshot {
  events: FeedEvent[];
}

export type FeedUrlCheck =
  | { ok: true; externalListingId: string | null; /** Safe to show and store, e.g. "airbnb.com · listing …4821". */ hint: string }
  | { ok: false; error: MessageKey };

/** Adapter for channels synced by reading a published calendar (iCal) feed. */
export interface CalendarFeedAdapter {
  readonly channel: ChannelId;
  readonly method: Extract<ChannelMethod, "ical">;
  readonly capabilities: ChannelCapabilities;
  /** Validate a feed link the landlord pasted, without storing or fetching it. */
  checkFeedUrl(url: string): FeedUrlCheck;
  /** Parse a fetched body. Throws ChannelSyncError("not_a_calendar") if it isn't a calendar. */
  parse(body: string): FeedSnapshot;
}

/**
 * Shape a partner-API adapter would take if HavenOS is ever approved as an
 * Airbnb software partner (see docs/short-stays.md → "Approved API path").
 * Nothing implements it: there are no credentials, and code for an API we
 * can't call would only rot. It is here so the sync engine's seams are known.
 */
export interface PartnerApiAdapter {
  readonly channel: ChannelId;
  readonly capabilities: ChannelCapabilities;
  listListings(): Promise<{ externalListingId: string; title: string }[]>;
  pullReservations(cursor: string | null): Promise<{ events: FeedEvent[]; cursor: string }>;
  pushUnavailable(externalListingId: string, ranges: { from: IsoDate; to: IsoDate }[]): Promise<void>;
}

/** A sync failure with a code the UI can explain. `detail` must never contain the feed link. */
export class ChannelSyncError extends Error {
  constructor(
    readonly code: ChannelErrorCode,
    readonly detail = "",
  ) {
    super(`channel sync failed: ${code}${detail ? ` (${detail})` : ""}`);
  }
}

/** Where feed links live: the OS credential store (Keychain / DPAPI), keyed by connection id. */
export interface ChannelSecretStore {
  /** False when the OS store is unavailable; links are then kept in memory only until quit. */
  readonly available: boolean;
  get(connectionId: string): string | null;
  set(connectionId: string, value: string): void;
  delete(connectionId: string): void;
}

/** Fetches a feed over HTTPS from the main process. Tests inject a fake. */
export interface FeedFetcher {
  fetch(url: string, opts: { timeoutMs: number; maxBytes: number }): Promise<{ status: number; body: string }>;
}

/** The running sync scheduler, as the IPC handlers see it. */
export interface ChannelSyncControl {
  readonly secrets: ChannelSecretStore;
  /** Read feeds now. connectionId null = every active connection. Resolves when done. */
  syncNow(opts: { connectionId: string | null; trigger: ChannelSyncTrigger; acceptShrink: boolean }): Promise<void>;
  /** When the timer will next read the feeds, or null if it isn't running. */
  nextSyncAt(): string | null;
  /** Connection ids being read right now. */
  running(): string[];
}

/** In-memory secrets, for tests and for machines without an OS credential store. */
export class MemorySecretStore implements ChannelSecretStore {
  private readonly values = new Map<string, string>();
  constructor(readonly available = true) {}
  get(connectionId: string) {
    return this.values.get(connectionId) ?? null;
  }
  set(connectionId: string, value: string) {
    this.values.set(connectionId, value);
  }
  delete(connectionId: string) {
    this.values.delete(connectionId);
  }
}
