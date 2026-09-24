import type { ChannelCapabilities } from "../../../lib/api/contract";
import { AIRBNB_IMPORT_DELAY_MINUTES } from "../../../lib/domain/short-stay";
import type { CalendarFeedAdapter, FeedEvent, FeedSnapshot, FeedUrlCheck } from "./channels";
import { parseIcal } from "./ical";

/**
 * Airbnb, through the listing's calendar export link (Calendar → Availability
 * → Connect calendars → "Export calendar"):
 *   https://www.airbnb.com/calendar/ical/<listingId>.ics?s=<secret>
 *
 * What the feed carries (see desktop/tests/fixtures/airbnb/README.md):
 *  - SUMMARY "Reserved" for a booking, with a DESCRIPTION holding the
 *    reservation URL (…/hosting/reservations/details/<CODE>, or the older
 *    …/reservation/itinerary?code=<CODE>) and the guest's phone last 4 digits;
 *  - SUMMARY "Airbnb (Not available)" for every other unavailable night (host
 *    blocks, prep time, advance notice, the availability window's tail).
 * Dates only: no guest name, price or check-in time. The DESCRIPTION is read
 * for the confirmation code and then dropped — the phone digits are never kept.
 */

export const AIRBNB_CAPABILITIES: ChannelCapabilities = {
  method: "ical",
  incremental: false,
  pushAvailability: false,
  guestDetails: false,
  money: false,
  channelImportDelayMinutes: AIRBNB_IMPORT_DELAY_MINUTES,
};

const HOST = /^(?:www\.)?airbnb(?:\.[a-z]{2,3}){1,2}$/;
const PATH = /^\/calendar\/ical\/(\d{1,40})\.ics$/;
/** Both URL forms; the code is 8–12 letters/digits (HM… today, but the prefix isn't guaranteed). */
const CODE = /(?:\/details\/|[?&]code=)([A-Z0-9]{8,12})(?![A-Z0-9])/i;

/** The booking reference in a reservation's DESCRIPTION, upper-cased, or null. */
export function airbnbConfirmationCode(description: string): string | null {
  const m = CODE.exec(description);
  return m ? m[1].toUpperCase() : null;
}

function isBlockSummary(summary: string): boolean {
  return /not available|blocked/i.test(summary);
}

export function checkAirbnbFeedUrl(raw: string): FeedUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "errors.channels.invalidFeedUrl" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: url.protocol === "http:" || url.protocol === "webcal:" ? "errors.channels.feedUrlNotHttps" : "errors.channels.invalidFeedUrl" };
  }
  if (url.username || url.password || url.port) return { ok: false, error: "errors.channels.invalidFeedUrl" };
  const host = url.hostname.toLowerCase();
  if (!HOST.test(host)) return { ok: false, error: "errors.channels.feedUrlWrongChannel" };
  const m = PATH.exec(url.pathname);
  if (!m) return { ok: false, error: "errors.channels.feedUrlWrongChannel" };
  const listingId = m[1];
  if (listingId.length > 64) return { ok: false, error: "errors.channels.invalidFeedUrl" };
  // The hint names the site and the listing's last digits only — never the `s=` secret.
  return { ok: true, externalListingId: listingId, hint: `${host.replace(/^www\./, "")} · listing …${listingId.slice(-4)}` };
}

export function parseAirbnbFeed(body: string): FeedSnapshot {
  const events: FeedEvent[] = [];
  for (const e of parseIcal(body)) {
    const summary = e.summary.slice(0, 200);
    const code = isBlockSummary(e.summary) ? null : airbnbConfirmationCode(e.description);
    // "Reserved" is the booking marker; a reservation URL without a block label is treated the same.
    const reservation = /^reserved$/i.test(e.summary) || code !== null;
    events.push({
      uid: e.uid,
      kind: reservation ? "reservation" : "block",
      confirmationCode: reservation ? code : null,
      start: e.start,
      endExclusive: e.endExclusive,
      summary,
    });
  }
  return { events };
}

export const airbnbAdapter: CalendarFeedAdapter = {
  channel: "airbnb",
  method: "ical",
  capabilities: AIRBNB_CAPABILITIES,
  checkFeedUrl: checkAirbnbFeedUrl,
  parse: parseAirbnbFeed,
};
