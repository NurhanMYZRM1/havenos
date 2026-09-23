import type { SearchResult } from "../../../lib/api/contract";
import { formatDate } from "../../../lib/domain/format";
import { formatRM } from "../../../lib/domain/money";
import { formatPhone } from "../../../lib/domain/phone";
import type { Core } from "../context";
import { allSpacePaths } from "./shared";

const LIMIT = 6;

/** Quick search across everything a landlord might look up by name or number. */
export function search(core: Core, query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  // Phones are stored as +60…; "012-345" should still find "+6012345…".
  const digits = q.replace(/\D/g, "").replace(/^0/, "");
  const phoneLike = digits.length >= 3 ? `%${digits}%` : "\u0000";
  const out: SearchResult[] = [];

  for (const p of core.db.all<{ id: string; name: string; address_line1: string; city: string; postcode: string }>(
    `SELECT id, name, address_line1, city, postcode FROM properties
     WHERE lower(name) LIKE ? ESCAPE '\\' OR lower(address_line1) LIKE ? ESCAPE '\\' OR lower(city) LIKE ? ESCAPE '\\' OR postcode LIKE ? ESCAPE '\\'
     ORDER BY lower(name) LIMIT ${LIMIT}`,
    [like, like, like, like],
  )) {
    out.push({ kind: "property", id: p.id, title: p.name, subtitle: `${p.address_line1}, ${p.postcode} ${p.city}`, href: `/properties/view?id=${p.id}` });
  }

  const paths = allSpacePaths(core);
  for (const s of core.db.all<{ id: string; property_id: string; property_name: string }>(
    `SELECT s.id, s.property_id, p.name AS property_name FROM spaces s JOIN properties p ON p.id = s.property_id
     WHERE s.archived_at IS NULL AND lower(s.label) LIKE ? ESCAPE '\\' ORDER BY lower(p.name), s.sort_order LIMIT ${LIMIT}`,
    [like],
  )) {
    out.push({ kind: "space", id: s.id, title: paths.get(s.id) ?? "", subtitle: s.property_name, href: `/properties/view?id=${s.property_id}` });
  }

  for (const t of core.db.all<{ id: string; full_name: string; phone: string; email: string }>(
    `SELECT id, full_name, phone, email FROM tenants
     WHERE lower(full_name) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\' OR phone LIKE ?
     ORDER BY lower(full_name) LIMIT ${LIMIT}`,
    [like, like, phoneLike],
  )) {
    out.push({ kind: "tenant", id: t.id, title: t.full_name, subtitle: [formatPhone(t.phone), t.email].filter(Boolean).join(" · "), href: `/tenants/view?id=${t.id}` });
  }

  for (const t of core.db.all<{ id: string; ref: string; full_name: string; space_id: string; start_date: string }>(
    `SELECT t.id, t.ref, tn.full_name, t.space_id, t.start_date FROM tenancies t JOIN tenants tn ON tn.id = t.tenant_id
     WHERE lower(t.ref) LIKE ? ESCAPE '\\' ORDER BY t.start_date DESC LIMIT ${LIMIT}`,
    [like],
  )) {
    out.push({ kind: "tenancy", id: t.id, title: `${t.ref} · ${t.full_name}`, subtitle: `${paths.get(t.space_id) ?? ""} · ${formatDate(t.start_date)}`, href: `/tenancies/view?id=${t.id}` });
  }

  for (const m of core.db.all<{ id: string; ref: string; title: string; property_name: string }>(
    `SELECT m.id, m.ref, m.title, p.name AS property_name FROM maintenance_requests m JOIN properties p ON p.id = m.property_id
     WHERE lower(m.title) LIKE ? ESCAPE '\\' OR lower(m.ref) LIKE ? ESCAPE '\\' OR lower(m.assignee_name) LIKE ? ESCAPE '\\'
     ORDER BY m.created_at DESC LIMIT ${LIMIT}`,
    [like, like, like],
  )) {
    out.push({ kind: "maintenance", id: m.id, title: `${m.ref} · ${m.title}`, subtitle: m.property_name, href: `/maintenance/view?id=${m.id}` });
  }

  for (const p of core.db.all<{ id: string; tenancy_id: string; receipt_no: string; reference: string; amount_sen: number; received_on: string; full_name: string }>(
    `SELECT pay.id, pay.tenancy_id, pay.receipt_no, pay.reference, pay.amount_sen, pay.received_on, tn.full_name
     FROM payments pay JOIN tenancies t ON t.id = pay.tenancy_id JOIN tenants tn ON tn.id = t.tenant_id
     WHERE lower(pay.receipt_no) LIKE ? ESCAPE '\\' OR lower(pay.reference) LIKE ? ESCAPE '\\'
     ORDER BY pay.received_on DESC LIMIT ${LIMIT}`,
    [like, like],
  )) {
    out.push({
      kind: "payment",
      id: p.id,
      title: `${p.receipt_no} · ${formatRM(p.amount_sen)}`,
      subtitle: `${p.full_name} · ${formatDate(p.received_on)}${p.reference ? ` · ${p.reference}` : ""}`,
      href: `/receipt?id=${p.id}`,
    });
  }
  return out;
}
