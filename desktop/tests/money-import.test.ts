import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { AppError } from "../core/errors";
import type { HandlerContext } from "../core/handler-utils";
import { moneyHandlers } from "../core/handlers-money";
import { ImportSessions, IMPORT_TTL_MS } from "../core/imports/import-session";
import { performanceReport } from "../core/services/performance";
import { createReservation, insertReservation } from "../core/services/reservations";
import { makeCore, seedProperty, tempDir } from "./helpers";

const FIXTURES = path.resolve(process.cwd(), "desktop/tests/fixtures/airbnb");
const TRANSACTIONS = path.join(FIXTURES, "transactions.csv");
const RESERVATIONS = path.join(FIXTURES, "reservations.csv");
const LISTING_A = "Cozy Studio, KLCC View | Pool & Netflix";
const LISTING_B = "Family 3BR Condo, Bukit Bintang | 6 Pax";
/** The day the fixture's Paid report was downloaded. */
const DOWNLOADED = new Date("2026-11-02T04:00:00.000Z");

function setup() {
  let now = DOWNLOADED.getTime();
  const core = makeCore(tempDir(), () => new Date(now));
  const p = seedProperty(core);
  const sessions = new ImportSessions(() => now);
  return { core, p, sessions, advance: (ms: number) => (now += ms) };
}

const count = (core: ReturnType<typeof makeCore>, sql: string, params: (string | number)[] = []) => core.db.get<{ n: number }>(sql, params)!.n;

function feedStay(core: ReturnType<typeof makeCore>, spaceId: string, code: string, checkIn: string, checkOut: string) {
  return insertReservation(core, {
    spaceId, guestName: "", guestCount: null, checkIn, checkOut, checkInTime: null, checkOutTime: null, status: "confirmed",
    channel: "airbnb", channelReservationId: code, connectionId: null, source: "feed", notes: "",
  });
}

describe("Airbnb transactions import", () => {
  it("previews without writing, then creates stays with guest names and ledger rows", () => {
    const { core, p, sessions } = setup();
    const preview = sessions.open(core, TRANSACTIONS);
    assert.equal(preview.kind, "airbnb_transactions");
    assert.equal(preview.fileName, "transactions.csv");
    assert.deepEqual([preview.rowsTotal, preview.rowsUsable, preview.rowsSkipped, preview.duplicates], [13, 8, 5, 0]);
    assert.deepEqual(preview.listings.map((l) => [l.name, l.rows, l.suggestedSpaceId]), [[LISTING_A, 4, null], [LISTING_B, 4, null]]);
    assert.deepEqual([preview.matchedReservations, preview.newReservations], [0, 6]);
    assert.equal(preview.currency, "MYR");
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations"), 0, "a preview writes nothing");

    const result = sessions.commit(core, preview.token, { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA });
    assert.equal(result.reservationsCreated, 6);
    assert.equal(result.reservationsUpdated, 0);
    assert.equal(result.ledgerEntries, 28);
    assert.deepEqual([result.rowsImported, result.rowsSkipped, result.duplicates], [8, 5, 0]);
    assert.deepEqual(result.conflicts, []);

    const r1 = core.db.get<Record<string, unknown>>("SELECT * FROM reservations WHERE channel_reservation_id = 'HMZX4K2P9Q'")!;
    assert.deepEqual([r1.guest_name, r1.check_in, r1.check_out, r1.space_id, r1.source, r1.channel, r1.status], ["Aisyah Rahman", "2026-09-18", "2026-09-21", p.unitA2, "csv", "airbnb", "confirmed"]);
    const ledger = core.db.all<{ kind: string; amount_sen: number; occurred_on: string; source: string; import_id: string }>(
      "SELECT kind, amount_sen, occurred_on, source, import_id FROM stay_ledger WHERE reservation_id = ? ORDER BY kind",
      [r1.id as string],
    );
    assert.deepEqual(ledger.map((l) => [l.kind, l.amount_sen, l.occurred_on, l.source]), [
      ["booking_value", 48000, "2026-09-19", "imported"],
      ["channel_fee", 1440, "2026-09-19", "imported"],
      ["cleaning_fee", 6000, "2026-09-19", "imported"],
      ["payout", 46560, "2026-09-19", "imported"],
    ]);
    assert.ok(ledger.every((l) => l.import_id === result.importId));
    const imp = core.db.get<Record<string, unknown>>("SELECT * FROM stay_imports WHERE id = ?", [result.importId])!;
    assert.deepEqual([imp.kind, imp.file_name, imp.rows_total, imp.rows_imported, imp.rows_skipped], ["airbnb_transactions", "transactions.csv", 13, 8, 5]);
    // The resolution is linked to its stay.
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_ledger l JOIN reservations r ON r.id = l.reservation_id WHERE l.kind = 'adjustment' AND l.amount_sen = -8000 AND r.channel_reservation_id = 'HMG2K7WX5P'"), 1);
    // The token is gone after commit.
    assert.throws(() => sessions.commit(core, preview.token, {}), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.importExpired");

    const report = performanceReport(core, { from: "2026-09", to: "2026-10", groupBy: "space", propertyId: null });
    const a = report.rows.find((r) => r.key === p.unitA2)!;
    assert.deepEqual([a.bookingValue.importedSen, a.channelFees.importedSen, a.payouts.importedSen, a.estimatedNetSen, a.stays], [165000, 4950, 160050, 160050, 3]);
    const b = report.rows.find((r) => r.key === p.roomA)!;
    assert.deepEqual([b.bookingValue.importedSen, b.payouts.importedSen, b.estimatedNetSen], [252000, 244200, 244200]);
    assert.equal(report.totals.payouts.totalSen, 404250, "payouts reconcile with Airbnb's transfers (RM 4,042.50)");
  });

  it("re-importing the same file changes nothing and counts duplicates", () => {
    const { core, p, sessions } = setup();
    const map = { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA };
    sessions.commit(core, sessions.open(core, TRANSACTIONS).token, map);
    const before = count(core, "SELECT COUNT(*) AS n FROM stay_ledger");
    const events = count(core, "SELECT COUNT(*) AS n FROM reservation_events");

    const preview = sessions.open(core, TRANSACTIONS);
    assert.equal(preview.duplicates, 8);
    assert.deepEqual([preview.matchedReservations, preview.newReservations], [6, 0]);
    assert.deepEqual(preview.listings.map((l) => l.suggestedSpaceId), [p.unitA2, p.roomA], "remembered listing → space");
    const again = sessions.commit(core, preview.token, map);
    assert.deepEqual([again.ledgerEntries, again.duplicates, again.rowsImported, again.reservationsCreated, again.reservationsUpdated], [0, 8, 0, 0, 0]);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_ledger"), before);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservation_events"), events);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations"), 6);
  });

  it("an overlapping export only adds the new lines, and a voided line is not re-created", () => {
    const { core, p, sessions } = setup();
    const full = fs.readFileSync(TRANSACTIONS, "utf8").split("\n").filter(Boolean);
    // The first export: header + the September lines only (the last four).
    const september = [full[0], ...full.slice(-4)].join("\n");
    const map = { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA };
    const first = sessions.commit(core, sessions.openText(core, "sep.csv", september).token, map);
    assert.equal(first.ledgerEntries, 8);
    const payout = core.db.get<{ id: string }>("SELECT id FROM stay_ledger WHERE kind = 'payout' AND amount_sen = 46560")!;
    core.db.run("UPDATE stay_ledger SET voided_at = '2026-11-02T00:00:00Z' WHERE id = ?", [payout.id]);
    const second = sessions.commit(core, sessions.open(core, TRANSACTIONS).token, map);
    assert.equal(second.ledgerEntries, 20);
    assert.equal(second.duplicates, 2);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_ledger WHERE amount_sen = 46560 AND kind = 'payout'"), 1);
  });

  it("enriches a calendar-synced stay instead of duplicating it", () => {
    const { core, p, sessions } = setup();
    const synced = feedStay(core, p.unitA2, "HMD3L8PY6J", "2026-10-09", "2026-10-12");
    const preview = sessions.open(core, TRANSACTIONS);
    assert.equal(preview.listings.find((l) => l.name === LISTING_A)!.suggestedSpaceId, p.unitA2, "suggested from the synced stay's code");
    assert.deepEqual([preview.matchedReservations, preview.newReservations], [1, 5]);
    const result = sessions.commit(core, preview.token, { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA });
    assert.deepEqual([result.reservationsCreated, result.reservationsUpdated], [5, 1]);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations WHERE channel_reservation_id = 'HMD3L8PY6J'"), 1);
    const r = core.db.get<{ guest_name: string; source: string }>("SELECT guest_name, source FROM reservations WHERE id = ?", [synced])!;
    assert.deepEqual({ ...r }, { guest_name: "Nurul Izzah Kamal", source: "feed" });
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_ledger WHERE reservation_id = ?", [synced]), 4);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservation_events WHERE reservation_id = ? AND source = 'csv' AND kind = 'updated'", [synced]), 1);
  });

  it("matches a synced stay by its feed event's code, or by same space and dates", () => {
    const { core, p, sessions } = setup();
    const byUid = feedStay(core, p.unitA2, "1418fb94e984-aaaa@airbnb.com", "2026-09-18", "2026-09-21");
    const now = "2026-11-02T00:00:00Z";
    core.db.run(
      `INSERT INTO channel_connections (id, channel, method, name, space_id, property_id, created_at, updated_at) VALUES ('c1', 'airbnb', 'ical', 'KLCC studio', ?, ?, ?, ?)`,
      [p.unitA2, p.propertyId, now, now],
    );
    const withEvent = feedStay(core, p.unitA2, "1418fb94e984-bbbb@airbnb.com", "2026-10-03", "2026-10-07");
    core.db.run(
      `INSERT INTO channel_events (id, connection_id, kind, external_uid, confirmation_code, start_date, end_date, state, reservation_id, first_seen_at, last_seen_at)
       VALUES ('e1', 'c1', 'reservation', 'bbbb', 'HMB7T2QW4N', '2026-10-03', '2026-10-07', 'applied', ?, ?, ?)`,
      [withEvent, now, now],
    );
    const result = sessions.commit(core, sessions.open(core, TRANSACTIONS).token, { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA });
    assert.equal(result.reservationsCreated, 4);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_ledger WHERE reservation_id = ?", [byUid]), 4);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_ledger WHERE reservation_id = ?", [withEvent]), 7, "reservation + alteration lines");
  });

  it("a clashing stay becomes a conflict: no reservation, money kept unlinked", () => {
    const { core, p, sessions } = setup();
    createReservation(core, { spaceId: p.roomA, guestName: "Direct guest", checkIn: "2026-10-24", checkOut: "2026-10-26", status: "confirmed", channel: "direct", channelReservationId: null, totalSen: null, notes: "" });
    const result = sessions.commit(core, sessions.open(core, TRANSACTIONS).token, { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA });
    assert.equal(result.reservationsCreated, 5);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].confirmationCode, "HMH5Q9TC3W");
    assert.ok(result.conflicts[0].message.length > 0);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations WHERE channel_reservation_id = 'HMH5Q9TC3W'"), 0);
    const money = core.db.all<{ reservation_id: string | null; space_id: string }>("SELECT reservation_id, space_id FROM stay_ledger WHERE external_ref LIKE 'airbnb:HMH5Q9TC3W:%'");
    assert.equal(money.length, 4);
    assert.ok(money.every((m) => m.reservation_id === null && m.space_id === p.roomA));
  });

  it("skips listings mapped to nothing and non-ringgit rows", () => {
    const { core, p, sessions } = setup();
    const text = fs.readFileSync(TRANSACTIONS, "utf8").trimEnd() + "\n10/25/2026,,Reservation,HMUSD00001,10/01/2026,10/20/2026,10/22/2026,2,Sam,Other place,,,USD,100.00,,3.00,,,,103.00,,,2026\n";
    const preview = sessions.openText(core, "t.csv", text);
    assert.equal(preview.rowsSkipped, 6);
    assert.equal(preview.currency, "MYR, USD");
    assert.ok(preview.warnings.some((w) => w.includes("USD")));
    assert.ok(!preview.listings.some((l) => l.name === "Other place"));
    const result = sessions.commit(core, preview.token, { [LISTING_A]: p.unitA2, [LISTING_B]: null });
    assert.equal(result.reservationsCreated, 3);
    assert.equal(result.rowsSkipped, 6 + 4);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_ledger WHERE external_ref LIKE 'airbnb:HMUSD00001:%'"), 0);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_ledger WHERE space_id = ?", [p.roomA]), 0);
  });

  it("validates the listing map and expires previews", () => {
    const { core, p, sessions, advance } = setup();
    const preview = sessions.open(core, TRANSACTIONS);
    assert.throws(() => sessions.commit(core, preview.token, { "Not in file": p.unitA2 }), (e: unknown) => e instanceof AppError && e.code === "VALIDATION");
    assert.throws(() => sessions.commit(core, preview.token, { [LISTING_A]: "missing-space" }), (e: unknown) => e instanceof AppError && Object.values(e.fields ?? {}).includes("errors.money.spaceMissing"));
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_imports"), 0);
    advance(IMPORT_TTL_MS + 1);
    assert.throws(() => sessions.commit(core, preview.token, { [LISTING_A]: p.unitA2 }), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.importExpired");
    // A token from another workspace is refused.
    const other = makeCore(tempDir(), () => DOWNLOADED);
    const token = sessions.open(core, TRANSACTIONS).token;
    assert.throws(() => sessions.preview(other, token), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.importExpired");
    sessions.discard(token);
    assert.throws(() => sessions.preview(core, token), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.importExpired");
  });

  it("refuses files that aren't CSV exports", () => {
    const { core, sessions } = setup();
    const dir = tempDir();
    const zip = path.join(dir, "x.csv");
    fs.writeFileSync(zip, Buffer.from([0x50, 0x4b, 3, 4, 0, 0]));
    assert.throws(() => sessions.open(core, zip), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.notText");
    const bad = path.join(dir, "bad.csv");
    fs.writeFileSync(bad, 'Date,Type,Amount\n"10/10/2026,Reservation,1\n');
    assert.throws(() => sessions.open(core, bad), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.malformedCsv");
    const big = path.join(dir, "big.csv");
    fs.writeFileSync(big, Buffer.alloc(10 * 1024 * 1024 + 1, 0x41));
    assert.throws(() => sessions.open(core, big), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.fileTooLarge");
    const latin = path.join(dir, "latin.csv");
    fs.writeFileSync(latin, Buffer.concat([Buffer.from("Date,Type,Confirmation code,Start date,End date,Guest,Listing,Currency,Amount\n10/10/2026,Reservation,HMLATIN001,10/01/2026,10/03/2026,Jos"), Buffer.from([0xe9]), Buffer.from(",Studio,MYR,100.00\n")]));
    assert.equal(sessions.open(core, latin).rowsUsable, 1, "an Excel (Windows-1252) re-save still reads");
  });

  it("works through the IPC handlers", async () => {
    const { core, p } = setup();
    let picked: string | null = TRANSACTIONS;
    const h = moneyHandlers({ core: () => core, platform: { pickImportFile: async () => picked } } as unknown as HandlerContext);
    const preview = (await h["imports.pickAirbnbCsv"](undefined))!;
    assert.equal(preview.rowsUsable, 8);
    assert.throws(() => h["imports.commit"]({ token: preview.token, listingMap: [] }), (e: unknown) => e instanceof AppError && e.fields?.listingMap === "validation.required");
    assert.throws(() => h["imports.commit"]({ token: preview.token, listingMap: { [LISTING_A]: 5 } }), (e: unknown) => e instanceof AppError && e.code === "VALIDATION");
    assert.throws(() => h["imports.commit"]({ token: "", listingMap: {} }), (e: unknown) => e instanceof AppError && e.fields?.token === "validation.required");
    const result = await h["imports.commit"]({ token: preview.token, listingMap: { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA } });
    assert.equal(result.reservationsCreated, 6);
    picked = null;
    assert.equal(await h["imports.pickAirbnbCsv"](undefined), null);
    assert.equal(h["imports.discard"]({ token: preview.token }), null);
  });
});

describe("Airbnb reservations import (legacy)", () => {
  it("adds stays and guest names, applies cancellations, stores no money or phone numbers", () => {
    const { core, p, sessions } = setup();
    const r3 = feedStay(core, p.unitA2, "HMC9V5XK2R", "2026-10-23", "2026-10-26");
    const preview = sessions.open(core, RESERVATIONS);
    assert.equal(preview.kind, "airbnb_reservations");
    assert.deepEqual([preview.matchedReservations, preview.newReservations], [1, 6]);
    assert.ok(preview.warnings.some((w) => w.includes("1 stays are cancelled")));
    const result = sessions.commit(core, preview.token, { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA });
    assert.deepEqual([result.reservationsCreated, result.reservationsUpdated, result.ledgerEntries, result.rowsImported], [6, 1, 0, 7]);
    assert.equal(core.db.get<{ status: string }>("SELECT status FROM reservations WHERE id = ?", [r3])!.status, "cancelled");
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM stay_ledger"), 0);
    const dump = JSON.stringify(core.db.all("SELECT * FROM reservations")) + JSON.stringify(core.db.all("SELECT * FROM reservation_events")) + JSON.stringify(core.db.all("SELECT * FROM settings"));
    assert.ok(!dump.includes("+60") && !dump.includes("+44") && !dump.includes("+81"), "no phone number is stored");

    // Then the transactions export adds money to the same stays, without duplicates.
    const tx = sessions.commit(core, sessions.open(core, TRANSACTIONS).token, { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA });
    assert.equal(tx.reservationsCreated, 0);
    assert.equal(tx.ledgerEntries, 28);
    assert.equal(count(core, "SELECT COUNT(*) AS n FROM reservations"), 7);

    const again = sessions.commit(core, sessions.open(core, RESERVATIONS).token, { [LISTING_A]: p.unitA2, [LISTING_B]: p.roomA });
    assert.deepEqual([again.reservationsCreated, again.reservationsUpdated, again.duplicates], [0, 0, 7]);
  });
});
