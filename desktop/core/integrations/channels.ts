/**
 * Where short-stay channel integrations (Airbnb, Booking.com, …) will plug in.
 *
 * NOTHING HERE IS CONNECTED. No adapter exists in this release and the app
 * never presents a channel as connected. This file fixes the shape an adapter
 * must have so it can be added later without touching tenancy records:
 *
 *  - A channel listing maps an external listing id to ONE lettable space
 *    (a whole unit, a room, or a bed) via the `channel_listings` table.
 *  - Imported bookings become rows in `reservations` (never `tenancies`), with
 *    `channel` + `channel_reservation_id` as the idempotency key.
 *  - Availability pushed to a channel must come from findConflict() in
 *    services/availability.ts, which already accounts for tenancies and
 *    reservations across the whole unit → room → bed tree.
 *
 * An adapter needs an authorised partner integration and credentials held in
 * the operating system's credential store (see desktop/main/secrets.ts), never
 * in the app bundle.
 */
import type { IsoDate } from "../../../lib/domain/dates";

export type ChannelId = "airbnb" | "booking_com" | "other";

export interface ExternalListing {
  channel: ChannelId;
  externalListingId: string;
  title: string;
}

export interface ExternalReservation {
  channel: ChannelId;
  externalReservationId: string;
  externalListingId: string;
  guestName: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  status: "confirmed" | "cancelled";
  totalSen: number | null;
}

export interface ChannelAdapter {
  readonly channel: ChannelId;
  /** Listings the landlord could map to spaces. */
  listListings(): Promise<ExternalListing[]>;
  /** Reservations changed since the last sync cursor. */
  pullReservations(cursor: string | null): Promise<{ reservations: ExternalReservation[]; cursor: string }>;
  /** Block dates on the channel that HavenOS knows are taken. */
  pushUnavailable(externalListingId: string, ranges: { from: IsoDate; to: IsoDate }[]): Promise<void>;
}

/** Registered adapters. Empty until an authorised integration is built. */
export const CHANNEL_ADAPTERS: readonly ChannelAdapter[] = [];
