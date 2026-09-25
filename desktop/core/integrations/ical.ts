import crypto from "node:crypto";
import { addDays, isIsoDate, todayInMalaysia, type IsoDate } from "../../../lib/domain/dates";
import { ChannelSyncError } from "./channels";

/**
 * A small, defensive reader for the subset of RFC 5545 (iCalendar) that
 * booking calendars use: VEVENTs with all-day or timed start/end. It never
 * expands recurrence rules; feeds with them are rejected explicitly. It skips anything
 * it can't read instead of failing the whole feed — except a body that isn't
 * a calendar at all, which is rejected so a login page or an error page can
 * never be mistaken for "no bookings".
 */

/** More events than any single listing's calendar plausibly has. */
export const MAX_FEED_EVENTS = 5000;
const MAX_UID = 255;

export interface IcalEvent {
  uid: string;
  summary: string;
  description: string;
  start: IsoDate;
  /** Exclusive: the day after the last day the event covers (a check-out day). */
  endExclusive: IsoDate;
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Split into logical lines: CRLF, LF or CR, with folded continuations (a leading space or tab) joined. */
export function unfoldLines(body: string): string[] {
  const out: string[] = [];
  for (const raw of body.replace(/^﻿/, "").split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

/** TEXT value escapes: \n \N \, \; \\ */
export function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** `NAME;PARAM=a;PARAM2="b:c":value` → parts. Null for a line that isn't a content line. */
function parseLine(line: string): ContentLine | null {
  const nameMatch = /^([A-Za-z0-9-]+)/.exec(line);
  if (!nameMatch) return null;
  const name = nameMatch[1].toUpperCase();
  const params: Record<string, string> = {};
  let i = nameMatch[1].length;
  while (i < line.length && line[i] === ";") {
    i++;
    const eq = line.indexOf("=", i);
    if (eq < 0) return null;
    const key = line.slice(i, eq).trim().toUpperCase();
    i = eq + 1;
    let value = "";
    if (line[i] === '"') {
      const close = line.indexOf('"', i + 1);
      if (close < 0) return null;
      value = line.slice(i + 1, close);
      i = close + 1;
      // A list of values (a,"b") — keep the first; booking feeds never use lists.
      while (i < line.length && line[i] !== ";" && line[i] !== ":") i++;
    } else {
      while (i < line.length && line[i] !== ";" && line[i] !== ":") value += line[i++];
    }
    if (key) params[key] = value;
  }
  if (line[i] !== ":") return null;
  return { name, params, value: line.slice(i + 1) };
}

const DATE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i;

/**
 * DATE → that day. DATE-TIME in UTC (…Z) → the Kuala Lumpur calendar day at
 * that instant. DATE-TIME with a TZID or floating → its own date part (the
 * listing's local day, which is what the landlord sees on the channel).
 */
export function readIcalDate(value: string): { date: IsoDate; timed: boolean } | null {
  const v = value.trim();
  const d = DATE.exec(v);
  if (d) {
    const date = `${d[1]}-${d[2]}-${d[3]}`;
    return isIsoDate(date) ? { date, timed: false } : null;
  }
  const t = DATE_TIME.exec(v);
  if (!t) return null;
  const date = `${t[1]}-${t[2]}-${t[3]}`;
  if (!isIsoDate(date)) return null;
  const [h, mi, s] = [Number(t[4]), Number(t[5]), Number(t[6])];
  if (h > 23 || mi > 59 || s > 60) return null;
  if (!t[7]) return { date, timed: true };
  const instant = new Date(Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]), h, mi, Math.min(s, 59)));
  return { date: todayInMalaysia(instant), timed: true };
}

/** Whole days in a DURATION: P#D, P#W, or P#DT… (the time part is ignored). */
export function readDurationDays(value: string): number | null {
  const m = /^\+?P(?:(\d{1,4})W|(\d{1,5})D(?:T[\dHMS]*)?|T[\dHMS]+)$/i.exec(value.trim());
  if (!m) return null;
  if (m[1]) return Number(m[1]) * 7;
  if (m[2]) return Number(m[2]);
  return 0;
}

function safeUid(raw: string): string {
  const uid = raw.trim();
  if (uid.length <= MAX_UID) return uid;
  return `sha256-${crypto.createHash("sha256").update(uid).digest("hex")}`;
}

interface Draft {
  uid: string;
  summary: string;
  description: string;
  status: string;
  start: { date: IsoDate; timed: boolean } | null;
  end: { date: IsoDate; timed: boolean } | null;
  durationDays: number | null;
  recurrenceId: string;
}

function emptyDraft(): Draft {
  return { uid: "", summary: "", description: "", status: "", start: null, end: null, durationDays: null, recurrenceId: "" };
}

function finish(d: Draft): IcalEvent | null {
  if (d.status.toUpperCase() === "CANCELLED") return null;
  if (!d.start) return null;
  let end: IsoDate;
  if (d.end) end = d.end.date;
  else if (d.durationDays !== null) end = addDays(d.start.date, d.durationDays);
  else end = addDays(d.start.date, 1);
  // A timed event inside one day (or a zero-length one) still takes that day.
  if (end <= d.start.date) end = addDays(d.start.date, 1);
  const summary = d.summary.trim();
  const uid =
    d.uid.trim() ||
    // No UID (not allowed by RFC 5545, but seen in hand-made calendars): derive a stable one.
    `nouid-${crypto.createHash("sha256").update(`${d.start.date}|${end}|${summary}`).digest("hex").slice(0, 32)}`;
  return { uid: safeUid(d.recurrenceId ? `${uid}#${d.recurrenceId}` : uid), summary, description: d.description, start: d.start.date, endExclusive: end };
}

/**
 * Parse a calendar body. Throws ChannelSyncError("not_a_calendar") unless the
 * body is a complete VCALENDAR, and ChannelSyncError("too_large") past
 * MAX_FEED_EVENTS events. Cancelled events are left out; events with the same
 * UID keep the first.
 */
export function parseIcal(body: string, maxEvents = MAX_FEED_EVENTS): IcalEvent[] {
  const lines = unfoldLines(body);
  const firstIndex = lines.findIndex((l) => l.trim() !== "");
  if (firstIndex < 0 || lines[firstIndex].trim().toUpperCase() !== "BEGIN:VCALENDAR") throw new ChannelSyncError("not_a_calendar");

  const events: IcalEvent[] = [];
  const seen = new Set<string>();
  let calendarClosed = false;
  let draft: Draft | null = null;
  // Components nested inside the current VEVENT (VALARM…) — their properties are ignored.
  let nested = 0;
  let vevents = 0;

  for (let n = firstIndex + 1; n < lines.length; n++) {
    const line = parseLine(lines[n]);
    if (!line) continue; // blank or junk line
    if (line.name === "BEGIN") {
      const component = line.value.trim().toUpperCase();
      if (draft) nested++;
      else if (component === "VEVENT") {
        if (++vevents > maxEvents) throw new ChannelSyncError("too_large", "events");
        draft = emptyDraft();
        nested = 0;
      }
      continue;
    }
    if (line.name === "END") {
      const component = line.value.trim().toUpperCase();
      if (draft) {
        if (nested > 0) nested--;
        else if (component === "VEVENT") {
          const event = finish(draft);
          draft = null;
          if (event && !seen.has(event.uid)) {
            seen.add(event.uid);
            events.push(event);
          }
        }
      } else if (component === "VCALENDAR") {
        calendarClosed = true;
        break;
      }
      continue;
    }
    if (!draft || nested > 0) continue;
    switch (line.name) {
      case "UID":
        draft.uid = line.value;
        break;
      case "SUMMARY":
        draft.summary = unescapeText(line.value);
        break;
      case "DESCRIPTION":
        draft.description = unescapeText(line.value);
        break;
      case "STATUS":
        draft.status = line.value.trim();
        break;
      case "RECURRENCE-ID":
        draft.recurrenceId = line.value.trim();
        break;
      case "RRULE":
      case "RDATE":
        throw new ChannelSyncError("unsupported_recurrence");
      case "DTSTART":
        draft.start = readIcalDate(line.value);
        break;
      case "DTEND":
        draft.end = readIcalDate(line.value);
        break;
      case "DURATION":
        draft.durationDays = readDurationDays(line.value);
        break;
      default:
        break;
    }
  }
  // A body cut off part-way would make bookings look cancelled; refuse it instead.
  if (!calendarClosed) throw new ChannelSyncError("not_a_calendar", "truncated");
  return events;
}
