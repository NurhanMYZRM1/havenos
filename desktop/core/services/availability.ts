import type { ConflictInfo } from "../../../lib/api/contract";
import { addDays, type IsoDate } from "../../../lib/domain/dates";
import type { ReservationChannel } from "../../../lib/domain/enums";
import { formatDate } from "../../../lib/domain/format";
import { t } from "../../../lib/i18n";
import type { Core } from "../context";
import { AppError } from "../errors";
import { SPACES_OVERLAP } from "../schema";
import { spacePath } from "./shared";

/**
 * Shared availability for long-term tenancies, short-stay reservations and
 * manual availability blocks. The database triggers enforce the same rule;
 * this module finds the specific clashes so the landlord gets a useful
 * explanation, and so a channel sync can hold a clashing booking for review
 * instead of failing.
 *
 * Every range here is inclusive days/nights: a reservation's nights are
 * check-in … check-out − 1 (its check-out day is free).
 */

export interface Conflict {
  kind: "tenancy" | "reservation" | "block";
  id: string;
  spaceId: string;
  /** Tenant name, guest name, or block reason. */
  who: string;
  start: IsoDate;
  /** Last occupied day; null for an open-ended tenancy. */
  end: IsoDate | null;
  channel: ReservationChannel | null;
}

export interface ConflictExclusions {
  excludeTenancyId?: string | null;
  excludeReservationId?: string | null;
  excludeBlockId?: string | null;
}

export function findConflicts(core: Core, spaceId: string, start: IsoDate, end: IsoDate | null, opts: ConflictExclusions = {}, limit = 20): Conflict[] {
  const params = {
    space: spaceId,
    start,
    end: end ?? "9999-12-31",
    exclude: opts.excludeTenancyId ?? "",
    excludeRes: opts.excludeReservationId ?? "",
    excludeBlock: opts.excludeBlockId ?? "",
    limit,
  };
  const out: Conflict[] = [];
  for (const t of core.db.all<{ id: string; space_id: string; full_name: string; start_date: string; last_day: string | null }>(
    `SELECT t.id, t.space_id, tn.full_name, t.start_date, COALESCE(t.moved_out_on, t.end_date) AS last_day
     FROM tenancies t
     JOIN tenants tn ON tn.id = t.tenant_id
     JOIN spaces a ON a.id = t.space_id
     JOIN spaces b ON b.id = $space
     WHERE t.cancelled_at IS NULL AND t.id <> $exclude AND ${SPACES_OVERLAP}
       AND t.start_date <= $end AND $start <= COALESCE(t.moved_out_on, t.end_date, '9999-12-31')
     ORDER BY t.start_date LIMIT $limit`,
    params,
  )) {
    out.push({ kind: "tenancy", id: t.id, spaceId: t.space_id, who: t.full_name, start: t.start_date, end: t.last_day, channel: null });
  }
  for (const r of core.db.all<{ id: string; space_id: string; guest_name: string; channel: ReservationChannel; check_in: string; check_out: string }>(
    `SELECT r.id, r.space_id, r.guest_name, r.channel, r.check_in, r.check_out
     FROM reservations r
     JOIN spaces a ON a.id = r.space_id
     JOIN spaces b ON b.id = $space
     WHERE r.status <> 'cancelled' AND r.id <> $excludeRes AND ${SPACES_OVERLAP}
       AND r.check_in <= $end AND $start < r.check_out
     ORDER BY r.check_in LIMIT $limit`,
    params,
  )) {
    out.push({ kind: "reservation", id: r.id, spaceId: r.space_id, who: r.guest_name, start: r.check_in, end: addDays(r.check_out, -1), channel: r.channel });
  }
  for (const k of core.db.all<{ id: string; space_id: string; reason: string; start_date: string; end_date: string }>(
    `SELECT k.id, k.space_id, k.reason, k.start_date, k.end_date
     FROM availability_blocks k
     JOIN spaces a ON a.id = k.space_id
     JOIN spaces b ON b.id = $space
     WHERE k.cancelled_at IS NULL AND k.id <> $excludeBlock AND ${SPACES_OVERLAP}
       AND k.start_date <= $end AND $start <= k.end_date
     ORDER BY k.start_date LIMIT $limit`,
    params,
  )) {
    out.push({ kind: "block", id: k.id, spaceId: k.space_id, who: k.reason, start: k.start_date, end: k.end_date, channel: null });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)).slice(0, limit);
}

export function findConflict(core: Core, spaceId: string, start: IsoDate, end: IsoDate | null, opts: ConflictExclusions = {}): Conflict | null {
  return findConflicts(core, spaceId, start, end, opts, 1)[0] ?? null;
}

/** Nights of a stay as an inclusive range, for findConflict(s). */
export function stayRange(checkIn: IsoDate, checkOut: IsoDate): [IsoDate, IsoDate] {
  return [checkIn, addDays(checkOut, -1)];
}

function blockReasonLabel(reason: string): string {
  switch (reason) {
    case "maintenance":
      return t("errors.blockReason.maintenance");
    case "personal":
      return t("errors.blockReason.personal");
    case "owner_stay":
      return t("errors.blockReason.owner_stay");
    default:
      return t("errors.blockReason.other");
  }
}

export function conflictError(core: Core, conflict: Conflict): AppError {
  const space = spacePath(core, conflict.spaceId);
  if (conflict.kind === "reservation") {
    return new AppError("CONFLICT", "errors.overlapReservation", {
      params: { space, start: formatDate(conflict.start), end: formatDate(conflict.end) },
    });
  }
  if (conflict.kind === "block") {
    return new AppError("CONFLICT", "errors.overlapBlock", {
      params: { space, reason: blockReasonLabel(conflict.who), start: formatDate(conflict.start), end: formatDate(conflict.end) },
    });
  }
  if (conflict.end === null) {
    return new AppError("CONFLICT", "errors.overlapOpen", {
      params: { space, tenant: conflict.who, start: formatDate(conflict.start) },
    });
  }
  return new AppError("CONFLICT", "errors.overlap", {
    params: { space, tenant: conflict.who, start: formatDate(conflict.start), end: formatDate(conflict.end) },
  });
}

/** The UI shape of a conflict, with a link to the clashing record. */
export function conflictInfo(core: Core, conflict: Conflict): ConflictInfo {
  const href =
    conflict.kind === "tenancy"
      ? `/tenancies/view/?id=${conflict.id}`
      : conflict.kind === "reservation"
        ? `/stays/reservation/?id=${conflict.id}`
        : `/stays/?tab=calendar&block=${conflict.id}`;
  return {
    kind: conflict.kind,
    id: conflict.id,
    spaceId: conflict.spaceId,
    spacePath: spacePath(core, conflict.spaceId),
    who: conflict.kind === "block" ? blockReasonLabel(conflict.who) : conflict.who,
    start: conflict.start,
    end: conflict.end,
    channel: conflict.channel,
    replaceable: conflict.kind === "block" || (conflict.kind === "reservation" && conflict.channel === "direct"),
    href,
  };
}

export function assertAvailable(core: Core, spaceId: string, start: IsoDate, end: IsoDate | null, opts: ConflictExclusions = {}) {
  const conflict = findConflict(core, spaceId, start, end, opts);
  if (conflict) throw conflictError(core, conflict);
}
