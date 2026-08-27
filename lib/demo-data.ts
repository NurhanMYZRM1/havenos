import type { Bed, BedStatus, Property, WorkOrder, PortfolioStats } from "./types";

// Deterministic demo portfolio so the dashboard renders without a live Supabase
// project. Swap for a server query against the occupancy_rollup view in prod.

let seq = 0;
const id = () => `demo-${(++seq).toString(36).padStart(4, "0")}`;

function beds(spec: string): Bed[] {
  // "OOAH" → occupied, occupied, available, hold …
  const map: Record<string, BedStatus> = { O: "occupied", A: "available", H: "hold", T: "turnover", M: "maintenance" };
  return spec.split("").map((c, i) => ({
    id: id(),
    label: String.fromCharCode(65 + i),
    rentCents: 165000 + (i % 3) * 15000,
    status: map[c] ?? "available",
  }));
}

export const demoProperties: Property[] = [
  {
    id: id(),
    name: "Ledger House",
    city: "Kuala Lumpur",
    addressLine1: "18 Jalan Mesui, Bukit Bintang",
    units: [
      { id: id(), label: "2A", floor: 2, type: "suite", sqm: 64, beds: beds("OOO") },
      { id: id(), label: "2B", floor: 2, type: "shared_room", sqm: 42, beds: beds("OOAO") },
      { id: id(), label: "3A", floor: 3, type: "suite", sqm: 64, beds: beds("OOH") },
      { id: id(), label: "3B", floor: 3, type: "shared_room", sqm: 42, beds: beds("OOOO") },
      { id: id(), label: "PH", floor: 5, type: "two_bed", sqm: 96, beds: beds("OM") },
    ],
  },
  {
    id: id(),
    name: "Meridian Loft",
    city: "Singapore",
    addressLine1: "77 Duxton Road",
    units: [
      { id: id(), label: "01", floor: 1, type: "studio", sqm: 38, beds: beds("O") },
      { id: id(), label: "02", floor: 2, type: "suite", sqm: 58, beds: beds("OOO") },
      { id: id(), label: "03", floor: 2, type: "shared_room", sqm: 40, beds: beds("OAO") },
      { id: id(), label: "04", floor: 3, type: "shared_room", sqm: 40, beds: beds("OOTO") },
    ],
  },
  {
    id: id(),
    name: "Aster Court",
    city: "Bangkok",
    addressLine1: "5 Soi Sukhumvit 31",
    units: [
      { id: id(), label: "A1", floor: 1, type: "one_bed", sqm: 46, beds: beds("O") },
      { id: id(), label: "A2", floor: 1, type: "shared_room", sqm: 44, beds: beds("OOAA") },
      { id: id(), label: "B1", floor: 2, type: "suite", sqm: 60, beds: beds("OOO") },
      { id: id(), label: "B2", floor: 2, type: "shared_room", sqm: 44, beds: beds("HOOO") },
    ],
  },
];

export const demoWorkOrders: WorkOrder[] = [
  { id: id(), ref: "WO-1041", title: "Water heater tripping breaker", propertyName: "Ledger House", location: "Unit PH · Bed B", category: "Electrical", priority: "critical", status: "in_progress", openedAt: "2026-08-25", dueAt: "2026-08-27" },
  { id: id(), ref: "WO-1042", title: "Keypad battery low", propertyName: "Meridian Loft", location: "Unit 03 · Door", category: "Access", priority: "standard", status: "triage", openedAt: "2026-08-26", dueAt: "2026-08-30" },
  { id: id(), ref: "WO-1043", title: "Deep clean after move-out", propertyName: "Meridian Loft", location: "Unit 04 · Bed C", category: "Turnover", priority: "high", status: "scheduled", openedAt: "2026-08-26", dueAt: "2026-08-28" },
  { id: id(), ref: "WO-1044", title: "AC filter replacement (quarterly)", propertyName: "Aster Court", location: "Whole property", category: "HVAC", priority: "low", status: "scheduled", openedAt: "2026-08-24", dueAt: "2026-09-02" },
  { id: id(), ref: "WO-1045", title: "Balcony door misaligned", propertyName: "Ledger House", location: "Unit 3A", category: "Carpentry", priority: "standard", status: "triage", openedAt: "2026-08-27", dueAt: "2026-09-01" },
  { id: id(), ref: "WO-1046", title: "Wifi AP offline, floor 2", propertyName: "Aster Court", location: "Floor 2", category: "Network", priority: "high", status: "in_progress", openedAt: "2026-08-26", dueAt: "2026-08-27" },
  { id: id(), ref: "WO-1047", title: "Repaint scuffed hallway", propertyName: "Meridian Loft", location: "Common area", category: "Cosmetic", priority: "low", status: "done", openedAt: "2026-08-20", dueAt: "2026-08-25" },
];

export const demoStats: PortfolioStats = {
  occupancyPct: 84.1,
  mrrCents: 6_483_000,
  openWorkOrders: demoWorkOrders.filter((w) => w.status !== "done" && w.status !== "cancelled").length,
  criticalWorkOrders: demoWorkOrders.filter((w) => w.priority === "critical" && w.status !== "done").length,
  avgStayMonths: 7.4,
};
