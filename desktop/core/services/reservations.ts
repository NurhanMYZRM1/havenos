import type { ReservationEvent } from "../../../lib/api/contract";
import type { IsoDate } from "../../../lib/domain/dates";
import type { ReservationChannel, ReservationSource } from "../../../lib/domain/enums";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { conflictError, findConflict, stayRange } from "./availability";
import { newId } from "./shared";
import { syncTurnover } from "./turnovers";

/**
 * Short-stay reservations (nights, check-out day free). Kept apart from
 * long-term tenancies — no rent schedule, deposits or move-in/out — but
 * booked against the same unit/room/bed tree, so a room let on a tenancy
 * can never also be sold as a short stay, and vice versa.
 *
 * Every write goes through this module, whether the landlord typed it or a
 * channel sync / CSV import produced it: it checks availability with the
 * shared rule, records a history event, and keeps the stay's turnover in
 * step. Nothing is ever deleted — a cancelled or vanished booking keeps its
 * row and history.
 */

export interface ReservationWrite {
  spaceId: string;
  guestName: string;
  guestCount: number | null;
  checkIn: IsoDate;
  checkOut: IsoDate;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: "tentative" | "confirmed";
  channel: ReservationChannel;
  channelReservationId: string | null;
  connectionId: string | null;
  source: ReservationSource;
  notes: string;
  /** For synced bookings: when the feed last listed it. */
  lastSeenAt?: string | null;
}

export interface ReservationRow {
  id: string;
  space_id: string;
  property_id: string;
  connection_id: string | null;
  channel: ReservationChannel;
  channel_reservation_id: string | null;
  source: ReservationSource;
  guest_name: string;
  guest_count: number | null;
  check_in: string;
  check_out: string;
  check_in_time: string | null;
  check_out_time: string | null;
  status: "tentative" | "confirmed" | "cancelled";
  cancelled_at: string | null;
  cancel_reason: string;
  missing_since: string | null;
  last_seen_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

type Change = ReservationEvent["changes"][number];

export function getReservationRow(core: Core, id: string): ReservationRow {
  const row = core.db.get<ReservationRow>("SELECT * FROM reservations WHERE id = ?", [id]);
  if (!row) throw notFound();
  return row;
}

export function addReservationEvent(
  core: Core,
  reservationId: string,
  kind: ReservationEvent["kind"],
  source: ReservationSource,
  changes: Change[] = [],
  note = "",
) {
  core.db.run(
    "INSERT INTO reservation_events (id, reservation_id, kind, source, changes, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [newId(), reservationId, kind, source, JSON.stringify(changes), note, core.nowIso()],
  );
}

function assertStayDates(checkIn: IsoDate, checkOut: IsoDate) {
  if (!(checkOut > checkIn)) throw new AppError("VALIDATION", "validation.endBeforeStart", { fields: { checkOut: "validation.endBeforeStart" } });
}

/** Insert a reservation. Throws CONFLICT (with an explanation) if the dates clash. */
export function insertReservation(core: Core, input: ReservationWrite): string {
  assertStayDates(input.checkIn, input.checkOut);
  const space = core.db.get<{ property_id: string }>("SELECT property_id FROM spaces WHERE id = ? AND archived_at IS NULL", [input.spaceId]);
  if (!space) throw notFound();
  return core.db.tx(() => {
    const [first, last] = stayRange(input.checkIn, input.checkOut);
    const conflict = findConflict(core, input.spaceId, first, last);
    if (conflict) throw conflictError(core, conflict);
    const id = newId();
    const now = core.nowIso();
    core.db.run(
      `INSERT INTO reservations (id, space_id, property_id, connection_id, channel, channel_reservation_id, source, guest_name, guest_count,
         check_in, check_out, check_in_time, check_out_time, status, last_seen_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.spaceId, space.property_id, input.connectionId, input.channel, input.channelReservationId, input.source,
        input.guestName.trim(), input.guestCount, input.checkIn, input.checkOut, input.checkInTime, input.checkOutTime,
        input.status, input.lastSeenAt ?? null, input.notes, now, now,
      ],
    );
    addReservationEvent(core, id, "created", input.source);
    syncTurnover(core, id);
    return id;
  });
}

/** Move a stay's dates. Throws CONFLICT if the new dates clash with anything else. */
export function changeReservationDates(core: Core, id: string, dates: { checkIn: IsoDate; checkOut: IsoDate }, source: ReservationSource) {
  assertStayDates(dates.checkIn, dates.checkOut);
  core.db.tx(() => {
    const row = getReservationRow(core, id);
    if (row.check_in === dates.checkIn && row.check_out === dates.checkOut) return;
    if (row.status !== "cancelled") {
      const [first, last] = stayRange(dates.checkIn, dates.checkOut);
      const conflict = findConflict(core, row.space_id, first, last, { excludeReservationId: id });
      if (conflict) throw conflictError(core, conflict);
    }
    core.db.run("UPDATE reservations SET check_in = ?, check_out = ?, updated_at = ? WHERE id = ?", [dates.checkIn, dates.checkOut, core.nowIso(), id]);
    const changes: Change[] = [];
    if (row.check_in !== dates.checkIn) changes.push({ field: "checkIn", from: row.check_in, to: dates.checkIn });
    if (row.check_out !== dates.checkOut) changes.push({ field: "checkOut", from: row.check_out, to: dates.checkOut });
    addReservationEvent(core, id, "dates_changed", source, changes);
    syncTurnover(core, id);
  });
}

export interface ReservationDetailsPatch {
  guestName?: string;
  guestCount?: number | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  notes?: string;
  status?: "tentative" | "confirmed";
}

const DETAIL_COLUMNS: Record<keyof ReservationDetailsPatch, keyof ReservationRow> = {
  guestName: "guest_name",
  guestCount: "guest_count",
  checkInTime: "check_in_time",
  checkOutTime: "check_out_time",
  notes: "notes",
  status: "status",
};

/** Update guest details, times, notes or tentative/confirmed. Records only fields that changed. */
export function updateReservationDetails(core: Core, id: string, patch: ReservationDetailsPatch, source: ReservationSource) {
  core.db.tx(() => {
    const row = getReservationRow(core, id);
    if (row.status === "cancelled" && patch.status) throw new AppError("NOT_ALLOWED", "errors.stays.alreadyCancelled");
    const changes: Change[] = [];
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const key of Object.keys(patch) as (keyof ReservationDetailsPatch)[]) {
      const next = patch[key];
      if (next === undefined) continue;
      const col = DETAIL_COLUMNS[key];
      const value = typeof next === "string" ? next.trim() : next;
      if (row[col] === value) continue;
      sets.push(`${col} = ?`);
      values.push(value);
      changes.push({ field: key, from: key === "notes" ? null : (row[col] as string | number | null), to: key === "notes" ? null : value });
    }
    if (!sets.length) return;
    core.db.run(`UPDATE reservations SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, [...values, core.nowIso(), id]);
    addReservationEvent(core, id, "updated", source, changes);
    if (patch.checkOutTime !== undefined) syncTurnover(core, id);
  });
}

/** Cancel a stay. The row and its history stay; its dates become free. */
export function cancelReservation(core: Core, id: string, reason = "", source: ReservationSource = "manual") {
  core.db.tx(() => {
    const row = getReservationRow(core, id);
    if (row.status === "cancelled") throw new AppError("NOT_ALLOWED", "errors.stays.alreadyCancelled");
    const now = core.nowIso();
    core.db.run("UPDATE reservations SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?", [now, reason.trim(), now, id]);
    addReservationEvent(core, id, "cancelled", source, [{ field: "status", from: row.status, to: "cancelled" }], reason.trim());
    syncTurnover(core, id);
  });
}

/** A synced booking no longer appears in its feed. It keeps its dates until the landlord confirms. */
export function markReservationMissing(core: Core, id: string) {
  const row = getReservationRow(core, id);
  if (row.missing_since || row.status === "cancelled") return;
  const now = core.nowIso();
  core.db.run("UPDATE reservations SET missing_since = ?, updated_at = ? WHERE id = ?", [now, now, id]);
  addReservationEvent(core, id, "missing", "feed");
}

/** A synced booking is listed in its feed (again). */
export function markReservationSeen(core: Core, id: string) {
  const row = getReservationRow(core, id);
  const now = core.nowIso();
  core.db.run("UPDATE reservations SET missing_since = NULL, last_seen_at = ? WHERE id = ?", [now, id]);
  if (row.missing_since) addReservationEvent(core, id, "reappeared", "feed");
}

// ── Compatibility with the pre-short-stay API (used by older tests) ─────────

export interface ReservationInput {
  spaceId: string;
  guestName: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  status: "tentative" | "confirmed";
  channel: ReservationChannel;
  channelReservationId: string | null;
  totalSen: number | null;
  notes: string;
}

/** A manually entered reservation. `totalSen` is recorded as an entered booking value. */
export function createReservation(core: Core, input: ReservationInput): string {
  return core.db.tx(() => {
    const id = insertReservation(core, {
      ...input,
      guestCount: null,
      checkInTime: null,
      checkOutTime: null,
      connectionId: null,
      source: "manual",
    });
    if (input.totalSen !== null) {
      const row = getReservationRow(core, id);
      const now = core.nowIso();
      core.db.run(
        `INSERT INTO stay_ledger (id, reservation_id, property_id, space_id, channel, kind, amount_sen, occurred_on, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'booking_value', ?, ?, 'entered', ?, ?)`,
        [newId(), id, row.property_id, row.space_id, row.channel, input.totalSen, row.check_in, now, now],
      );
    }
    return id;
  });
}
