import { addDays, type IsoDate } from "../../../lib/domain/dates";
import { formatDate } from "../../../lib/domain/format";
import type { Core } from "../context";
import { AppError } from "../errors";
import { SPACES_OVERLAP } from "../schema";
import { spacePath } from "./shared";

/**
 * Shared availability for long-term tenancies and (future) short-stay
 * reservations. The database triggers enforce the same rule; this module
 * finds the specific clash so the landlord gets a useful explanation.
 */

export interface Conflict {
  kind: "tenancy" | "reservation";
  spaceId: string;
  who: string;
  start: IsoDate;
  /** Last occupied day; null for an open-ended tenancy. */
  end: IsoDate | null;
}

export function findConflict(
  core: Core,
  spaceId: string,
  start: IsoDate,
  end: IsoDate | null,
  opts: { excludeTenancyId?: string | null; excludeReservationId?: string | null } = {},
): Conflict | null {
  const params = {
    space: spaceId,
    start,
    end: end ?? "9999-12-31",
    exclude: opts.excludeTenancyId ?? "",
    excludeRes: opts.excludeReservationId ?? "",
  };
  const t = core.db.get<{ space_id: string; full_name: string; start_date: string; last_day: string | null }>(
    `SELECT t.space_id, tn.full_name, t.start_date, COALESCE(t.moved_out_on, t.end_date) AS last_day
     FROM tenancies t
     JOIN tenants tn ON tn.id = t.tenant_id
     JOIN spaces a ON a.id = t.space_id
     JOIN spaces b ON b.id = $space
     WHERE t.cancelled_at IS NULL AND t.id <> $exclude AND ${SPACES_OVERLAP}
       AND t.start_date <= $end AND $start <= COALESCE(t.moved_out_on, t.end_date, '9999-12-31')
     ORDER BY t.start_date LIMIT 1`,
    params,
  );
  if (t) return { kind: "tenancy", spaceId: t.space_id, who: t.full_name, start: t.start_date, end: t.last_day };
  const r = core.db.get<{ space_id: string; guest_name: string; check_in: string; check_out: string }>(
    `SELECT r.space_id, r.guest_name, r.check_in, r.check_out
     FROM reservations r
     JOIN spaces a ON a.id = r.space_id
     JOIN spaces b ON b.id = $space
     WHERE r.status <> 'cancelled' AND r.id <> $excludeRes AND ${SPACES_OVERLAP}
       AND r.check_in <= $end AND $start < r.check_out
     ORDER BY r.check_in LIMIT 1`,
    params,
  );
  if (r) return { kind: "reservation", spaceId: r.space_id, who: r.guest_name, start: r.check_in, end: addDays(r.check_out, -1) };
  return null;
}

export function conflictError(core: Core, conflict: Conflict): AppError {
  const space = spacePath(core, conflict.spaceId);
  if (conflict.kind === "reservation") {
    return new AppError("CONFLICT", "errors.overlapReservation", {
      params: { space, start: formatDate(conflict.start), end: formatDate(conflict.end) },
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

export function assertAvailable(
  core: Core,
  spaceId: string,
  start: IsoDate,
  end: IsoDate | null,
  opts: { excludeTenancyId?: string | null } = {},
) {
  const conflict = findConflict(core, spaceId, start, end, opts);
  if (conflict) throw conflictError(core, conflict);
}
