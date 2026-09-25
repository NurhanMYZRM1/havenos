/**
 * Airbnb CSV exports → stays and ledger lines.
 *
 * Two files are understood (see desktop/tests/fixtures/airbnb/README.md for
 * the research behind every choice, with confidence levels):
 *
 *  - **Transactions** (Earnings → Paid / Upcoming → Export CSV). Columns are
 *    matched by normalised header name plus aliases, never by position; hosts
 *    can choose which columns to export, and older files say "Host Fee",
 *    "Paid Out", "Reference".
 *  - **Reservations** (Hosting → Reservations → Export; reportedly removed by
 *    Airbnb in 2026). Best-effort secondary path for files hosts already have.
 *
 * ## Column → ledger kind (transactions)
 *
 * One CSV line can give several ledger rows. All are channel 'airbnb',
 * source 'imported', dated on the line's `Date` (the payout release date);
 * the performance report re-attributes earnings to the stay's check-in month.
 *
 * | Line                                   | Ledger rows                                                                 |
 * |----------------------------------------|-----------------------------------------------------------------------------|
 * | `Type` = Payout                        | none — it only adds up the lines it pays (would double count). Counted, warned. |
 * | any other line with Gross earnings > 0 | booking_value = Gross earnings + Occupancy taxes                            |
 * | (Reservation, and a price Adjustment)  | channel_fee   = |Service fee| + |Fast Pay fee|  (positive = a cost)          |
 * |                                        | cleaning_fee  = Cleaning fee (a part of Gross earnings: shown, never added) |
 * |                                        | tax           = Occupancy taxes (pass-through tax the host must remit)      |
 * |                                        | payout        = Amount (what Airbnb paid for this line), when > 0           |
 * | tax pass-through line, no gross        | booking_value = tax = Amount, payout = Amount                               |
 * | Resolution Adjustment / Adjustment /   | adjustment    = Amount (signed)                                             |
 * | unknown types, no positive gross       |   unknown types are also flagged in a warning                               |
 * | `Airbnb remitted tax`                  | none — Airbnb collected and paid it; it never reaches the host (warned)     |
 * | `Pet fee`, `Paid out` on lines, `Earnings year`, `Details`, `Booking date` | not stored                      |
 *
 * Why booking value includes pass-through occupancy taxes: the report's
 * estimated net is booking value − channel fees − taxes − expenses, so a tax
 * the host collects and remits must sit in both terms to net to zero. Gross
 * earnings already include the cleaning fee (fixture: 3 × 150 + 60 = 510), so
 * cleaning_fee is informational. With this mapping the fixture reproduces the
 * README's control totals (gross A 1,650.00 / B 2,600.00, service fee 49.50 /
 * 78.00, Amount 1,600.50 / 2,442.00).
 *
 * A price Adjustment line that carries Gross earnings (an alteration adding a
 * night) is split like a reservation so booking value, fees and the average
 * nightly rate stay right; an adjustment without gross (e.g. a resolution) is
 * recorded as its signed net Amount.
 *
 * Upcoming lines (Date after today) have not been paid: their stays are
 * imported but no money, so a later Paid export can't double count them.
 *
 * ## Reservations export
 *
 * Stays only: confirmation code, status, guest name, dates, listing.
 * `Earnings` is net of Airbnb's fee and the same money arrives with the
 * transactions export, so it is not stored (warned). `Contact` (full phone
 * number) and guest counts are never read.
 *
 * ## Dates, amounts, currency
 *
 * Dates are MM/DD/YYYY (Airbnb's format even in other locales) or ISO
 * YYYY-MM-DD; anything else skips the row with a warning — DD/MM is never
 * guessed. Amounts are parsed digit by digit into sen (no floats): optional
 * RM/MYR/$/€ prefix, grouping commas only in the 1,234,567 shape, a leading
 * minus or parentheses, at most two decimals. Lines in a currency other than
 * MYR are skipped with a warning.
 *
 * Only these fields are kept in memory after parsing: confirmation code,
 * listing name, dates, nights, guest name, status, reference and amounts.
 */

import crypto from "node:crypto";
import type { CsvImportWarning, StayImportKind } from "../../../lib/api/contract";
import { addDays, daysBetween, isIsoDate, type IsoDate } from "../../../lib/domain/dates";
import type { LedgerKind } from "../../../lib/domain/enums";
import { formatRM, MAX_SEN } from "../../../lib/domain/money";
import type { MessageKey, MessageParams } from "../../../lib/i18n";
import { AppError } from "../errors";
import { mapColumns, normalizeHeader, parseCsv } from "./csv";

export interface MoneyLine {
  kind: LedgerKind;
  amountSen: number;
  occurredOn: IsoDate;
  /** Idempotency key: the same line in a later or overlapping export gives the same key. */
  externalRef: string;
  /** Previous app versions included the payout date in the key. Used only in main during import. */
  legacyRefForDate: (date: IsoDate) => string;
}

export interface AirbnbRow {
  /** 1-based line number in the file (header = 1). */
  rowNumber: number;
  /** The Type as written in the file (for the ledger description). */
  typeLabel: string;
  code: string | null;
  listing: string;
  guestName: string;
  checkIn: IsoDate | null;
  checkOut: IsoDate | null;
  status: "confirmed" | "tentative" | "cancelled";
  /** A line Airbnb hasn't paid yet (Upcoming report). */
  upcoming: boolean;
  money: MoneyLine[];
}

export interface ParsedAirbnbFile {
  kind: StayImportKind;
  rowsTotal: number;
  /** Rows left out while parsing (payout transfers, other currencies, unreadable). */
  rowsSkipped: number;
  rows: AirbnbRow[];
  currency: string | null;
  warnings: CsvImportWarning[];
}

const warn = (key: MessageKey, params?: MessageParams): CsvImportWarning => ({ key, params });

// ── Values ─────────────────────────────────────────────────────────────────

/** MM/DD/YYYY (1- or 2-digit month/day) or YYYY-MM-DD. Never DD/MM. */
export function parseAirbnbDate(input: string): IsoDate | null {
  const s = input.trim();
  if (isIsoDate(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

export type AmountParse = { ok: true; sen: number | null; currency: string | null } | { ok: false };

const PREFIXES: [RegExp, string][] = [
  [/^myr\s*/i, "MYR"],
  [/^rm\s*/i, "MYR"],
  [/^us\$\s*/i, "USD"],
  [/^s\$\s*/i, "SGD"],
  [/^\$\s*/, "$"],
  [/^€\s*/, "EUR"],
  [/^£\s*/, "GBP"],
];

/**
 * "465.60", "\"1,047.60\"", "-80.00", "(80.00)", "RM1,234.56", "MYR 12" → sen.
 * Empty → { ok: true, sen: null }. Exact integer arithmetic on the digits.
 */
export function parseAirbnbAmount(input: string): AmountParse {
  let s = input.trim().replace(/[  ]/g, " ");
  if (s === "") return { ok: true, sen: null, currency: null };
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (/^[-−]/.test(s)) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  let currency: string | null = null;
  for (const [re, code] of PREFIXES) {
    if (re.test(s)) {
      currency = code;
      s = s.replace(re, "");
      break;
    }
  }
  if (/^[-−]/.test(s)) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return { ok: false };
  const whole = m[1].replace(/^0+(?=\d)/, "");
  if (whole.length > 8) return { ok: false };
  const sen = Number(whole) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (sen > MAX_SEN) return { ok: false };
  return { ok: true, sen: negative && sen !== 0 ? -sen : sen, currency };
}

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

function readCode(s: string): string | null {
  const v = s.trim().toUpperCase();
  return /^[A-Z0-9-]{4,64}$/.test(v) ? v : null;
}

// ── Vocabulary ─────────────────────────────────────────────────────────────

const TX_COLUMNS = {
  date: ["date", "日付", "日期"],
  type: ["type", "種別", "类型", "類型"],
  code: ["confirmation code", "reservation code", "確認コード"],
  start: ["start date", "check-in", "check-in date", "start"],
  end: ["end date", "checkout", "check-out", "check-out date", "end"],
  nights: ["nights", "# of nights", "number of nights"],
  guest: ["guest", "guest name"],
  listing: ["listing", "listing name", "listing title"],
  reference: ["reference code", "reference"],
  currency: ["currency", "通貨", "货币"],
  amount: ["amount", "金額", "金额"],
  paidOut: ["paid out"],
  serviceFee: ["service fee", "host fee", "host service fee"],
  fastPayFee: ["fast pay fee"],
  cleaningFee: ["cleaning fee"],
  gross: ["gross earnings"],
  occupancyTax: ["occupancy taxes", "occupancy tax"],
  remittedTax: ["airbnb remitted tax", "airbnb remitted taxes"],
} as const;

const RES_COLUMNS = {
  code: ["confirmation code", "reservation code", "確認コード"],
  status: ["status"],
  guest: ["guest name", "guest"],
  start: ["start date", "check-in", "check-in date"],
  end: ["end date", "checkout", "check-out", "check-out date"],
  nights: ["# of nights", "nights", "number of nights"],
  listing: ["listing", "listing name", "listing title"],
  earnings: ["earnings"],
} as const;

type TxField = keyof typeof TX_COLUMNS;
type ResField = keyof typeof RES_COLUMNS;

type LineType = "payout" | "reservation" | "adjustment" | "resolution" | "tax" | "unknown";

const TYPE_ALIASES: Record<Exclude<LineType, "unknown" | "resolution" | "tax">, string[]> = {
  payout: ["payout", "支払い", "付款", "versement", "pago", "auszahlung", "pembayaran"],
  reservation: ["reservation", "booking", "予約", "预订", "預訂", "réservation", "reserva", "reservación", "buchung", "prenotazione", "tempahan"],
  adjustment: ["adjustment", "調整", "调整", "ajustement", "ajuste", "anpassung", "pelarasan"],
};

export function lineType(raw: string): LineType {
  const v = raw.trim().toLowerCase();
  for (const [type, aliases] of Object.entries(TYPE_ALIASES)) if (aliases.includes(v)) return type as LineType;
  if (v.includes("resolution")) return "resolution";
  if (/\btax\b|\btot\b/.test(v)) return "tax";
  return "unknown";
}

// ── Files ──────────────────────────────────────────────────────────────────

function has<F extends string>(cols: Partial<Record<F, number>>, ...fields: F[]) {
  return fields.every((f) => cols[f] !== undefined);
}

/** Collects per-row problems, keeping the list readable. */
class Problems {
  private shown = 0;
  private hidden = 0;
  constructor(private readonly out: CsvImportWarning[], private readonly limit = 5) {}
  add(key: MessageKey, params: MessageParams) {
    if (this.shown < this.limit) {
      this.out.push(warn(key, params));
      this.shown++;
    } else this.hidden++;
  }
  flush() {
    if (this.hidden) this.out.push(warn("shortStays.import.warn.moreProblems", { n: this.hidden }));
  }
}

function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

/** Parse either Airbnb export. Throws AppError notAirbnbCsv / emptyCsv. */
export function parseAirbnbCsv(text: string, today: IsoDate): ParsedAirbnbFile {
  const table = parseCsv(text);
  if (table.length === 0) throw new AppError("VALIDATION", "errors.money.emptyCsv");
  const [header, ...body] = table;
  const tx = mapColumns(header, TX_COLUMNS);
  if (has(tx, "date", "type") && (has(tx, "amount") || has(tx, "gross") || has(tx, "paidOut"))) {
    if (!body.length) throw new AppError("VALIDATION", "errors.money.emptyCsv");
    return parseTransactions(body, tx, today);
  }
  const res = mapColumns(header, RES_COLUMNS);
  if (has(res, "code", "status", "start") && (has(res, "end") || has(res, "nights"))) {
    if (!body.length) throw new AppError("VALIDATION", "errors.money.emptyCsv");
    return parseReservations(body, header.length, res);
  }
  const knownHeaders = new Set([...Object.values(TX_COLUMNS), ...Object.values(RES_COLUMNS)].flat().map(normalizeHeader));
  const unknownHeaders = header.filter((name) => !knownHeaders.has(normalizeHeader(name))).map((name) => clean(name, 120));
  if (unknownHeaders.length) throw new AppError("VALIDATION", "errors.money.notAirbnbCsvHeaders", { params: { headers: unknownHeaders.join(", ") } });
  throw new AppError("VALIDATION", "errors.money.notAirbnbCsv");
}

function stayDates(start: string, end: string, nights: string): { checkIn: IsoDate | null; checkOut: IsoDate | null; bad: string | null } {
  if (!start.trim()) return { checkIn: null, checkOut: null, bad: null };
  const checkIn = parseAirbnbDate(start);
  if (!checkIn) return { checkIn: null, checkOut: null, bad: start };
  let checkOut: IsoDate | null = null;
  if (end.trim()) {
    checkOut = parseAirbnbDate(end);
    if (!checkOut) return { checkIn: null, checkOut: null, bad: end };
  } else if (/^\d{1,3}$/.test(nights.trim()) && Number(nights) > 0) {
    checkOut = addDays(checkIn, Number(nights));
  }
  if (checkOut && daysBetween(checkIn, checkOut) <= 0) return { checkIn: null, checkOut: null, bad: end };
  return { checkIn, checkOut: checkOut ?? null, bad: null };
}

function parseTransactions(body: string[][], cols: Partial<Record<TxField, number>>, today: IsoDate): ParsedAirbnbFile {
  const warnings: CsvImportWarning[] = [];
  const problems = new Problems(warnings);
  const cell = (row: string[], f: TxField) => (cols[f] === undefined ? "" : (row[cols[f]!] ?? "").trim());
  const rows: AirbnbRow[] = [];
  const identities = new Map<string, { date: IsoDate; money: MoneyLine[] }[]>();
  const legacySeen = new Map<string, number>();
  const otherCurrencies = new Map<string, number>();
  const unknownTypes = new Map<string, number>();
  const currencies = new Set<string>();
  let skipped = 0;
  let payoutRows = 0;
  let upcomingRows = 0;
  let remittedSen = 0;

  body.forEach((row, index) => {
    const rowNumber = index + 2;
    const typeLabel = clean(cell(row, "type"), 60);
    const type = lineType(typeLabel);
    if (type === "payout") {
      payoutRows++;
      skipped++;
      return;
    }
    // Amounts first: a currency prefix in a cell counts like the Currency column.
    const amounts: Partial<Record<TxField, number | null>> = {};
    let prefixCurrency: string | null = null;
    for (const f of ["amount", "serviceFee", "fastPayFee", "cleaningFee", "gross", "occupancyTax", "remittedTax"] as const) {
      const raw = cell(row, f);
      const parsed = parseAirbnbAmount(raw);
      if (!parsed.ok) {
        problems.add("shortStays.import.warn.badAmount", { row: rowNumber, value: raw.slice(0, 40) });
        skipped++;
        return;
      }
      amounts[f] = parsed.sen;
      prefixCurrency ??= parsed.currency;
    }
    const currency = (cell(row, "currency").toUpperCase() || prefixCurrency || "MYR").slice(0, 10);
    currencies.add(currency);
    if (currency !== "MYR") {
      otherCurrencies.set(currency, (otherCurrencies.get(currency) ?? 0) + 1);
      skipped++;
      return;
    }
    const rawDate = cell(row, "date");
    if (!rawDate) {
      problems.add("shortStays.import.warn.missingDate", { row: rowNumber });
      skipped++;
      return;
    }
    const date = parseAirbnbDate(rawDate);
    if (!date) {
      problems.add("shortStays.import.warn.badDate", { row: rowNumber, value: rawDate.slice(0, 40) });
      skipped++;
      return;
    }
    const stay = stayDates(cell(row, "start"), cell(row, "end"), cell(row, "nights"));
    if (stay.bad !== null) {
      problems.add("shortStays.import.warn.badDate", { row: rowNumber, value: stay.bad.slice(0, 40) });
      skipped++;
      return;
    }
    if (type === "unknown" && typeLabel) unknownTypes.set(typeLabel, (unknownTypes.get(typeLabel) ?? 0) + 1);
    remittedSen += Math.abs(amounts.remittedTax ?? 0);

    const code = readCode(cell(row, "code"));
    const reference = clean(cell(row, "reference"), 40);
    const upcoming = date > today;
    if (upcoming) upcomingRows++;

    // The payout date can move between Paid exports. Keep it out of the key,
    // as with listing titles and guest names, which can be renamed.
    const facts = [
      type === "unknown" ? typeLabel.toLowerCase() : type,
      code ?? "",
      reference,
      stay.checkIn ?? "",
      stay.checkOut ?? "",
      currency,
      ...(["amount", "serviceFee", "fastPayFee", "cleaningFee", "gross", "occupancyTax"] as const).map((f) => String(amounts[f] ?? "")),
    ];
    const normalized = facts.join("|");
    const legacyFacts = (on: IsoDate) => [facts[0], on, ...facts.slice(1)].join("|");
    const legacyNormalized = legacyFacts(date);
    const legacyOccurrence = (legacySeen.get(legacyNormalized) ?? 0) + 1;
    legacySeen.set(legacyNormalized, legacyOccurrence);
    const refBase = `airbnb:${code ?? (reference || "line")}`;
    const money: MoneyLine[] = [];
    const add = (kind: LedgerKind, amountSen: number) => money.push({
      kind, amountSen, occurredOn: date, externalRef: `${refBase}:${kind}`,
      legacyRefForDate: (on) => `${refBase}:${kind}:${sha1(`${legacyFacts(on)}#${legacyOccurrence}`)}`,
    });

    if (!upcoming) {
      const amount = amounts.amount ?? null;
      const gross = amounts.gross ?? null;
      const occ = Math.abs(amounts.occupancyTax ?? 0);
      if (gross !== null && gross > 0) {
        add("booking_value", gross + occ);
        const fees = Math.abs(amounts.serviceFee ?? 0) + Math.abs(amounts.fastPayFee ?? 0);
        if (fees > 0) add("channel_fee", fees);
        const cleaning = Math.abs(amounts.cleaningFee ?? 0);
        if (cleaning > 0) add("cleaning_fee", cleaning);
        if (occ > 0) add("tax", occ);
        if (amount !== null && amount > 0) add("payout", amount);
      } else if (type === "tax" && amount !== null && amount > 0) {
        add("booking_value", amount);
        add("tax", amount);
        add("payout", amount);
      } else {
        const net = amount ?? (gross !== null ? gross - Math.abs(amounts.serviceFee ?? 0) - Math.abs(amounts.fastPayFee ?? 0) : null);
        if (net !== null && net !== 0) add("adjustment", net);
      }
    }

    const hasStay = !!(code && stay.checkIn && stay.checkOut);
    if (!money.length && !hasStay) {
      skipped++;
      return;
    }
    rows.push({
      rowNumber,
      typeLabel: typeLabel || "Airbnb",
      code,
      listing: clean(cell(row, "listing"), 200),
      guestName: clean(cell(row, "guest"), 120),
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      status: "confirmed",
      upcoming,
      money,
    });
    const group = identities.get(normalized) ?? [];
    group.push({ date, money });
    identities.set(normalized, group);
  });

  // Airbnb can reorder exports. Repeated otherwise-identical lines keep
  // their occurrence numbers when their date order stays the same.
  for (const [identity, group] of identities) {
    group.sort((a, b) => a.date.localeCompare(b.date));
    group.forEach(({ money }, index) => {
      const hash = sha1(`${identity}#${index + 1}`);
      for (const line of money) line.externalRef += `:${hash}`;
    });
  }
  problems.flush();
  if (payoutRows) warnings.push(warn("shortStays.import.warn.payoutRows", { n: payoutRows }));
  for (const [currency, n] of otherCurrencies) warnings.push(warn("shortStays.import.warn.otherCurrency", { n, currency }));
  if (cols.currency === undefined) warnings.push(warn("shortStays.import.warn.noCurrencyColumn"));
  for (const [type, n] of unknownTypes) warnings.push(warn("shortStays.import.warn.unknownType", { n, type }));
  if (upcomingRows) warnings.push(warn("shortStays.import.warn.upcoming", { n: upcomingRows }));
  if (remittedSen) warnings.push(warn("shortStays.import.warn.remittedTax", { amount: formatRM(remittedSen) }));

  return {
    kind: "airbnb_transactions",
    rowsTotal: body.length,
    rowsSkipped: skipped,
    rows,
    currency: currencies.size ? [...currencies].sort((a, b) => (a === "MYR" ? -1 : b === "MYR" ? 1 : a.localeCompare(b))).join(", ") : null,
    warnings,
  };
}

function parseReservations(body: string[][], width: number, cols: Partial<Record<ResField, number>>): ParsedAirbnbFile {
  const warnings: CsvImportWarning[] = [warn("shortStays.import.warn.noMoneyInReservations")];
  const problems = new Problems(warnings);
  const cell = (row: string[], f: ResField) => (cols[f] === undefined ? "" : (row[cols[f]!] ?? "").trim());
  const rows: AirbnbRow[] = [];
  const currencies = new Set<string>();
  let skipped = 0;

  body.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.length > width) {
      problems.add("shortStays.import.warn.extraColumns", { row: rowNumber });
      skipped++;
      return;
    }
    const code = readCode(cell(row, "code"));
    const stay = stayDates(cell(row, "start"), cell(row, "end"), cell(row, "nights"));
    if (stay.bad !== null) {
      problems.add("shortStays.import.warn.badDate", { row: rowNumber, value: stay.bad.slice(0, 40) });
      skipped++;
      return;
    }
    if (!code || !stay.checkIn || !stay.checkOut) {
      skipped++;
      return;
    }
    const earnings = parseAirbnbAmount(cell(row, "earnings"));
    if (earnings.ok && earnings.currency) currencies.add(earnings.currency);
    const status = cell(row, "status").toLowerCase();
    rows.push({
      rowNumber,
      typeLabel: "Reservation",
      code,
      listing: clean(cell(row, "listing"), 200),
      guestName: clean(cell(row, "guest"), 120),
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      status: /cancel|取消|キャンセル|annul|batal/.test(status) ? "cancelled" : /pending|request/.test(status) ? "tentative" : "confirmed",
      upcoming: false,
      money: [],
    });
  });
  problems.flush();
  return {
    kind: "airbnb_reservations",
    rowsTotal: body.length,
    rowsSkipped: skipped,
    rows,
    currency: currencies.size ? [...currencies].join(", ") : null,
    warnings,
  };
}
