import type { LedgerEntry, LedgerInput } from "../../../lib/api/contract";
import type { IsoDate } from "../../../lib/domain/dates";
import { isOneOf, LEDGER_KINDS, RESERVATION_CHANNELS, STAY_EXPENSE_CATEGORIES, type LedgerKind, type ReservationChannel, type StayExpenseCategory } from "../../../lib/domain/enums";
import { MAX_SEN } from "../../../lib/domain/money";
import { asObject, done, readDate, readEnum, readId, readText, type FieldErrors, type Validated } from "../../../lib/domain/validate";
import type { Core } from "../context";
import { AppError, notFound, validationError } from "../errors";
import { allSpacePaths, newId } from "./shared";

/**
 * The short-stay money ledger. 'entered' rows are typed by the landlord here;
 * 'imported' rows are written by the channel CSV importer (imports/) and are
 * idempotent on external_ref. Nothing is deleted: a wrong entry is voided and
 * stays visible (and a voided imported row is never re-created by a re-import).
 *
 * Sign rule: amounts are positive (a fee or an expense is a positive cost);
 * only adjustments may be negative.
 */

export const DESCRIPTION_MAX = 500;

interface LedgerRow {
  id: string;
  reservation_id: string | null;
  property_id: string;
  space_id: string | null;
  channel: ReservationChannel;
  kind: LedgerKind;
  amount_sen: number;
  occurred_on: string;
  source: "imported" | "entered";
  import_id: string | null;
  category: StayExpenseCategory | "";
  description: string;
  voided_at: string | null;
  created_at: string;
  property_name: string;
}

/** Shape checks only; checks that need the database happen in createLedgerEntry. */
export function validateLedgerInput(input: unknown): Validated<LedgerInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const kind = readEnum(o, "kind", LEDGER_KINDS, f);
  const raw = o.amountSen;
  let amountSen = 0;
  if (raw === null || raw === undefined) f.amountSen = "validation.required";
  else if (typeof raw !== "number" || !Number.isSafeInteger(raw)) f.amountSen = "validation.invalidAmount";
  else if (Math.abs(raw) > MAX_SEN) f.amountSen = "validation.amountTooLarge";
  else if (raw < 0 && kind !== "adjustment") f.amountSen = "errors.money.negativeAmount";
  else if (raw === 0) f.amountSen = kind === "adjustment" ? "errors.money.amountZero" : "validation.amountPositive";
  else amountSen = raw;
  const rawCategory = o.category ?? "";
  let category: StayExpenseCategory | "" = "";
  if (rawCategory !== "" && !isOneOf(STAY_EXPENSE_CATEGORIES, rawCategory)) f.category = "validation.chooseOne";
  else if (kind === "expense") {
    if (rawCategory === "") f.category = "errors.money.expenseCategory";
    else category = rawCategory as StayExpenseCategory;
  }
  const value: LedgerInput = {
    reservationId: readId(o, "reservationId", f, { required: false }),
    propertyId: readId(o, "propertyId", f) ?? "",
    spaceId: readId(o, "spaceId", f, { required: false }),
    channel: readEnum(o, "channel", RESERVATION_CHANNELS, f),
    kind,
    amountSen,
    occurredOn: readDate(o, "occurredOn", f, { required: true }) ?? "",
    category,
    description: readText(o, "description", f, { max: DESCRIPTION_MAX }),
  };
  return done(f, value);
}

const SELECT = `SELECT l.*, p.name AS property_name FROM stay_ledger l JOIN properties p ON p.id = l.property_id`;

function toEntry(r: LedgerRow, paths: Map<string, string>): LedgerEntry {
  return {
    id: r.id,
    reservationId: r.reservation_id,
    propertyId: r.property_id,
    spaceId: r.space_id,
    channel: r.channel,
    kind: r.kind,
    amountSen: r.amount_sen,
    occurredOn: r.occurred_on,
    category: r.category,
    description: r.description,
    source: r.source,
    importId: r.import_id,
    propertyName: r.property_name,
    spacePath: r.space_id ? (paths.get(r.space_id) ?? null) : null,
    voidedAt: r.voided_at,
    createdAt: r.created_at,
  };
}

export function getLedgerEntry(core: Core, id: string): LedgerEntry {
  const row = core.db.get<LedgerRow>(`${SELECT} WHERE l.id = ?`, [id]);
  if (!row) throw notFound();
  return toEntry(row, allSpacePaths(core));
}

/** Record an amount the landlord typed. Links to the stay's space and channel when a stay is given. */
export function createLedgerEntry(core: Core, input: LedgerInput): LedgerEntry {
  const f: FieldErrors = {};
  const property = core.db.get<{ id: string }>("SELECT id FROM properties WHERE id = ?", [input.propertyId]);
  if (!property) f.propertyId = "errors.money.propertyMissing";
  let spaceId = input.spaceId;
  let channel = input.channel;
  if (spaceId) {
    const space = core.db.get<{ property_id: string }>("SELECT property_id FROM spaces WHERE id = ?", [spaceId]);
    if (!space || space.property_id !== input.propertyId) f.spaceId = "errors.money.spaceNotInProperty";
  }
  if (input.reservationId) {
    const r = core.db.get<{ property_id: string; space_id: string; channel: ReservationChannel }>(
      "SELECT property_id, space_id, channel FROM reservations WHERE id = ?",
      [input.reservationId],
    );
    if (!r) f.reservationId = "errors.notFound";
    else if (r.property_id !== input.propertyId || (spaceId && spaceId !== r.space_id)) f.reservationId = "errors.money.reservationMismatch";
    else {
      spaceId = r.space_id;
      // A stay's money belongs to the stay's channel, so reports group it together.
      channel = r.channel;
    }
  }
  if (Object.keys(f).length) throw validationError(f);
  const id = newId();
  const now = core.nowIso();
  core.db.run(
    `INSERT INTO stay_ledger (id, reservation_id, property_id, space_id, channel, kind, amount_sen, occurred_on, source, category, description, created_at, updated_at)
     VALUES ($id, $reservationId, $propertyId, $spaceId, $channel, $kind, $amountSen, $occurredOn, 'entered', $category, $description, $now, $now)`,
    { ...input, id, spaceId, channel, now },
  );
  return getLedgerEntry(core, id);
}

export function voidLedgerEntry(core: Core, id: string) {
  const row = core.db.get<{ voided_at: string | null }>("SELECT voided_at FROM stay_ledger WHERE id = ?", [id]);
  if (!row) throw notFound();
  if (row.voided_at) throw new AppError("NOT_ALLOWED", "errors.money.entryVoided");
  const now = core.nowIso();
  core.db.run("UPDATE stay_ledger SET voided_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
}

export interface LedgerFilter {
  from: IsoDate;
  to: IsoDate;
  propertyId: string | null;
  reservationId: string | null;
}

/** Entries with occurred_on in [from, to], newest first. Voided entries are included (voidedAt set). */
export function listLedger(core: Core, filter: LedgerFilter): LedgerEntry[] {
  const rows = core.db.all<LedgerRow>(
    `${SELECT}
     WHERE l.occurred_on BETWEEN $from AND $to
       AND ($propertyId IS NULL OR l.property_id = $propertyId)
       AND ($reservationId IS NULL OR l.reservation_id = $reservationId)
     ORDER BY l.occurred_on DESC, l.created_at DESC, l.kind`,
    { ...filter },
  );
  const paths = allSpacePaths(core);
  return rows.map((r) => toEntry(r, paths));
}
