import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CsvImportPreview, CsvImportResult, StayImportKind } from "../../../lib/api/contract";
import type { IsoDate } from "../../../lib/domain/dates";
import { t } from "../../../lib/i18n";
import type { Core } from "../context";
import { AppError, validationError } from "../errors";
import { cancelReservation, insertReservation, updateReservationDetails } from "../services/reservations";
import { newId } from "../services/shared";
import { parseAirbnbCsv, type AirbnbRow, type MoneyLine, type ParsedAirbnbFile } from "./airbnb-csv";
import { CsvSyntaxError } from "./csv";

/**
 * Two-step CSV import: `open` reads and parses a file and holds the parsed
 * rows in memory under a random token (nothing is written); `commit` applies
 * them in one transaction with the landlord's listing → space choices;
 * `discard` forgets them. Tokens expire after 30 minutes and belong to the
 * workspace (database) they were opened in.
 */

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const IMPORT_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 5;
/** settings key: { [listing title]: spaceId }, remembered from the last commit. */
export const LISTING_MAP_SETTING = "airbnbListingMap";

interface Session {
  dbPath: string;
  fileName: string;
  parsed: ParsedAirbnbFile;
  expiresAt: number;
}

interface Found {
  id: string;
  property_id: string;
  space_id: string;
  guest_name: string;
  status: string;
}

interface StayGroup {
  code: string;
  listing: string;
  guestName: string;
  checkIn: IsoDate | null;
  checkOut: IsoDate | null;
  status: "confirmed" | "tentative" | "cancelled";
}

/** Read an import file: size limit, not a binary/spreadsheet, UTF-8 (Windows-1252 fallback for Excel re-saves). */
export function readImportFile(filePath: string): string {
  let bytes: Buffer;
  try {
    if (fs.statSync(filePath).size > MAX_IMPORT_BYTES) throw new AppError("VALIDATION", "errors.money.fileTooLarge");
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("NOT_FOUND", "errors.money.unreadable");
  }
  if (bytes.length > MAX_IMPORT_BYTES) throw new AppError("VALIDATION", "errors.money.fileTooLarge");
  const head = bytes.subarray(0, 4096);
  if ((head[0] === 0x50 && head[1] === 0x4b) || head.includes(0)) throw new AppError("VALIDATION", "errors.money.notText");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function groupStays(rows: readonly AirbnbRow[]): Map<string, StayGroup> {
  const out = new Map<string, StayGroup>();
  for (const r of rows) {
    if (!r.code) continue;
    let g = out.get(r.code);
    if (!g) {
      g = { code: r.code, listing: "", guestName: "", checkIn: null, checkOut: null, status: r.status };
      out.set(r.code, g);
    }
    if (!g.listing && r.listing) g.listing = r.listing;
    if (!g.guestName && r.guestName) g.guestName = r.guestName;
    if (!g.checkIn && r.checkIn && r.checkOut) {
      g.checkIn = r.checkIn;
      g.checkOut = r.checkOut;
    }
    if (r.status !== "cancelled") g.status = r.status;
  }
  return out;
}

/** The HavenOS stay an Airbnb confirmation code refers to, if any. */
function findReservation(core: Core, code: string, spaceId: string | null, checkIn: IsoDate | null, checkOut: IsoDate | null): Found | null {
  const cols = "r.id, r.property_id, r.space_id, r.guest_name, r.status";
  const byCode = core.db.get<Found>(`SELECT ${cols} FROM reservations r WHERE r.channel = 'airbnb' AND r.channel_reservation_id = ?`, [code]);
  if (byCode) return byCode;
  // A calendar-synced stay keyed by its feed UID, whose event carried the code.
  const byEvent = core.db.get<Found>(
    `SELECT ${cols} FROM channel_events e JOIN reservations r ON r.id = e.reservation_id
     WHERE e.confirmation_code = ? AND r.channel = 'airbnb' ORDER BY e.last_seen_at DESC LIMIT 1`,
    [code],
  );
  if (byEvent) return byEvent;
  if (!spaceId || !checkIn || !checkOut) return null;
  // Same space, same nights, synced from Airbnb without a code of its own.
  const same = core.db.all<Found>(
    `SELECT ${cols} FROM reservations r
     WHERE r.space_id = ? AND r.channel = 'airbnb' AND r.check_in = ? AND r.check_out = ? AND r.status <> 'cancelled'
       AND (r.channel_reservation_id IS NULL OR r.channel_reservation_id LIKE '%@%')
     LIMIT 2`,
    [spaceId, checkIn, checkOut],
  );
  return same.length === 1 ? same[0] : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function activeSpace(core: Core, id: string | null | undefined): { id: string; property_id: string } | null {
  if (!id) return null;
  return core.db.get<{ id: string; property_id: string }>("SELECT id, property_id FROM spaces WHERE id = ? AND archived_at IS NULL", [id]) ?? null;
}

export function rememberedListingMap(core: Core): Record<string, string> {
  const row = core.db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [LISTING_MAP_SETTING]);
  if (!row) return Object.create(null);
  try {
    const v = JSON.parse(row.value) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return Object.create(null);
    const out: Record<string, string> = Object.create(null);
    for (const [name, id] of Object.entries(v)) if (typeof id === "string") out[name] = id;
    return out;
  } catch {
    return Object.create(null);
  }
}

function suggestSpace(core: Core, listing: string, codes: readonly string[], remembered: Record<string, string>): string | null {
  const known = activeSpace(core, remembered[listing]);
  if (known) return known.id;
  const counts = new Map<string, number>();
  for (const code of codes) {
    const r = findReservation(core, code, null, null, null);
    if (r && activeSpace(core, r.space_id)) counts.set(r.space_id, (counts.get(r.space_id) ?? 0) + 1);
  }
  if (counts.size) return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const name = norm(listing);
  if (!name) return null;
  const matches = core.db
    .all<{ space_id: string; name: string }>(
      "SELECT c.space_id, c.name FROM channel_connections c JOIN spaces s ON s.id = c.space_id WHERE c.channel = 'airbnb' AND c.removed_at IS NULL AND s.archived_at IS NULL",
    )
    .filter((c) => {
      const n = norm(c.name);
      return n !== "" && (n.includes(name) || name.includes(n));
    });
  return matches.length === 1 ? matches[0].space_id : null;
}

interface ImportedMoney {
  id: string;
  external_ref: string;
  occurred_on: IsoDate;
  description: string;
}

function findImportedMoney(core: Core, line: MoneyLine): ImportedMoney | null {
  const columns = "id, external_ref, occurred_on, description";
  const current = core.db.get<ImportedMoney>(`SELECT ${columns} FROM stay_ledger WHERE external_ref = ?`, [line.externalRef]);
  if (current) return current;
  const prefix = line.externalRef.slice(0, line.externalRef.lastIndexOf(":") + 1);
  const candidates = core.db.all<ImportedMoney>(
    `SELECT ${columns} FROM stay_ledger WHERE source = 'imported' AND external_ref >= ? AND external_ref < ?`,
    [prefix, `${prefix}\uffff`],
  );
  const matching = candidates.filter((entry) => entry.external_ref === line.legacyRefForDate(entry.occurred_on));
  return matching.find((entry) => entry.occurred_on === line.occurredOn) ?? matching[0] ?? null;
}

function moneyUnchanged(core: Core, lines: readonly MoneyLine[]): boolean {
  return lines.every((line) => findImportedMoney(core, line)?.occurred_on === line.occurredOn);
}

export class ImportSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly clock: () => number = Date.now) {}

  private prune() {
    const now = this.clock();
    for (const [token, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(token);
    while (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
  }

  private get(core: Core, token: string): Session {
    const s = this.sessions.get(token);
    if (!s || s.expiresAt <= this.clock() || s.dbPath !== core.dbPath) {
      this.sessions.delete(token);
      throw new AppError("NOT_FOUND", "errors.money.importExpired");
    }
    return s;
  }

  /** Read and parse a file; nothing is written. */
  open(core: Core, filePath: string): CsvImportPreview {
    const text = readImportFile(filePath);
    return this.openText(core, path.basename(filePath), text);
  }

  openText(core: Core, fileName: string, text: string): CsvImportPreview {
    let parsed: ParsedAirbnbFile;
    try {
      parsed = parseAirbnbCsv(text, core.today());
    } catch (err) {
      if (err instanceof CsvSyntaxError) throw new AppError("VALIDATION", "errors.money.malformedCsv", { params: { line: err.line } });
      throw err;
    }
    this.prune();
    const token = crypto.randomUUID();
    this.sessions.set(token, { dbPath: core.dbPath, fileName: fileName.slice(0, 200), parsed, expiresAt: this.clock() + IMPORT_TTL_MS });
    return this.preview(core, token);
  }

  discard(token: string) {
    this.sessions.delete(token);
  }

  preview(core: Core, token: string): CsvImportPreview {
    const { parsed, fileName } = this.get(core, token);
    const remembered = rememberedListingMap(core);
    const stays = groupStays(parsed.rows);
    const byListing = new Map<string, { rows: number; codes: Set<string> }>();
    for (const r of parsed.rows) {
      const listing = r.listing || (r.code ? stays.get(r.code)?.listing : "") || "";
      if (!listing) continue;
      const entry = byListing.get(listing) ?? { rows: 0, codes: new Set<string>() };
      entry.rows++;
      if (r.code) entry.codes.add(r.code);
      byListing.set(listing, entry);
    }
    const listings = [...byListing.entries()]
      .map(([name, e]) => ({ name, rows: e.rows, suggestedSpaceId: suggestSpace(core, name, [...e.codes], remembered) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const suggested = new Map(listings.map((l) => [l.name, l.suggestedSpaceId]));

    let matched = 0;
    let fresh = 0;
    let willCancel = 0;
    const found = new Map<string, Found | null>();
    for (const g of stays.values()) {
      const r = findReservation(core, g.code, suggested.get(g.listing) ?? null, g.checkIn, g.checkOut);
      found.set(g.code, r);
      if (r) {
        matched++;
        if (g.status === "cancelled" && r.status !== "cancelled") willCancel++;
      } else if (g.checkIn && g.checkOut && g.status !== "cancelled") fresh++;
    }

    let duplicates = 0;
    let noListing = 0;
    for (const r of parsed.rows) {
      const listing = r.listing || (r.code ? stays.get(r.code)?.listing : "") || "";
      if (!listing && !(r.code && found.get(r.code))) {
        noListing++;
        continue;
      }
      if (r.money.length) {
        if (moneyUnchanged(core, r.money)) duplicates++;
      } else if (parsed.kind === "airbnb_reservations" && r.code) {
        const existing = found.get(r.code);
        if (existing && (existing.guest_name || !r.guestName) && (r.status !== "cancelled" || existing.status === "cancelled")) duplicates++;
      }
    }
    const warnings = [...parsed.warnings];
    if (noListing) warnings.push({ key: "shortStays.import.warn.noListing", params: { n: noListing } });
    if (willCancel) warnings.push({ key: "shortStays.import.warn.willCancel", params: { n: willCancel } });

    return {
      token,
      kind: parsed.kind,
      fileName,
      rowsTotal: parsed.rowsTotal,
      rowsUsable: parsed.rows.length - noListing,
      rowsSkipped: parsed.rowsSkipped + noListing,
      duplicates,
      listings,
      matchedReservations: matched,
      newReservations: fresh,
      currency: parsed.currency,
      warnings,
    };
  }

  /** Apply a previewed file in one transaction. `listingMap`: listing title → space id, or null to leave it out. */
  commit(core: Core, token: string, listingMap: Record<string, string | null>): CsvImportResult {
    const session = this.get(core, token);
    const { parsed } = session;
    const stays = groupStays(parsed.rows);
    const listingNames = new Set<string>();
    for (const r of parsed.rows) if (r.listing) listingNames.add(r.listing);

    const spaces = new Map<string, { id: string; property_id: string } | null>();
    const fields: Record<string, "errors.money.listingUnknown" | "errors.money.spaceMissing"> = {};
    for (const [name, spaceId] of Object.entries(listingMap)) {
      if (!listingNames.has(name)) {
        fields[`listingMap.${name}`] = "errors.money.listingUnknown";
        continue;
      }
      if (spaceId === null) {
        spaces.set(name, null);
        continue;
      }
      const space = activeSpace(core, spaceId);
      if (!space) fields[`listingMap.${name}`] = "errors.money.spaceMissing";
      else spaces.set(name, space);
    }
    if (Object.keys(fields).length) throw validationError(fields);

    const result = core.db.tx(() => {
      const importId = newId();
      const now = core.nowIso();
      core.db.run(
        "INSERT INTO stay_imports (id, kind, file_name, rows_total, created_at) VALUES (?, ?, ?, ?, ?)",
        [importId, parsed.kind satisfies StayImportKind, session.fileName, parsed.rowsTotal, now],
      );
      const out: CsvImportResult = {
        importId,
        rowsImported: 0,
        rowsSkipped: parsed.rowsSkipped,
        duplicates: 0,
        reservationsCreated: 0,
        reservationsUpdated: 0,
        ledgerEntries: 0,
        conflicts: [],
      };

      // 1. Stays, once per confirmation code.
      const resolved = new Map<string, Found | null>();
      const changedCodes = new Set<string>();
      const updatedIds = new Set<string>();
      for (const g of stays.values()) {
        const mapped = g.listing ? spaces.get(g.listing) : undefined;
        if (g.listing && !mapped) {
          resolved.set(g.code, null); // listing left out (or not mapped) by the landlord
          continue;
        }
        let r = findReservation(core, g.code, mapped?.id ?? null, g.checkIn, g.checkOut);
        if (r) {
          if (g.guestName && !r.guest_name) {
            updateReservationDetails(core, r.id, { guestName: g.guestName }, "csv");
            updatedIds.add(r.id);
            changedCodes.add(g.code);
          }
          if (g.status === "cancelled" && r.status !== "cancelled") {
            cancelReservation(core, r.id, "", "csv");
            updatedIds.add(r.id);
            changedCodes.add(g.code);
          }
        } else if (mapped && g.checkIn && g.checkOut && g.status !== "cancelled") {
          try {
            const id = insertReservation(core, {
              spaceId: mapped.id,
              guestName: g.guestName,
              guestCount: null,
              checkIn: g.checkIn,
              checkOut: g.checkOut,
              checkInTime: null,
              checkOutTime: null,
              status: g.status,
              channel: "airbnb",
              channelReservationId: g.code,
              connectionId: null,
              source: "csv",
              notes: "",
            });
            out.reservationsCreated++;
            changedCodes.add(g.code);
            r = { id, property_id: mapped.property_id, space_id: mapped.id, guest_name: g.guestName, status: g.status };
          } catch (err) {
            if (!(err instanceof AppError) || err.code !== "CONFLICT") throw err;
            out.conflicts.push({ confirmationCode: g.code, message: err.message });
          }
        }
        resolved.set(g.code, r);
      }
      out.reservationsUpdated = updatedIds.size;

      // 2. Money, one ledger row per line and kind; a changed payout date updates the existing row.
      const consumed = new Set<string>();
      for (const row of parsed.rows) {
        const listing = row.listing || (row.code ? stays.get(row.code)?.listing : "") || "";
        const mapped = listing ? spaces.get(listing) : undefined;
        if (listing && !mapped) {
          out.rowsSkipped++;
          continue;
        }
        const stay = row.code ? (resolved.get(row.code) ?? null) : null;
        const target = stay ? { reservationId: stay.id, propertyId: stay.property_id, spaceId: stay.space_id } : mapped ? { reservationId: null, propertyId: mapped.property_id, spaceId: mapped.id } : null;
        if (!target) {
          out.rowsSkipped++;
          continue;
        }
        if (!row.money.length) {
          if (row.code && changedCodes.has(row.code) && !consumed.has(row.code)) {
            consumed.add(row.code);
            out.rowsImported++;
          } else if (stay) out.duplicates++;
          else out.rowsSkipped++;
          continue;
        }
        let inserted = 0;
        let updated = 0;
        for (const m of row.money) {
          const existing = findImportedMoney(core, m);
          if (existing) {
            const moved = existing.occurred_on !== m.occurredOn;
            if (moved || existing.external_ref !== m.externalRef) {
              const description = moved
                ? `${existing.description} · ${t("shortStays.import.previousPayoutDate", { date: existing.occurred_on })}`
                : existing.description;
              core.db.run("UPDATE stay_ledger SET occurred_on = ?, external_ref = ?, description = ?, updated_at = ? WHERE id = ?", [
                m.occurredOn, m.externalRef, description, now, existing.id,
              ]);
            }
            if (moved) updated++;
            continue;
          }
          inserted += core.db.run(
            `INSERT OR IGNORE INTO stay_ledger (id, reservation_id, property_id, space_id, channel, kind, amount_sen, occurred_on, source, import_id, external_ref, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'airbnb', ?, ?, ?, 'imported', ?, ?, ?, ?, ?)`,
            [newId(), target.reservationId, target.propertyId, target.spaceId, m.kind, m.amountSen, m.occurredOn, importId, m.externalRef, row.typeLabel, now, now],
          ).changes;
        }
        out.ledgerEntries += inserted;
        if (inserted || updated) out.rowsImported++;
        else out.duplicates++;
      }

      // 3. Remember the landlord's listing choices for next time.
      const remembered = rememberedListingMap(core);
      for (const [name, space] of spaces) {
        if (space) remembered[name] = space.id;
        else delete remembered[name];
      }
      core.db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
        LISTING_MAP_SETTING,
        JSON.stringify(remembered),
      ]);
      core.db.run("UPDATE stay_imports SET rows_imported = ?, rows_skipped = ? WHERE id = ?", [out.rowsImported, out.rowsSkipped + out.duplicates, importId]);
      return out;
    });
    this.sessions.delete(token);
    return result;
  }
}
