import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createConnection, getConnection, getConnectionDetail, listConnections, removeConnection, updateConnection } from "../core/channels/connections";
import { acknowledgeBlock, pendingBlocks } from "../core/channels/pending";
import { ChannelScheduler } from "../core/channels/scheduler";
import { resolveEvent, syncConnection } from "../core/channels/sync";
import { closeCore, DB_FILE, type Core } from "../core/context";
import { AppError } from "../core/errors";
import { ChannelSyncError, MemorySecretStore, type FeedFetcher } from "../core/integrations/channels";
import { createReservation } from "../core/services/reservations";
import { createTenancy } from "../core/services/tenancies";
import { clock, FIXED_NOW, makeCore, newTenant, seedProperty, tempDir } from "./helpers";

const fixture = (...p: string[]) => fs.readFileSync(path.resolve(process.cwd(), "desktop/tests/fixtures", ...p), "utf8");
const V1 = fixture("airbnb", "listing-a-v1.ics");
const V2 = fixture("airbnb", "listing-a-v2.ics");
const EMPTY = fixture("airbnb", "listing-a-empty.ics");
const SECRET = "0123456789abcdef0123456789abcdef";
const URL_A = `https://www.airbnb.com/calendar/ical/900000000000000001.ics?s=${SECRET}`;

class FakeFetcher implements FeedFetcher {
  body = V1;
  error: ChannelSyncError | null = null;
  calls = 0;
  gate: Promise<void> | null = null;
  async fetch(_url: string) {
    this.calls++;
    if (this.gate) await this.gate;
    if (this.error) throw this.error;
    return { status: 200, body: this.body };
  }
}

function setup(now: () => Date = () => FIXED_NOW) {
  const dir = tempDir();
  const core = makeCore(dir, now);
  const p = seedProperty(core);
  const secrets = new MemorySecretStore();
  const fetcher = new FakeFetcher();
  const control = { secrets, running: () => [] as string[], nextSyncAt: () => null };
  const connect = (spaceId = p.unitA2, url = URL_A) =>
    createConnection(core, secrets, { channel: "airbnb", name: "Listing A", spaceId, feedUrl: url, checkInTime: "15:00", checkOutTime: "11:00" });
  const sync = (id: string, acceptShrink = false) => syncConnection({ getCore: () => core, secrets, fetcher, connectionId: id, trigger: "manual", acceptShrink });
  return { dir, core, p, secrets, fetcher, control, connect, sync };
}

type Row = Record<string, unknown>;
const plain = (rows: Row[]) => rows.map((r) => ({ ...r }));

function reservations(core: Core) {
  return plain(
    core.db.all<Row>(
      "SELECT channel_reservation_id AS code, check_in, check_out, status, source, guest_name, missing_since IS NOT NULL AS missing FROM reservations ORDER BY check_in",
    ),
  );
}

const historyCount = (core: Core) => core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM reservation_events")!.n;
const count = (core: Core, sql: string, params: string[] = []) => core.db.get<{ n: number }>(sql, params)!.n;

const tenancy = (spaceId: string, startDate: string, endDate: string | null) => ({
  tenantId: null,
  newTenant: newTenant("Tenant T"),
  spaceId,
  startDate,
  endDate,
  monthlyRentSen: 100000,
  rentDueDay: 7,
  rentStartMonth: startDate.slice(0, 7),
  securityDepositSen: 0,
  utilityDepositSen: 0,
  terms: "",
  stagingKey: null,
});

function addBlock(core: Core, spaceId: string, start: string, end: string): string {
  const property = core.db.get<{ property_id: string }>("SELECT property_id FROM spaces WHERE id = ?", [spaceId])!.property_id;
  const id = crypto.randomUUID();
  core.db.run(
    "INSERT INTO availability_blocks (id, space_id, property_id, start_date, end_date, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'maintenance', ?, ?)",
    [id, spaceId, property, start, end, FIXED_NOW.toISOString(), FIXED_NOW.toISOString()],
  );
  return id;
}

function errorKey(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (err) {
    assert.ok(err instanceof AppError, String(err));
    return err.messageKey ?? err.code;
  }
}

describe("channel connections", () => {
  it("keeps the feed link out of the database, and rejects duplicates and unlettable spaces", () => {
    const { core, p, secrets, connect, control } = setup();
    const id = connect();
    assert.equal(secrets.get(id), URL_A);
    const row = core.db.get<Row>("SELECT * FROM channel_connections WHERE id = ?", [id])!;
    assert.ok(!JSON.stringify(row).includes(SECRET));
    assert.equal(row.external_listing_id, "900000000000000001");

    assert.equal(errorKey(() => connect(p.roomA)), "errors.channels.duplicateFeed");
    assert.equal(errorKey(() => connect(p.roomA, "https://www.airbnb.com/calendar/ical/900000000000000001.ics?s=other")), "errors.channels.duplicateListing");
    assert.equal(errorKey(() => connect(p.unitA2, "https://www.airbnb.com/calendar/ical/5555.ics?s=x")), "errors.channels.spaceTaken");
    // A-1 is let by room, so the unit as a whole isn't lettable.
    assert.equal(errorKey(() => connect(p.unitA1, "https://www.airbnb.com/calendar/ical/6666.ics?s=x")), "errors.channels.notLettable");
    assert.equal(errorKey(() => connect(p.roomA, "https://example.com/calendar.ics")), "errors.channels.feedUrlWrongChannel");

    const view = getConnection(core, control, id);
    assert.equal(view.feedLinkHint, "airbnb.com · listing …0001");
    assert.equal(view.health, "never_synced");
    assert.ok(!JSON.stringify(view).includes(SECRET));

    removeConnection(core, secrets, id);
    assert.equal(secrets.get(id), null);
    assert.deepEqual(listConnections(core, control), []);
    connect(); // the same link can be connected again after removal
    closeCore(core);
  });

  it("moves upcoming bookings when the connection is re-mapped to another space", async () => {
    const { core, p, secrets, connect, sync } = setup();
    const id = connect(p.roomA);
    await sync(id);
    updateConnection(core, secrets, { id, name: "Listing A", spaceId: p.roomB, feedUrl: null, checkInTime: "14:00", checkOutTime: "12:00", turnoverChecklist: ["Sweep"] });
    const spaces = plain(core.db.all<Row>("SELECT channel_reservation_id AS code, space_id FROM reservations ORDER BY check_in"));
    assert.deepEqual(spaces.map((r) => r.space_id), [p.roomA, p.roomB, p.roomB], "the past stay stays where it happened");
    assert.equal(secrets.get(id), URL_A, "a null feedUrl keeps the link");
    closeCore(core);
  });
});

describe("calendar sync", () => {
  it("first import creates feed reservations (with history) and informational blocks", async () => {
    const { core, connect, sync, control } = setup();
    const id = connect();
    const out = await sync(id);
    assert.equal(out.outcome, "ok");
    assert.ok(out.changed);
    assert.deepEqual(reservations(core), [
      { code: "HMZX4K2P9Q", check_in: "2026-09-18", check_out: "2026-09-21", status: "confirmed", source: "feed", guest_name: "", missing: 0 },
      { code: "HMB7T2QW4N", check_in: "2026-10-02", check_out: "2026-10-05", status: "confirmed", source: "feed", guest_name: "", missing: 0 },
      { code: "HMC9V5XK2R", check_in: "2026-10-23", check_out: "2026-10-26", status: "confirmed", source: "feed", guest_name: "", missing: 0 },
    ]);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM channel_events WHERE kind = 'block'"), 2);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM availability_blocks"), 0, "channel blocks never become HavenOS blocks");
    assert.deepEqual({ ...core.db.get<Row>("SELECT outcome, events_seen, created_count FROM channel_sync_runs")! }, { outcome: "ok", events_seen: 5, created_count: 3 });
    assert.deepEqual(plain(core.db.all<Row>("SELECT DISTINCT kind, source FROM reservation_events")), [{ kind: "created", source: "feed" }]);
    const view = getConnection(core, control, id);
    assert.equal(view.health, "ok");
    assert.equal(view.counts.upcoming, 2);
    assert.equal(view.lastError, null);
    closeCore(core);
  });

  it("re-syncing the same feed creates nothing and records no history", async () => {
    const { core, connect, sync } = setup();
    const id = connect();
    await sync(id);
    const events = () => plain(core.db.all<Row>("SELECT id, external_uid, state, start_date FROM channel_events ORDER BY id"));
    const before = { res: reservations(core), history: historyCount(core), events: events() };
    const out = await sync(id);
    assert.equal(out.outcome, "ok");
    assert.equal(out.changed, false);
    assert.deepEqual(reservations(core), before.res);
    assert.equal(historyCount(core), before.history);
    assert.deepEqual(events(), before.events);
    closeCore(core);
  });

  it("v1 → v2: date change matched by code despite a new UID, new booking, vanished booking flagged missing (not cancelled), blocks replaced", async () => {
    const { core, connect, sync, fetcher, control } = setup();
    const id = connect();
    await sync(id);
    const r2 = core.db.get<{ id: string }>("SELECT id FROM reservations WHERE channel_reservation_id = 'HMB7T2QW4N'")!.id;
    fetcher.body = V2;
    const out = await sync(id);
    assert.equal(out.outcome, "ok");
    assert.deepEqual(reservations(core), [
      { code: "HMZX4K2P9Q", check_in: "2026-09-18", check_out: "2026-09-21", status: "confirmed", source: "feed", guest_name: "", missing: 0 },
      { code: "HMB7T2QW4N", check_in: "2026-10-03", check_out: "2026-10-07", status: "confirmed", source: "feed", guest_name: "", missing: 0 },
      { code: "HMD3L8PY6J", check_in: "2026-10-09", check_out: "2026-10-12", status: "confirmed", source: "feed", guest_name: "", missing: 0 },
      { code: "HMC9V5XK2R", check_in: "2026-10-23", check_out: "2026-10-26", status: "confirmed", source: "feed", guest_name: "", missing: 1 },
    ]);
    // The moved booking kept its row and gained a history entry; its event row took the new UID.
    assert.deepEqual(plain(core.db.all<Row>("SELECT kind FROM reservation_events WHERE reservation_id = ? ORDER BY rowid", [r2])), [{ kind: "created" }, { kind: "dates_changed" }]);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM channel_events WHERE confirmation_code = 'HMB7T2QW4N'"), 1);
    assert.equal(
      core.db.get<{ u: string }>("SELECT external_uid AS u FROM channel_events WHERE confirmation_code = 'HMB7T2QW4N'")!.u,
      "1418fb94e984-e98009cb3aab6940b7e5bb25d86044e3@airbnb.com",
    );
    assert.deepEqual(plain(core.db.all<Row>("SELECT start_date, end_date FROM channel_events WHERE kind = 'block'")), [{ start_date: "2027-03-28", end_date: "2027-09-28" }]);
    const run = core.db.get<Row>("SELECT created_count, updated_count, missing_count FROM channel_sync_runs ORDER BY rowid DESC LIMIT 1")!;
    assert.deepEqual({ ...run }, { created_count: 1, updated_count: 1, missing_count: 1 });
    const detail = getConnectionDetail(core, control, id);
    assert.deepEqual(detail.missingReservations.map((r) => [r.channelReservationId, r.datesLocked, r.nights]), [["HMC9V5XK2R", true, 3]]);
    assert.equal(detail.counts.missing, 1);

    // It reappears → no longer missing, with a history entry.
    fetcher.body = V1.replace("END:VCALENDAR", V2.slice(V2.indexOf("BEGIN:VEVENT\r\nDTEND;VALUE=DATE:20261012"), V2.indexOf("BEGIN:VEVENT\r\nDTEND;VALUE=DATE:20270928")) + "END:VCALENDAR");
    await sync(id);
    const r3 = core.db.get<{ id: string; missing_since: string | null }>("SELECT id, missing_since FROM reservations WHERE channel_reservation_id = 'HMC9V5XK2R'")!;
    assert.equal(r3.missing_since, null);
    assert.ok(core.db.get("SELECT 1 FROM reservation_events WHERE reservation_id = ? AND kind = 'reappeared'", [r3.id]));
    closeCore(core);
  });

  it("never flags a stay that has already ended", async () => {
    const c = clock();
    const { core, connect, sync, fetcher } = setup(c.now);
    const id = connect();
    await sync(id);
    // Drop only the past stay (R1) from the feed.
    fetcher.body = V1.replace(/BEGIN:VEVENT\r\nDTEND;VALUE=DATE:20260921[\s\S]*?END:VEVENT\r\n/, "");
    c.advanceDays(1);
    await sync(id);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations WHERE missing_since IS NOT NULL"), 0);
    closeCore(core);
  });

  it("holds a booking that clashes with a tenancy as a conflict and inserts nothing", async () => {
    const { core, p, connect, sync, control } = setup();
    createTenancy(core, tenancy(p.unitA2, "2026-10-01", "2026-10-03"));
    const id = connect();
    const out = await sync(id);
    assert.equal(out.outcome, "ok");
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations WHERE channel_reservation_id = 'HMB7T2QW4N'"), 0);
    const detail = getConnectionDetail(core, control, id);
    assert.equal(detail.counts.conflicts, 1);
    assert.equal(detail.events.length, 1);
    const ev = detail.events[0];
    assert.equal(ev.confirmationCode, "HMB7T2QW4N");
    assert.equal(ev.state, "conflict");
    assert.deepEqual(ev.conflicts.map((c) => [c.kind, c.who, c.replaceable]), [["tenancy", "Tenant T", false]]);
    assert.throws(() => resolveEvent(core, ev.id, "replace"), (e: unknown) => e instanceof AppError && e.messageKey === "errors.channels.notReplaceable");
    // Dismissed stays dismissed on the next sync.
    resolveEvent(core, ev.id, "dismiss");
    await sync(id);
    assert.equal(core.db.get<{ s: string }>("SELECT state AS s FROM channel_events WHERE id = ?", [ev.id])!.s, "dismissed");
    closeCore(core);
  });

  it("a date change onto taken nights keeps the old dates and records a conflict once", async () => {
    const { core, p, connect, sync, fetcher } = setup();
    const id = connect();
    await sync(id);
    createReservation(core, { spaceId: p.unitA2, guestName: "Direct guest", checkIn: "2026-10-05", checkOut: "2026-10-07", status: "confirmed", channel: "direct", channelReservationId: null, totalSen: null, notes: "" });
    fetcher.body = V2;
    await sync(id);
    await sync(id);
    const r2 = core.db.get<{ id: string; check_in: string; check_out: string }>("SELECT id, check_in, check_out FROM reservations WHERE channel_reservation_id = 'HMB7T2QW4N'")!;
    assert.deepEqual([r2.check_in, r2.check_out], ["2026-10-02", "2026-10-05"]);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservation_events WHERE reservation_id = ? AND kind = 'conflict'", [r2.id]), 1);
    const ev = core.db.get<{ id: string; state: string }>("SELECT id, state FROM channel_events WHERE confirmation_code = 'HMB7T2QW4N'")!;
    assert.equal(ev.state, "conflict");

    // Replace: the direct booking is cancelled (not deleted) and the new dates apply.
    resolveEvent(core, ev.id, "replace");
    const direct = core.db.get<{ status: string; cancel_reason: string }>("SELECT status, cancel_reason FROM reservations WHERE channel = 'direct'")!;
    assert.deepEqual({ ...direct }, { status: "cancelled", cancel_reason: "Replaced by Airbnb booking HMB7T2QW4N" });
    assert.deepEqual(
      { ...core.db.get<Row>("SELECT check_in, check_out FROM reservations WHERE id = ?", [r2.id])! },
      { check_in: "2026-10-03", check_out: "2026-10-07" },
    );
    closeCore(core);
  });

  it("'replace' cancels a manual block and then applies the booking", async () => {
    const { core, p, connect, sync } = setup();
    const blockId = addBlock(core, p.unitA2, "2026-10-03", "2026-10-03");
    const id = connect();
    await sync(id);
    const ev = core.db.get<{ id: string; state: string }>("SELECT id, state FROM channel_events WHERE confirmation_code = 'HMB7T2QW4N'")!;
    assert.equal(ev.state, "conflict");
    resolveEvent(core, ev.id, "retry");
    assert.equal(core.db.get<{ s: string }>("SELECT state AS s FROM channel_events WHERE id = ?", [ev.id])!.s, "conflict", "retry alone can't apply it");
    resolveEvent(core, ev.id, "replace");
    assert.ok(core.db.get<{ c: string | null }>("SELECT cancelled_at AS c FROM availability_blocks WHERE id = ?", [blockId])!.c);
    assert.equal(core.db.get<{ s: string }>("SELECT state AS s FROM channel_events WHERE id = ?", [ev.id])!.s, "applied");
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations WHERE channel_reservation_id = 'HMB7T2QW4N' AND status = 'confirmed'"), 1);
    closeCore(core);
  });

  it("the shrink guard rejects an emptied feed until the landlord accepts it", async () => {
    const { core, connect, sync, fetcher, control } = setup();
    const id = connect();
    await sync(id);
    const before = reservations(core);
    fetcher.body = EMPTY;
    const out = await sync(id);
    assert.equal(out.outcome, "rejected");
    assert.equal(out.errorCode, "feed_shrank");
    assert.deepEqual(reservations(core), before, "nothing applied");
    assert.equal(getConnection(core, control, id).lastError?.code, "feed_shrank");

    const accepted = await sync(id, true);
    assert.equal(accepted.outcome, "ok");
    assert.deepEqual(
      reservations(core).map((r) => [r.code, r.status, r.missing]),
      [
        ["HMZX4K2P9Q", "confirmed", 0],
        ["HMB7T2QW4N", "confirmed", 1],
        ["HMC9V5XK2R", "confirmed", 1],
      ],
    );
    assert.equal(getConnection(core, control, id).lastError, null);
    closeCore(core);
  });

  it("a failed fetch leaves data untouched and records only an error code", async () => {
    const { core, connect, sync, fetcher, control } = setup();
    const id = connect();
    await sync(id);
    const before = { res: reservations(core), events: count(core, "SELECT COUNT(*) AS n FROM channel_events") };
    fetcher.error = new ChannelSyncError("http_error", "503");
    const out = await sync(id);
    assert.deepEqual([out.outcome, out.errorCode, out.errorDetail], ["failed", "http_error", "503"]);
    assert.deepEqual(reservations(core), before.res);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM channel_events"), before.events);
    const view = getConnection(core, control, id);
    assert.deepEqual(view.lastError && [view.lastError.code, view.lastError.detail], ["http_error", "503"]);

    fetcher.error = null;
    fetcher.body = "<html>Please log in</html>";
    assert.equal((await sync(id)).errorCode, "not_a_calendar");
    assert.deepEqual(reservations(core), before.res);
    closeCore(core);
  });

  it("the feed link never reaches the database file, run rows or errors", async () => {
    const { dir, core, connect, sync, fetcher, secrets } = setup();
    const id = connect();
    await sync(id);
    fetcher.error = new ChannelSyncError("offline");
    const out = await sync(id);
    assert.ok(!JSON.stringify(out).includes(SECRET));
    secrets.delete(id);
    const missing = await sync(id);
    assert.equal(missing.errorCode, "feed_link_missing");
    const runs = JSON.stringify(core.db.all("SELECT * FROM channel_sync_runs"));
    assert.ok(!runs.includes(SECRET) && !runs.includes("airbnb.com/calendar"));
    closeCore(core);
    for (const f of fs.readdirSync(dir).filter((n) => n.startsWith(DB_FILE))) {
      const bytes = fs.readFileSync(path.join(dir, f));
      assert.ok(!bytes.includes(SECRET), `${f} holds the secret`);
      assert.ok(!bytes.includes("calendar/ical/900000000000000001.ics"), `${f} holds the link`);
    }
  });
});

describe("pending blocks", () => {
  it("lists nights HavenOS knows are taken that the channel still shows open, and remembers acknowledgements", async () => {
    const { core, p, connect, sync } = setup();
    const id = connect(p.roomA);
    await sync(id);
    createTenancy(core, tenancy(p.roomA, "2026-11-01", "2026-11-30"));
    // Bed 1 is in room C, which doesn't overlap room A.
    const elsewhere = addBlock(core, p.bed1, "2026-10-15", "2026-10-16");
    // 10 Oct is already "Airbnb (Not available)" (B1 covers 9–10 Oct), so only 11–12 Oct is pending.
    const blockId = addBlock(core, p.roomA, "2026-10-10", "2026-10-12");
    createReservation(core, { spaceId: p.roomA, guestName: "Direct guest", checkIn: "2026-10-05", checkOut: "2026-10-08", status: "confirmed", channel: "direct", channelReservationId: null, totalSen: null, notes: "" });
    let blocks = pendingBlocks(core, id);
    assert.deepEqual(
      blocks.map((b) => [b.start, b.end, b.reasons.map((r) => r.kind), b.acknowledgedAt]),
      [
        ["2026-10-05", "2026-10-07", ["reservation"], null],
        ["2026-10-11", "2026-10-12", ["block"], null],
        ["2026-11-01", "2026-11-30", ["tenancy"], null],
      ],
    );
    assert.equal(blocks[0].reasons[0].label, "Direct guest");
    assert.equal(blocks[1].reasons[0].href, `/stays/?tab=calendar&block=${blockId}`);
    assert.equal(blocks[2].reasons[0].label, "Tenant T");
    assert.match(blocks[2].reasons[0].href, /^\/tenancies\/view\/\?id=/);
    assert.ok(!blocks.some((b) => b.reasons.some((r) => r.href.includes(elsewhere))));

    acknowledgeBlock(core, id, "2026-11-01", "2026-11-30", true);
    blocks = pendingBlocks(core, null);
    assert.ok(blocks[2].acknowledgedAt);
    assert.equal(getConnection(core, { secrets: new MemorySecretStore(), running: () => [], nextSyncAt: () => null }, id).counts.pendingBlocks, 2);
    acknowledgeBlock(core, id, "2026-11-01", "2026-11-30", false);
    assert.equal(pendingBlocks(core, id)[2].acknowledgedAt, null);
    closeCore(core);
  });

  it("covers overlapping spaces and open-ended tenancies up to the horizon", () => {
    const { core, p, connect } = setup();
    const id = connect(p.roomA);
    // A block on the whole unit takes room A too.
    addBlock(core, p.unitA1, "2026-10-20", "2026-10-21");
    createTenancy(core, tenancy(p.roomA, "2026-12-01", null));
    const blocks = pendingBlocks(core, id);
    assert.deepEqual(blocks.map((b) => [b.start, b.end, b.reasons[0].kind]), [
      ["2026-10-20", "2026-10-21", "block"],
      ["2026-12-01", "2027-09-22", "tenancy"],
    ]);
    closeCore(core);
  });
});

describe("scheduler", () => {
  const workspaces = (core: Core, ws = "main") => ({ current: core, workspace: ws });

  it("syncs active connections, joins a running sync, and emits events", async () => {
    const { core, connect, fetcher, secrets } = setup();
    const id = connect();
    const events: [string, unknown][] = [];
    const s = new ChannelScheduler({ workspaces: workspaces(core), secrets, fetcher, emit: (e, payload) => events.push([e, payload]), log: () => undefined });
    let release!: () => void;
    fetcher.gate = new Promise((r) => (release = r));
    const a = s.syncNow({ connectionId: id, trigger: "manual", acceptShrink: false });
    const b = s.syncNow({ connectionId: null, trigger: "manual", acceptShrink: false });
    assert.deepEqual(s.running(), [id]);
    release();
    await Promise.all([a, b]);
    assert.equal(fetcher.calls, 1, "the second request joined the first");
    assert.deepEqual(s.running(), []);
    assert.deepEqual(events[0], ["channel-sync", { running: [id] }]);
    assert.ok(events.some(([e, payload]) => e === "data-changed" && (payload as { reason: string }).reason === "channel-sync"));
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations"), 3);
    closeCore(core);
  });

  it("does nothing outside the main workspace, and skips applying if the workspace changed during the fetch", async () => {
    const { core, connect, fetcher, secrets } = setup();
    const id = connect();
    const s = new ChannelScheduler({ workspaces: workspaces(core, "sample"), secrets, fetcher, emit: () => undefined, log: () => undefined });
    await s.syncNow({ connectionId: null, trigger: "manual", acceptShrink: false });
    assert.equal(fetcher.calls, 0);

    const other = makeCore();
    const ws = { current: core, workspace: "main" };
    const s2 = new ChannelScheduler({ workspaces: ws, secrets, fetcher, emit: () => undefined, log: () => undefined });
    let release!: () => void;
    fetcher.gate = new Promise((r) => (release = r));
    const done = s2.syncNow({ connectionId: id, trigger: "manual", acceptShrink: false });
    ws.current = other; // e.g. a backup was restored meanwhile
    release();
    await done;
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations"), 0);
    assert.equal(count(other, "SELECT COUNT(*) AS n FROM reservations"), 0);
    closeCore(core);
    closeCore(other);
  });

  it("backs off timer syncs after a 429 but still honours manual refresh", async () => {
    const { core, connect, fetcher, secrets } = setup();
    const id = connect();
    const s = new ChannelScheduler({ workspaces: workspaces(core), secrets, fetcher, emit: () => undefined, log: () => undefined, now: () => FIXED_NOW, random: () => 0.5 });
    fetcher.error = new ChannelSyncError("rate_limited", "429");
    await s.syncOne(id, "timer", false, true);
    assert.equal(fetcher.calls, 1);
    assert.equal(await s.syncOne(id, "timer", false, true), null, "timer sync skipped while backing off");
    assert.equal(fetcher.calls, 1);
    fetcher.error = null;
    await s.syncNow({ connectionId: id, trigger: "manual", acceptShrink: false });
    assert.equal(fetcher.calls, 2);
    closeCore(core);
  });

  it("start() runs a launch sync and keeps the timer going after errors; stop() ends it", async () => {
    const { core, connect, fetcher, secrets } = setup();
    connect();
    fetcher.error = new ChannelSyncError("offline");
    const logs: string[] = [];
    const s = new ChannelScheduler({ workspaces: workspaces(core), secrets, fetcher, emit: () => undefined, log: (l) => logs.push(l), launchDelayMs: 1, intervalMs: 5, jitterMs: 1 });
    s.start();
    assert.ok(s.nextSyncAt());
    await new Promise((r) => setTimeout(r, 60));
    s.stop();
    assert.ok(fetcher.calls >= 2, `ran ${fetcher.calls} times`);
    assert.equal(s.nextSyncAt(), null);
    assert.ok(logs.every((l) => !l.includes(SECRET) && /channel sync [\w-]+: offline/.test(l)));
    const runs = core.db.all<{ trigger: string }>("SELECT trigger FROM channel_sync_runs ORDER BY rowid");
    assert.equal(runs[0].trigger, "launch");
    assert.equal(runs[1].trigger, "timer");
    closeCore(core);
  });
});
