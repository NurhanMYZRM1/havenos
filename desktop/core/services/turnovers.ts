import type { ChecklistItem, TurnoverDetail, TurnoverFilter, TurnoverItem, TurnoverUpdate } from "../../../lib/api/contract";
import { daysBetween, timestampParts, type IsoDate } from "../../../lib/domain/dates";
import { OPEN_TURNOVER_STATUSES, type ReservationChannel, type TurnoverStatus } from "../../../lib/domain/enums";
import { DEFAULT_TURNOVER_CHECKLIST } from "../../../lib/domain/short-stay";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { SPACES_OVERLAP } from "../schema";
import { allSpacePaths, listAttachments, newId } from "./shared";

/**
 * Turnovers: the cleaning / inspection between one stay and the next. One per
 * reservation, due on its check-out day. They are created and moved by
 * syncTurnover(), which services/reservations.ts calls inside the same
 * transaction after every insert, date change, check-out time change or
 * cancellation — so a turnover can never drift from its stay.
 */

/** Used when neither the reservation nor its connection says when guests arrive. */
export const DEFAULT_CHECK_IN_TIME = "15:00";
export const DEFAULT_CHECK_OUT_TIME = "11:00";

const OPEN_SQL = `(${OPEN_TURNOVER_STATUSES.map((s) => `'${s}'`).join(",")})`;

interface TurnoverRow {
  id: string;
  reservation_id: string;
  property_id: string;
  space_id: string;
  due_date: string;
  checkout_time: string;
  status: TurnoverStatus;
  assignee_name: string;
  assignee_phone: string;
  checklist: string;
  cost_sen: number | null;
  notes: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TurnoverJoinedRow extends TurnoverRow {
  property_name: string;
  guest_name: string;
  channel: ReservationChannel;
  photo_count: number;
  next_id: string | null;
  next_check_in: string | null;
  next_check_in_time: string | null;
  next_connection_check_in_time: string | null;
  next_guest_name: string | null;
}

// ── Keeping turnovers in step with reservations ─────────────────────────────

function checklistFor(core: Core, connectionId: string | null): ChecklistItem[] {
  let labels: readonly string[] = DEFAULT_TURNOVER_CHECKLIST;
  if (connectionId) {
    const raw = core.db.get<{ turnover_checklist: string }>("SELECT turnover_checklist FROM channel_connections WHERE id = ?", [connectionId])?.turnover_checklist;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const custom = Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === "string" && l.trim() !== "").map((l) => l.trim()) : [];
      if (custom.length) labels = custom;
    } catch {
      // The column is CHECKed as a JSON array; fall back to the default if it's somehow not.
    }
  }
  return labels.map((label) => ({ label, done: false }));
}

/**
 * Keep a reservation's turnover in step with it:
 *  - a live stay with no turnover, whose check-out is today or later, gets one
 *    (a stay that had already ended when it was recorded gets none);
 *  - dates / check-out time move with the stay unless the turnover is done
 *    (a turnover's own check-out time is only overwritten when the stay has
 *    an explicit one, so a time the landlord set by hand survives);
 *  - a cancelled stay's turnover is skipped unless it was already done.
 */
export function syncTurnover(core: Core, reservationId: string): void {
  const r = core.db.get<{
    id: string;
    property_id: string;
    space_id: string;
    connection_id: string | null;
    check_out: string;
    check_out_time: string | null;
    status: string;
    connection_check_out_time: string | null;
  }>(
    `SELECT r.id, r.property_id, r.space_id, r.connection_id, r.check_out, r.check_out_time, r.status,
       c.check_out_time AS connection_check_out_time
     FROM reservations r LEFT JOIN channel_connections c ON c.id = r.connection_id
     WHERE r.id = ?`,
    [reservationId],
  );
  if (!r) return;
  const existing = core.db.get<TurnoverRow>("SELECT * FROM turnovers WHERE reservation_id = ?", [reservationId]);
  const now = core.nowIso();

  if (r.status === "cancelled") {
    if (existing && existing.status !== "done" && existing.status !== "skipped") {
      core.db.run("UPDATE turnovers SET status = 'skipped', updated_at = ? WHERE id = ?", [now, existing.id]);
    }
    return;
  }

  if (!existing) {
    if (r.check_out < core.today()) return;
    core.db.run(
      `INSERT INTO turnovers (id, reservation_id, property_id, space_id, due_date, checkout_time, status, checklist, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        newId(),
        r.id,
        r.property_id,
        r.space_id,
        r.check_out,
        r.check_out_time ?? r.connection_check_out_time ?? DEFAULT_CHECK_OUT_TIME,
        JSON.stringify(checklistFor(core, r.connection_id)),
        now,
        now,
      ],
    );
    return;
  }

  if (existing.status === "done") return;
  const checkoutTime = r.check_out_time ?? existing.checkout_time;
  if (existing.due_date !== r.check_out || existing.checkout_time !== checkoutTime) {
    core.db.run("UPDATE turnovers SET due_date = ?, checkout_time = ?, updated_at = ? WHERE id = ?", [r.check_out, checkoutTime, now, existing.id]);
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** One ordered timeline per space, including arrivals on its parents/children. */
function selectTurnovers(where: string): string {
  return `WITH selected AS MATERIALIZED (
    SELECT t.* FROM turnovers t ${where ? `WHERE ${where}` : ""}
    ORDER BY t.due_date LIMIT 5000
  ), target_spaces AS (
    SELECT DISTINCT space_id FROM selected
  ), arrivals AS MATERIALIZED (
    SELECT target.space_id, n.id, n.check_in, n.check_in_time, n.guest_name,
      c.check_in_time AS connection_check_in_time,
      ROW_NUMBER() OVER (PARTITION BY target.space_id
        ORDER BY n.check_in, COALESCE(n.check_in_time, '99:99'), n.created_at, n.id) AS seq
    FROM target_spaces target
    JOIN spaces b ON b.id = target.space_id
    JOIN spaces a ON ${SPACES_OVERLAP}
    JOIN reservations n ON n.space_id = a.id AND n.status <> 'cancelled'
    LEFT JOIN channel_connections c ON c.id = n.connection_id
  ), timeline AS (
    SELECT space_id, due_date AS date, 0 AS kind, id AS turnover_id, NULL AS seq FROM selected
    UNION ALL
    SELECT space_id, check_in, 1, NULL, seq FROM arrivals
  ), upcoming AS (
    SELECT turnover_id, MIN(seq) OVER (PARTITION BY space_id ORDER BY date, kind, seq
      ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS next_seq
    FROM timeline
  )
  SELECT t.*, p.name AS property_name, r.guest_name, r.channel,
    (SELECT COUNT(*) FROM attachments a WHERE a.turnover_id = t.id) AS photo_count,
    n.id AS next_id, n.check_in AS next_check_in, n.check_in_time AS next_check_in_time,
    n.connection_check_in_time AS next_connection_check_in_time, n.guest_name AS next_guest_name
  FROM selected t
  JOIN properties p ON p.id = t.property_id
  JOIN reservations r ON r.id = t.reservation_id
  JOIN upcoming u ON u.turnover_id = t.id
  LEFT JOIN arrivals first ON first.space_id = t.space_id AND first.seq = u.next_seq
  LEFT JOIN arrivals n ON n.space_id = t.space_id
    AND n.seq = u.next_seq + CASE WHEN first.id = t.reservation_id THEN 1 ELSE 0 END`;
}

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** "YYYY-MM-DD HH:MM" in Kuala Lumpur, comparable as a string. */
function localStamp(date: IsoDate, time: string): string {
  return `${date} ${time}`;
}

function nowStamp(core: Core): string {
  const p = timestampParts(core.nowIso());
  return localStamp(p.date, `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`);
}

function parseChecklist(raw: string): ChecklistItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((i) => {
      const item = (i ?? {}) as { label?: unknown; done?: unknown };
      return { label: typeof item.label === "string" ? item.label : String(item.label ?? ""), done: item.done === true };
    });
  } catch {
    return [];
  }
}

function toItems(core: Core, rows: readonly TurnoverJoinedRow[]): TurnoverItem[] {
  if (!rows.length) return [];
  const paths = allSpacePaths(core);
  const now = nowStamp(core);
  const today = core.today();
  return rows.map((r): TurnoverItem => {
    const n = r.next_id && r.next_check_in ? { id: r.next_id, check_in: r.next_check_in, guest_name: r.next_guest_name ?? "" } : null;
    const nextTime = n ? r.next_check_in_time ?? r.next_connection_check_in_time ?? null : null;
    const effectiveNextTime = nextTime ?? DEFAULT_CHECK_IN_TIME;
    const open = r.status !== "done" && r.status !== "skipped";
    const windowMinutes = n ? daysBetween(r.due_date, n.check_in) * 1440 + minutes(effectiveNextTime) - minutes(r.checkout_time) : null;
    const late = open && (n ? now > localStamp(n.check_in, effectiveNextTime) : today > r.due_date);
    return {
      id: r.id,
      reservationId: r.reservation_id,
      propertyId: r.property_id,
      propertyName: r.property_name,
      spaceId: r.space_id,
      spacePath: paths.get(r.space_id) ?? "",
      guestName: r.guest_name,
      channel: r.channel,
      dueDate: r.due_date,
      checkoutTime: r.checkout_time,
      nextCheckIn: n ? { reservationId: n.id, date: n.check_in, time: nextTime, guestName: n.guest_name } : null,
      windowHours: windowMinutes === null ? null : Math.round(windowMinutes / 6) / 10,
      status: r.status,
      assigneeName: r.assignee_name,
      assigneePhone: r.assignee_phone,
      checklist: parseChecklist(r.checklist),
      costSen: r.cost_sen,
      notes: r.notes,
      completedAt: r.completed_at,
      photoCount: r.photo_count,
      unassigned: open && r.assignee_name.trim() === "" && r.assignee_phone.trim() === "",
      late,
    };
  });
}

function sortItems(items: TurnoverItem[]): TurnoverItem[] {
  return items.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    const an = a.nextCheckIn ? `${a.nextCheckIn.date} ${a.nextCheckIn.time ?? DEFAULT_CHECK_IN_TIME}` : "9999";
    const bn = b.nextCheckIn ? `${b.nextCheckIn.date} ${b.nextCheckIn.time ?? DEFAULT_CHECK_IN_TIME}` : "9999";
    if (an !== bn) return an < bn ? -1 : 1;
    if (a.checkoutTime !== b.checkoutTime) return a.checkoutTime < b.checkoutTime ? -1 : 1;
    return a.spacePath.localeCompare(b.spacePath);
  });
}

/** Turnovers matching a free-form WHERE clause (internal: used by the day view and alerts). */
export function queryTurnovers(core: Core, where: string, params: Record<string, string | number | null> = {}): TurnoverItem[] {
  const rows = core.db.all<TurnoverJoinedRow>(selectTurnovers(where), params);
  return sortItems(toItems(core, rows));
}

export function listTurnovers(core: Core, filter: TurnoverFilter): TurnoverItem[] {
  const where: string[] = [];
  const params: Record<string, string | null> = {};
  if (filter.from) {
    where.push("t.due_date >= $from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("t.due_date <= $to");
    params.to = filter.to;
  }
  if (filter.status === "open") where.push(`t.status IN ${OPEN_SQL}`);
  else if (filter.status !== "all") {
    where.push("t.status = $status");
    params.status = filter.status;
  }
  if (filter.propertyId) {
    where.push("t.property_id = $propertyId");
    params.propertyId = filter.propertyId;
  }
  return queryTurnovers(core, where.join(" AND "), params);
}

/** Open turnovers due on or before `through` (inclusive). */
export function openTurnoversThrough(core: Core, through: IsoDate): TurnoverItem[] {
  return queryTurnovers(core, `t.status IN ${OPEN_SQL} AND t.due_date <= $through`, { through });
}

export function getTurnover(core: Core, id: string): TurnoverDetail {
  const row = core.db.get<TurnoverJoinedRow>(selectTurnovers("t.id = ?"), [id]);
  if (!row) throw notFound();
  const [item] = toItems(core, [row]);
  return { ...item, photos: listAttachments(core, { kind: "turnover", id }) };
}

export function updateTurnover(core: Core, input: TurnoverUpdate): TurnoverDetail {
  core.db.tx(() => {
    const row = core.db.get<TurnoverRow & { reservation_status: string }>(
      "SELECT t.*, r.status AS reservation_status FROM turnovers t JOIN reservations r ON r.id = t.reservation_id WHERE t.id = ?",
      [input.id],
    );
    if (!row) throw notFound();
    const reopening = input.status !== "done" && input.status !== "skipped";
    if (row.reservation_status === "cancelled" && reopening) throw new AppError("NOT_ALLOWED", "errors.stays.turnoverSkipped");
    let completedAt = row.completed_at;
    if (input.status === "done" && row.status !== "done") completedAt = core.nowIso();
    if (input.status !== "done") completedAt = null;
    core.db.run(
      `UPDATE turnovers SET status = $status, assignee_name = $assigneeName, assignee_phone = $assigneePhone, checkout_time = $checkoutTime,
         checklist = $checklist, cost_sen = $costSen, notes = $notes, completed_at = $completedAt, updated_at = $now
       WHERE id = $id`,
      {
        ...input,
        assigneeName: input.assigneeName.trim(),
        checklist: JSON.stringify(input.checklist.map((i) => ({ label: i.label.trim(), done: i.done === true }))),
        completedAt,
        now: core.nowIso(),
      },
    );
  });
  return getTurnover(core, input.id);
}
