/**
 * Validation shared by the forms (for instant feedback) and the desktop main
 * process (the authority — it treats every IPC payload as untrusted `unknown`
 * and re-validates before touching the database).
 *
 * Errors are i18n message keys keyed by field name.
 */

import type {
  ChargeInput,
  ChargeUpdate,
  DepositInput,
  MaintenanceInput,
  MoveInInput,
  MoveOutInput,
  PaymentInput,
  PropertyInput,
  ScheduleChangeInput,
  SettingsInput,
  SpaceInput,
  SpaceUpdate,
  TenancyCreate,
  TenancyUpdate,
  TenantInput,
} from "../api/contract";
import type { MessageKey } from "../i18n";
import { isIsoDate, isYearMonth, monthOf, type IsoDate, type YearMonth } from "./dates";
import {
  CHARGE_KINDS,
  DEPOSIT_ENTRY_KINDS,
  DEPOSIT_TYPES,
  isOneOf,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  MY_STATES,
  PAYMENT_METHODS,
  PROPERTY_TYPES,
  RENTAL_MODES,
  ROOM_TYPES,
  SPACE_KINDS,
} from "./enums";
import { MAX_SEN, type ParseMoneyError, type Sen } from "./money";
import { normalizePhone } from "./phone";

export type FieldErrors = Record<string, MessageKey>;
export type Validated<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

export const LIMITS = {
  name: 120,
  label: 60,
  line: 200,
  text: 5000,
  terms: 20000,
} as const;

// ── Readers ────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

export function asObject(value: unknown): Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}

export function readText(o: Obj, key: string, f: FieldErrors, opts: { required?: boolean; max?: number } = {}): string {
  const raw = o[key];
  const value = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : null;
  if (value === null) {
    f[key] = "validation.required";
    return "";
  }
  if (opts.required && value === "") f[key] = "validation.required";
  else if (value.length > (opts.max ?? LIMITS.line)) f[key] = "validation.tooLong";
  return value;
}

export function readInt(
  o: Obj,
  key: string,
  f: FieldErrors,
  opts: { min: number; max: number; required?: boolean; error?: MessageKey },
): number | null {
  const raw = o[key];
  if (raw === null || raw === undefined || raw === "") {
    if (opts.required) f[key] = "validation.required";
    return null;
  }
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < opts.min || n > opts.max) {
    f[key] = opts.error ?? "validation.invalidNumber";
    return null;
  }
  return n;
}

export function readSen(o: Obj, key: string, f: FieldErrors, opts: { required?: boolean; positive?: boolean } = {}): Sen | null {
  const raw = o[key];
  if (raw === null || raw === undefined) {
    if (opts.required) f[key] = "validation.required";
    return null;
  }
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    f[key] = "validation.invalidAmount";
    return null;
  }
  if (raw < 0) f[key] = "validation.amountNegative";
  else if (raw > MAX_SEN) f[key] = "validation.amountTooLarge";
  else if (opts.positive && raw === 0) f[key] = "validation.amountPositive";
  return raw;
}

export function readDate(o: Obj, key: string, f: FieldErrors, opts: { required?: boolean } = {}): IsoDate | null {
  const raw = o[key];
  if (raw === null || raw === undefined || raw === "") {
    if (opts.required) f[key] = "validation.required";
    return null;
  }
  if (!isIsoDate(raw)) {
    f[key] = "validation.invalidDate";
    return null;
  }
  return raw;
}

export function readMonth(o: Obj, key: string, f: FieldErrors): YearMonth {
  const raw = o[key];
  if (!isYearMonth(raw)) {
    f[key] = "validation.invalidMonth";
    return "1970-01";
  }
  return raw;
}

export function readEnum<T extends string>(o: Obj, key: string, list: readonly T[], f: FieldErrors): T {
  const raw = o[key];
  if (!isOneOf(list, raw)) {
    f[key] = "validation.chooseOne";
    return list[0];
  }
  return raw;
}

export function readId(o: Obj, key: string, f: FieldErrors, opts: { required?: boolean } = { required: true }): string | null {
  const raw = o[key];
  if (raw === null || raw === undefined || raw === "") {
    if (opts.required) f[key] = "validation.required";
    return null;
  }
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(raw)) {
    f[key] = "validation.chooseOne";
    return null;
  }
  return raw;
}

export function readBool(o: Obj, key: string): boolean {
  return o[key] === true;
}

export function readPhone(o: Obj, key: string, f: FieldErrors, required = false): string {
  const raw = readText(o, key, f, { required, max: 40 });
  if (!raw || f[key]) return raw;
  const parsed = normalizePhone(raw);
  if (!parsed.ok) {
    f[key] = "validation.invalidPhone";
    return raw;
  }
  return parsed.e164;
}

function readEmail(o: Obj, key: string, f: FieldErrors): string {
  const raw = readText(o, key, f, { max: 200 });
  if (raw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) f[key] = "validation.invalidEmail";
  return raw.toLowerCase();
}

export function done<T>(f: FieldErrors, value: T): Validated<T> {
  return Object.keys(f).length ? { ok: false, fields: f } : { ok: true, value };
}

export function moneyErrorKey(error: ParseMoneyError): MessageKey {
  switch (error) {
    case "empty":
      return "validation.required";
    case "negative":
      return "validation.amountNegative";
    case "too_precise":
      return "validation.amountTooPrecise";
    case "too_large":
      return "validation.amountTooLarge";
    default:
      return "validation.invalidAmount";
  }
}

/** "2", "0.5", "1.5" months → tenths (20, 5, 15). */
export function parseMonthsToTenths(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,2}(\.\d)?$/.test(s)) return null;
  const tenths = Math.round(Number(s) * 10);
  return tenths >= 0 && tenths <= 120 ? tenths : null;
}

// ── Entities ───────────────────────────────────────────────────────────────

export function validatePropertyInput(input: unknown): Validated<PropertyInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const postcode = readText(o, "postcode", f, { required: true, max: 5 });
  if (postcode && !f.postcode && !/^\d{5}$/.test(postcode)) f.postcode = "validation.invalidPostcode";
  const value: PropertyInput = {
    name: readText(o, "name", f, { required: true, max: LIMITS.name }),
    propertyType: readEnum(o, "propertyType", PROPERTY_TYPES, f),
    addressLine1: readText(o, "addressLine1", f, { required: true }),
    addressLine2: readText(o, "addressLine2", f),
    postcode,
    city: readText(o, "city", f, { required: true, max: 80 }),
    state: readEnum(o, "state", MY_STATES, f),
    notes: readText(o, "notes", f, { max: LIMITS.text }),
    rentDueDay: readInt(o, "rentDueDay", f, { min: 1, max: 31, required: true, error: "validation.dueDayRange" }) ?? 1,
    securityDepositTenths:
      readInt(o, "securityDepositTenths", f, { min: 0, max: 120, required: true, error: "validation.depositMonthsRange" }) ?? 0,
    utilityDepositTenths:
      readInt(o, "utilityDepositTenths", f, { min: 0, max: 120, required: true, error: "validation.depositMonthsRange" }) ?? 0,
    defaultTenancyMonths:
      readInt(o, "defaultTenancyMonths", f, { min: 1, max: 120, required: true, error: "validation.tenancyMonthsRange" }) ?? 12,
    defaultTerms: readText(o, "defaultTerms", f, { max: LIMITS.terms }),
  };
  return done(f, value);
}

function readSpaceFields(o: Obj, f: FieldErrors, kind: string) {
  return {
    label: readText(o, "label", f, { required: true, max: LIMITS.label }),
    rentalMode: kind === "unit" ? readEnum(o, "rentalMode", RENTAL_MODES, f) : null,
    floor: readText(o, "floor", f, { max: 20 }),
    sizeSqft: readInt(o, "sizeSqft", f, { min: 1, max: 100_000, error: "validation.sizeRange" }),
    bedrooms: kind === "unit" ? readInt(o, "bedrooms", f, { min: 0, max: 50, error: "validation.countRange" }) : null,
    bathrooms: kind === "unit" ? readInt(o, "bathrooms", f, { min: 0, max: 50, error: "validation.countRange" }) : null,
    roomType: kind === "room" && o.roomType != null ? readEnum(o, "roomType", ROOM_TYPES, f) : null,
    defaultRentSen: readSen(o, "defaultRentSen", f) ?? 0,
    notes: readText(o, "notes", f, { max: LIMITS.text }),
  };
}

export function validateSpaceInput(input: unknown): Validated<SpaceInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const kind = readEnum(o, "kind", SPACE_KINDS, f);
  const propertyId = readId(o, "propertyId", f) ?? "";
  const parentId = readId(o, "parentId", f, { required: kind !== "unit" });
  if (kind === "unit" && parentId) f.parentId = "errors.wrongParent";
  return done(f, { propertyId, parentId: kind === "unit" ? null : parentId, kind, ...readSpaceFields(o, f, kind) });
}

export function validateSpaceUpdate(input: unknown, kind: string): Validated<SpaceUpdate> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const id = readId(o, "id", f) ?? "";
  return done(f, { id, ...readSpaceFields(o, f, kind) });
}

export function validateTenantInput(input: unknown): Validated<TenantInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, {
    fullName: readText(o, "fullName", f, { required: true, max: LIMITS.name }),
    phone: readPhone(o, "phone", f),
    email: readEmail(o, "email", f),
    emergencyName: readText(o, "emergencyName", f, { max: LIMITS.name }),
    emergencyPhone: readPhone(o, "emergencyPhone", f),
    notes: readText(o, "notes", f, { max: LIMITS.text }),
  });
}

function readTenancyTerms(o: Obj, f: FieldErrors) {
  const startDate = readDate(o, "startDate", f, { required: true }) ?? "1970-01-01";
  const endDate = readDate(o, "endDate", f);
  if (endDate && !f.startDate && endDate < startDate) f.endDate = "validation.endBeforeStart";
  return {
    startDate,
    endDate,
    securityDepositSen: readSen(o, "securityDepositSen", f, { required: true }) ?? 0,
    utilityDepositSen: readSen(o, "utilityDepositSen", f, { required: true }) ?? 0,
    terms: readText(o, "terms", f, { max: LIMITS.terms }),
  };
}

export function validateTenancyCreate(input: unknown): Validated<TenancyCreate> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const base = readTenancyTerms(o, f);
  const tenantId = readId(o, "tenantId", f, { required: false });
  let newTenant: TenantInput | null = null;
  if (!tenantId) {
    if (o.newTenant == null) f.tenantId = "validation.chooseTenant";
    else {
      const nt = validateTenantInput(o.newTenant);
      if (nt.ok) newTenant = nt.value;
      else for (const [k, v] of Object.entries(nt.fields)) f[`newTenant.${k}`] = v;
    }
  }
  const rentStartMonth = readMonth(o, "rentStartMonth", f);
  if (!f.rentStartMonth && !f.startDate && rentStartMonth < monthOf(base.startDate)) {
    f.rentStartMonth = "validation.rentStartBeforeTenancy";
  }
  if (!f.rentStartMonth && base.endDate && rentStartMonth > monthOf(base.endDate)) {
    f.rentStartMonth = "validation.rentStartAfterEnd";
  }
  return done(f, {
    ...base,
    tenantId,
    newTenant,
    spaceId: readId(o, "spaceId", f) ?? "",
    monthlyRentSen: readSen(o, "monthlyRentSen", f, { required: true, positive: true }) ?? 0,
    rentDueDay: readInt(o, "rentDueDay", f, { min: 1, max: 31, required: true, error: "validation.dueDayRange" }) ?? 1,
    rentStartMonth,
    stagingKey: readId(o, "stagingKey", f, { required: false }),
  });
}

export function validateTenancyUpdate(input: unknown): Validated<TenancyUpdate> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const base = readTenancyTerms(o, f);
  return done(f, { ...base, id: readId(o, "id", f) ?? "" });
}

export function validateMoveIn(input: unknown): Validated<MoveInInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const list = Array.isArray(o.depositReceived) ? o.depositReceived : [];
  const depositReceived: MoveInInput["depositReceived"] = [];
  list.forEach((raw, i) => {
    const d = asObject(raw);
    const df: FieldErrors = {};
    const amount = readSen(d, "amountSen", df, { required: true, positive: true });
    const entry = {
      depositType: readEnum(d, "depositType", DEPOSIT_TYPES, df),
      amountSen: amount ?? 0,
      method: readEnum(d, "method", PAYMENT_METHODS, df),
      reference: readText(d, "reference", df),
    };
    for (const [k, v] of Object.entries(df)) f[`depositReceived.${i}.${k}`] = v;
    depositReceived.push(entry);
  });
  return done(f, {
    id: readId(o, "id", f) ?? "",
    movedInOn: readDate(o, "movedInOn", f, { required: true }) ?? "1970-01-01",
    notes: readText(o, "notes", f, { max: LIMITS.text }),
    depositReceived,
  });
}

export function validateMoveOut(input: unknown): Validated<MoveOutInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  let deposit: MoveOutInput["deposit"] = null;
  if (o.deposit != null) {
    const d = asObject(o.deposit);
    const refundSen = readSen(d, "refundSen", f, { required: true }) ?? 0;
    const deductSen = readSen(d, "deductSen", f, { required: true }) ?? 0;
    const deductReason = readText(d, "deductReason", f, { max: LIMITS.line });
    if (deductSen > 0 && !deductReason) f["deposit.deductReason"] = "validation.deductReason";
    deposit = {
      refundSen,
      deductSen,
      deductReason,
      method: d.method == null ? null : readEnum(d, "method", PAYMENT_METHODS, f),
      reference: readText(d, "reference", f),
    };
  }
  return done(f, {
    id: readId(o, "id", f) ?? "",
    movedOutOn: readDate(o, "movedOutOn", f, { required: true }) ?? "1970-01-01",
    notes: readText(o, "notes", f, { max: LIMITS.text }),
    voidChargesAfterMoveOut: readBool(o, "voidChargesAfterMoveOut"),
    deposit,
  });
}

export function validateChargeInput(input: unknown): Validated<ChargeInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const kinds = CHARGE_KINDS.filter((k) => k !== "rent") as Exclude<(typeof CHARGE_KINDS)[number], "rent">[];
  return done(f, {
    tenancyId: readId(o, "tenancyId", f) ?? "",
    kind: readEnum(o, "kind", kinds, f),
    description: readText(o, "description", f, { required: true, max: LIMITS.line }),
    amountSen: readSen(o, "amountSen", f, { required: true, positive: true }) ?? 0,
    dueDate: readDate(o, "dueDate", f, { required: true }) ?? "1970-01-01",
  });
}

export function validateChargeUpdate(input: unknown): Validated<ChargeUpdate> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, {
    id: readId(o, "id", f) ?? "",
    description: readText(o, "description", f, { required: true, max: LIMITS.line }),
    amountSen: readSen(o, "amountSen", f, { required: true, positive: true }) ?? 0,
    dueDate: readDate(o, "dueDate", f, { required: true }) ?? "1970-01-01",
  });
}

export function validatePaymentInput(input: unknown): Validated<PaymentInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, {
    tenancyId: readId(o, "tenancyId", f) ?? "",
    receivedOn: readDate(o, "receivedOn", f, { required: true }) ?? "1970-01-01",
    amountSen: readSen(o, "amountSen", f, { required: true, positive: true }) ?? 0,
    method: readEnum(o, "method", PAYMENT_METHODS, f),
    reference: readText(o, "reference", f, { max: LIMITS.line }),
    description: readText(o, "description", f, { max: LIMITS.line }),
    notes: readText(o, "notes", f, { max: LIMITS.text }),
    stagingKey: readId(o, "stagingKey", f, { required: false }),
  });
}

export function validateDepositInput(input: unknown): Validated<DepositInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  const kind = readEnum(o, "kind", DEPOSIT_ENTRY_KINDS, f);
  const notes = readText(o, "notes", f, { max: LIMITS.text });
  if (kind === "deducted" && !notes) f.notes = "validation.deductReason";
  return done(f, {
    tenancyId: readId(o, "tenancyId", f) ?? "",
    depositType: readEnum(o, "depositType", DEPOSIT_TYPES, f),
    kind,
    amountSen: readSen(o, "amountSen", f, { required: true, positive: true }) ?? 0,
    occurredOn: readDate(o, "occurredOn", f, { required: true }) ?? "1970-01-01",
    method: o.method == null || o.method === "" ? null : readEnum(o, "method", PAYMENT_METHODS, f),
    reference: readText(o, "reference", f, { max: LIMITS.line }),
    notes,
  });
}

export function validateScheduleChange(input: unknown): Validated<ScheduleChangeInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, {
    tenancyId: readId(o, "tenancyId", f) ?? "",
    effectiveMonth: readMonth(o, "effectiveMonth", f),
    amountSen: readSen(o, "amountSen", f, { required: true, positive: true }) ?? 0,
    dueDay: readInt(o, "dueDay", f, { min: 1, max: 31, required: true, error: "validation.dueDayRange" }) ?? 1,
    applyToUnpaid: readBool(o, "applyToUnpaid"),
  });
}

export function validateMaintenanceInput(input: unknown): Validated<MaintenanceInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, {
    propertyId: readId(o, "propertyId", f) ?? "",
    spaceId: readId(o, "spaceId", f, { required: false }),
    tenantId: readId(o, "tenantId", f, { required: false }),
    title: readText(o, "title", f, { required: true, max: LIMITS.line }),
    description: readText(o, "description", f, { max: LIMITS.text }),
    category: readEnum(o, "category", MAINTENANCE_CATEGORIES, f),
    priority: readEnum(o, "priority", MAINTENANCE_PRIORITIES, f),
    status: readEnum(o, "status", MAINTENANCE_STATUSES, f),
    dueDate: readDate(o, "dueDate", f),
    assigneeName: readText(o, "assigneeName", f, { max: LIMITS.name }),
    assigneePhone: readPhone(o, "assigneePhone", f),
    estimatedCostSen: readSen(o, "estimatedCostSen", f),
    actualCostSen: readSen(o, "actualCostSen", f),
    reportedOn: readDate(o, "reportedOn", f, { required: true }) ?? "1970-01-01",
  });
}

export function validateSettingsInput(input: unknown): Validated<SettingsInput> {
  const o = asObject(input);
  const f: FieldErrors = {};
  return done(f, {
    landlordName: readText(o, "landlordName", f, { max: LIMITS.name }),
    contactPhone: readPhone(o, "contactPhone", f),
    contactEmail: readEmail(o, "contactEmail", f),
    address: readText(o, "address", f, { max: 500 }),
    receiptNote: readText(o, "receiptNote", f, { max: 500 }),
  });
}
