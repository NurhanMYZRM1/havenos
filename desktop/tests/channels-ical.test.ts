import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { FEED_MAX_BYTES, HttpFeedFetcher } from "../core/channels/fetcher";
import { airbnbConfirmationCode, checkAirbnbFeedUrl, parseAirbnbFeed } from "../core/integrations/airbnb";
import { ChannelSyncError } from "../core/integrations/channels";
import { checkGenericFeedUrl, parseGenericFeed } from "../core/integrations/generic-ical";
import { parseIcal, readIcalDate, unescapeText, unfoldLines } from "../core/integrations/ical";
import { feedAdapter } from "../core/integrations/registry";

const fixture = (...p: string[]) => fs.readFileSync(path.resolve(process.cwd(), "desktop/tests/fixtures", ...p), "utf8");
const SECRET = "0123456789abcdef0123456789abcdef";
const AIRBNB_URL = `https://www.airbnb.com/calendar/ical/900000000000000001.ics?s=${SECRET}`;

function syncErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ChannelSyncError) return err.code;
    throw err;
  }
  return "none";
}

const cal = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR", ""].join("\r\n");

describe("iCal parser", () => {
  it("unfolds CRLF/LF continuations and unescapes text", () => {
    assert.deepEqual(unfoldLines("A:1\r\n 23\n\tX\r\nB:2"), ["A:123X", "B:2"]);
    assert.equal(unescapeText("a\\nb\\Nc\\,d\\;e\\\\f"), "a\nb\nc,d;e\\f");
  });

  it("reads DATE, UTC DATE-TIME (as a Kuala Lumpur day) and TZID/floating DATE-TIME", () => {
    assert.deepEqual(readIcalDate("20261001"), { date: "2026-10-01", timed: false });
    // 20:00 UTC on 1 Oct is 04:00 on 2 Oct in Kuala Lumpur.
    assert.deepEqual(readIcalDate("20261001T200000Z"), { date: "2026-10-02", timed: true });
    assert.deepEqual(readIcalDate("20261001T200000"), { date: "2026-10-01", timed: true });
    assert.equal(readIcalDate("20261340"), null);
    assert.equal(readIcalDate("garbage"), null);
  });

  it("handles DURATION, missing DTEND, cancelled events, nested VALARM and junk lines", () => {
    const events = parseIcal(fixture("ical", "generic-lf.ics"));
    assert.deepEqual(
      events.map((e) => [e.uid, e.start, e.endExclusive, e.summary]),
      [
        ["evt-1@example.com", "2026-10-01", "2026-10-04", "Booking, direct site"],
        ["evt-2@example.com", "2026-10-10", "2026-10-12", "Owner stay"],
        ["evt-4@example.com", "2026-11-01", "2026-11-02", "One night"],
      ],
    );
    assert.equal(events[0].description, "", "the alarm's DESCRIPTION isn't the event's");
  });

  it("accepts P#W durations, a timed event inside one day, quoted params and duplicate UIDs", () => {
    const events = parseIcal(
      cal(
        "BEGIN:VEVENT", "UID:w", "DTSTART;VALUE=DATE:20261001", "DURATION:P1W", "END:VEVENT",
        "BEGIN:VEVENT", "UID:t", 'DTSTART;TZID="Asia/Kuala_Lumpur":20261005T100000', "DTEND;TZID=\"Asia/Kuala_Lumpur\":20261005T120000", "END:VEVENT",
        "BEGIN:VEVENT", "UID:w", "DTSTART;VALUE=DATE:20261201", "END:VEVENT",
      ),
    );
    assert.deepEqual(events.map((e) => [e.uid, e.start, e.endExclusive]), [
      ["w", "2026-10-01", "2026-10-08"],
      ["t", "2026-10-05", "2026-10-06"],
    ]);
  });

  it("rejects bodies that aren't a complete calendar", () => {
    assert.equal(syncErrorCode(() => parseIcal("<!doctype html><html>Log in</html>")), "not_a_calendar");
    assert.equal(syncErrorCode(() => parseIcal("")), "not_a_calendar");
    assert.equal(syncErrorCode(() => parseIcal("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;VALUE=DATE:20261001\r\n")), "not_a_calendar");
  });

  it("caps the number of events", () => {
    const events: string[] = [];
    for (let i = 0; i < 6; i++) events.push("BEGIN:VEVENT", `UID:${i}`, "DTSTART;VALUE=DATE:20261001", "END:VEVENT");
    assert.equal(parseIcal(cal(...events), 6).length, 6);
    assert.equal(syncErrorCode(() => parseIcal(cal(...events), 5)), "too_large");
  });

  it("explicitly rejects daily, weekly and recurrence-date calendars", () => {
    for (const rule of ["RRULE:FREQ=DAILY;COUNT=3", "RRULE:FREQ=WEEKLY;BYDAY=MO,FR", "RDATE;VALUE=DATE:20261002,20261005"]) {
      assert.equal(syncErrorCode(() => parseIcal(cal("BEGIN:VEVENT", "UID:repeat", "DTSTART;VALUE=DATE:20261001", rule, "END:VEVENT"))), "unsupported_recurrence");
    }
  });
});

describe("Airbnb adapter", () => {
  it("accepts export links on www.airbnb.com and regional hosts, and never puts the secret in the hint", () => {
    const check = checkAirbnbFeedUrl(AIRBNB_URL);
    assert.deepEqual(check, { ok: true, externalListingId: "900000000000000001", hint: "airbnb.com · listing …0001" });
    assert.ok(checkAirbnbFeedUrl("https://airbnb.com/calendar/ical/12345678.ics?s=abc").ok);
    const regional = checkAirbnbFeedUrl("https://www.airbnb.com.my/calendar/ical/12344821.ics?s=abc");
    assert.ok(regional.ok && regional.hint === "airbnb.com.my · listing …4821");
    assert.ok(!JSON.stringify(check).includes(SECRET));
  });

  it("rejects other links with a reason", () => {
    const err = (url: string) => {
      const r = checkAirbnbFeedUrl(url);
      return r.ok ? null : r.error;
    };
    assert.equal(err("http://www.airbnb.com/calendar/ical/1.ics?s=x"), "errors.channels.feedUrlNotHttps");
    assert.equal(err("webcal://www.airbnb.com/calendar/ical/1.ics"), "errors.channels.feedUrlNotHttps");
    assert.equal(err("https://www.airbnb.evil.com/calendar/ical/1.ics"), "errors.channels.feedUrlWrongChannel");
    assert.equal(err("https://airbnb.com.evil.io/calendar/ical/1.ics"), "errors.channels.feedUrlWrongChannel");
    assert.equal(err("https://www.airbnb.com/rooms/123"), "errors.channels.feedUrlWrongChannel");
    assert.equal(err("https://user:pw@www.airbnb.com/calendar/ical/1.ics"), "errors.channels.invalidFeedUrl");
    assert.equal(err("not a url"), "errors.channels.invalidFeedUrl");
  });

  it("parses the research fixture: bookings with codes, blocks, no phone digits", () => {
    const { events } = parseAirbnbFeed(fixture("airbnb", "listing-a-v1.ics"));
    assert.deepEqual(
      events.map((e) => [e.kind, e.confirmationCode, e.start, e.endExclusive, e.summary]),
      [
        ["reservation", "HMZX4K2P9Q", "2026-09-18", "2026-09-21", "Reserved"],
        ["reservation", "HMB7T2QW4N", "2026-10-02", "2026-10-05", "Reserved"],
        ["block", null, "2026-10-09", "2026-10-11", "Airbnb (Not available)"],
        ["reservation", "HMC9V5XK2R", "2026-10-23", "2026-10-26", "Reserved"],
        ["block", null, "2027-03-24", "2027-09-24", "Airbnb (Not available)"],
      ],
    );
    assert.ok(!JSON.stringify(events).includes("4821"), "the phone digits are dropped");
    assert.deepEqual(parseAirbnbFeed(fixture("airbnb", "listing-a-empty.ics")).events, []);
  });

  it("reads both reservation URL forms", () => {
    assert.equal(airbnbConfirmationCode("Reservation URL: https://www.airbnb.com/hosting/reservations/details/hmab12cd34\nPhone"), "HMAB12CD34");
    assert.equal(airbnbConfirmationCode("Reservation URL: https://www.airbnb.com/reservation/itinerary?code=HMQW12ER34"), "HMQW12ER34");
    assert.equal(airbnbConfirmationCode("no url here"), null);
  });

  it("has the calendar-only capabilities", () => {
    const a = feedAdapter("airbnb")!;
    assert.deepEqual(a.capabilities, { method: "ical", incremental: false, pushAvailability: false, guestDetails: false, money: false, channelImportDelayMinutes: 180 });
    assert.equal(feedAdapter("booking_com"), null);
    assert.equal(feedAdapter("__proto__"), null);
  });
});

describe("generic calendar adapter", () => {
  it("accepts public https links only", () => {
    const ok = checkGenericFeedUrl("https://calendar.example.com/feeds/abc123/secret.ics");
    assert.deepEqual(ok, { ok: true, externalListingId: null, hint: "calendar.example.com · calendar link" });
    for (const url of ["https://localhost/a.ics", "https://127.0.0.1/a.ics", "https://10.1.2.3/a.ics", "https://192.168.0.2/a.ics", "https://[::1]/a.ics", "https://169.254.169.254/latest"]) {
      const r = checkGenericFeedUrl(url);
      assert.ok(!r.ok && r.error === "errors.channels.feedUrlNotPublic", url);
    }
    const http = checkGenericFeedUrl("http://calendar.example.com/a.ics");
    assert.ok(!http.ok && http.error === "errors.channels.feedUrlNotHttps");
  });

  it("treats every event as a booking keyed by UID", () => {
    const { events } = parseGenericFeed(fixture("ical", "generic-lf.ics"));
    assert.ok(events.every((e) => e.kind === "reservation" && e.confirmationCode === null));
    assert.equal(events.length, 3);
  });
});

describe("feed fetcher", () => {
  const response = (status: number, body: string, headers: Record<string, string> = {}) => new Response(status >= 300 && status < 400 ? null : body, { status, headers });

  it("sends calendar headers and returns the body", async () => {
    let seen: RequestInit | undefined;
    const f = new HttpFeedFetcher({
      appVersion: "9.9.9",
      fetchImpl: (async (_url: URL, init: RequestInit) => {
        seen = init;
        return response(200, "BEGIN:VCALENDAR");
      }) as unknown as typeof fetch,
    });
    const r = await f.fetch(AIRBNB_URL, { timeoutMs: 1000, maxBytes: FEED_MAX_BYTES });
    assert.equal(r.body, "BEGIN:VCALENDAR");
    const headers = seen!.headers as Record<string, string>;
    assert.equal(headers.Accept, "text/calendar");
    assert.match(headers["User-Agent"], /^HavenOS\/9\.9\.9/);
    assert.equal(seen!.redirect, "manual");
  });

  it("maps statuses and failures to codes without the link", async () => {
    const run = async (impl: (url: URL) => Promise<Response>, opts = { timeoutMs: 1000, maxBytes: 1000 }) => {
      const f = new HttpFeedFetcher({ fetchImpl: impl as unknown as typeof fetch });
      try {
        await f.fetch(AIRBNB_URL, opts);
        return "ok";
      } catch (err) {
        assert.ok(err instanceof ChannelSyncError);
        assert.ok(!String(err.message).includes(SECRET) && !err.detail.includes("airbnb"), "no link in errors");
        return `${err.code}${err.detail ? `:${err.detail}` : ""}`;
      }
    };
    assert.equal(await run(async () => response(404, "")), "not_found:404");
    assert.equal(await run(async () => response(410, "")), "not_found:410");
    assert.equal(await run(async () => response(403, "")), "forbidden:403");
    assert.equal(await run(async () => response(429, "")), "rate_limited:429");
    assert.equal(await run(async () => response(503, "")), "http_error:503");
    assert.equal(await run(async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))), "offline");
    assert.equal(await run(async () => response(200, "x".repeat(2000))), "too_large");
    assert.equal(await run(async () => response(200, "x", { "content-length": "999999" })), "too_large");
    // A server that never answers.
    assert.equal(
      await run(
        (_url: URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => (init as RequestInit).signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
        { timeoutMs: 20, maxBytes: 1000 },
      ),
      "timeout",
    );
  });

  it("preserves a sanitized original network error name and message", async () => {
    const fetcher = new HttpFeedFetcher({ fetchImpl: (async () => {
      throw new TypeError(`fetch failed ${AIRBNB_URL} ${SECRET}`);
    }) as unknown as typeof fetch });
    await assert.rejects(fetcher.fetch(AIRBNB_URL, { timeoutMs: 1000, maxBytes: 1000 }), (err: unknown) => {
      assert.ok(err instanceof ChannelSyncError);
      assert.equal(err.code, "offline");
      assert.equal(err.diagnostic, "TypeError: fetch failed [redacted] [redacted]");
      assert.ok(!JSON.stringify(err).includes(SECRET));
      return true;
    });
  });

  it("follows up to three https redirects and refuses http ones", async () => {
    const hops: string[] = [];
    const impl = async (url: URL) => {
      hops.push(url.hostname);
      if (url.hostname === "www.airbnb.com") return response(302, "", { location: "https://www.airbnb.com.my/calendar/ical/1.ics?s=x" });
      return response(200, "BEGIN:VCALENDAR");
    };
    const f = new HttpFeedFetcher({ fetchImpl: impl as unknown as typeof fetch });
    assert.equal((await f.fetch(AIRBNB_URL, { timeoutMs: 1000, maxBytes: 1000 })).body, "BEGIN:VCALENDAR");
    assert.deepEqual(hops, ["www.airbnb.com", "www.airbnb.com.my"]);

    const toHttp = new HttpFeedFetcher({ fetchImpl: (async () => response(301, "", { location: "http://example.com/x.ics" })) as unknown as typeof fetch });
    await assert.rejects(toHttp.fetch(AIRBNB_URL, { timeoutMs: 1000, maxBytes: 1000 }), (e: unknown) => e instanceof ChannelSyncError && e.code === "http_error");
    let n = 0;
    const loop = new HttpFeedFetcher({ fetchImpl: (async () => response(302, "", { location: `https://www.airbnb.com/${n++}` })) as unknown as typeof fetch });
    await assert.rejects(loop.fetch(AIRBNB_URL, { timeoutMs: 1000, maxBytes: 1000 }), (e: unknown) => e instanceof ChannelSyncError && e.detail === "redirect");
    assert.equal(n, 4);
  });
});
