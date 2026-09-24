import type { ChannelConnectionCreate, ChannelConnectionUpdate, ChannelEventAction } from "../../../lib/api/contract";
import type { IsoDate } from "../../../lib/domain/dates";
import { CHANNEL_IDS } from "../../../lib/domain/enums";
import { isClockTime } from "../../../lib/domain/short-stay";
import { asObject, done, LIMITS, readDate, readEnum, readId, readText, type FieldErrors, type Validated } from "../../../lib/domain/validate";

/** IPC input for channels.* is untrusted: every field is checked here before it reaches a service. */

export const MAX_FEED_URL = 2000;
export const MAX_CHECKLIST_ITEMS = 40;
export const MAX_CHECKLIST_ITEM = 120;

type Obj = Record<string, unknown>;

function readFeedUrl(o: Obj, key: string, f: FieldErrors): string {
  const raw = o[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    f[key] = "validation.required";
    return "";
  }
  const v = raw.trim();
  if (v.length > MAX_FEED_URL) f[key] = "errors.channels.feedUrlTooLong";
  else if (/\s/.test(v)) f[key] = "errors.channels.invalidFeedUrl";
  return v;
}

function readTime(o: Obj, key: string, f: FieldErrors): string {
  const raw = o[key];
  if (!isClockTime(raw)) {
    f[key] = "errors.channels.invalidTime";
    return "00:00";
  }
  return raw;
}

function readChecklist(o: Obj, key: string, f: FieldErrors): string[] {
  const raw = o[key];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    f[key] = "validation.required";
    return [];
  }
  if (raw.length > MAX_CHECKLIST_ITEMS) {
    f[key] = "errors.channels.checklistTooLong";
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      f[key] = "validation.required";
      return [];
    }
    const v = item.trim();
    if (v.length > MAX_CHECKLIST_ITEM) {
      f[key] = "validation.tooLong";
      return [];
    }
    if (v) out.push(v);
  }
  return out;
}

function readStrictBool(o: Obj, key: string, f: FieldErrors): boolean {
  const raw = o[key];
  if (typeof raw !== "boolean") f[key] = "validation.chooseOne";
  return raw === true;
}

export function validateConnectionCreate(input: unknown): Validated<ChannelConnectionCreate> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const value: ChannelConnectionCreate = {
    channel: readEnum(o, "channel", CHANNEL_IDS, f),
    name: readText(o, "name", f, { required: true, max: LIMITS.name }),
    spaceId: readId(o, "spaceId", f) ?? "",
    feedUrl: readFeedUrl(o, "feedUrl", f),
    checkInTime: readTime(o, "checkInTime", f),
    checkOutTime: readTime(o, "checkOutTime", f),
  };
  return done(f, value);
}

export function validateConnectionUpdate(input: unknown): Validated<ChannelConnectionUpdate> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const value: ChannelConnectionUpdate = {
    id: readId(o, "id", f) ?? "",
    name: readText(o, "name", f, { required: true, max: LIMITS.name }),
    spaceId: readId(o, "spaceId", f) ?? "",
    feedUrl: o.feedUrl === null || o.feedUrl === undefined ? null : readFeedUrl(o, "feedUrl", f),
    checkInTime: readTime(o, "checkInTime", f),
    checkOutTime: readTime(o, "checkOutTime", f),
    turnoverChecklist: readChecklist(o, "turnoverChecklist", f),
  };
  return done(f, value);
}

export function validateSetPaused(input: unknown): Validated<{ id: string; paused: boolean }> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, { id: readId(o, "id", f) ?? "", paused: readStrictBool(o, "paused", f) });
}

export function validateRefresh(input: unknown): Validated<{ id: string | null; acceptShrink: boolean }> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const id = readId(o, "id", f, { required: false });
  const acceptShrink = o.acceptShrink === undefined ? false : readStrictBool(o, "acceptShrink", f);
  return done(f, { id, acceptShrink });
}

const EVENT_ACTIONS = ["retry", "dismiss", "replace"] as const satisfies readonly ChannelEventAction[];

export function validateResolveEvent(input: unknown): Validated<{ eventId: string; action: ChannelEventAction }> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, { eventId: readId(o, "eventId", f) ?? "", action: readEnum(o, "action", EVENT_ACTIONS, f) });
}

export function validatePendingBlocks(input: unknown): Validated<{ connectionId: string | null }> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, { connectionId: readId(o, "connectionId", f, { required: false }) });
}

export function validateAcknowledgeBlock(input: unknown): Validated<{ connectionId: string; start: IsoDate; end: IsoDate; done: boolean }> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const connectionId = readId(o, "connectionId", f) ?? "";
  const start = readDate(o, "start", f, { required: true }) ?? "";
  const end = readDate(o, "end", f, { required: true }) ?? "";
  if (start && end && end < start) f.end = "validation.endBeforeStart";
  return done(f, { connectionId, start, end, done: readStrictBool(o, "done", f) });
}
