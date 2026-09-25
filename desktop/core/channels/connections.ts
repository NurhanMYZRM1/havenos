import crypto from "node:crypto";
import type {
  ChannelConnection,
  ChannelConnectionCreate,
  ChannelConnectionDetail,
  ChannelConnectionUpdate,
  ChannelErrorCode,
  ChannelEventView,
  ChannelSyncRun,
  ConflictInfo,
  ReservationSummary,
} from "../../../lib/api/contract";
import type { ChannelId, ReservationChannel, ReservationSource, SpaceKind, TurnoverStatus } from "../../../lib/domain/enums";
import { channelHealth, DEFAULT_TURNOVER_CHECKLIST, isFeedStale, nights } from "../../../lib/domain/short-stay";
import { t } from "../../../lib/i18n";
import type { Core } from "../context";
import { AppError, notFound, validationError } from "../errors";
import type { ChannelSecretStore, ChannelSyncControl } from "../integrations/channels";
import { feedAdapter } from "../integrations/registry";
import { conflictInfo, findConflicts, stayRange } from "../services/availability";
import { moveReservationSpace, type ReservationRow } from "../services/reservations";
import { allSpacePaths, isLettable, newId, spacePath, type SpaceRow } from "../services/shared";
import { pendingBlocks } from "./pending";

/**
 * Channel connections: one external listing ↔ one lettable space. The feed
 * link is stored only in the ChannelSecretStore (OS credential store); the
 * database keeps a SHA-256 fingerprint so the same link can't be added twice.
 */

export interface ConnectionRow {
  id: string;
  channel: ChannelId;
  method: "ical";
  name: string;
  external_listing_id: string | null;
  space_id: string;
  property_id: string;
  status: "active" | "paused";
  feed_fingerprint: string | null;
  check_in_time: string;
  check_out_time: string;
  turnover_checklist: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  last_error_detail: string;
  last_error_at: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What the list/detail views need from the running scheduler. */
export type ConnectionViewContext = Pick<ChannelSyncControl, "secrets" | "running" | "nextSyncAt">;

export const fingerprint = (url: string) => crypto.createHash("sha256").update(url.trim()).digest("hex");

export function channelLabel(channel: ReservationChannel): string {
  return t(`errors.channels.channelName.${channel}`);
}

/** An active (not removed) connection, or NOT_FOUND. */
export function getConnectionRow(core: Core, id: string): ConnectionRow {
  const row = core.db.get<ConnectionRow>("SELECT * FROM channel_connections WHERE id = ?", [id]);
  if (!row) throw notFound();
  if (row.removed_at) throw new AppError("NOT_FOUND", "errors.channels.removed");
  return row;
}

export function findConnectionRow(core: Core, id: string): ConnectionRow | null {
  return core.db.get<ConnectionRow>("SELECT * FROM channel_connections WHERE id = ? AND removed_at IS NULL", [id]) ?? null;
}

export function activeConnectionIds(core: Core): string[] {
  return core.db
    .all<{ id: string }>("SELECT id FROM channel_connections WHERE removed_at IS NULL AND status = 'active' ORDER BY created_at, id")
    .map((r) => r.id);
}

function lettableSpace(core: Core, spaceId: string): { id: string; property_id: string } {
  const row = core.db.get<SpaceRow & { unit_mode: SpaceRow["rental_mode"]; unit_archived: string | null }>(
    `SELECT s.*, u.rental_mode AS unit_mode, u.archived_at AS unit_archived
     FROM spaces s JOIN spaces u ON u.id = s.unit_id WHERE s.id = ?`,
    [spaceId],
  );
  if (!row || row.archived_at || row.unit_archived || !isLettable(row, row.unit_mode)) {
    throw validationError({ spaceId: "errors.channels.notLettable" });
  }
  return { id: row.id, property_id: row.property_id };
}

function checkUrl(channel: ChannelId, url: string) {
  const adapter = feedAdapter(channel);
  if (!adapter) throw validationError({ channel: "errors.channels.unsupportedChannel" });
  const check = adapter.checkFeedUrl(url);
  if (!check.ok) throw validationError({ feedUrl: check.error });
  return check;
}

/** Friendly errors for the three uniqueness rules (checked before writing, so the message can name the other connection). */
function assertUnique(core: Core, c: { id: string; channel: ChannelId; spaceId: string; listingId: string | null; fingerprint: string | null }) {
  if (c.fingerprint) {
    const other = core.db.get<{ name: string }>(
      "SELECT name FROM channel_connections WHERE removed_at IS NULL AND feed_fingerprint = ? AND id <> ?",
      [c.fingerprint, c.id],
    );
    if (other) throw new AppError("CONFLICT", "errors.channels.duplicateFeed", { params: { name: other.name }, fields: { feedUrl: "errors.channels.duplicateFeed" } });
  }
  if (c.listingId) {
    const other = core.db.get<{ name: string }>(
      "SELECT name FROM channel_connections WHERE removed_at IS NULL AND channel = ? AND external_listing_id = ? AND id <> ?",
      [c.channel, c.listingId, c.id],
    );
    if (other) throw new AppError("CONFLICT", "errors.channels.duplicateListing", { params: { name: other.name }, fields: { feedUrl: "errors.channels.duplicateListing" } });
  }
  const other = core.db.get<{ name: string }>(
    "SELECT name FROM channel_connections WHERE removed_at IS NULL AND channel = ? AND space_id = ? AND id <> ?",
    [c.channel, c.spaceId, c.id],
  );
  if (other) {
    throw new AppError("CONFLICT", "errors.channels.spaceTaken", {
      params: { space: spacePath(core, c.spaceId), channel: channelLabel(c.channel), name: other.name },
      fields: { spaceId: "errors.channels.spaceTaken" },
    });
  }
}

/** Unique-index failures that slipped past assertUnique (e.g. a race) as friendly errors. */
function mapUniqueError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : "";
  if (!message.includes("UNIQUE")) return err;
  if (message.includes("feed_fingerprint")) return new AppError("CONFLICT", "errors.channels.duplicateFeed", { params: { name: "" } });
  if (message.includes("external_listing_id")) return new AppError("CONFLICT", "errors.channels.duplicateListing", { params: { name: "" } });
  return new AppError("CONFLICT", "errors.channels.spaceTaken", { params: { space: "", channel: "", name: "" } });
}

export function createConnection(core: Core, secrets: ChannelSecretStore, input: ChannelConnectionCreate): string {
  const check = checkUrl(input.channel, input.feedUrl);
  const space = lettableSpace(core, input.spaceId);
  const id = newId();
  const fp = fingerprint(input.feedUrl);
  try {
    core.db.tx(() => {
      assertUnique(core, { id, channel: input.channel, spaceId: space.id, listingId: check.externalListingId, fingerprint: fp });
      const now = core.nowIso();
      core.db.run(
        `INSERT INTO channel_connections (id, channel, method, name, external_listing_id, space_id, property_id, status, feed_fingerprint,
           check_in_time, check_out_time, created_at, updated_at)
         VALUES (?, ?, 'ical', ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        [id, input.channel, input.name.trim(), check.externalListingId, space.id, space.property_id, fp, input.checkInTime, input.checkOutTime, now, now],
      );
      // Last, so a failure to store the link undoes the row too.
      storeLink(secrets, id, input.feedUrl);
    });
  } catch (err) {
    throw mapUniqueError(err);
  }
  return id;
}

/** Returns whether the feed link changed (the caller then reads it again). */
export function updateConnection(core: Core, secrets: ChannelSecretStore, input: ChannelConnectionUpdate): { linkChanged: boolean } {
  const row = getConnectionRow(core, input.id);
  const check = input.feedUrl !== null ? checkUrl(row.channel, input.feedUrl) : null;
  const space = lettableSpace(core, input.spaceId);
  const fp = input.feedUrl !== null ? fingerprint(input.feedUrl) : row.feed_fingerprint;
  const listingId = check ? check.externalListingId : row.external_listing_id;
  const linkChanged = input.feedUrl !== null && (fp !== row.feed_fingerprint || safeSecret(secrets, row.id) === null);
  try {
    core.db.tx(() => {
      assertUnique(core, { id: row.id, channel: row.channel, spaceId: space.id, listingId, fingerprint: fp });
      if (space.id !== row.space_id) {
        // Bookings still to come follow the listing to its new space.
        const upcoming = core.db.all<{ id: string }>(
          "SELECT id FROM reservations WHERE connection_id = ? AND status <> 'cancelled' AND check_out > ? ORDER BY check_in",
          [row.id, core.today()],
        );
        for (const r of upcoming) moveReservationSpace(core, r.id, space.id, "feed");
      }
      core.db.run(
        `UPDATE channel_connections SET name = ?, space_id = ?, property_id = ?, external_listing_id = ?, feed_fingerprint = ?,
           check_in_time = ?, check_out_time = ?, turnover_checklist = ?, updated_at = ? WHERE id = ?`,
        [
          input.name.trim(), space.id, space.property_id, listingId, fp, input.checkInTime, input.checkOutTime,
          JSON.stringify(input.turnoverChecklist), core.nowIso(), row.id,
        ],
      );
      if (input.feedUrl !== null) storeLink(secrets, row.id, input.feedUrl);
    });
  } catch (err) {
    throw mapUniqueError(err);
  }
  return { linkChanged };
}

export function setConnectionPaused(core: Core, id: string, paused: boolean) {
  const row = getConnectionRow(core, id);
  const status = paused ? "paused" : "active";
  if (row.status === status) return;
  core.db.run("UPDATE channel_connections SET status = ?, updated_at = ? WHERE id = ?", [status, core.nowIso(), id]);
}

/**
 * Soft removal: the connection stops syncing and its link is forgotten.
 * Reservations it imported (and their history) stay; its pending-review
 * events and "block on the channel" acknowledgements go.
 */
export function removeConnection(core: Core, secrets: ChannelSecretStore, id: string) {
  getConnectionRow(core, id);
  core.db.tx(() => {
    const now = core.nowIso();
    core.db.run("UPDATE channel_connections SET removed_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
    core.db.run("DELETE FROM channel_events WHERE connection_id = ?", [id]);
    core.db.run("DELETE FROM channel_push_acks WHERE connection_id = ?", [id]);
  });
  secrets.delete(id);
}

// ── Views ──────────────────────────────────────────────────────────────────

interface JoinedRow extends ConnectionRow {
  property_name: string;
  space_kind: SpaceKind;
}

const JOINED = `
  SELECT c.*, p.name AS property_name, s.kind AS space_kind
  FROM channel_connections c
  JOIN properties p ON p.id = c.property_id
  JOIN spaces s ON s.id = c.space_id`;

function parseChecklist(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function storeLink(secrets: ChannelSecretStore, id: string, url: string) {
  try {
    secrets.set(id, url.trim());
  } catch {
    throw new AppError("INTERNAL", "errors.channels.credentialStore");
  }
}

function safeSecret(secrets: ChannelSecretStore, id: string): string | null {
  try {
    return secrets.get(id);
  } catch {
    return null;
  }
}

function toConnection(core: Core, ctx: ConnectionViewContext, r: JoinedRow, paths: Map<string, string>): ChannelConnection {
  const adapter = feedAdapter(r.channel);
  const link = safeSecret(ctx.secrets, r.id);
  const check = link && adapter ? adapter.checkFeedUrl(link) : null;
  const running = ctx.running().includes(r.id);
  const now = core.now();
  const today = core.today();
  const count = (sql: string, params: (string | number)[]) => core.db.get<{ n: number }>(sql, params)?.n ?? 0;
  const checklist = parseChecklist(r.turnover_checklist);
  return {
    id: r.id,
    channel: r.channel,
    method: r.method,
    name: r.name,
    externalListingId: r.external_listing_id,
    propertyId: r.property_id,
    propertyName: r.property_name,
    spaceId: r.space_id,
    spacePath: paths.get(r.space_id) ?? "",
    spaceKind: r.space_kind,
    status: r.status,
    health: channelHealth({ status: r.status, lastSuccessAt: r.last_success_at, lastErrorAt: r.last_error_at, hasFeedLink: link !== null, running }, now),
    capabilities: adapter
      ? adapter.capabilities
      : { method: "ical", incremental: false, pushAvailability: false, guestDetails: false, money: false, channelImportDelayMinutes: null },
    hasFeedLink: link !== null,
    feedLinkHint: check && check.ok ? check.hint : null,
    checkInTime: r.check_in_time,
    checkOutTime: r.check_out_time,
    turnoverChecklist: checklist.length ? checklist : [...DEFAULT_TURNOVER_CHECKLIST],
    lastAttemptAt: r.last_attempt_at,
    lastSuccessAt: r.last_success_at,
    nextSyncAt: r.status === "active" ? ctx.nextSyncAt() : null,
    lastError: r.last_error_code && r.last_error_at ? { code: r.last_error_code as ChannelErrorCode, detail: r.last_error_detail, at: r.last_error_at } : null,
    stale: isFeedStale(r.last_success_at, now),
    counts: {
      upcoming: count("SELECT COUNT(*) AS n FROM reservations WHERE connection_id = ? AND status <> 'cancelled' AND check_out > ?", [r.id, today]),
      conflicts: count("SELECT COUNT(*) AS n FROM channel_events WHERE connection_id = ? AND state = 'conflict'", [r.id]),
      missing: count("SELECT COUNT(*) AS n FROM reservations WHERE connection_id = ? AND status <> 'cancelled' AND missing_since IS NOT NULL", [r.id]),
      pendingBlocks: r.status === "active" ? pendingBlocks(core, r.id).filter((b) => !b.acknowledgedAt).length : 0,
    },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listConnections(core: Core, ctx: ConnectionViewContext): ChannelConnection[] {
  const paths = allSpacePaths(core);
  return core.db
    .all<JoinedRow>(`${JOINED} WHERE c.removed_at IS NULL ORDER BY p.name, c.name, c.created_at`)
    .map((r) => toConnection(core, ctx, r, paths));
}

export function getConnection(core: Core, ctx: ConnectionViewContext, id: string): ChannelConnection {
  getConnectionRow(core, id);
  const row = core.db.get<JoinedRow>(`${JOINED} WHERE c.id = ?`, [id])!;
  return toConnection(core, ctx, row, allSpacePaths(core));
}

interface RunRow {
  id: string;
  trigger: ChannelSyncRun["trigger"];
  started_at: string;
  finished_at: string | null;
  outcome: ChannelSyncRun["outcome"];
  error_code: string | null;
  diagnostic: string | null;
  events_seen: number;
  created_count: number;
  updated_count: number;
  missing_count: number;
  conflict_count: number;
}

export interface ChannelEventRow {
  id: string;
  connection_id: string;
  kind: "reservation" | "block";
  external_uid: string;
  confirmation_code: string | null;
  start_date: string;
  end_date: string;
  summary: string;
  state: "applied" | "conflict" | "dismissed";
  reservation_id: string | null;
  conflict: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/** Stored conflict JSON; NULL or malformed reads as no conflicts. */
export function parseConflicts(raw: string | null): ConflictInfo[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((c) => c && typeof c === "object") as ConflictInfo[]) : [];
  } catch {
    return [];
  }
}

export function toEventView(core: Core, e: ChannelEventRow, connectionName: string): ChannelEventView {
  const conn = getConnectionRow(core, e.connection_id);
  const res = e.reservation_id
    ? core.db.get<ReservationRow>("SELECT * FROM reservations WHERE id = ?", [e.reservation_id])
    : core.db.get<ReservationRow>("SELECT * FROM reservations WHERE channel = ? AND channel_reservation_id = ?", [conn.channel, e.confirmation_code ?? e.external_uid]);
  const ours = res?.connection_id === conn.id;
  const adoptable = res?.space_id === conn.space_id && (!res.connection_id || !findConnectionRow(core, res.connection_id));
  const [first, last] = stayRange(e.start_date, e.end_date);
  const spaceId = res && ours && res.status !== "cancelled" ? res.space_id : conn.space_id;
  const conflicts = findConflicts(core, spaceId, first, last, { excludeReservationId: res && (ours || adoptable) ? res.id : null }).map((c) => conflictInfo(core, c));
  // A booking reference owned by another listing still needs review even when its dates don't overlap.
  if (res && !ours && !adoptable && !conflicts.some((c) => c.kind === "reservation" && c.id === res.id)) {
    const [start, end] = stayRange(res.check_in, res.check_out);
    conflicts.push(conflictInfo(core, { kind: "reservation", id: res.id, spaceId: res.space_id, who: res.guest_name, start, end, channel: res.channel }));
  }
  return {
    id: e.id,
    connectionId: e.connection_id,
    connectionName,
    kind: e.kind,
    confirmationCode: e.confirmation_code,
    checkIn: e.start_date,
    checkOut: e.end_date,
    state: e.state,
    reservationId: e.reservation_id,
    currentDates:
      res && res.status !== "cancelled" && (res.check_in !== e.start_date || res.check_out !== e.end_date)
        ? { checkIn: res.check_in, checkOut: res.check_out }
        : null,
    conflicts,
    firstSeenAt: e.first_seen_at,
    lastSeenAt: e.last_seen_at,
  };
}

interface SummaryRow {
  id: string;
  property_id: string;
  property_name: string;
  space_id: string;
  space_kind: SpaceKind;
  channel: ReservationChannel;
  channel_reservation_id: string | null;
  connection_id: string | null;
  connection_name: string | null;
  connection_removed: string | null;
  source: ReservationSource;
  guest_name: string;
  guest_count: number | null;
  check_in: string;
  check_out: string;
  check_in_time: string | null;
  check_out_time: string | null;
  status: ReservationSummary["status"];
  missing_since: string | null;
  last_seen_at: string | null;
  turnover_id: string | null;
  turnover_status: TurnoverStatus | null;
  created_at: string;
  updated_at: string;
}

function toReservationSummary(r: SummaryRow, paths: Map<string, string>): ReservationSummary {
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
    datesLocked: r.connection_id !== null && r.connection_removed === null && r.connection_name !== null,
    turnoverId: r.turnover_id,
    turnoverStatus: r.turnover_status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getConnectionDetail(core: Core, ctx: ConnectionViewContext, id: string): ChannelConnectionDetail {
  const base = getConnection(core, ctx, id);
  const runs = core.db
    .all<RunRow>("SELECT * FROM channel_sync_runs WHERE connection_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 10", [id])
    .map(
      (r): ChannelSyncRun => ({
        id: r.id,
        trigger: r.trigger,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        outcome: r.outcome,
        errorCode: r.error_code as ChannelErrorCode | null,
        diagnostic: r.diagnostic,
        eventsSeen: r.events_seen,
        created: r.created_count,
        updated: r.updated_count,
        missing: r.missing_count,
        conflicts: r.conflict_count,
      }),
    );
  const events = core.db
    .all<ChannelEventRow>(
      "SELECT * FROM channel_events WHERE connection_id = ? AND kind = 'reservation' AND state IN ('conflict','dismissed') ORDER BY state, start_date",
      [id],
    )
    .map((e) => toEventView(core, e, base.name));
  const paths = allSpacePaths(core);
  const missingReservations = core.db
    .all<SummaryRow>(
      `SELECT r.*, p.name AS property_name, s.kind AS space_kind, c.name AS connection_name, c.removed_at AS connection_removed,
         tv.id AS turnover_id, tv.status AS turnover_status
       FROM reservations r
       JOIN properties p ON p.id = r.property_id
       JOIN spaces s ON s.id = r.space_id
       LEFT JOIN channel_connections c ON c.id = r.connection_id
       LEFT JOIN turnovers tv ON tv.reservation_id = r.id
       WHERE r.connection_id = ? AND r.status <> 'cancelled' AND r.missing_since IS NOT NULL
       ORDER BY r.check_in`,
      [id],
    )
    .map((r) => toReservationSummary(r, paths));
  return { ...base, runs, events, missingReservations };
}
