import type { ExportDataset } from "../../../lib/domain/enums";
import { senToDecimal } from "../../../lib/domain/money";
import type { Core } from "../context";
import { toCharges } from "./rent";
import { allSpacePaths, loadLedgers, summarize, TENANCY_SELECT, type TenancyJoinedRow } from "./shared";

type Cell = string | number | null;

/**
 * CSV for Excel / Google Sheets: UTF-8 with BOM, CRLF, every field quoted.
 * Text that a spreadsheet would run as a formula (=, +, -, @) is prefixed
 * with an apostrophe. Money is plain ringgit ("1250.00"), dates ISO
 * (YYYY-MM-DD) so they sort and import unambiguously. Headers stay in
 * English on purpose: they are a stable interchange format.
 */
export function toCsv(header: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    if (v === null) return '""';
    if (typeof v === "number") return `"${v}"`;
    const numeric = /^-?\d+(\.\d+)?$/.test(v);
    const safe = !numeric && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

const money = (sen: number | null) => (sen === null ? null : senToDecimal(sen));

function tenancyRows(core: Core) {
  return core.db.all<TenancyJoinedRow>(`${TENANCY_SELECT} ORDER BY t.start_date`);
}

export function exportDataset(core: Core, dataset: ExportDataset): { fileName: string; content: string } {
  const today = core.today();
  const paths = allSpacePaths(core);
  const file = (name: string, header: string[], rows: Cell[][]) => ({ fileName: `havenos-${name}-${today}.csv`, content: toCsv(header, rows) });

  switch (dataset) {
    case "properties":
      return file(
        "properties",
        ["ID", "Name", "Type", "Address line 1", "Address line 2", "Postcode", "City", "State", "Rent due day", "Security deposit (months)", "Utility deposit (months)", "Default tenancy (months)", "Created", "Archived"],
        core.db
          .all<Record<string, string | number | null>>("SELECT * FROM properties ORDER BY lower(name)")
          .map((p) => [p.id, p.name, p.property_type, p.address_line1, p.address_line2, p.postcode, p.city, p.state, p.rent_due_day, Number(p.security_deposit_tenths) / 10, Number(p.utility_deposit_tenths) / 10, p.default_tenancy_months, p.created_at, p.archived_at]),
      );
    case "spaces":
      return file(
        "units-rooms-beds",
        ["ID", "Property", "Kind", "Name", "Arrangement", "Floor", "Size (sq ft)", "Bedrooms", "Bathrooms", "Room type", "Default rent (RM)", "Archived"],
        core.db
          .all<Record<string, string | number | null>>("SELECT s.*, p.name AS property_name FROM spaces s JOIN properties p ON p.id = s.property_id ORDER BY lower(p.name), s.unit_id, s.sort_order")
          .map((s) => [s.id, s.property_name, s.kind, paths.get(String(s.id)) ?? "", s.rental_mode, s.floor, s.size_sqft, s.bedrooms, s.bathrooms, s.room_type, money(Number(s.default_rent_sen)), s.archived_at]),
      );
    case "tenants":
      return file(
        "tenants",
        ["ID", "Name", "Phone", "Email", "Emergency contact", "Emergency phone", "Notes", "Created"],
        core.db
          .all<Record<string, string>>("SELECT * FROM tenants ORDER BY lower(full_name)")
          .map((t) => [t.id, t.full_name, t.phone, t.email, t.emergency_name, t.emergency_phone, t.notes, t.created_at]),
      );
    case "tenancies": {
      const rows = tenancyRows(core);
      const byId = new Map(rows.map((r) => [r.id, r]));
      return file(
        "tenancies",
        ["Reference", "Tenant", "Property", "Unit / room / bed", "Start", "End", "Moved in", "Moved out", "Status", "Monthly rent (RM)", "Due day", "Security deposit (RM)", "Utility deposit (RM)", "Balance (RM)", "Overdue (RM)", "Cancelled"],
        summarize(core, rows, paths).map((s) => [s.ref, s.tenantName, s.propertyName, s.spacePath, s.startDate, s.endDate, s.movedInOn, s.movedOutOn, s.status, money(s.monthlyRentSen), s.rentDueDay, money(byId.get(s.id)!.security_deposit_sen), money(byId.get(s.id)!.utility_deposit_sen), money(s.balanceSen), money(s.overdueSen), s.cancelledAt]),
      );
    }
    case "charges": {
      const rows = tenancyRows(core);
      const ledgers = loadLedgers(core, rows.map((r) => r.id));
      const out: Cell[][] = [];
      for (const r of rows) {
        for (const c of toCharges(ledgers.get(r.id)!, today).charges) {
          out.push([r.ref, r.tenant_name, r.property_name, paths.get(r.space_id) ?? "", c.kind, c.period, c.description, c.dueDate, money(c.amountSen), money(c.paidSen), money(c.balanceSen), c.state, c.voidedAt]);
        }
      }
      return file("rent-charges", ["Tenancy", "Tenant", "Property", "Unit / room / bed", "Kind", "Month", "Description", "Due date", "Amount (RM)", "Paid (RM)", "Balance (RM)", "Status", "Voided"], out);
    }
    case "payments":
      return file(
        "payments",
        ["Receipt no.", "Tenancy", "Tenant", "Property", "Unit / room / bed", "Received on", "Amount (RM)", "Method", "Reference", "Description", "Notes", "Voided", "Void reason"],
        core.db
          .all<Record<string, string | number | null>>(
            `SELECT pay.*, t.ref, t.space_id, tn.full_name, p.name AS property_name FROM payments pay
             JOIN tenancies t ON t.id = pay.tenancy_id JOIN tenants tn ON tn.id = t.tenant_id JOIN properties p ON p.id = t.property_id
             ORDER BY pay.received_on, pay.receipt_no`,
          )
          .map((p) => [p.receipt_no, p.ref, p.full_name, p.property_name, paths.get(String(p.space_id)) ?? "", p.received_on, money(Number(p.amount_sen)), p.method, p.reference, p.description, p.notes, p.voided_at, p.void_reason]),
      );
    case "deposits":
      return file(
        "deposits",
        ["Tenancy", "Tenant", "Deposit", "Entry", "Amount (RM)", "Date", "Method", "Reference", "Notes", "Voided"],
        core.db
          .all<Record<string, string | number | null>>(
            `SELECT d.*, t.ref, tn.full_name FROM deposit_entries d JOIN tenancies t ON t.id = d.tenancy_id JOIN tenants tn ON tn.id = t.tenant_id
             ORDER BY d.occurred_on, d.created_at`,
          )
          .map((d) => [d.ref, d.full_name, d.deposit_type, d.kind, money(Number(d.amount_sen)), d.occurred_on, d.method, d.reference, d.notes, d.voided_at]),
      );
    case "maintenance":
      return file(
        "maintenance",
        ["Reference", "Property", "Unit / room / bed", "Title", "Category", "Priority", "Status", "Reported on", "Due date", "Completed on", "Assigned to", "Assignee phone", "Estimated cost (RM)", "Actual cost (RM)", "Reported by"],
        core.db
          .all<Record<string, string | number | null>>(
            `SELECT m.*, p.name AS property_name, tn.full_name FROM maintenance_requests m JOIN properties p ON p.id = m.property_id
             LEFT JOIN tenants tn ON tn.id = m.tenant_id ORDER BY m.reported_on, m.ref`,
          )
          .map((m) => [m.ref, m.property_name, m.space_id ? paths.get(String(m.space_id)) ?? "" : "", m.title, m.category, m.priority, m.status, m.reported_on, m.due_date, m.completed_on, m.assignee_name, m.assignee_phone, money(m.estimated_cost_sen as number | null), money(m.actual_cost_sen as number | null), m.full_name]),
      );
  }
}
