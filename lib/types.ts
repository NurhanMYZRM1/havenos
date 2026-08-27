// Domain types mirroring supabase/migrations/0001_core.sql.
// Regenerate machine types with `npm run db:types` once a Supabase project is linked.

export type BedStatus = "available" | "occupied" | "hold" | "turnover" | "maintenance";
export type UnitType = "studio" | "one_bed" | "two_bed" | "suite" | "shared_room";
export type WorkOrderPriority = "low" | "standard" | "high" | "critical";
export type WorkOrderStatus = "triage" | "scheduled" | "in_progress" | "blocked" | "done" | "cancelled";

export interface Bed {
  id: string;
  label: string;
  rentCents: number;
  status: BedStatus;
}

export interface Unit {
  id: string;
  label: string;
  floor: number;
  type: UnitType;
  sqm: number;
  beds: Bed[];
}

export interface Property {
  id: string;
  name: string;
  city: string;
  addressLine1: string;
  units: Unit[];
}

export interface WorkOrder {
  id: string;
  ref: string;
  title: string;
  propertyName: string;
  location: string; // "Unit 4A · Bed 2" etc.
  category: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  openedAt: string;
  dueAt: string;
}

export interface PortfolioStats {
  occupancyPct: number;
  mrrCents: number;
  openWorkOrders: number;
  criticalWorkOrders: number;
  avgStayMonths: number;
}

export function bedRollup(property: Property) {
  const beds = property.units.flatMap((u) => u.beds);
  const by = (s: BedStatus) => beds.filter((b) => b.status === s).length;
  return {
    total: beds.length,
    occupied: by("occupied"),
    available: by("available"),
    hold: by("hold"),
    down: by("turnover") + by("maintenance"),
    occupancyPct: beds.length ? Math.round((by("occupied") / beds.length) * 1000) / 10 : 0,
  };
}
