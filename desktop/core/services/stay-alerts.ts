import type { StayAlert } from "../../../lib/api/contract";
import { addDays, type IsoDate } from "../../../lib/domain/dates";
import type { SpaceKind } from "../../../lib/domain/enums";
import { spacesOverlap, type SpaceRef } from "../../../lib/domain/inventory";
import { ARRIVAL_LOOKAHEAD_DAYS } from "../../../lib/domain/short-stay";
import { pendingBlocks } from "../channels/pending";
import type { Core } from "../context";
import { listMaintenance } from "./maintenance";
import { allSpacePaths } from "./shared";
import { connectionHref, FAILING_HEALTH, liveConnections, STALE_HEALTH, type ChannelRuntime } from "./stay-channels";
import { queryReservations, reservationHref } from "./stays";
import { openTurnoversThrough } from "./turnovers";

/**
 * Things on the short-stay side that need the landlord's attention, most
 * urgent first. Ids are stable (`kind:ref`) so the UI can remember what was
 * seen; `params` carry what the UI's message for each kind interpolates.
 */

/** Unassigned turnovers are flagged this many days ahead. */
export const UNASSIGNED_LOOKAHEAD_DAYS = 3;
/** Dates to block on a channel are flagged when they start within this many days. */
export const PENDING_BLOCK_LOOKAHEAD_DAYS = 60;

const SEVERITY_RANK: Record<StayAlert["severity"], number> = { critical: 0, warning: 1, info: 2 };

export function turnoverHref(id: string): string {
  return `/stays/turnover/?id=${id}`;
}

export function maintenanceHref(id: string): string {
  return `/maintenance/view/?id=${id}`;
}

/** unit/room ancestry for every space, for spacesOverlap(). */
export function spaceRefs(core: Core): Map<string, SpaceRef> {
  const out = new Map<string, SpaceRef>();
  for (const s of core.db.all<{ id: string; kind: SpaceKind; unit_id: string; room_id: string | null }>("SELECT id, kind, unit_id, room_id FROM spaces")) {
    out.set(s.id, { id: s.id, kind: s.kind, unitId: s.unit_id, roomId: s.room_id });
  }
  return out;
}

export function overlaps(refs: Map<string, SpaceRef>, a: string, b: string): boolean {
  const ra = refs.get(a);
  const rb = refs.get(b);
  return !!ra && !!rb && spacesOverlap(ra, rb);
}

export function sortAlerts(alerts: StayAlert[]): StayAlert[] {
  return alerts.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s) return s;
    const ad = a.date ?? "9999-12-31";
    const bd = b.date ?? "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function stayAlerts(core: Core, runtime: ChannelRuntime): StayAlert[] {
  const today = core.today();
  const paths = allSpacePaths(core);
  const alerts: StayAlert[] = [];
  const connections = liveConnections(core, runtime);
  const connectionById = new Map(connections.map((c) => [c.id, c]));

  // Feed bookings that clash with another HavenOS record, waiting for a decision.
  for (const e of core.db.all<{
    id: string;
    connection_id: string;
    confirmation_code: string | null;
    start_date: string;
    end_date: string;
    connection_name: string;
    space_id: string;
    property_name: string;
  }>(
    `SELECT e.id, e.connection_id, e.confirmation_code, e.start_date, e.end_date, c.name AS connection_name, c.space_id, p.name AS property_name
     FROM channel_events e
     JOIN channel_connections c ON c.id = e.connection_id
     JOIN properties p ON p.id = c.property_id
     WHERE e.state = 'conflict' AND c.removed_at IS NULL AND e.end_date >= ?`,
    [today],
  )) {
    alerts.push({
      id: `conflict:${e.id}`,
      kind: "conflict",
      severity: "critical",
      date: e.start_date,
      propertyName: e.property_name,
      spacePath: paths.get(e.space_id) ?? null,
      params: {
        connection: e.connection_name,
        code: e.confirmation_code ?? "",
        checkIn: e.start_date,
        checkOut: e.end_date,
        space: paths.get(e.space_id) ?? "",
      },
      href: connectionHref(e.connection_id),
    });
  }

  // Synced bookings the feed stopped listing: maybe cancelled on the channel.
  for (const r of queryReservations(core, "r.missing_since IS NOT NULL AND r.status <> 'cancelled' AND r.check_out > $today", { today }, paths)) {
    alerts.push({
      id: `missing_from_feed:${r.id}`,
      kind: "missing_from_feed",
      severity: "warning",
      date: r.checkIn,
      propertyName: r.propertyName,
      spacePath: r.spacePath,
      params: {
        guest: r.guestName,
        code: r.channelReservationId ?? "",
        space: r.spacePath,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        since: r.missingSince ?? "",
        connection: r.connectionName ?? "",
      },
      href: reservationHref(r.id),
    });
  }

  // Turnovers: late ones, and ones nobody has been given yet.
  const tomorrow = addDays(today, 1);
  for (const tv of openTurnoversThrough(core, addDays(today, UNASSIGNED_LOOKAHEAD_DAYS))) {
    const base = {
      date: tv.dueDate,
      propertyName: tv.propertyName,
      spacePath: tv.spacePath,
      href: turnoverHref(tv.id),
    };
    const params = {
      space: tv.spacePath,
      guest: tv.guestName,
      date: tv.dueDate,
      checkoutTime: tv.checkoutTime,
      nextCheckIn: tv.nextCheckIn?.date ?? "",
      nextCheckInTime: tv.nextCheckIn?.time ?? "",
      nextGuest: tv.nextCheckIn?.guestName ?? "",
      hours: tv.windowHours ?? "",
    };
    if (tv.late) alerts.push({ ...base, id: `late_turnover:${tv.id}`, kind: "late_turnover", severity: "critical", params });
    if (tv.unassigned) {
      alerts.push({
        ...base,
        id: `unassigned_turnover:${tv.id}`,
        kind: "unassigned_turnover",
        severity: tv.dueDate <= tomorrow ? "critical" : "warning",
        params,
      });
    }
  }

  // Calendar feeds that aren't being read.
  for (const c of connections) {
    if (c.status !== "active") continue;
    const base = { date: null, propertyName: c.property_name, spacePath: paths.get(c.space_id) ?? null, href: connectionHref(c.id) };
    if (STALE_HEALTH.includes(c.health)) {
      alerts.push({
        ...base,
        id: `stale_feed:${c.id}`,
        kind: "stale_feed",
        severity: "warning",
        params: { connection: c.name, lastSuccessAt: c.last_success_at ?? "", health: c.health },
      });
    } else if (FAILING_HEALTH.includes(c.health)) {
      alerts.push({
        ...base,
        id: `sync_failed:${c.id}`,
        kind: "sync_failed",
        severity: "warning",
        params: {
          connection: c.name,
          error: c.health === "feed_link_missing" ? "feed_link_missing" : c.last_error_code ?? "internal",
          lastSuccessAt: c.last_success_at ?? "",
        },
      });
    }
  }

  // Guests arriving soon to a place with an open critical repair.
  const critical = listMaintenance(core, { propertyId: null, status: "open", priority: "critical", overdueOnly: false, query: "" });
  if (critical.length) {
    const refs = spaceRefs(core);
    const until = addDays(today, ARRIVAL_LOOKAHEAD_DAYS);
    for (const r of queryReservations(core, "r.status <> 'cancelled' AND r.check_in >= $today AND r.check_in <= $until", { today, until }, paths)) {
      const hits = critical.filter((m) => m.propertyId === r.propertyId && (m.spaceId === null || overlaps(refs, m.spaceId, r.spaceId)));
      if (!hits.length) continue;
      alerts.push({
        id: `arrival_with_critical_maintenance:${r.id}`,
        kind: "arrival_with_critical_maintenance",
        severity: "critical",
        date: r.checkIn,
        propertyName: r.propertyName,
        spacePath: r.spacePath,
        params: { guest: r.guestName, space: r.spacePath, date: r.checkIn, title: hits[0].title, ref: hits[0].ref, count: hits.length },
        href: maintenanceHref(hits[0].id),
      });
    }
  }

  // Dates taken in HavenOS that a channel calendar still shows as open.
  const pendingUntil: IsoDate = addDays(today, PENDING_BLOCK_LOOKAHEAD_DAYS);
  for (const b of pendingBlocks(core, null)) {
    if (b.acknowledgedAt || b.start > pendingUntil || b.end < today) continue;
    alerts.push({
      id: `block_not_on_channel:${b.connectionId}:${b.start}:${b.end}`,
      kind: "block_not_on_channel",
      severity: "warning",
      date: b.start,
      propertyName: connectionById.get(b.connectionId)?.property_name ?? "",
      spacePath: b.spacePath,
      params: {
        connection: b.connectionName,
        channel: b.channel,
        space: b.spacePath,
        start: b.start,
        end: b.end,
        count: b.reasons.length,
        reason: b.reasons[0]?.label ?? "",
      },
      href: connectionHref(b.connectionId),
    });
  }

  return sortAlerts(alerts);
}
