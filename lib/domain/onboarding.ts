/**
 * The "Add a property" flow keeps raw form state in a saved draft; this
 * module turns that draft into a validated creation plan.
 */

import type { DraftRoom, DraftUnit, OnboardingDraftData, PropertyInput } from "../api/contract";
import type { MessageKey } from "../i18n";
import { isOneOf, MY_STATES, PROPERTY_TYPES, RENTAL_MODES, ROOM_TYPES, type RentalMode, type RoomType, type SpaceKind } from "./enums";
import { parseRinggit, type Sen } from "./money";
import { LIMITS, moneyErrorKey, parseMonthsToTenths, validatePropertyInput, type FieldErrors, type Validated } from "./validate";

export const ONBOARDING_STEPS = ["details", "arrangement", "rent", "photos", "review"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const MAX_UNITS = 200;
export const MAX_ROOMS_PER_UNIT = 30;
export const MAX_BEDS_PER_ROOM = 20;

export function makeKey(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function emptyDraft(): OnboardingDraftData {
  return {
    details: { name: "", propertyType: "", addressLine1: "", addressLine2: "", postcode: "", city: "", state: "", notes: "" },
    arrangement: { defaultMode: "", units: [] },
    rent: {
      rentDueDay: "1",
      securityDepositMonths: "2",
      utilityDepositMonths: "0.5",
      defaultTenancyMonths: "12",
      defaultTerms: "",
      rents: {},
    },
  };
}

export function newRoom(index: number, withBeds: number, roomType: RoomType = index === 0 ? "master" : "medium"): DraftRoom {
  return {
    key: makeKey(),
    label: index === 0 ? "Master bedroom" : `Room ${index + 1}`,
    roomType,
    beds: Array.from({ length: withBeds }, (_, i) => ({ key: makeKey(), label: `Bed ${i + 1}` })),
  };
}

export function newUnit(label: string, mode: RentalMode, rooms = mode === "whole_unit" ? 0 : 3, beds = 2): DraftUnit {
  return {
    key: makeKey(),
    label,
    floor: "",
    sizeSqft: "",
    bedrooms: "",
    rentalMode: mode,
    rooms: Array.from({ length: rooms }, (_, i) => newRoom(i, mode === "by_bed" ? beds : 0)),
  };
}

/** The spaces that need a rent, according to each unit's arrangement. */
export function draftLettables(data: OnboardingDraftData): { key: string; kind: SpaceKind; path: string }[] {
  const out: { key: string; kind: SpaceKind; path: string }[] = [];
  for (const unit of data.arrangement.units) {
    const unitName = unit.label.trim() || "Unit";
    if (unit.rentalMode === "whole_unit") {
      out.push({ key: unit.key, kind: "unit", path: unitName });
      continue;
    }
    for (const room of unit.rooms) {
      const roomPath = `${unitName} › ${room.label.trim() || "Room"}`;
      if (unit.rentalMode === "by_room") out.push({ key: room.key, kind: "room", path: roomPath });
      else for (const bed of room.beds) out.push({ key: bed.key, kind: "bed", path: `${roomPath} › ${bed.label.trim() || "Bed"}` });
    }
  }
  return out;
}

// ── Sanitising untrusted draft JSON ────────────────────────────────────────

function s(v: unknown, max: number = LIMITS.line): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function key(v: unknown): string {
  return typeof v === "string" && /^[A-Za-z0-9]{1,32}$/.test(v) ? v : makeKey();
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Coerce whatever the UI sent into a well-formed draft (never trusted). */
export function sanitizeDraft(input: unknown): OnboardingDraftData {
  const o = obj(input);
  const d = obj(o.details);
  const a = obj(o.arrangement);
  const r = obj(o.rent);
  const units: DraftUnit[] = arr(a.units)
    .slice(0, MAX_UNITS)
    .map((raw) => {
      const u = obj(raw);
      return {
        key: key(u.key),
        label: s(u.label, LIMITS.label),
        floor: s(u.floor, 20),
        sizeSqft: s(u.sizeSqft, 10),
        bedrooms: s(u.bedrooms, 4),
        rentalMode: isOneOf(RENTAL_MODES, u.rentalMode) ? u.rentalMode : "whole_unit",
        rooms: arr(u.rooms)
          .slice(0, MAX_ROOMS_PER_UNIT)
          .map((rawRoom) => {
            const room = obj(rawRoom);
            return {
              key: key(room.key),
              label: s(room.label, LIMITS.label),
              roomType: isOneOf(ROOM_TYPES, room.roomType) ? room.roomType : "other",
              beds: arr(room.beds)
                .slice(0, MAX_BEDS_PER_ROOM)
                .map((rawBed) => {
                  const bed = obj(rawBed);
                  return { key: key(bed.key), label: s(bed.label, LIMITS.label) };
                }),
            };
          }),
      };
    });
  const rents: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(r.rents)).slice(0, 5000)) {
    if (/^[A-Za-z0-9]{1,32}$/.test(k)) rents[k] = s(v, 20);
  }
  return {
    details: {
      name: s(d.name, LIMITS.name),
      propertyType: isOneOf(PROPERTY_TYPES, d.propertyType) ? d.propertyType : "",
      addressLine1: s(d.addressLine1),
      addressLine2: s(d.addressLine2),
      postcode: s(d.postcode, 10),
      city: s(d.city, 80),
      state: isOneOf(MY_STATES, d.state) ? d.state : "",
      notes: s(d.notes, LIMITS.text),
    },
    arrangement: {
      defaultMode: isOneOf(RENTAL_MODES, a.defaultMode) ? a.defaultMode : "",
      units,
    },
    rent: {
      rentDueDay: s(r.rentDueDay, 4),
      securityDepositMonths: s(r.securityDepositMonths, 6),
      utilityDepositMonths: s(r.utilityDepositMonths, 6),
      defaultTenancyMonths: s(r.defaultTenancyMonths, 6),
      defaultTerms: s(r.defaultTerms, LIMITS.terms),
      rents,
    },
  };
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface PlannedSpace {
  kind: SpaceKind;
  label: string;
  rentalMode: RentalMode | null;
  floor: string;
  sizeSqft: number | null;
  bedrooms: number | null;
  roomType: RoomType | null;
  defaultRentSen: Sen;
  children: PlannedSpace[];
}

export interface OnboardingPlan {
  property: PropertyInput;
  units: PlannedSpace[];
}

function optionalInt(value: string, min: number, max: number, path: string, f: FieldErrors, error: MessageKey): number | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
    f[path] = error;
    return null;
  }
  return Number(v);
}

function checkDuplicates(labels: { path: string; label: string }[], f: FieldErrors) {
  const seen = new Map<string, string>();
  for (const { path, label } of labels) {
    const norm = label.trim().toLowerCase();
    if (!norm) continue;
    if (seen.has(norm)) f[path] = "validation.duplicateLabel";
    else seen.set(norm, path);
  }
}

function validateDetails(data: OnboardingDraftData, f: FieldErrors) {
  const rent = data.rent;
  const result = validatePropertyInput({
    ...data.details,
    rentDueDay: Number(rent.rentDueDay) || 1,
    securityDepositTenths: 0,
    utilityDepositTenths: 0,
    defaultTenancyMonths: 12,
    defaultTerms: "",
  });
  if (!result.ok) for (const [k, v] of Object.entries(result.fields)) if (k in data.details) f[`details.${k}`] = v;
}

function validateArrangement(data: OnboardingDraftData, f: FieldErrors) {
  const units = data.arrangement.units;
  if (!data.arrangement.defaultMode) f["arrangement.defaultMode"] = "validation.chooseOne";
  if (units.length === 0) f["arrangement.units"] = "validation.needUnit";
  checkDuplicates(units.map((u, i) => ({ path: `arrangement.units.${i}.label`, label: u.label })), f);
  units.forEach((unit, i) => {
    const p = `arrangement.units.${i}`;
    if (!unit.label.trim()) f[`${p}.label`] = "validation.required";
    optionalInt(unit.sizeSqft, 1, 100_000, `${p}.sizeSqft`, f, "validation.sizeRange");
    optionalInt(unit.bedrooms, 0, 50, `${p}.bedrooms`, f, "validation.countRange");
    if (unit.rentalMode === "whole_unit") return;
    if (unit.rooms.length === 0) f[`${p}.rooms`] = "validation.needRoom";
    checkDuplicates(unit.rooms.map((r, j) => ({ path: `${p}.rooms.${j}.label`, label: r.label })), f);
    unit.rooms.forEach((room, j) => {
      const rp = `${p}.rooms.${j}`;
      if (!room.label.trim()) f[`${rp}.label`] = "validation.required";
      if (unit.rentalMode !== "by_bed") return;
      if (room.beds.length === 0) f[`${rp}.beds`] = "validation.needBed";
      checkDuplicates(room.beds.map((b, k) => ({ path: `${rp}.beds.${k}.label`, label: b.label })), f);
      room.beds.forEach((bed, k) => {
        if (!bed.label.trim()) f[`${rp}.beds.${k}.label`] = "validation.required";
      });
    });
  });
}

function validateRent(data: OnboardingDraftData, f: FieldErrors) {
  const r = data.rent;
  const due = r.rentDueDay.trim();
  if (!/^\d{1,2}$/.test(due) || Number(due) < 1 || Number(due) > 31) f["rent.rentDueDay"] = "validation.dueDayRange";
  if (parseMonthsToTenths(r.securityDepositMonths) === null) f["rent.securityDepositMonths"] = "validation.depositMonthsRange";
  if (parseMonthsToTenths(r.utilityDepositMonths) === null) f["rent.utilityDepositMonths"] = "validation.depositMonthsRange";
  const months = r.defaultTenancyMonths.trim();
  if (!/^\d{1,3}$/.test(months) || Number(months) < 1 || Number(months) > 120) f["rent.defaultTenancyMonths"] = "validation.tenancyMonthsRange";
  for (const space of draftLettables(data)) {
    const raw = r.rents[space.key] ?? "";
    if (!raw.trim()) continue; // rent can be filled in later, per tenancy
    const parsed = parseRinggit(raw);
    if (!parsed.ok) f[`rent.rents.${space.key}`] = moneyErrorKey(parsed.error);
  }
}

/** Errors for one step (0-based index into ONBOARDING_STEPS). */
export function validateDraftStep(data: OnboardingDraftData, step: number): FieldErrors {
  const f: FieldErrors = {};
  if (step === 0) validateDetails(data, f);
  if (step === 1) validateArrangement(data, f);
  if (step === 2) validateRent(data, f);
  return f;
}

/** First step with an error, for jumping back from Review. */
export function firstInvalidStep(data: OnboardingDraftData): number | null {
  for (let step = 0; step < ONBOARDING_STEPS.length; step++) {
    if (Object.keys(validateDraftStep(data, step)).length) return step;
  }
  return null;
}

export function planFromDraft(data: OnboardingDraftData): Validated<OnboardingPlan> {
  const f: FieldErrors = {};
  validateDetails(data, f);
  validateArrangement(data, f);
  validateRent(data, f);
  if (Object.keys(f).length) return { ok: false, fields: f };

  const d = data.details;
  const r = data.rent;
  const property: PropertyInput = {
    name: d.name.trim(),
    propertyType: d.propertyType || "other",
    addressLine1: d.addressLine1.trim(),
    addressLine2: d.addressLine2.trim(),
    postcode: d.postcode.trim(),
    city: d.city.trim(),
    state: d.state || "KUL",
    notes: d.notes.trim(),
    rentDueDay: Number(r.rentDueDay),
    securityDepositTenths: parseMonthsToTenths(r.securityDepositMonths) ?? 0,
    utilityDepositTenths: parseMonthsToTenths(r.utilityDepositMonths) ?? 0,
    defaultTenancyMonths: Number(r.defaultTenancyMonths),
    defaultTerms: r.defaultTerms.trim(),
  };
  const rentFor = (k: string): Sen => {
    const parsed = parseRinggit(r.rents[k] ?? "");
    return parsed.ok ? parsed.sen : 0;
  };
  const units: PlannedSpace[] = data.arrangement.units.map((unit) => ({
    kind: "unit",
    label: unit.label.trim(),
    rentalMode: unit.rentalMode,
    floor: unit.floor.trim(),
    sizeSqft: unit.sizeSqft.trim() ? Number(unit.sizeSqft) : null,
    bedrooms: unit.bedrooms.trim() ? Number(unit.bedrooms) : null,
    roomType: null,
    defaultRentSen: unit.rentalMode === "whole_unit" ? rentFor(unit.key) : 0,
    children:
      unit.rentalMode === "whole_unit"
        ? []
        : unit.rooms.map((room) => ({
            kind: "room" as const,
            label: room.label.trim(),
            rentalMode: null,
            floor: "",
            sizeSqft: null,
            bedrooms: null,
            roomType: room.roomType,
            defaultRentSen: unit.rentalMode === "by_room" ? rentFor(room.key) : 0,
            children:
              unit.rentalMode === "by_bed"
                ? room.beds.map((bed) => ({
                    kind: "bed" as const,
                    label: bed.label.trim(),
                    rentalMode: null,
                    floor: "",
                    sizeSqft: null,
                    bedrooms: null,
                    roomType: null,
                    defaultRentSen: rentFor(bed.key),
                    children: [],
                  }))
                : [],
          })),
  }));
  return { ok: true, value: { property, units } };
}
