import type { ChannelErrorCode, ChannelEventAction, ChannelSyncTrigger, ConflictInfo } from "../../../lib/api/contract";
import type { IsoDate } from "../../../lib/domain/dates";
import { t } from "../../../lib/i18n";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { ChannelSyncError, type ChannelSecretStore, type FeedEvent, type FeedFetcher, type FeedSnapshot } from "../integrations/channels";
import { feedAdapter } from "../integrations/registry";
import { conflictInfo, findConflicts, stayRange } from "../services/availability";
import {
  addReservationEvent,
  cancelReservation,
  changeReservationDates,
  getReservationRow,
  insertReservation,
  linkReservationToConnection,
  markReservationMissing,
  markReservationSeen,
  reinstateReservation,
  type ReservationRow,
} from "../services/reservations";
import { newId } from "../services/shared";
import { channelLabel, findConnectionRow, parseConflicts, getConnectionRow, type ChannelEventRow, type ConnectionRow } from "./connections";
import { FEED_MAX_BYTES, FEED_TIMEOUT_MS, statusError } from "./fetcher";
import { safeSyncDiagnostic, sanitizeSyncText } from "./diagnostics";

/**
 * The calendar sync engine.
 *
 * A calendar feed is a full snapshot with no change log, so each sync
 * compares the snapshot with what the connection's feed said last time
 * (channel_events) and with the reservations HavenOS holds:
 *  - bookings are matched by confirmation code first (Airbnb keeps it when
 *    dates change, while the UID may change), then by UID;
 *  - new bookings are inserted, moved bookings get their new dates — both
 *    only when the nights are free by the shared availability rule; a clash
 *    is held as a 'conflict' event for the landlord, never forced;
 *  - a future booking the feed stops listing is flagged missing, never
 *    cancelled; stays that have ended are left alone;
 *  - "not available" blocks are informational and replaced wholesale.
 * Everything a sync changes is applied in one transaction, and a feed that
 * suddenly lost most of its bookings is refused (see shrinkRejected) until
 * the landlord confirms it.
 */

export const RUNS_KEPT = 50;

export interface ReconcileStats {
  created: number;
  updated: number;
  missing: number;
  conflicts: number;
}

export interface ReconcileResult extends ReconcileStats {
  rejected: boolean;
  changed: boolean;
}

interface Ctx {
  core: Core;
  conn: ConnectionRow;
  now: string;
  today: IsoDate;
  stats: ReconcileStats;
  changed: boolean;
  touchedRows: Set<string>;
  seenReservations: Set<string>;
}

type EventState = "applied" | "conflict" | "dismissed";

function isConflictError(err: unknown): boolean {
  return err instanceof AppError && err.code === "CONFLICT";
}

function futureReservationEvents(events: readonly FeedEvent[], today: IsoDate): number {
  return events.filter((e) => e.kind === "reservation" && e.endExclusive > today).length;
}

/**
 * A feed that lost most of its future bookings at once is more likely broken
 * (an emptied export, a listing that was snoozed) than a wave of cancellations.
 */
export function shrinkRejected(core: Core, connectionId: string, snapshot: FeedSnapshot): boolean {
  const today = core.today();
  const before =
    core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM channel_events WHERE connection_id = ? AND kind = 'reservation' AND end_date > ?", [connectionId, today])?.n ?? 0;
  if (before >= 1 && snapshot.events.length === 0) return true;
  const after = futureReservationEvents(snapshot.events, today);
  return before - after >= 3 || (before >= 3 && after * 2 <= before);
}

function reservationKey(e: FeedEvent): string {
  return e.confirmationCode ?? e.uid;
}

function eventRowByUid(core: Core, connectionId: string, uid: string): ChannelEventRow | undefined {
  return core.db.get<ChannelEventRow>("SELECT * FROM channel_events WHERE connection_id = ? AND external_uid = ?", [connectionId, uid]);
}

/** The channel_events row for a booking: by confirmation code, else by UID. Re-keys it when the UID changed. */
function locateEventRow(ctx: Ctx, e: FeedEvent): ChannelEventRow | undefined {
  const { core, conn } = ctx;
  let row = e.confirmationCode
    ? core.db.get<ChannelEventRow>(
        "SELECT * FROM channel_events WHERE connection_id = ? AND kind = 'reservation' AND confirmation_code = ? ORDER BY last_seen_at DESC LIMIT 1",
        [conn.id, e.confirmationCode],
      )
    : undefined;
  if (!row) row = eventRowByUid(core, conn.id, e.uid);
  if (row && row.kind === "block") {
    // The dates were a block before and are a booking now: the block row is simply replaced.
    core.db.run("DELETE FROM channel_events WHERE id = ?", [row.id]);
    ctx.changed = true;
    return undefined;
  }
  if (row && row.external_uid !== e.uid) {
    const clash = eventRowByUid(core, conn.id, e.uid);
    if (clash && clash.id !== row.id) core.db.run("DELETE FROM channel_events WHERE id = ?", [clash.id]);
    core.db.run("UPDATE channel_events SET external_uid = ? WHERE id = ?", [e.uid, row.id]);
    row = { ...row, external_uid: e.uid };
    ctx.changed = true;
  }
  return row;
}

function connectionIsLive(core: Core, id: string | null): boolean {
  if (!id) return false;
  return !!core.db.get("SELECT 1 FROM channel_connections WHERE id = ? AND removed_at IS NULL", [id]);
}

function reservationConflictInfo(core: Core, r: ReservationRow): ConflictInfo {
  const [start, end] = stayRange(r.check_in, r.check_out);
  return conflictInfo(core, { kind: "reservation", id: r.id, spaceId: r.space_id, who: r.guest_name, start, end, channel: r.channel });
}

function conflictsFor(ctx: Ctx, spaceId: string, e: FeedEvent, excludeReservationId: string | null): ConflictInfo[] {
  const [first, last] = stayRange(e.start, e.endExclusive);
  return findConflicts(ctx.core, spaceId, first, last, { excludeReservationId }).map((c) => conflictInfo(ctx.core, c));
}

function writeEventRow(
  ctx: Ctx,
  prev: ChannelEventRow | undefined,
  e: FeedEvent,
  state: EventState,
  reservationId: string | null,
  conflicts: ConflictInfo[] | null,
): string {
  const { core, conn, now } = ctx;
  const conflict = conflicts && conflicts.length ? JSON.stringify(conflicts) : null;
  if (!prev) {
    const id = newId();
    core.db.run(
      `INSERT INTO channel_events (id, connection_id, kind, external_uid, confirmation_code, start_date, end_date, summary, state, reservation_id, conflict, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, conn.id, e.kind, e.uid, e.confirmationCode, e.start, e.endExclusive, e.summary, state, reservationId, conflict, now, now],
    );
    ctx.changed = true;
    return id;
  }
  if (
    prev.start_date !== e.start ||
    prev.end_date !== e.endExclusive ||
    prev.state !== state ||
    prev.reservation_id !== reservationId ||
    prev.conflict !== conflict ||
    prev.confirmation_code !== e.confirmationCode ||
    prev.summary !== e.summary
  ) {
    ctx.changed = true;
  }
  core.db.run(
    `UPDATE channel_events SET confirmation_code = ?, start_date = ?, end_date = ?, summary = ?, state = ?, reservation_id = ?, conflict = ?, last_seen_at = ?
     WHERE id = ?`,
    [e.confirmationCode, e.start, e.endExclusive, e.summary, state, reservationId, conflict, now, prev.id],
  );
  return prev.id;
}

/**
 * Apply one booking from the feed. `force` re-evaluates a dismissed event
 * (the landlord asked to retry). Returns the event's resulting state.
 */
function applyReservationEvent(ctx: Ctx, e: FeedEvent, force = false): EventState {
  const { core, conn } = ctx;
  const prev = locateEventRow(ctx, e);
  const sameDates = !!prev && prev.start_date === e.start && prev.end_date === e.endExclusive;
  const newlyConflicting = !prev || prev.state !== "conflict" || !sameDates;

  const done = (state: EventState, reservationId: string | null, conflicts: ConflictInfo[] | null) => {
    const id = writeEventRow(ctx, prev, e, state, reservationId, conflicts);
    ctx.touchedRows.add(id);
    if (reservationId) ctx.seenReservations.add(reservationId);
    if (state === "conflict") ctx.stats.conflicts++;
    return state;
  };

  let res: ReservationRow | undefined;
  if (prev?.reservation_id) res = core.db.get<ReservationRow>("SELECT * FROM reservations WHERE id = ?", [prev.reservation_id]);
  if (!res) {
    res = core.db.get<ReservationRow>("SELECT * FROM reservations WHERE channel = ? AND channel_reservation_id = ?", [conn.channel, reservationKey(e)]);
  }

  // The landlord chose to ignore this booking; keep that until its dates change.
  if (prev && prev.state === "dismissed" && sameDates && !force) {
    if (res && res.status !== "cancelled" && res.connection_id === conn.id) markReservationSeen(core, res.id);
    return done("dismissed", prev.reservation_id, parseConflicts(prev.conflict));
  }

  if (res) {
    const ours = res.connection_id === conn.id;
    const adoptable = !ours && !connectionIsLive(core, res.connection_id) && res.space_id === conn.space_id;
    if (!ours && !adoptable) {
      // The same booking reference belongs to another space or another connection.
      return done("conflict", null, [reservationConflictInfo(core, res)]);
    }
    if (!ours) {
      linkReservationToConnection(core, res.id, conn.id, "feed");
      ctx.changed = true;
    }
    if (res.status === "cancelled") {
      const conflicts = conflictsFor(ctx, conn.space_id, e, res.id);
      if (!conflicts.length) {
        try {
          reinstateReservation(core, res.id, { spaceId: conn.space_id, checkIn: e.start, checkOut: e.endExclusive, connectionId: conn.id }, "feed");
          ctx.stats.updated++;
          ctx.changed = true;
          return done("applied", res.id, null);
        } catch (err) {
          if (!isConflictError(err)) throw err;
        }
      }
      return done("conflict", res.id, conflicts.length ? conflicts : conflictsFor(ctx, conn.space_id, e, res.id));
    }
    if (res.missing_since) ctx.changed = true;
    markReservationSeen(core, res.id);
    if (res.check_in === e.start && res.check_out === e.endExclusive) return done("applied", res.id, null);
    const conflicts = conflictsFor(ctx, res.space_id, e, res.id);
    if (!conflicts.length) {
      try {
        changeReservationDates(core, res.id, { checkIn: e.start, checkOut: e.endExclusive }, "feed");
        ctx.stats.updated++;
        ctx.changed = true;
        return done("applied", res.id, null);
      } catch (err) {
        if (!isConflictError(err)) throw err;
      }
    }
    if (newlyConflicting) {
      addReservationEvent(core, res.id, "conflict", "feed", [
        { field: "checkIn", from: res.check_in, to: e.start },
        { field: "checkOut", from: res.check_out, to: e.endExclusive },
      ]);
      ctx.changed = true;
    }
    return done("conflict", res.id, conflicts);
  }

  const conflicts = conflictsFor(ctx, conn.space_id, e, null);
  if (conflicts.length) return done("conflict", null, conflicts);
  const id = insertReservation(core, {
    spaceId: conn.space_id,
    guestName: "",
    guestCount: null,
    checkIn: e.start,
    checkOut: e.endExclusive,
    checkInTime: null,
    checkOutTime: null,
    status: "confirmed",
    channel: conn.channel,
    channelReservationId: reservationKey(e),
    connectionId: conn.id,
    source: "feed",
    notes: "",
    lastSeenAt: ctx.now,
  });
  ctx.stats.created++;
  ctx.changed = true;
  return done("applied", id, null);
}

/** Blocks are informational: the set is replaced by what the feed lists now. */
function replaceBlocks(ctx: Ctx, blocks: readonly FeedEvent[]) {
  const { core, conn, now } = ctx;
  const existing = new Map(
    core.db.all<ChannelEventRow>("SELECT * FROM channel_events WHERE connection_id = ? AND kind = 'block'", [conn.id]).map((r) => [r.external_uid, r]),
  );
  const keep = new Set<string>();
  for (const b of blocks) {
    const prev = existing.get(b.uid);
    if (prev && prev.start_date === b.start && prev.end_date === b.endExclusive && prev.summary === b.summary) {
      core.db.run("UPDATE channel_events SET last_seen_at = ? WHERE id = ?", [now, prev.id]);
      keep.add(prev.id);
      continue;
    }
    if (prev) core.db.run("DELETE FROM channel_events WHERE id = ?", [prev.id]);
    const clash = eventRowByUid(core, conn.id, b.uid);
    if (clash) continue; // a booking holds this UID (can't happen with a well-formed feed)
    const id = newId();
    core.db.run(
      `INSERT INTO channel_events (id, connection_id, kind, external_uid, confirmation_code, start_date, end_date, summary, state, reservation_id, conflict, first_seen_at, last_seen_at)
       VALUES (?, ?, 'block', ?, NULL, ?, ?, ?, 'applied', NULL, NULL, ?, ?)`,
      [id, conn.id, b.uid, b.start, b.endExclusive, b.summary, prev?.first_seen_at ?? now, now],
    );
    keep.add(id);
    ctx.changed = true;
  }
  for (const r of existing.values()) {
    if (keep.has(r.id) || !core.db.get("SELECT 1 FROM channel_events WHERE id = ?", [r.id])) continue;
    core.db.run("DELETE FROM channel_events WHERE id = ?", [r.id]);
    ctx.changed = true;
  }
}

function newCtx(core: Core, conn: ConnectionRow): Ctx {
  return {
    core,
    conn,
    now: core.nowIso(),
    today: core.today(),
    stats: { created: 0, updated: 0, missing: 0, conflicts: 0 },
    changed: false,
    touchedRows: new Set(),
    seenReservations: new Set(),
  };
}

/**
 * Compare a parsed snapshot with what HavenOS holds for the connection and
 * apply the differences. Runs in one transaction: any failure undoes all of it.
 */
export function reconcileSnapshot(core: Core, connectionId: string, snapshot: FeedSnapshot, opts: { acceptShrink: boolean }): ReconcileResult {
  return core.db.tx(() => {
    const conn = getConnectionRow(core, connectionId);
    if (!opts.acceptShrink && shrinkRejected(core, conn.id, snapshot)) {
      return { rejected: true, changed: false, created: 0, updated: 0, missing: 0, conflicts: 0 };
    }
    const space = core.db.get<{ archived_at: string | null }>("SELECT archived_at FROM spaces WHERE id = ?", [conn.space_id]);
    if (!space || space.archived_at) throw new ChannelSyncError("internal", "space_archived");

    const ctx = newCtx(core, conn);
    const seenKeys = new Set<string>();
    const blocks: FeedEvent[] = [];
    for (const e of snapshot.events) {
      if (e.kind === "block") {
        blocks.push(e);
        continue;
      }
      const key = reservationKey(e);
      if (seenKeys.has(key)) continue; // the same booking listed twice: keep the first
      seenKeys.add(key);
      applyReservationEvent(ctx, e);
    }

    // Bookings the feed no longer lists.
    for (const row of core.db.all<ChannelEventRow>("SELECT * FROM channel_events WHERE connection_id = ? AND kind = 'reservation'", [conn.id])) {
      if (ctx.touchedRows.has(row.id)) continue;
      if (row.reservation_id && !ctx.seenReservations.has(row.reservation_id)) {
        const res = core.db.get<ReservationRow>("SELECT * FROM reservations WHERE id = ?", [row.reservation_id]);
        // Never cancel automatically, and a stay that has ended simply dropped out of the feed.
        if (res && res.status !== "cancelled" && res.check_out > ctx.today && !res.missing_since && res.connection_id === conn.id) {
          markReservationMissing(core, res.id);
          ctx.stats.missing++;
        }
      }
      core.db.run("DELETE FROM channel_events WHERE id = ?", [row.id]);
      ctx.changed = true;
    }

    replaceBlocks(ctx, blocks);
    core.db.run("DELETE FROM channel_push_acks WHERE connection_id = ? AND end_date < ?", [conn.id, ctx.today]);
    return { rejected: false, changed: ctx.changed, ...ctx.stats };
  });
}

// ── Resolving held events ──────────────────────────────────────────────────

function feedEventFromRow(row: ChannelEventRow): FeedEvent {
  return {
    uid: row.external_uid,
    kind: row.kind,
    confirmationCode: row.confirmation_code,
    start: row.start_date,
    endExclusive: row.end_date,
    summary: row.summary,
  };
}

/** Act on a held booking. Returns the connection id (for the detail view). */
export function resolveEvent(core: Core, eventId: string, action: ChannelEventAction): string {
  const row = core.db.get<ChannelEventRow>("SELECT * FROM channel_events WHERE id = ?", [eventId]);
  if (!row) throw notFound();
  const conn = getConnectionRow(core, row.connection_id);
  if (row.kind !== "reservation") throw new AppError("NOT_ALLOWED", "errors.channels.eventNotPending");

  core.db.tx(() => {
    if (action === "dismiss") {
      if (row.state === "applied") throw new AppError("NOT_ALLOWED", "errors.channels.eventNotPending");
      core.db.run("UPDATE channel_events SET state = 'dismissed' WHERE id = ?", [row.id]);
      return;
    }
    const e = feedEventFromRow(row);
    if (action === "replace") {
      const res = row.reservation_id ? core.db.get<ReservationRow>("SELECT * FROM reservations WHERE id = ?", [row.reservation_id]) : undefined;
      const spaceId = res && res.status !== "cancelled" ? res.space_id : conn.space_id;
      const [first, last] = stayRange(e.start, e.endExclusive);
      const clashes = findConflicts(core, spaceId, first, last, { excludeReservationId: res?.id ?? null }).map((c) => conflictInfo(core, c));
      if (clashes.some((c) => !c.replaceable)) throw new AppError("NOT_ALLOWED", "errors.channels.notReplaceable");
      const reason = e.confirmationCode
        ? t("errors.channels.replacedBy", { channel: channelLabel(conn.channel), code: e.confirmationCode })
        : t("errors.channels.replacedByNoCode", { channel: channelLabel(conn.channel) });
      const now = core.nowIso();
      for (const c of clashes) {
        if (c.kind === "block") {
          core.db.run("UPDATE availability_blocks SET cancelled_at = ?, updated_at = ? WHERE id = ? AND cancelled_at IS NULL", [now, now, c.id]);
        } else if (c.kind === "reservation") {
          cancelReservation(core, c.id, reason, "manual");
        }
      }
    }
    const ctx = newCtx(core, conn);
    const state = applyReservationEvent(ctx, e, true);
    if (action === "replace" && state !== "applied") throw new AppError("NOT_ALLOWED", "errors.channels.notReplaceable");
  });
  return conn.id;
}

// ── One sync run ───────────────────────────────────────────────────────────

export interface SyncOptions {
  /** The workspace to apply to, re-read after the fetch; null = don't apply (sample workspace, quitting). */
  getCore: () => Core | null;
  secrets: ChannelSecretStore;
  fetcher: FeedFetcher;
  connectionId: string;
  trigger: ChannelSyncTrigger;
  acceptShrink: boolean;
}

export interface SyncOutcome {
  runId: string | null;
  outcome: "ok" | "failed" | "rejected" | "skipped";
  errorCode: ChannelErrorCode | null;
  errorDetail: string;
  diagnostic: string | null;
  changed: boolean;
}

const SKIPPED: SyncOutcome = { runId: null, outcome: "skipped", errorCode: null, errorDetail: "", diagnostic: null, changed: false };

function insertRun(core: Core, runId: string, connectionId: string, trigger: ChannelSyncTrigger, startedAt: string) {
  core.db.run("INSERT INTO channel_sync_runs (id, connection_id, trigger, started_at) VALUES (?, ?, ?, ?)", [runId, connectionId, trigger, startedAt]);
}

function finishRun(
  core: Core,
  run: { id: string; connectionId: string; trigger: ChannelSyncTrigger; startedAt: string },
  result: { outcome: "ok" | "failed" | "rejected"; code: ChannelErrorCode | null; detail: string; diagnostic: string | null; eventsSeen: number; stats: ReconcileStats },
) {
  const now = core.nowIso();
  core.db.tx(() => {
    if (!core.db.get("SELECT 1 FROM channel_sync_runs WHERE id = ?", [run.id])) insertRun(core, run.id, run.connectionId, run.trigger, run.startedAt);
    core.db.run(
      `UPDATE channel_sync_runs SET finished_at = ?, outcome = ?, error_code = ?, diagnostic = ?, events_seen = ?, created_count = ?, updated_count = ?, missing_count = ?, conflict_count = ?
       WHERE id = ?`,
      [now, result.outcome, result.code, result.diagnostic, result.eventsSeen, result.stats.created, result.stats.updated, result.stats.missing, result.stats.conflicts, run.id],
    );
    if (result.outcome === "ok") {
      core.db.run(
        "UPDATE channel_connections SET last_attempt_at = ?, last_success_at = ?, last_error_code = NULL, last_error_detail = '', last_error_at = NULL WHERE id = ?",
        [now, now, run.connectionId],
      );
    } else {
      core.db.run("UPDATE channel_connections SET last_attempt_at = ?, last_error_code = ?, last_error_detail = ?, last_error_at = ? WHERE id = ?", [
        now,
        result.code,
        result.detail.slice(0, 40),
        now,
        run.connectionId,
      ]);
    }
    core.db.run(
      `DELETE FROM channel_sync_runs WHERE connection_id = ? AND id NOT IN (
         SELECT id FROM channel_sync_runs WHERE connection_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ${RUNS_KEPT})`,
      [run.connectionId, run.connectionId],
    );
  });
}

function asSyncError(err: unknown, fallback: ChannelErrorCode): ChannelSyncError {
  return err instanceof ChannelSyncError ? err : new ChannelSyncError(fallback);
}

/**
 * Read one connection's feed and apply it. The fetch happens outside any
 * transaction; the workspace is looked up again afterwards, and nothing is
 * applied if the connection is no longer there (workspace switched or a
 * backup restored meanwhile).
 */
export async function syncConnection(opts: SyncOptions): Promise<SyncOutcome> {
  const core = opts.getCore();
  if (!core) return SKIPPED;
  const conn = findConnectionRow(core, opts.connectionId);
  if (!conn || conn.status !== "active") return SKIPPED;
  const run = { id: newId(), connectionId: conn.id, trigger: opts.trigger, startedAt: core.nowIso() };
  insertRun(core, run.id, run.connectionId, run.trigger, run.startedAt);
  const noStats: ReconcileStats = { created: 0, updated: 0, missing: 0, conflicts: 0 };

  let url: string | null = null;
  const fail = (target: Core, err: ChannelSyncError, eventsSeen = 0, diagnostic = safeSyncDiagnostic(err, url)): SyncOutcome => {
    const detail = sanitizeSyncText(err.detail, url);
    finishRun(target, run, { outcome: "failed", code: err.code, detail, diagnostic, eventsSeen, stats: noStats });
    return { runId: run.id, outcome: "failed", errorCode: err.code, errorDetail: detail, diagnostic, changed: false };
  };

  try {
    url = opts.secrets.get(conn.id);
  } catch {
    return fail(core, new ChannelSyncError("credential_store"));
  }
  if (!url) return fail(core, new ChannelSyncError("feed_link_missing"));
  const adapter = feedAdapter(conn.channel);
  if (!adapter) return fail(core, new ChannelSyncError("internal", "unsupported_channel"));

  let body: string | null = null;
  let fetchError: ChannelSyncError | null = null;
  let fetchDiagnostic: string | undefined;
  try {
    const res = await opts.fetcher.fetch(url, { timeoutMs: FEED_TIMEOUT_MS, maxBytes: FEED_MAX_BYTES });
    if (res.status < 200 || res.status >= 300) throw statusError(res.status);
    body = res.body;
  } catch (err) {
    fetchError = asSyncError(err, "offline");
    fetchDiagnostic = err instanceof ChannelSyncError && err.diagnostic ? sanitizeSyncText(err.diagnostic, url) : safeSyncDiagnostic(err, url);
    fetchError = new ChannelSyncError(fetchError.code, sanitizeSyncText(fetchError.detail, url));
  }
  const after = opts.getCore();
  if (!after || !findConnectionRow(after, conn.id)) return SKIPPED;
  if (fetchError || body === null) return fail(after, fetchError ?? new ChannelSyncError("internal"), 0, fetchDiagnostic);

  let snapshot: FeedSnapshot;
  try {
    snapshot = adapter.parse(body);
  } catch (err) {
    return fail(after, asSyncError(err, "not_a_calendar"), 0, safeSyncDiagnostic(err, url));
  }

  let result: ReconcileResult;
  try {
    result = reconcileSnapshot(after, conn.id, snapshot, { acceptShrink: opts.acceptShrink });
  } catch (err) {
    return fail(after, asSyncError(err, "internal"), snapshot.events.length, safeSyncDiagnostic(err, url));
  }
  if (result.rejected) {
    finishRun(after, run, { outcome: "rejected", code: "feed_shrank", detail: "", diagnostic: null, eventsSeen: snapshot.events.length, stats: noStats });
    return { runId: run.id, outcome: "rejected", errorCode: "feed_shrank", errorDetail: "", diagnostic: null, changed: false };
  }
  finishRun(after, run, { outcome: "ok", code: null, detail: "", diagnostic: null, eventsSeen: snapshot.events.length, stats: result });
  return { runId: run.id, outcome: "ok", errorCode: null, errorDetail: "", diagnostic: null, changed: result.changed };
}

/** For tests and diagnostics. */
export function reservationForEvent(core: Core, eventId: string): ReservationRow | null {
  const row = core.db.get<ChannelEventRow>("SELECT * FROM channel_events WHERE id = ?", [eventId]);
  return row?.reservation_id ? getReservationRow(core, row.reservation_id) : null;
}
