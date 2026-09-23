import type { Tenant, TenantDetail, TenantInput } from "../../../lib/api/contract";
import type { Core } from "../context";
import { notFound } from "../errors";
import { listAttachments, newId, summarize, TENANCY_SELECT, type TenancyJoinedRow } from "./shared";

interface TenantRow {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  emergency_name: string;
  emergency_phone: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

function toTenant(r: TenantRow, stats: { current: number; balance: number }): Tenant {
  return {
    id: r.id,
    fullName: r.full_name,
    phone: r.phone,
    email: r.email,
    emergencyName: r.emergency_name,
    emergencyPhone: r.emergency_phone,
    notes: r.notes,
    createdAt: r.created_at,
    currentTenancies: stats.current,
    balanceSen: stats.balance,
  };
}

function stats(core: Core, tenantIds: string[]) {
  const rows = core.db.all<TenancyJoinedRow>(
    `${TENANCY_SELECT} WHERE t.tenant_id IN (${tenantIds.map(() => "?").join(",") || "''"})`,
    tenantIds,
  );
  const summaries = summarize(core, rows);
  const out = new Map<string, { current: number; balance: number }>();
  for (const id of tenantIds) out.set(id, { current: 0, balance: 0 });
  for (const s of summaries) {
    const entry = out.get(s.tenantId)!;
    if (s.status === "active" || s.status === "expiring" || s.status === "upcoming") entry.current++;
    if (s.status !== "cancelled") entry.balance += s.balanceSen;
  }
  return { out, summaries };
}

export function listTenants(core: Core, query: string): Tenant[] {
  const q = `%${query.trim().toLowerCase()}%`;
  const rows = core.db.all<TenantRow>(
    `SELECT * FROM tenants WHERE lower(full_name) LIKE ? OR phone LIKE ? OR lower(email) LIKE ? ORDER BY lower(full_name) LIMIT 1000`,
    [q, `%${query.replace(/\D/g, "") || "\u0000"}%`, q],
  );
  const { out } = stats(core, rows.map((r) => r.id));
  return rows.map((r) => toTenant(r, out.get(r.id)!));
}

export function getTenant(core: Core, id: string): TenantDetail {
  const row = core.db.get<TenantRow>("SELECT * FROM tenants WHERE id = ?", [id]);
  if (!row) throw notFound();
  const { out, summaries } = stats(core, [id]);
  return {
    ...toTenant(row, out.get(id)!),
    tenancies: summaries.sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    documents: listAttachments(core, { kind: "tenant", id }),
  };
}

export function insertTenant(core: Core, input: TenantInput): string {
  const id = newId();
  const now = core.nowIso();
  core.db.run(
    `INSERT INTO tenants (id, full_name, phone, email, emergency_name, emergency_phone, notes, created_at, updated_at)
     VALUES ($id, $fullName, $phone, $email, $emergencyName, $emergencyPhone, $notes, $now, $now)`,
    { ...input, id, now },
  );
  return id;
}

export function createTenant(core: Core, input: TenantInput): Tenant {
  const id = insertTenant(core, input);
  return listTenantById(core, id);
}

function listTenantById(core: Core, id: string): Tenant {
  const row = core.db.get<TenantRow>("SELECT * FROM tenants WHERE id = ?", [id]);
  if (!row) throw notFound();
  return toTenant(row, stats(core, [id]).out.get(id)!);
}

export function updateTenant(core: Core, id: string, input: TenantInput): Tenant {
  const changed = core.db.run(
    `UPDATE tenants SET full_name = $fullName, phone = $phone, email = $email, emergency_name = $emergencyName,
       emergency_phone = $emergencyPhone, notes = $notes, updated_at = $now WHERE id = $id`,
    { ...input, id, now: core.nowIso() },
  );
  if (!changed.changes) throw notFound();
  return listTenantById(core, id);
}
