import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { AppError } from "../core/errors";
import { lineType, parseAirbnbAmount, parseAirbnbCsv, parseAirbnbDate } from "../core/imports/airbnb-csv";
import { CsvSyntaxError, mapColumns, normalizeHeader, parseCsv } from "../core/imports/csv";

const fixture = (name: string) => fs.readFileSync(path.resolve(process.cwd(), "desktop/tests/fixtures/airbnb", name), "utf8");
const TODAY = "2026-11-02";

describe("RFC 4180 CSV reader", () => {
  it("handles quotes, escaped quotes, embedded newlines, BOM and CRLF", () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","line1\r\nline2"\r\n1,,3';
    assert.deepEqual(parseCsv(text), [
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\r\nline2"],
      ["1", "", "3"],
    ]);
  });

  it("accepts LF, lone CR, a missing final newline and drops blank lines", () => {
    assert.deepEqual(parseCsv("a,b\n\n1,2\r3,4"), [["a", "b"], ["1", "2"], ["3", "4"]]);
    assert.deepEqual(parseCsv("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(parseCsv(""), []);
  });

  it("keeps empty trailing fields and detects a semicolon file", () => {
    assert.deepEqual(parseCsv("a,b,\n1,,"), [["a", "b", ""], ["1", "", ""]]);
    assert.deepEqual(parseCsv('a;b\n"1,5";2'), [["a", "b"], ["1,5", "2"]]);
  });

  it("rejects an unterminated quoted field", () => {
    assert.throws(() => parseCsv('a,b\n"oops,1\n2,3'), (e: unknown) => e instanceof CsvSyntaxError && e.line === 2);
  });

  it("matches headers by normalised name, whatever the order", () => {
    assert.equal(normalizeHeader(" Paid Out "), "paidout");
    assert.equal(normalizeHeader("# of nights"), "ofnights");
    const cols = mapColumns(["Amount", "EXTRA", "Host Fee", "date"], { date: ["date"], fee: ["service fee", "host fee"], amount: ["amount"], missing: ["nope"] });
    assert.deepEqual({ ...cols }, { date: 3, fee: 2, amount: 0 });
  });
});

describe("Airbnb amounts and dates", () => {
  it("parses amounts to exact sen", () => {
    const sen = (s: string) => {
      const r = parseAirbnbAmount(s);
      return r.ok ? r.sen : "invalid";
    };
    assert.equal(sen("465.60"), 46560);
    assert.equal(sen("1,047.60"), 104760);
    assert.equal(sen("RM1,234.56"), 123456);
    assert.equal(sen("MYR 12"), 1200);
    assert.equal(sen("-80.00"), -8000);
    assert.equal(sen("(80.00)"), -8000);
    assert.equal(sen("RM-5.5"), -550);
    assert.equal(sen("0.10"), 10);
    assert.equal(sen("1234567.89"), 123456789);
    assert.equal(sen(""), null);
    assert.equal(sen("1.234"), "invalid");
    assert.equal(sen("1,23.00"), "invalid");
    assert.equal(sen("12,5"), "invalid");
    assert.equal(sen("abc"), "invalid");
    assert.equal(sen("999999999.99"), "invalid");
    // 0.1 + 0.2 style float drift can't happen: 19.99 × many stays stays exact.
    assert.equal(sen("19.99"), 1999);
    const usd = parseAirbnbAmount("$10.00");
    assert.ok(usd.ok && usd.currency === "$");
    const rm = parseAirbnbAmount("RM494.70");
    assert.ok(rm.ok && rm.currency === "MYR");
  });

  it("reads MM/DD/YYYY and ISO, never guesses DD/MM", () => {
    assert.equal(parseAirbnbDate("10/24/2026"), "2026-10-24");
    assert.equal(parseAirbnbDate("9/5/2026"), "2026-09-05");
    // Ambiguous: always month first, like Airbnb writes it.
    assert.equal(parseAirbnbDate("04/10/2026"), "2026-04-10");
    assert.equal(parseAirbnbDate("2026-10-24"), "2026-10-24");
    assert.equal(parseAirbnbDate("24/10/2026"), null);
    assert.equal(parseAirbnbDate("02/30/2026"), null);
    assert.equal(parseAirbnbDate("10/24/26"), null);
    assert.equal(parseAirbnbDate("24 Oct 2026"), null);
  });

  it("treats Type as an open vocabulary", () => {
    assert.equal(lineType("Payout"), "payout");
    assert.equal(lineType("Reservation"), "reservation");
    assert.equal(lineType("予約"), "reservation");
    assert.equal(lineType("Adjustment"), "adjustment");
    assert.equal(lineType("Resolution Adjustment"), "resolution");
    assert.equal(lineType("Resolution Payout"), "resolution");
    assert.equal(lineType("Pass Through Tot"), "tax");
    assert.equal(lineType("Co-Host Payout"), "unknown");
  });
});

describe("Airbnb transactions export", () => {
  const parsed = parseAirbnbCsv(fixture("transactions.csv"), TODAY);

  it("detects the file and skips payout transfer rows", () => {
    assert.equal(parsed.kind, "airbnb_transactions");
    assert.equal(parsed.rowsTotal, 13);
    assert.equal(parsed.rowsSkipped, 5);
    assert.equal(parsed.rows.length, 8);
    assert.equal(parsed.currency, "MYR");
    assert.ok(parsed.warnings.some((w) => w.includes("5 payout transfer rows")));
    assert.ok(parsed.warnings.some((w) => w.includes("RM 20.00")), "Airbnb-remitted tourism tax is explained, not counted");
  });

  it("reproduces the README control totals per listing", () => {
    const totals = new Map<string, Record<string, number>>();
    for (const r of parsed.rows) {
      const t = totals.get(r.listing) ?? {};
      for (const m of r.money) t[m.kind] = (t[m.kind] ?? 0) + m.amountSen;
      totals.set(r.listing, t);
    }
    const a = totals.get("Cozy Studio, KLCC View | Pool & Netflix")!;
    const b = totals.get("Family 3BR Condo, Bukit Bintang | 6 Pax")!;
    assert.deepEqual(a, { booking_value: 165000, channel_fee: 4950, cleaning_fee: 18000, payout: 160050 });
    assert.deepEqual(b, { booking_value: 260000, channel_fee: 7800, cleaning_fee: 36000, payout: 252200, adjustment: -8000 });
    // Amount per listing (payouts + netted adjustments) matches the README: A 1,600.50, B 2,442.00.
    assert.equal(b.payout + b.adjustment, 244200);
  });

  it("keeps stay facts and gives every money line a stable, unique key", () => {
    const r2 = parsed.rows.filter((r) => r.code === "HMB7T2QW4N");
    assert.equal(r2.length, 2);
    assert.deepEqual([r2[0].checkIn, r2[0].checkOut, r2[0].guestName], ["2026-10-03", "2026-10-07", "Daniel Tan Wei Ming"]);
    const refs = parsed.rows.flatMap((r) => r.money.map((m) => m.externalRef));
    assert.equal(new Set(refs).size, refs.length);
    const again = parseAirbnbCsv(fixture("transactions.csv"), TODAY).rows.flatMap((r) => r.money.map((m) => m.externalRef));
    assert.deepEqual(again, refs);
    assert.ok(refs.every((ref) => ref.startsWith("airbnb:") && ref.length <= 200));
  });

  it("matches renamed and reordered columns, ignores extra ones", () => {
    const text = [
      "Earnings Year,Host Fee,Amount,Listing,Guest,Nights,Start Date,Confirmation Code,Type,Date,Currency,Gross Earnings,Secret",
      "2026,15.30,494.70,Studio,Nurul,3,10/09/2026,HMD3L8PY6J,Reservation,10/10/2026,MYR,510.00,x",
    ].join("\n");
    const p = parseAirbnbCsv(text, TODAY);
    assert.equal(p.rows.length, 1);
    assert.equal(p.rows[0].checkOut, "2026-10-12", "end date from start + nights");
    assert.deepEqual(p.rows[0].money.map((m) => [m.kind, m.amountSen]), [["booking_value", 51000], ["channel_fee", 1530], ["payout", 49470]]);
  });

  it("skips other currencies, unreadable dates and amounts with warnings; flags unknown types", () => {
    const text = [
      "Date,Type,Confirmation code,Start date,End date,Listing,Currency,Amount,Gross earnings,Service fee",
      "10/10/2026,Reservation,HMAAAA1111,10/09/2026,10/12/2026,Studio,USD,100.00,103.00,3.00",
      "24/10/2026,Reservation,HMAAAA2222,10/09/2026,10/12/2026,Studio,MYR,100.00,103.00,3.00",
      "10/10/2026,Reservation,HMAAAA3333,10/09/2026,10/12/2026,Studio,MYR,1.234,103.00,3.00",
      "10/10/2026,Co-Host Payout,HMAAAA4444,,,Studio,MYR,-20.00,,",
      "10/10/2026,Reservation,HMAAAA5555,10/13/2026,10/15/2026,Studio,MYR,97.00,100.00,3.00",
    ].join("\r\n");
    const p = parseAirbnbCsv(text, TODAY);
    assert.deepEqual(p.rows.map((r) => r.code), ["HMAAAA4444", "HMAAAA5555"]);
    assert.equal(p.rowsSkipped, 3);
    assert.equal(p.currency, "MYR, USD");
    assert.ok(p.warnings.some((w) => w.includes("1 rows in USD")));
    assert.ok(p.warnings.some((w) => w.includes("Row 3") && w.includes("24/10/2026")));
    assert.ok(p.warnings.some((w) => w.includes("Row 4") && w.includes("1.234")));
    assert.ok(p.warnings.some((w) => w.includes("Co-Host Payout")));
    assert.deepEqual(p.rows[0].money.map((m) => [m.kind, m.amountSen]), [["adjustment", -2000]]);
  });

  it("imports no money for payouts Airbnb hasn't released yet", () => {
    const p = parseAirbnbCsv(fixture("transactions.csv"), "2026-10-05");
    const upcoming = p.rows.filter((r) => r.upcoming);
    assert.ok(upcoming.length > 0);
    assert.ok(upcoming.every((r) => r.money.length === 0));
    assert.ok(p.warnings.some((w) => w.includes("hasn't released")));
  });

  it("rejects other files", () => {
    assert.throws(() => parseAirbnbCsv("Name,Phone\nA,1", TODAY), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.notAirbnbCsv");
    assert.throws(() => parseAirbnbCsv("", TODAY), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.emptyCsv");
    assert.throws(() => parseAirbnbCsv("Date,Type,Amount\n", TODAY), (e: unknown) => e instanceof AppError && e.messageKey === "errors.money.emptyCsv");
  });
});

describe("Airbnb reservations export (legacy)", () => {
  const parsed = parseAirbnbCsv(fixture("reservations.csv"), TODAY);

  it("reads stays and statuses but no money and no contact details", () => {
    assert.equal(parsed.kind, "airbnb_reservations");
    assert.equal(parsed.rows.length, 7);
    assert.equal(parsed.currency, "MYR");
    const r3 = parsed.rows.find((r) => r.code === "HMC9V5XK2R")!;
    assert.deepEqual([r3.status, r3.checkIn, r3.checkOut, r3.guestName], ["cancelled", "2026-10-23", "2026-10-26", "Hiroshi Nakamura"]);
    assert.ok(parsed.rows.every((r) => r.money.length === 0));
    const kept = JSON.stringify(parsed);
    assert.ok(!kept.includes("7700") && !kept.includes("+60") && !kept.includes("5555"), "phone numbers are never kept");
    assert.ok(parsed.warnings.some((w) => w.includes("Transaction history")));
  });

  it("drops rows broken by an unquoted comma", () => {
    const text = "Confirmation code,Status,Guest name,Start date,End date,Listing,Earnings\nHMX1234567,Confirmed,A,2026-10-01,2026-10-03,Studio, KLCC,RM1,000.00\n";
    const p = parseAirbnbCsv(text, TODAY);
    assert.equal(p.rows.length, 0);
    assert.equal(p.rowsSkipped, 1);
  });
});
