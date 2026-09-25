import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { closeCore, DB_FILE } from "../core/context";
import { Db } from "../core/db";
import { AppError } from "../core/errors";
import { MIGRATIONS, SCHEMA_VERSION } from "../core/schema";
import { findConflicts } from "../core/services/availability";
import { cancelReservation, changeReservationDates, createReservation, insertReservation } from "../core/services/reservations";
import { createTenancy } from "../core/services/tenancies";
import { FIXED_NOW, makeCore, newTenant, seedProperty, tempDir } from "./helpers";

const tenancy = (spaceId: string, startDate: string, endDate: string | null) => ({
  tenantId: null,
  newTenant: newTenant("Tenant"),
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

function block(core: ReturnType<typeof makeCore>, spaceId: string, start: string, end: string) {
  const property = core.db.get<{ property_id: string }>("SELECT property_id FROM spaces WHERE id = ?", [spaceId])!.property_id;
  core.db.run(
    `INSERT INTO availability_blocks (id, space_id, property_id, start_date, end_date, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'maintenance', ?, ?)`,
    [crypto.randomUUID(), spaceId, property, start, end, FIXED_NOW.toISOString(), FIXED_NOW.toISOString()],
  );
}

function rejectsOverlap(fn: () => unknown) {
  assert.throws(fn, (err: unknown) => (err instanceof AppError && err.code === "CONFLICT") || String(err).includes("HAVENOS:OVERLAP"));
}

describe("schema 2 upgrade keeps existing records", () => {
  it("migrates a version-1 database with reservations and attachments", () => {
    const dir = tempDir();
    // Build a version-1 database by hand, the way an older HavenOS left it.
    const v1 = new Db(path.join(dir, DB_FILE));
    v1.exec(MIGRATIONS[0].sql);
    v1.exec("PRAGMA user_version = 1");
    const now = FIXED_NOW.toISOString();
    v1.run("INSERT INTO properties (id, name, property_type, address_line1, postcode, city, state, created_at, updated_at) VALUES ('p1', 'Old Place', 'condominium', '1 Jalan', '50450', 'KL', 'KUL', ?, ?)", [now, now]);
    v1.run("INSERT INTO spaces (id, property_id, kind, unit_id, label, rental_mode, created_at, updated_at) VALUES ('u1', 'p1', 'unit', 'u1', 'A-1', 'whole_unit', ?, ?)", [now, now]);
    v1.run(
      `INSERT INTO reservations (id, space_id, property_id, guest_name, check_in, check_out, status, channel, total_sen, created_at, updated_at)
       VALUES ('r1', 'u1', 'p1', 'Guest One', '2026-10-01', '2026-10-04', 'confirmed', 'direct', 45000, ?, ?),
              ('r2', 'u1', 'p1', 'Guest Two', '2026-11-01', '2026-11-03', 'cancelled', 'direct', NULL, ?, ?)`,
      [now, now, now, now],
    );
    v1.run(
      `INSERT INTO attachments (id, property_id, purpose, file_name, stored_name, mime_type, size_bytes, sha256, created_at)
       VALUES ('a1', 'p1', 'photo', 'front.jpg', 'x.jpg', 'image/jpeg', 10, 'abc', ?)`,
      [now],
    );
    v1.close();

    const core = makeCore(dir);
    assert.equal(core.db.get<{ user_version: number }>("PRAGMA user_version")?.user_version, SCHEMA_VERSION);
    const r1 = core.db.get<{ guest_name: string; source: string; cancelled_at: string | null }>("SELECT guest_name, source, cancelled_at FROM reservations WHERE id = 'r1'");
    assert.deepEqual({ ...r1 }, { guest_name: "Guest One", source: "manual", cancelled_at: null });
    const r2 = core.db.get<{ status: string; cancelled_at: string | null }>("SELECT status, cancelled_at FROM reservations WHERE id = 'r2'");
    assert.equal(r2?.status, "cancelled");
    assert.ok(r2?.cancelled_at, "a cancelled reservation gets a cancellation time");
    // The old total becomes an entered booking value on the ledger.
    const ledger = core.db.all<{ kind: string; amount_sen: number; source: string; reservation_id: string }>("SELECT kind, amount_sen, source, reservation_id FROM stay_ledger");
    assert.deepEqual(ledger.map((r) => ({ ...r })), [{ kind: "booking_value", amount_sen: 45000, source: "entered", reservation_id: "r1" }]);
    assert.equal(core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM attachments")?.n, 1);
    assert.equal(core.db.all("PRAGMA foreign_key_check").length, 0);
    assert.ok(fs.readdirSync(path.join(dir, "backups")).some((f) => f.startsWith("pre-upgrade-v1")), "a pre-upgrade copy is kept");
    // Overlap rules still hold after the rebuild.
    rejectsOverlap(() => createTenancy(core, tenancy("u1", "2026-10-02", "2026-12-31")));
    closeCore(core);
  });
});

describe("schema 3 sync diagnostics", () => {
  it("upgrades a schema-2 database without changing existing connection or sync history", () => {
    const dir = tempDir();
    const old = new Db(path.join(dir, DB_FILE));
    old.exec(MIGRATIONS[0].sql);
    old.exec(MIGRATIONS[1].sql);
    old.exec("PRAGMA user_version = 2");
    const now = FIXED_NOW.toISOString();
    old.run("INSERT INTO properties (id, name, property_type, address_line1, postcode, city, state, created_at, updated_at) VALUES ('p1', 'Old Place', 'condominium', '1 Jalan', '50450', 'KL', 'KUL', ?, ?)", [now, now]);
    old.run("INSERT INTO spaces (id, property_id, kind, unit_id, label, rental_mode, created_at, updated_at) VALUES ('u1', 'p1', 'unit', 'u1', 'A-1', 'whole_unit', ?, ?)", [now, now]);
    old.run("INSERT INTO channel_connections (id, channel, method, name, space_id, property_id, created_at, updated_at) VALUES ('c1', 'airbnb', 'ical', 'Calendar', 'u1', 'p1', ?, ?)", [now, now]);
    old.run("INSERT INTO channel_sync_runs (id, connection_id, trigger, started_at, outcome, error_code) VALUES ('sync1', 'c1', 'manual', ?, 'failed', 'internal')", [now]);
    old.close();
    const core = makeCore(dir);
    const row = core.db.get<{ id: string; outcome: string; error_code: string; diagnostic: string | null }>("SELECT id, outcome, error_code, diagnostic FROM channel_sync_runs");
    assert.deepEqual({ ...row }, { id: "sync1", outcome: "failed", error_code: "internal", diagnostic: null });
    assert.equal(core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM channel_connections")!.n, 1);
    assert.equal(core.db.get<{ user_version: number }>("PRAGMA user_version")!.user_version, SCHEMA_VERSION);
    assert.deepEqual(core.db.all("PRAGMA foreign_key_check"), []);
    assert.ok(fs.readdirSync(path.join(dir, "backups")).some((f) => f.startsWith("pre-upgrade-v2")));
    closeCore(core);
  });
});

describe("availability blocks share the overlap rule", () => {
  it("a block rejects tenancies and reservations across the space tree, and the reverse", () => {
    const core = makeCore();
    const p = seedProperty(core);
    block(core, p.roomA, "2026-10-10", "2026-10-12");
    // A tenancy on the unit that contains the blocked room.
    rejectsOverlap(() => createTenancy(core, tenancy(p.unitA1, "2026-10-01", null)));
    // A stay whose last night is the block's first night.
    rejectsOverlap(() => createReservation(core, { spaceId: p.roomA, guestName: "G", checkIn: "2026-10-08", checkOut: "2026-10-11", status: "confirmed", channel: "direct", channelReservationId: null, totalSen: null, notes: "" }));
    // Checking out on the block's first day is fine; so is a sibling room.
    createReservation(core, { spaceId: p.roomA, guestName: "G", checkIn: "2026-10-08", checkOut: "2026-10-10", status: "confirmed", channel: "direct", channelReservationId: null, totalSen: null, notes: "" });
    createReservation(core, { spaceId: p.roomB, guestName: "G", checkIn: "2026-10-10", checkOut: "2026-10-12", status: "confirmed", channel: "direct", channelReservationId: null, totalSen: null, notes: "" });
    // A block over an existing reservation is rejected by the database itself.
    rejectsOverlap(() => block(core, p.unitA1, "2026-10-09", "2026-10-09"));
    closeCore(core);
  });

  it("findConflicts lists every clash with ids, in date order", () => {
    const core = makeCore();
    const p = seedProperty(core);
    createTenancy(core, tenancy(p.roomA, "2026-10-01", "2026-10-31"));
    block(core, p.roomB, "2026-10-05", "2026-10-06");
    const conflicts = findConflicts(core, p.unitA1, "2026-10-01", "2026-10-10");
    assert.deepEqual(conflicts.map((c) => [c.kind, c.start]), [["tenancy", "2026-10-01"], ["block", "2026-10-05"]]);
    assert.ok(conflicts.every((c) => c.id));
    closeCore(core);
  });
});

describe("reservation writes keep history", () => {
  it("records creation, date changes and cancellation without deleting the row", () => {
    const core = makeCore();
    const p = seedProperty(core);
    const id = insertReservation(core, {
      spaceId: p.unitA2, guestName: "", guestCount: null, checkIn: "2026-10-01", checkOut: "2026-10-03", checkInTime: null, checkOutTime: null,
      status: "confirmed", channel: "airbnb", channelReservationId: "HMTEST0001", connectionId: null, source: "feed", notes: "",
    });
    changeReservationDates(core, id, { checkIn: "2026-10-02", checkOut: "2026-10-05" }, "feed");
    cancelReservation(core, id, "Cancelled on Airbnb", "manual");
    const events = core.db.all<{ kind: string; source: string }>("SELECT kind, source FROM reservation_events WHERE reservation_id = ? ORDER BY rowid", [id]);
    assert.deepEqual(events.map((e) => ({ ...e })), [
      { kind: "created", source: "feed" },
      { kind: "dates_changed", source: "feed" },
      { kind: "cancelled", source: "manual" },
    ]);
    const row = core.db.get<{ status: string; check_in: string }>("SELECT status, check_in FROM reservations WHERE id = ?", [id]);
    assert.deepEqual({ ...row }, { status: "cancelled", check_in: "2026-10-02" });
    closeCore(core);
  });
});
