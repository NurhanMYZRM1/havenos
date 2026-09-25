import type {
  AvailabilityBlockInput,
  ChecklistItem,
  ReservationCreate,
  ReservationFilter,
  ReservationUpdate,
  TurnoverFilter,
  TurnoverUpdate,
} from "../../../lib/api/contract";
import { daysBetween, type IsoDate } from "../../../lib/domain/dates";
import { BLOCK_REASONS, isOneOf, TURNOVER_STATUSES, type ReservationChannel, type TurnoverStatus } from "../../../lib/domain/enums";
import { isClockTime } from "../../../lib/domain/short-stay";
import {
  asObject,
  done,
  LIMITS,
  readBool,
  readDate,
  readEnum,
  readId,
  readInt,
  readPhone,
  readSen,
  readText,
  type FieldErrors,
  type Validated,
} from "../../../lib/domain/validate";

/**
 * Validation for short-stay IPC payloads (reservations, blocks, turnovers,
 * day view and calendar). Every payload is untrusted `unknown`.
 */

type Obj = Record<string, unknown>;

/** Channels a landlord can pick for a booking they type in themselves. */
export const MANUAL_CHANNELS = ["direct", "airbnb", "other"] as const satisfies readonly ReservationChannel[];

export const MAX_STAY_NIGHTS = 365;
export const MAX_CHECKLIST_ITEMS = 40;
export const MAX_CHECKLIST_LABEL = 120;
export const MAX_CALENDAR_DAYS = 120;

function readTime(o: Obj, key: string, f: FieldErrors, required = false): string | null {
  const raw = o[key];
  if (raw === null || raw === undefined || raw === "") {
    if (required) f[key] = "validation.required";
    return null;
  }
  if (!isClockTime(raw)) {
    f[key] = "errors.stays.invalidTime";
    return null;
  }
  return raw;
}

function readStayDates(o: Obj, f: FieldErrors): { checkIn: IsoDate; checkOut: IsoDate } {
  const checkIn = readDate(o, "checkIn", f, { required: true }) ?? "1970-01-01";
  const checkOut = readDate(o, "checkOut", f, { required: true }) ?? "1970-01-02";
  if (!f.checkIn && !f.checkOut) {
    if (checkOut <= checkIn) f.checkOut = "errors.stays.checkOutAfterCheckIn";
    else if (daysBetween(checkIn, checkOut) > MAX_STAY_NIGHTS) f.checkOut = "errors.stays.stayTooLong";
  }
  return { checkIn, checkOut };
}

function readStayDetails(o: Obj, f: FieldErrors) {
  return {
    guestName: readText(o, "guestName", f, { max: LIMITS.name }),
    guestCount: readInt(o, "guestCount", f, { min: 1, max: 50, error: "errors.stays.guestCountRange" }),
    ...readStayDates(o, f),
    checkInTime: readTime(o, "checkInTime", f),
    checkOutTime: readTime(o, "checkOutTime", f),
    status: readEnum(o, "status", ["tentative", "confirmed"] as const, f),
    notes: readText(o, "notes", f, { max: LIMITS.text }),
  };
}

export function validateReservationCreate(input: unknown): Validated<ReservationCreate> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const details = readStayDetails(o, f);
  const reference = readText(o, "channelReservationId", f, { max: 64 });
  return done(f, {
    spaceId: readId(o, "spaceId", f) ?? "",
    ...details,
    channel: readEnum(o, "channel", MANUAL_CHANNELS, f),
    channelReservationId: reference || null,
  });
}

export function validateReservationUpdate(input: unknown): Validated<ReservationUpdate> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, { id: readId(o, "id", f) ?? "", ...readStayDetails(o, f) });
}

/** A [from, to] day range (both inclusive), `to` on or after `from`. */
function readRange(o: Obj, f: FieldErrors): { from: IsoDate; to: IsoDate } {
  const from = readDate(o, "from", f, { required: true }) ?? "1970-01-01";
  const to = readDate(o, "to", f, { required: true }) ?? "1970-01-01";
  if (!f.from && !f.to && to < from) f.to = "validation.endBeforeStart";
  return { from, to };
}

export function validateReservationFilter(input: unknown): Validated<ReservationFilter> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, {
    ...readRange(o, f),
    propertyId: readId(o, "propertyId", f, { required: false }),
    spaceId: readId(o, "spaceId", f, { required: false }),
    includeCancelled: readBool(o, "includeCancelled"),
  });
}

export function validateBlockInput(input: unknown): Validated<AvailabilityBlockInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const startDate = readDate(o, "startDate", f, { required: true }) ?? "1970-01-01";
  const endDate = readDate(o, "endDate", f, { required: true }) ?? "1970-01-01";
  if (!f.startDate && !f.endDate && endDate < startDate) f.endDate = "validation.endBeforeStart";
  return done(f, {
    spaceId: readId(o, "spaceId", f) ?? "",
    startDate,
    endDate,
    reason: readEnum(o, "reason", BLOCK_REASONS, f),
    maintenanceId: readId(o, "maintenanceId", f, { required: false }),
    notes: readText(o, "notes", f, { max: LIMITS.text }),
  });
}

export function validateBlockUpdate(input: unknown): Validated<AvailabilityBlockInput & { id: string }> {
  const base = validateBlockInput(input);
  const f: FieldErrors = base.ok ? {} : { ...base.fields };
  const id = readId(asObject(input), "id", f) ?? "";
  return base.ok ? done(f, { ...base.value, id }) : { ok: false, fields: f };
}

export function validateBlockList(input: unknown): Validated<{ from: IsoDate; to: IsoDate; propertyId: string | null; includeCancelled: boolean }> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, {
    ...readRange(o, f),
    propertyId: readId(o, "propertyId", f, { required: false }),
    includeCancelled: readBool(o, "includeCancelled"),
  });
}

function readChecklist(o: Obj, f: FieldErrors): ChecklistItem[] {
  const raw = o.checklist;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    f.checklist = "validation.required";
    return [];
  }
  if (raw.length > MAX_CHECKLIST_ITEMS) {
    f.checklist = "errors.stays.checklistTooLong";
    return [];
  }
  const items: ChecklistItem[] = [];
  raw.forEach((entry, i) => {
    const item = asObject(entry);
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label || label.length > MAX_CHECKLIST_LABEL) f[`checklist.${i}.label`] = "errors.stays.checklistLabel";
    if (item.done !== undefined && typeof item.done !== "boolean") f[`checklist.${i}.done`] = "validation.chooseOne";
    items.push({ label, done: item.done === true });
  });
  return items;
}

export function validateTurnoverUpdate(input: unknown): Validated<TurnoverUpdate> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, {
    id: readId(o, "id", f) ?? "",
    status: readEnum(o, "status", TURNOVER_STATUSES, f),
    assigneeName: readText(o, "assigneeName", f, { max: LIMITS.name }),
    assigneePhone: readPhone(o, "assigneePhone", f),
    checkoutTime: readTime(o, "checkoutTime", f, true) ?? "11:00",
    checklist: readChecklist(o, f),
    costSen: readSen(o, "costSen", f),
    notes: readText(o, "notes", f, { max: LIMITS.text }),
  });
}

export function validateTurnoverFilter(input: unknown): Validated<TurnoverFilter> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const from = readDate(o, "from", f);
  const to = readDate(o, "to", f);
  if (from && to && to < from) f.to = "validation.endBeforeStart";
  let status: TurnoverStatus | "open" | "all" = "open";
  if (o.status !== undefined && o.status !== null) {
    if (o.status === "open" || o.status === "all" || isOneOf(TURNOVER_STATUSES, o.status)) status = o.status;
    else f.status = "validation.chooseOne";
  }
  return done(f, { from, to, status, propertyId: readId(o, "propertyId", f, { required: false }) });
}

export function validateDayParams(input: unknown): Validated<{ date: IsoDate }> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, { date: readDate(o, "date", f, { required: true }) ?? "1970-01-01" });
}

export function validateCalendarParams(input: unknown): Validated<{ from: IsoDate; to: IsoDate; propertyId: string | null; includeCancelled: boolean }> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const range = readRange(o, f);
  if (!f.from && !f.to && daysBetween(range.from, range.to) >= MAX_CALENDAR_DAYS) f.to = "errors.stays.calendarRange";
  if (o.includeCancelled !== undefined && typeof o.includeCancelled !== "boolean") f.includeCancelled = "validation.chooseOne";
  return done(f, { ...range, propertyId: readId(o, "propertyId", f, { required: false }), includeCancelled: readBool(o, "includeCancelled") });
}
