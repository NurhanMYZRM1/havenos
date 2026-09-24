import type { CalendarItem, CalendarRow, StayCalendar, StayDay } from "../../../lib/api/contract";
import { addDays, daysBetween, type IsoDate } from "../../../lib/domain/dates";
import type { BlockReason, RentalMode, ReservationChannel, ReservationStatus, SpaceKind } from "../../../lib/domain/enums";
import { t, type MessageKey } from "../../../lib/i18n";
import type { Core } from "../context";
import { AppError } from "../errors";
import { blockHref } from "./blocks";
import { listMaintenance } from "./maintenance";
import { allSpacePaths, isLettable, type SpaceRow } from "./shared";
import { overlaps, spaceRefs, stayAlerts } from "./stay-alerts";
import { connectionHref, FAILING_HEALTH, liveConnections, STALE_HEALTH, type ChannelRuntime, type LiveConnection } from "./stay-channels";
import { MAX_CALENDAR_DAYS } from "./stay-validate";
import { channelLabel, queryReservations, reservationHref } from "./stays";
import { queryTurnovers } from "./turnovers";

/** A space has short-stay activity if it has a live connection or a stay in this window around today. */
export const ACTIVITY_PAST_DAYS = 90;
export const ACTIVITY_FUTURE_DAYS = 365;

// ── Day view ────────────────────────────────────────────────────────────────

export function stayDay(core: Core, date: IsoDate, runtime: ChannelRuntime): StayDay {
  const today = core.today();
  const paths = allSpacePaths(core);
  const live = "r.status <> 'cancelled'";
  const arrivals = queryReservations(core, `${live} AND r.check_in = $date`, { date }, paths);
  const departures = queryReservations(core, `${live} AND r.check_out = $date`, { date }, paths);
  const inHouse = queryReservations(core, `${live} AND r.check_in < $date AND r.check_out > $date`, { date }, paths);
  const turnovers = queryTurnovers(
    core,
    "((t.due_date = $date AND t.status <> 'skipped') OR (t.due_date < $date AND t.status IN ('pending','scheduled','in_progress')))",
    { date },
  );

  // Open maintenance where short stays happen.
  const connections = liveConnections(core, runtime);
  const activeSpaces = new Set<string>(connections.map((c) => c.space_id));
  for (const r of core.db.all<{ space_id: string }>(
    "SELECT DISTINCT space_id FROM reservations WHERE status <> 'cancelled' AND check_out >= ? AND check_in <= ?",
    [addDays(today, -ACTIVITY_PAST_DAYS), addDays(today, ACTIVITY_FUTURE_DAYS)],
  )) {
    activeSpaces.add(r.space_id);
  }
  const refs = spaceRefs(core);
  const activeProperties = new Set<string>();
  for (const id of activeSpaces) {
    const p = core.db.get<{ property_id: string }>("SELECT property_id FROM spaces WHERE id = ?", [id]);
    if (p) activeProperties.add(p.property_id);
  }
  const maintenance = activeSpaces.size
    ? listMaintenance(core, { propertyId: null, status: "open", priority: null, overdueOnly: false, query: "" }).filter((m) =>
        m.spaceId === null ? activeProperties.has(m.propertyId) : [...activeSpaces].some((s) => overlaps(refs, s, m.spaceId!)),
      )
    : [];

  const active = connections.filter((c) => c.status === "active");
  const oldest = active.map((c) => c.last_success_at).filter((s): s is string => !!s).sort()[0] ?? null;
  return {
    date,
    today,
    arrivals,
    departures,
    inHouse,
    turnovers,
    maintenance,
    alerts: stayAlerts(core, runtime),
    channels: {
      total: connections.length,
      active: active.length,
      stale: active.filter((c) => STALE_HEALTH.includes(c.health)).length,
      failing: active.filter((c) => FAILING_HEALTH.includes(c.health)).length,
      oldestSuccessAt: oldest,
    },
  };
}

// ── Calendar ────────────────────────────────────────────────────────────────

interface CalSpace extends SpaceRow {
  property_name: string;
  property_archived_at: string | null;
  unit_mode: RentalMode | null;
  unit_archived_at: string | null;
  parent_archived_at: string | null;
}

interface Placed {
  spaceId: string;
  item: CalendarItem;
}

function blockLabel(reason: BlockReason): string {
  return t(`errors.stays.blockReason.${reason}` as MessageKey);
}

/** Sort key following the unit → room → bed tree by sort order. */
function treeKey(s: CalSpace, byId: Map<string, CalSpace>): string {
  const parts: string[] = [];
  let cur: CalSpace | undefined = s;
  while (cur) {
    parts.unshift(`${String(cur.sort_order + 100000).padStart(7, "0")}${cur.created_at}${cur.id}`);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return parts.join("/");
}

export function stayCalendar(core: Core, params: { from: IsoDate; to: IsoDate; propertyId: string | null }, runtime: ChannelRuntime): StayCalendar {
  const { from, to, propertyId } = params;
  if (to < from) throw new AppError("VALIDATION", "validation.endBeforeStart", { fields: { to: "validation.endBeforeStart" } });
  if (daysBetween(from, to) >= MAX_CALENDAR_DAYS) throw new AppError("VALIDATION", "errors.stays.calendarRange", { fields: { to: "errors.stays.calendarRange" } });
  const after = addDays(to, 1);
  const paths = allSpacePaths(core);
  const refs = spaceRefs(core);

  const spaces = core.db.all<CalSpace>(
    `SELECT s.*, p.name AS property_name, p.archived_at AS property_archived_at, u.rental_mode AS unit_mode, u.archived_at AS unit_archived_at,
       (SELECT archived_at FROM spaces x WHERE x.id = s.parent_id) AS parent_archived_at
     FROM spaces s JOIN properties p ON p.id = s.property_id JOIN spaces u ON u.id = s.unit_id
     ${propertyId ? "WHERE s.property_id = ?" : ""}`,
    propertyId ? [propertyId] : [],
  );
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const openLettable = (s: CalSpace) =>
    !s.archived_at && !s.unit_archived_at && !s.parent_archived_at && !s.property_archived_at && isLettable(s, s.unit_mode);

  const connections = liveConnections(core, runtime).filter((c) => !propertyId || c.property_id === propertyId);
  const connectionsBySpace = new Map<string, LiveConnection[]>();
  for (const c of connections) connectionsBySpace.set(c.space_id, [...(connectionsBySpace.get(c.space_id) ?? []), c]);

  // Everything in range, placed on the space it's recorded against.
  const placed: Placed[] = [];
  const own = new Set<string>();
  for (const r of core.db.all<{
    id: string;
    space_id: string;
    guest_name: string;
    channel: ReservationChannel;
    channel_reservation_id: string | null;
    source: string;
    check_in: string;
    check_out: string;
    status: ReservationStatus;
    missing_since: string | null;
  }>(
    `SELECT id, space_id, guest_name, channel, channel_reservation_id, source, check_in, check_out, status, missing_since
     FROM reservations WHERE status <> 'cancelled' AND check_in <= ? AND check_out > ?`,
    [to, from],
  )) {
    own.add(r.space_id);
    const code = r.channel_reservation_id && r.channel_reservation_id.length <= 20 ? r.channel_reservation_id : "";
    placed.push({
      spaceId: r.space_id,
      item: {
        kind: "reservation",
        id: r.id,
        start: r.check_in,
        endExclusive: r.check_out,
        label: r.guest_name || code || t("errors.stays.guestFallback", { channel: channelLabel(r.channel) }),
        status: r.status,
        channel: r.channel,
        missing: !!r.missing_since,
        viaSpacePath: null,
        href: reservationHref(r.id),
      },
    });
  }
  for (const k of core.db.all<{ id: string; space_id: string; start_date: string; end_date: string; reason: BlockReason }>(
    "SELECT id, space_id, start_date, end_date, reason FROM availability_blocks WHERE cancelled_at IS NULL AND start_date <= ? AND end_date >= ?",
    [to, from],
  )) {
    own.add(k.space_id);
    placed.push({
      spaceId: k.space_id,
      item: {
        kind: "block",
        id: k.id,
        start: k.start_date,
        endExclusive: addDays(k.end_date, 1),
        label: blockLabel(k.reason),
        status: null,
        channel: null,
        missing: false,
        viaSpacePath: null,
        href: blockHref(k.id),
      },
    });
  }
  for (const tn of core.db.all<{ id: string; space_id: string; start_date: string; last_day: string | null; full_name: string }>(
    `SELECT t.id, t.space_id, t.start_date, COALESCE(t.moved_out_on, t.end_date) AS last_day, tn.full_name
     FROM tenancies t JOIN tenants tn ON tn.id = t.tenant_id
     WHERE t.cancelled_at IS NULL AND t.start_date <= ? AND COALESCE(t.moved_out_on, t.end_date, '9999-12-31') >= ?`,
    [to, from],
  )) {
    placed.push({
      spaceId: tn.space_id,
      item: {
        kind: "tenancy",
        id: tn.id,
        start: tn.start_date,
        endExclusive: tn.last_day ? addDays(tn.last_day, 1) : after,
        label: tn.full_name,
        status: null,
        channel: null,
        missing: false,
        viaSpacePath: null,
        href: `/tenancies/view/?id=${tn.id}`,
      },
    });
  }

  // Rows: spaces sold as short stays, or holding a stay/block in range.
  const rowIds = new Set<string>();
  for (const s of spaces) {
    if (propertyId && openLettable(s)) rowIds.add(s.id);
    else if (connectionsBySpace.has(s.id) && openLettable(s)) rowIds.add(s.id);
    else if (own.has(s.id)) rowIds.add(s.id);
  }

  const eventsFor = (conn: LiveConnection[]) => {
    if (!conn.length) return [];
    const ids = conn.map((c) => c.id);
    return core.db.all<{
      id: string;
      connection_id: string;
      kind: "reservation" | "block";
      confirmation_code: string | null;
      summary: string;
      start_date: string;
      end_date: string;
      state: "applied" | "conflict" | "dismissed";
    }>(
      `SELECT id, connection_id, kind, confirmation_code, summary, start_date, end_date, state FROM channel_events
       WHERE connection_id IN (${ids.map(() => "?").join(",")}) AND start_date <= ? AND end_date > ?
         AND (state = 'conflict' OR (kind = 'block' AND state <> 'dismissed'))
       ORDER BY start_date`,
      [...ids, to, from],
    );
  };

  const rows: (CalendarRow & { key: string })[] = [];
  for (const id of rowIds) {
    const s = byId.get(id)!;
    const conn = connectionsBySpace.get(id) ?? [];
    const channelById = new Map(conn.map((c) => [c.id, c]));
    const items: CalendarItem[] = [];
    for (const p of placed) {
      if (p.spaceId === id) items.push(p.item);
      else if (overlaps(refs, p.spaceId, id)) items.push({ ...p.item, viaSpacePath: paths.get(p.spaceId) ?? "" });
    }
    for (const e of eventsFor(conn)) {
      const c = channelById.get(e.connection_id)!;
      items.push({
        kind: e.state === "conflict" ? "conflict" : "channel_block",
        id: e.id,
        start: e.start_date,
        endExclusive: e.end_date,
        label: e.confirmation_code || e.summary || t(`errors.stays.channel.${c.channel}` as MessageKey),
        status: null,
        channel: c.channel,
        missing: false,
        viaSpacePath: null,
        href: connectionHref(c.id),
      });
    }
    items.sort((a, b) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    const first = conn[0];
    rows.push({
      key: `${s.property_name.toLowerCase()}\u0000${s.property_id}\u0000${treeKey(s, byId)}`,
      spaceId: s.id,
      propertyId: s.property_id,
      propertyName: s.property_name,
      spacePath: paths.get(s.id) ?? s.label,
      spaceKind: s.kind as SpaceKind,
      connection: first ? { id: first.id, name: first.name, channel: first.channel, health: first.health } : null,
      items,
    });
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { from, to, today: core.today(), rows: rows.map(({ key: _key, ...row }) => row) };
}
