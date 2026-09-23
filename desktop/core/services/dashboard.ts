import type { DashboardSummary } from "../../../lib/api/contract";
import { addDays, type YearMonth } from "../../../lib/domain/dates";
import { MAINTENANCE_STATUSES, type MaintenanceStatus } from "../../../lib/domain/enums";
import { UPCOMING_WITHIN_DAYS } from "../../../lib/domain/tenancy";
import type { Core } from "../context";
import { listMaintenance } from "./maintenance";
import { occupancyCounts } from "./properties";
import { rentMonth, totalDepositsHeld } from "./rent";
import { getSettings } from "./settings";
import { occupiesOn, summarize, TENANCY_SELECT, type SpaceRow, type TenancyJoinedRow } from "./shared";

/** Every dashboard figure is computed from stored records — nothing is hard-coded. */
export function dashboardSummary(core: Core, month: YearMonth): DashboardSummary {
  const today = core.today();
  const soon = addDays(today, UPCOMING_WITHIN_DAYS);
  const rent = rentMonth(core, month); // also tops up this month's rent charges

  const spaces = core.db.all<SpaceRow>(
    "SELECT s.* FROM spaces s JOIN properties p ON p.id = s.property_id WHERE p.archived_at IS NULL",
  );
  const rows = core.db.all<TenancyJoinedRow>(`${TENANCY_SELECT} WHERE t.cancelled_at IS NULL AND p.archived_at IS NULL`);
  const occupancy = occupancyCounts(spaces, rows.filter((r) => occupiesOn(r, today)));
  const summaries = summarize(core, rows);

  const current = summaries.filter((s) => s.status === "active" || s.status === "expiring" || s.status === "upcoming");
  const byDate = <T extends { startDate: string }>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : 1);

  const endingSoon = summaries
    .filter((s) => s.status === "expiring" && !s.movedOutOn)
    .sort(byDate((s) => s.endDate ?? ""))
    .slice(0, 8);
  const moveIns = summaries
    .filter((s) => !s.movedInOn && s.startDate >= today && s.startDate <= soon)
    .sort(byDate((s) => s.startDate))
    .slice(0, 8);
  const moveOuts = summaries
    .filter((s) => !s.movedOutOn && s.endDate !== null && s.endDate >= today && s.endDate <= soon)
    .sort(byDate((s) => s.endDate ?? ""))
    .slice(0, 8);
  const needsAttention = summaries.filter((s) => s.needsMoveIn || s.needsMoveOut).slice(0, 8);

  const open = listMaintenance(core, { propertyId: null, status: "open", priority: null, overdueOnly: false, query: "" });
  const byStatus = Object.fromEntries(MAINTENANCE_STATUSES.map((s) => [s, 0])) as Record<MaintenanceStatus, number>;
  for (const m of open) byStatus[m.status]++;

  return {
    today,
    month,
    counts: {
      properties: core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM properties WHERE archived_at IS NULL")?.n ?? 0,
      tenants: core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tenants")?.n ?? 0,
      currentTenancies: current.length,
    },
    occupancy: { lettable: occupancy.lettable, occupied: occupancy.occupied, byKind: occupancy.byKind },
    rent: {
      expectedSen: rent.totals.expectedSen,
      collectedSen: rent.totals.collectedSen,
      outstandingSen: rent.totals.outstandingSen,
      overdueInMonthSen: rent.totals.overdueSen,
      overdueAllSen: summaries.reduce((s, x) => s + x.overdueSen, 0),
      receivedInMonthSen: rent.totals.receivedInMonthSen,
    },
    depositsHeldSen: totalDepositsHeld(core),
    endingSoon,
    moveIns,
    moveOuts,
    needsAttention,
    maintenance: {
      open: open.length,
      overdue: open.filter((m) => m.overdue).length,
      urgent: open.filter((m) => m.priority === "critical").length,
      byStatus,
      top: open.slice(0, 5),
    },
    lastLocalBackupAt: getSettings(core).lastLocalBackupAt,
  };
}
