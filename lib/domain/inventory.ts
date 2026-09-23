import type { IsoDate } from "./dates";
import type { RentalMode, SpaceKind } from "./enums";

/**
 * Inventory is a tree inside each property: unit → room → bed. Any node can
 * be let (a whole unit, a single room, or a single bed), and the same tree is
 * what future short-stay reservations book against, so availability is
 * shared by construction.
 *
 * Two spaces CONTAIN one another when letting one makes the other
 * unavailable: a unit contains its rooms and beds, a room contains its beds.
 * Every space carries its unit id and (for rooms and beds) its room id so the
 * test is a flat comparison — no tree walk, usable inside SQLite triggers.
 */
export interface SpaceRef {
  id: string;
  kind: SpaceKind;
  unitId: string;
  roomId: string | null;
}

export function spacesOverlap(a: SpaceRef, b: SpaceRef): boolean {
  if (a.unitId !== b.unitId) return false;
  if (a.kind === "unit" || b.kind === "unit") return true;
  if (a.roomId !== b.roomId) return false;
  return a.kind === "room" || b.kind === "room" || a.id === b.id;
}

const OPEN_END = "9999-12-31";

/** Inclusive day ranges; a null end is open-ended. */
export function dateRangesOverlap(
  aStart: IsoDate,
  aEnd: IsoDate | null,
  bStart: IsoDate,
  bEnd: IsoDate | null,
): boolean {
  return aStart <= (bEnd ?? OPEN_END) && bStart <= (aEnd ?? OPEN_END);
}

export interface InventoryUnitShape {
  id: string;
  rentalMode: RentalMode;
  archived: boolean;
  rooms: { id: string; archived: boolean; beds: { id: string; archived: boolean }[] }[];
}

/**
 * The spaces a landlord actually lets, according to each unit's arrangement.
 * Occupancy is measured against these, so a whole-unit condo counts as one
 * lettable space while a room-let terrace counts each room.
 */
export function lettableSpaces(units: readonly InventoryUnitShape[]): { id: string; kind: SpaceKind; unitId: string }[] {
  const out: { id: string; kind: SpaceKind; unitId: string }[] = [];
  for (const unit of units) {
    if (unit.archived) continue;
    if (unit.rentalMode === "whole_unit") {
      out.push({ id: unit.id, kind: "unit", unitId: unit.id });
      continue;
    }
    for (const room of unit.rooms) {
      if (room.archived) continue;
      if (unit.rentalMode === "by_room") {
        out.push({ id: room.id, kind: "room", unitId: unit.id });
        continue;
      }
      for (const bed of room.beds) {
        if (!bed.archived) out.push({ id: bed.id, kind: "bed", unitId: unit.id });
      }
    }
  }
  return out;
}
