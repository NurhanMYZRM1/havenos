import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OnboardingPlan, PlannedSpace } from "../../lib/domain/onboarding";
import { openCore, type Core } from "../core/context";
import { createPropertyFromPlan, getProperty } from "../core/services/properties";

/** 12:00 in Kuala Lumpur on 23 Sep 2026. */
export const FIXED_NOW = new Date("2026-09-23T04:00:00.000Z");

export function tempDir(label = "havenos-test"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

export function clock(start = FIXED_NOW) {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    set: (d: Date | string) => {
      now = new Date(d).getTime();
    },
    advanceDays: (n: number) => {
      now += n * 86_400_000;
    },
  };
}

export function makeCore(dir = tempDir(), now: () => Date = () => FIXED_NOW): Core {
  return openCore({ dir, appVersion: "0.0.0-test", now });
}

/** A valid 1×1 PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const s = (kind: PlannedSpace["kind"], label: string, rent: number, children: PlannedSpace[] = [], extra: Partial<PlannedSpace> = {}): PlannedSpace => ({
  kind,
  label,
  rentalMode: null,
  floor: "",
  sizeSqft: null,
  bedrooms: null,
  roomType: null,
  defaultRentSen: rent,
  children,
  ...extra,
});

export const PROPERTY_BASE: OnboardingPlan["property"] = {
  name: "Test Residences",
  propertyType: "condominium",
  addressLine1: "1 Jalan Ujian",
  addressLine2: "",
  postcode: "50450",
  city: "Kuala Lumpur",
  state: "KUL",
  notes: "",
  rentDueDay: 7,
  securityDepositTenths: 20,
  utilityDepositTenths: 5,
  defaultTenancyMonths: 12,
  defaultTerms: "",
};

/** One unit let by room (3 rooms, room C has 2 beds) plus one whole unit. */
export function seedProperty(core: Core) {
  const id = createPropertyFromPlan(core, {
    property: PROPERTY_BASE,
    units: [
      s("unit", "A-1", 0, [
        s("room", "Room A", 80000),
        s("room", "Room B", 70000),
        s("room", "Room C", 0, [s("bed", "Bed 1", 30000), s("bed", "Bed 2", 30000)]),
      ], { rentalMode: "by_room" }),
      s("unit", "A-2", 200000, [], { rentalMode: "whole_unit" }),
    ],
  });
  const p = getProperty(core, id);
  const [a1, a2] = p.units;
  return {
    propertyId: id,
    unitA1: a1.id,
    roomA: a1.children[0].id,
    roomB: a1.children[1].id,
    roomC: a1.children[2].id,
    bed1: a1.children[2].children[0].id,
    bed2: a1.children[2].children[1].id,
    unitA2: a2.id,
  };
}

export const newTenant = (fullName: string) => ({
  fullName,
  phone: "+60123456789",
  email: "",
  emergencyName: "",
  emergencyPhone: "",
  notes: "",
});
