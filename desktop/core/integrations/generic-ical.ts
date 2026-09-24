import net from "node:net";
import type { ChannelCapabilities } from "../../../lib/api/contract";
import type { CalendarFeedAdapter, FeedSnapshot, FeedUrlCheck } from "./channels";
import { parseIcal } from "./ical";

/**
 * Any other booking calendar published as an iCal link (a channel manager, a
 * direct-booking site, another platform's export). Every event is treated as
 * a booking of the connected space; the feed's UID is its reference.
 */

export const GENERIC_ICAL_CAPABILITIES: ChannelCapabilities = {
  method: "ical",
  incremental: false,
  pushAvailability: false,
  guestDetails: false,
  money: false,
  channelImportDelayMinutes: null,
};

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (v.startsWith("::ffff:")) return true; // mapped IPv4 in hex form
  return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
}

/** True for localhost names and loopback / private / link-local IP literals. */
export function isNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const kind = net.isIP(host);
  if (kind === 4) return isPrivateIPv4(host);
  if (kind === 6) return isPrivateIPv6(host);
  return false;
}

export function checkGenericFeedUrl(raw: string): FeedUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "errors.channels.invalidFeedUrl" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: url.protocol === "http:" || url.protocol === "webcal:" ? "errors.channels.feedUrlNotHttps" : "errors.channels.invalidFeedUrl" };
  }
  if (url.username || url.password || !url.hostname) return { ok: false, error: "errors.channels.invalidFeedUrl" };
  if (isNonPublicHost(url.hostname)) return { ok: false, error: "errors.channels.feedUrlNotPublic" };
  // Only the host: the path and query often carry the calendar's secret.
  return { ok: true, externalListingId: null, hint: `${url.hostname.toLowerCase().replace(/^www\./, "")} · calendar link` };
}

export function parseGenericFeed(body: string): FeedSnapshot {
  return {
    events: parseIcal(body).map((e) => ({
      uid: e.uid,
      kind: "reservation" as const,
      confirmationCode: null,
      start: e.start,
      endExclusive: e.endExclusive,
      summary: e.summary.slice(0, 200),
    })),
  };
}

export const genericIcalAdapter: CalendarFeedAdapter = {
  channel: "other",
  method: "ical",
  capabilities: GENERIC_ICAL_CAPABILITIES,
  checkFeedUrl: checkGenericFeedUrl,
  parse: parseGenericFeed,
};
