import type { PendingBlock } from "../../../lib/api/contract";
import { addDays, daysBetween, type IsoDate } from "../../../lib/domain/dates";
import type { ChannelId, ReservationChannel } from "../../../lib/domain/enums";
import { t } from "../../../lib/i18n";
import type { Core } from "../context";
import { conflictInfo, findConflicts, type Conflict } from "../services/availability";
import { allSpacePaths } from "../services/shared";

/**
 * Dates HavenOS knows are taken on a connection's space (tenancies, manual
 * blocks, reservations from other channels or direct) that the channel's
 * calendar — as last imported — still shows as open. Calendar feeds can't be
 * written to, so the landlord blocks these on the channel by hand.
 *
 * "Taken" comes from findConflicts (the one availability rule), over the
 * space and every space that overlaps it, from today for PENDING_HORIZON_DAYS.
 */

export const PENDING_HORIZON_DAYS = 365;
/** Enough for a year of nightly bookings across a unit's rooms and beds. */
const MAX_RECORDS = 5000;

interface ConnRow {
  id: string;
  name: string;
  channel: ChannelId;
  space_id: string;
}

function reasonLabel(core: Core, c: Conflict, who: string): string {
  if (who) return who;
  if (c.kind !== "reservation") return who;
  const r = core.db.get<{ channel: ReservationChannel; channel_reservation_id: string | null }>(
    "SELECT channel, channel_reservation_id FROM reservations WHERE id = ?",
    [c.id],
  );
  const channel = t(`errors.channels.channelName.${r?.channel ?? "direct"}`);
  return r?.channel_reservation_id && r.channel !== "other" ? `${channel} · ${r.channel_reservation_id}` : channel;
}

export function pendingBlocks(core: Core, connectionId: string | null): PendingBlock[] {
  const today = core.today();
  const horizonEnd = addDays(today, PENDING_HORIZON_DAYS - 1);
  const conns = core.db.all<ConnRow>(
    `SELECT id, name, channel, space_id FROM channel_connections
     WHERE removed_at IS NULL AND status = 'active' AND ($id IS NULL OR id = $id) ORDER BY created_at, id`,
    { id: connectionId },
  );
  if (!conns.length) return [];
  const paths = allSpacePaths(core);
  const out: PendingBlock[] = [];
  const dayIndex = (d: IsoDate) => daysBetween(today, d);

  for (const conn of conns) {
    const own = new Set(core.db.all<{ id: string }>("SELECT id FROM reservations WHERE connection_id = ?", [conn.id]).map((r) => r.id));
    const records = findConflicts(core, conn.space_id, today, horizonEnd, {}, MAX_RECORDS).filter((c) => !(c.kind === "reservation" && own.has(c.id)));
    if (!records.length) continue;

    const taken = new Array<boolean>(PENDING_HORIZON_DAYS).fill(false);
    const mark = (from: IsoDate, lastInclusive: IsoDate | null, value: boolean) => {
      const a = Math.max(0, dayIndex(from));
      const b = Math.min(PENDING_HORIZON_DAYS - 1, dayIndex(lastInclusive ?? horizonEnd));
      for (let i = a; i <= b; i++) taken[i] = value;
    };
    for (const c of records) mark(c.start, c.end, true);
    // Nights the channel already shows as unavailable (bookings, blocks, reviewed events alike).
    for (const e of core.db.all<{ start_date: string; end_date: string }>(
      "SELECT start_date, end_date FROM channel_events WHERE connection_id = ? AND end_date > ? AND start_date <= ?",
      [conn.id, today, horizonEnd],
    )) {
      mark(e.start_date, addDays(e.end_date, -1), false);
    }

    const acks = new Map(
      core.db
        .all<{ start_date: string; end_date: string; acked_at: string }>("SELECT start_date, end_date, acked_at FROM channel_push_acks WHERE connection_id = ?", [conn.id])
        .map((a) => [`${a.start_date}|${a.end_date}`, a.acked_at]),
    );

    for (let i = 0; i < PENDING_HORIZON_DAYS; i++) {
      if (!taken[i]) continue;
      let j = i;
      while (j + 1 < PENDING_HORIZON_DAYS && taken[j + 1]) j++;
      const start = addDays(today, i);
      const end = addDays(today, j);
      const reasons: PendingBlock["reasons"] = [];
      const seen = new Set<string>();
      for (const c of records) {
        if (c.start > end || (c.end !== null && c.end < start) || seen.has(c.id)) continue;
        seen.add(c.id);
        const info = conflictInfo(core, c);
        reasons.push({ kind: c.kind, label: reasonLabel(core, c, info.who), href: info.href });
      }
      out.push({
        connectionId: conn.id,
        connectionName: conn.name,
        channel: conn.channel,
        spaceId: conn.space_id,
        spacePath: paths.get(conn.space_id) ?? "",
        start,
        end,
        reasons,
        acknowledgedAt: acks.get(`${start}|${end}`) ?? null,
      });
      i = j;
    }
  }
  return out;
}

/** Mark a pending range as blocked on the channel by hand (done) or undo that. */
export function acknowledgeBlock(core: Core, connectionId: string, start: IsoDate, end: IsoDate, done: boolean) {
  if (done) {
    core.db.run(
      `INSERT INTO channel_push_acks (connection_id, start_date, end_date, acked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (connection_id, start_date, end_date) DO UPDATE SET acked_at = excluded.acked_at`,
      [connectionId, start, end, core.nowIso()],
    );
  } else {
    core.db.run("DELETE FROM channel_push_acks WHERE connection_id = ? AND start_date = ? AND end_date = ?", [connectionId, start, end]);
  }
}
