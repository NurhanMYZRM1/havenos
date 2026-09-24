import type {
  LedgerEntry,
  ReservationCreate,
  ReservationDetail,
  ReservationEvent,
  ReservationFilter,
  ReservationSummary,
  ReservationUpdate,
} from "../../../lib/api/contract";
import type { LedgerKind, ReservationChannel, SpaceKind, StayExpenseCategory, TurnoverStatus } from "../../../lib/domain/enums";
import { nights } from "../../../lib/domain/short-stay";
import { t, type MessageKey } from "../../../lib/i18n";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import {
  cancelReservation,
  changeReservationDates,
  getReservationRow,
  insertReservation,
  updateReservationDetails,
  type ReservationRow,
} from "./reservations";
import { allSpacePaths } from "./shared";

/**
 * Reading reservations, and the landlord's own reservation edits. Every write
 * goes through services/reservations.ts (availability, history, turnovers);
 * this module adds what's specific to a person typing: bookings synced from a
 * channel keep the channel's dates, and friendly errors for duplicates.
 */

export interface ReservationJoinedRow extends ReservationRow {
  property_name: string;
  space_kind: SpaceKind;
  connection_name: string | null;
  connection_live: number | null;
  turnover_id: string | null;
  turnover_status: TurnoverStatus | null;
}

export const RESERVATION_SELECT = `
  SELECT r.*, p.name AS property_name, s.kind AS space_kind, c.name AS connection_name,
    CASE WHEN c.id IS NOT NULL AND c.removed_at IS NULL THEN 1 ELSE 0 END AS connection_live,
    tv.id AS turnover_id, tv.status AS turnover_status
  FROM reservations r
  JOIN properties p ON p.id = r.property_id
  JOIN spaces s ON s.id = r.space_id
  LEFT JOIN channel_connections c ON c.id = r.connection_id
  LEFT JOIN turnovers tv ON tv.reservation_id = r.id`;

export function channelLabel(channel: ReservationChannel): string {
  return t(`errors.stays.channel.${channel}` as MessageKey);
}

export function reservationHref(id: string): string {
  return `/stays/reservation/?id=${id}`;
}

/** Dates of a booking synced from a live channel feed can only change on the channel. */
function datesLocked(r: Pick<ReservationJoinedRow, "source" | "connection_id" | "connection_live">): boolean {
  return r.source === "feed" && !!r.connection_id && r.connection_live === 1;
}

export function toReservationSummary(r: ReservationJoinedRow, paths: Map<string, string>): ReservationSummary {
  return {
    id: r.id,
    propertyId: r.property_id,
    propertyName: r.property_name,
    spaceId: r.space_id,
    spacePath: paths.get(r.space_id) ?? "",
    spaceKind: r.space_kind,
    channel: r.channel,
    channelReservationId: r.channel_reservation_id,
    connectionId: r.connection_id,
    connectionName: r.connection_name,
    source: r.source,
    guestName: r.guest_name,
    guestCount: r.guest_count,
    checkIn: r.check_in,
    checkOut: r.check_out,
    checkInTime: r.check_in_time,
    checkOutTime: r.check_out_time,
    nights: nights(r.check_in, r.check_out),
    status: r.status,
    missingSince: r.missing_since,
    lastSeenAt: r.last_seen_at,
    datesLocked: datesLocked(r),
    turnoverId: r.turnover_id,
    turnoverStatus: r.turnover_status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Summaries for a free-form WHERE clause over `r` (internal: day view, alerts). */
export function queryReservations(core: Core, where: string, params: Record<string, string | number | null> = {}, paths?: Map<string, string>): ReservationSummary[] {
  const rows = core.db.all<ReservationJoinedRow>(
    `${RESERVATION_SELECT} ${where ? `WHERE ${where}` : ""} ORDER BY r.check_in, COALESCE(r.check_in_time, '99:99'), r.created_at LIMIT 5000`,
    params,
  );
  const pathMap = paths ?? allSpacePaths(core);
  return rows.map((r) => toReservationSummary(r, pathMap));
}

/** Stays whose dates touch [from, to]: any night in range, or checking out on/after `from`. */
export function listReservations(core: Core, filter: ReservationFilter): ReservationSummary[] {
  const where = ["r.check_in <= $to", "r.check_out >= $from"];
  if (filter.propertyId) where.push("r.property_id = $propertyId");
  if (filter.spaceId) where.push("r.space_id = $spaceId");
  if (!filter.includeCancelled) where.push("r.status <> 'cancelled'");
  return queryReservations(core, where.join(" AND "), { from: filter.from, to: filter.to, propertyId: filter.propertyId, spaceId: filter.spaceId });
}

interface EventRow {
  id: string;
  kind: ReservationEvent["kind"];
  source: ReservationEvent["source"];
  changes: string;
  note: string;
  created_at: string;
}

export interface LedgerRow {
  id: string;
  reservation_id: string | null;
  property_id: string;
  space_id: string | null;
  channel: ReservationChannel;
  kind: LedgerKind;
  amount_sen: number;
  occurred_on: string;
  source: "imported" | "entered";
  import_id: string | null;
  category: StayExpenseCategory | "";
  description: string;
  voided_at: string | null;
  created_at: string;
  property_name: string;
}

export function toLedgerEntry(r: LedgerRow, paths: Map<string, string>): LedgerEntry {
  return {
    id: r.id,
    reservationId: r.reservation_id,
    propertyId: r.property_id,
    spaceId: r.space_id,
    channel: r.channel,
    kind: r.kind,
    amountSen: r.amount_sen,
    occurredOn: r.occurred_on,
    category: r.category,
    description: r.description,
    source: r.source,
    importId: r.import_id,
    propertyName: r.property_name,
    spacePath: r.space_id ? paths.get(r.space_id) ?? null : null,
    voidedAt: r.voided_at,
    createdAt: r.created_at,
  };
}

function parseChanges(raw: string): ReservationEvent["changes"] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReservationEvent["changes"]) : [];
  } catch {
    return [];
  }
}

export function getReservation(core: Core, id: string): ReservationDetail {
  const row = core.db.get<ReservationJoinedRow>(`${RESERVATION_SELECT} WHERE r.id = ?`, [id]);
  if (!row) throw notFound();
  const paths = allSpacePaths(core);
  const events = core.db
    .all<EventRow>("SELECT * FROM reservation_events WHERE reservation_id = ? ORDER BY created_at DESC, rowid DESC", [id])
    .map((e): ReservationEvent => ({ id: e.id, kind: e.kind, source: e.source, changes: parseChanges(e.changes), note: e.note, createdAt: e.created_at }));
  const ledger = core.db
    .all<LedgerRow>(
      `SELECT l.*, p.name AS property_name FROM stay_ledger l JOIN properties p ON p.id = l.property_id
       WHERE l.reservation_id = ? ORDER BY l.occurred_on, l.created_at, l.rowid`,
      [id],
    )
    .map((l) => toLedgerEntry(l, paths));
  return {
    ...toReservationSummary(row, paths),
    notes: row.notes,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    events,
    ledger,
  };
}

function assertReferenceFree(core: Core, channel: ReservationChannel, reference: string | null, exceptId: string | null) {
  if (!reference) return;
  const taken = core.db.get<{ id: string }>("SELECT id FROM reservations WHERE channel = ? AND channel_reservation_id = ? AND id <> ?", [
    channel,
    reference,
    exceptId ?? "",
  ]);
  if (taken) {
    throw new AppError("CONFLICT", "errors.stays.duplicateReference", {
      params: { channel: channelLabel(channel), code: reference },
      fields: { channelReservationId: "errors.stays.duplicateReference" },
    });
  }
}

/** A booking the landlord types in (direct, or one taken on a channel HavenOS doesn't sync). */
export function createManualReservation(core: Core, input: ReservationCreate): ReservationDetail {
  const space = core.db.get<{ id: string }>(
    `SELECT s.id FROM spaces s JOIN spaces u ON u.id = s.unit_id JOIN properties p ON p.id = s.property_id
     WHERE s.id = ? AND s.archived_at IS NULL AND u.archived_at IS NULL AND p.archived_at IS NULL`,
    [input.spaceId],
  );
  if (!space) throw new AppError("VALIDATION", "errors.stays.spaceUnavailable", { fields: { spaceId: "errors.stays.spaceUnavailable" } });
  const id = core.db.tx(() => {
    assertReferenceFree(core, input.channel, input.channelReservationId, null);
    return insertReservation(core, {
      ...input,
      guestName: input.guestName.trim(),
      notes: input.notes.trim(),
      connectionId: null,
      source: "manual",
    });
  });
  return getReservation(core, id);
}

/**
 * Edit a booking. Dates (and tentative/confirmed) of a booking synced from a
 * live channel feed belong to the channel: changing them here would be undone
 * by the next sync, so it's refused with an explanation.
 */
export function updateManualReservation(core: Core, input: ReservationUpdate): ReservationDetail {
  core.db.tx(() => {
    const row = core.db.get<ReservationJoinedRow>(`${RESERVATION_SELECT} WHERE r.id = ?`, [input.id]);
    if (!row) throw notFound();
    if (row.status === "cancelled") throw new AppError("NOT_ALLOWED", "errors.stays.alreadyCancelled");
    const locked = datesLocked(row);
    const datesChanged = row.check_in !== input.checkIn || row.check_out !== input.checkOut;
    if (locked && datesChanged) {
      throw new AppError("NOT_ALLOWED", "errors.stays.datesLocked", {
        params: { channel: channelLabel(row.channel) },
        fields: { checkIn: "errors.stays.datesLocked" },
      });
    }
    if (locked && row.status !== input.status) {
      throw new AppError("NOT_ALLOWED", "errors.stays.statusLocked", {
        params: { channel: channelLabel(row.channel) },
        fields: { status: "errors.stays.statusLocked" },
      });
    }
    if (datesChanged) changeReservationDates(core, input.id, { checkIn: input.checkIn, checkOut: input.checkOut }, "manual");
    updateReservationDetails(
      core,
      input.id,
      {
        guestName: input.guestName,
        guestCount: input.guestCount,
        checkInTime: input.checkInTime,
        checkOutTime: input.checkOutTime,
        notes: input.notes,
        ...(locked ? {} : { status: input.status }),
      },
      "manual",
    );
  });
  return getReservation(core, input.id);
}

/**
 * Cancel a booking. Also how the landlord confirms that a booking which
 * vanished from its channel feed really was cancelled there.
 */
export function cancelManualReservation(core: Core, id: string, reason: string): ReservationDetail {
  getReservationRow(core, id);
  cancelReservation(core, id, reason, "manual");
  return getReservation(core, id);
}
