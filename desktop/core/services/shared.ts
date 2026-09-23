import crypto from "node:crypto";
import type { Attachment, AttachmentOwner, TenancySummary } from "../../../lib/api/contract";
import { monthOf, type IsoDate } from "../../../lib/domain/dates";
import type { AttachmentPurpose, ChargeKind, PaymentMethod, RentalMode, RoomType, SpaceKind } from "../../../lib/domain/enums";
import { allocatePayments, chargeState, scheduleItemFor, type Allocation } from "../../../lib/domain/rent";
import { needsMoveIn, needsMoveOut, tenancyStatus, type TenancyDates } from "../../../lib/domain/tenancy";
import type { Core } from "../context";

export const newId = () => crypto.randomUUID();

export function nextRef(core: Core, counter: "tenancy" | "receipt" | "maintenance", prefix: string, pad = 4): string {
  core.db.run("UPDATE counters SET value = value + 1 WHERE name = ?", [counter]);
  const n = core.db.get<{ value: number }>("SELECT value FROM counters WHERE name = ?", [counter])?.value ?? 1;
  return `${prefix}-${String(n).padStart(pad, "0")}`;
}

// ── Attachments ────────────────────────────────────────────────────────────

export interface AttachmentRow {
  id: string;
  purpose: AttachmentPurpose;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  caption: string;
  sort_order: number;
  created_at: string;
  thumb_name: string | null;
}

export const ATTACHMENT_COLUMNS =
  "id, purpose, file_name, mime_type, size_bytes, width, height, caption, sort_order, created_at, thumb_name";

const DISPLAYABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function toAttachment(row: AttachmentRow): Attachment {
  const url = `havenos-file://attachment/${row.id}`;
  return {
    id: row.id,
    purpose: row.purpose,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    caption: row.caption,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    url,
    thumbUrl: row.thumb_name ? `havenos-file://thumb/${row.id}` : url,
    isImage: DISPLAYABLE.has(row.mime_type),
  };
}

export const OWNER_COLUMN: Record<AttachmentOwner["kind"], string> = {
  property: "property_id",
  maintenance: "maintenance_id",
  tenancy: "tenancy_id",
  tenant: "tenant_id",
  payment: "payment_id",
  draft: "draft_id",
  staging: "staging_key",
};

export function listAttachments(core: Core, owner: AttachmentOwner): Attachment[] {
  const col = OWNER_COLUMN[owner.kind];
  return core.db
    .all<AttachmentRow>(`SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE ${col} = ? ORDER BY sort_order, created_at`, [owner.id])
    .map(toAttachment);
}

/** Hand uploads made in a form over to the record that was just saved. */
export function claimStaged(core: Core, stagingKey: string | null, owner: AttachmentOwner) {
  if (!stagingKey) return;
  const col = OWNER_COLUMN[owner.kind];
  core.db.run(`UPDATE attachments SET staging_key = NULL, ${col} = ? WHERE staging_key = ?`, [owner.id, stagingKey]);
}

// ── Spaces ─────────────────────────────────────────────────────────────────

export interface SpaceRow {
  id: string;
  property_id: string;
  kind: SpaceKind;
  parent_id: string | null;
  unit_id: string;
  room_id: string | null;
  label: string;
  rental_mode: RentalMode | null;
  floor: string;
  size_sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  room_type: RoomType | null;
  default_rent_sen: number;
  sort_order: number;
  notes: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** "A-12-3 › Master bedroom › Bed 1" for every space. */
export function buildPaths(rows: readonly SpaceRow[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string>();
  for (const r of rows) {
    const parts: string[] = [];
    let cur: SpaceRow | undefined = r;
    while (cur) {
      parts.unshift(cur.label);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    out.set(r.id, parts.join(" › "));
  }
  return out;
}

export function allSpacePaths(core: Core): Map<string, string> {
  return buildPaths(core.db.all<SpaceRow>("SELECT * FROM spaces"));
}

export function spacePath(core: Core, spaceId: string): string {
  const rows = core.db.all<SpaceRow>(
    "SELECT s.* FROM spaces s JOIN spaces x ON x.id = ? WHERE s.id IN (x.id, x.parent_id, x.unit_id)",
    [spaceId],
  );
  return buildPaths(rows).get(spaceId) ?? "";
}

/** True when a space is let under its unit's arrangement. */
export function isLettable(space: SpaceRow, unitMode: RentalMode | null): boolean {
  if (space.kind === "unit") return space.rental_mode === "whole_unit";
  if (space.kind === "room") return unitMode === "by_room";
  return unitMode === "by_bed";
}

// ── Tenancies & ledgers ────────────────────────────────────────────────────

export interface TenancyRow {
  id: string;
  ref: string;
  tenant_id: string;
  space_id: string;
  property_id: string;
  start_date: IsoDate;
  end_date: IsoDate | null;
  rent_start_month: string;
  security_deposit_sen: number;
  utility_deposit_sen: number;
  terms: string;
  moved_in_on: IsoDate | null;
  move_in_notes: string;
  moved_out_on: IsoDate | null;
  move_out_notes: string;
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
  updated_at: string;
}

export interface TenancyJoinedRow extends TenancyRow {
  tenant_name: string;
  tenant_phone: string;
  property_name: string;
  space_kind: SpaceKind;
}

export const TENANCY_SELECT = `
  SELECT t.*, tn.full_name AS tenant_name, tn.phone AS tenant_phone, p.name AS property_name, s.kind AS space_kind
  FROM tenancies t
  JOIN tenants tn ON tn.id = t.tenant_id
  JOIN properties p ON p.id = t.property_id
  JOIN spaces s ON s.id = t.space_id`;

export function tenancyDates(r: TenancyRow): TenancyDates {
  return {
    startDate: r.start_date,
    endDate: r.end_date,
    movedInOn: r.moved_in_on,
    movedOutOn: r.moved_out_on,
    cancelledAt: r.cancelled_at,
  };
}

export interface ChargeRow {
  id: string;
  tenancy_id: string;
  kind: ChargeKind;
  period: string | null;
  description: string;
  amount_sen: number;
  due_date: IsoDate;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: string;
  tenancy_id: string;
  receipt_no: string;
  received_on: IsoDate;
  amount_sen: number;
  method: PaymentMethod;
  reference: string;
  description: string;
  notes: string;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRow {
  id: string;
  tenancy_id: string;
  effective_month: string;
  amount_sen: number;
  due_day: number;
  created_at: string;
}

export interface Ledger {
  charges: ChargeRow[];
  payments: PaymentRow[];
  schedule: ScheduleRow[];
}

function inClause(ids: readonly string[]): string {
  return ids.map(() => "?").join(",");
}

/** Charges, payments and schedule for many tenancies in three queries. */
export function loadLedgers(core: Core, tenancyIds: readonly string[]): Map<string, Ledger> {
  const out = new Map<string, Ledger>();
  for (const id of tenancyIds) out.set(id, { charges: [], payments: [], schedule: [] });
  if (tenancyIds.length === 0) return out;
  // Chunk to stay well under SQLite's bound-parameter limit.
  for (let i = 0; i < tenancyIds.length; i += 500) {
    const chunk = tenancyIds.slice(i, i + 500);
    const q = inClause(chunk);
    for (const c of core.db.all<ChargeRow>(`SELECT * FROM charges WHERE tenancy_id IN (${q}) ORDER BY due_date, created_at`, chunk)) {
      out.get(c.tenancy_id)!.charges.push(c);
    }
    for (const p of core.db.all<PaymentRow>(`SELECT * FROM payments WHERE tenancy_id IN (${q}) ORDER BY received_on, created_at`, chunk)) {
      out.get(p.tenancy_id)!.payments.push(p);
    }
    for (const s of core.db.all<ScheduleRow>(`SELECT * FROM rent_schedule WHERE tenancy_id IN (${q}) ORDER BY effective_month`, chunk)) {
      out.get(s.tenancy_id)!.schedule.push(s);
    }
  }
  return out;
}

export function allocate(ledger: Ledger): Allocation {
  return allocatePayments(
    ledger.charges.map((c) => ({ id: c.id, dueDate: c.due_date, amountSen: c.amount_sen, createdAt: c.created_at, voided: !!c.voided_at })),
    ledger.payments.map((p) => ({ amountSen: p.amount_sen, voided: !!p.voided_at })),
  );
}

export function overdueFrom(ledger: Ledger, alloc: Allocation, today: IsoDate): number {
  let overdue = 0;
  for (const c of ledger.charges) {
    const paid = alloc.paidByCharge.get(c.id) ?? 0;
    if (chargeState({ amountSen: c.amount_sen, paidSen: paid, dueDate: c.due_date, today, voided: !!c.voided_at }) === "overdue") {
      overdue += c.amount_sen - paid;
    }
  }
  return overdue;
}

export function currentRent(schedule: readonly ScheduleRow[], today: IsoDate): { amountSen: number; dueDay: number } {
  const items = schedule.map((s) => ({ effectiveMonth: s.effective_month, amountSen: s.amount_sen, dueDay: s.due_day }));
  const item = scheduleItemFor(items, monthOf(today)) ?? items[0];
  return item ? { amountSen: item.amountSen, dueDay: item.dueDay } : { amountSen: 0, dueDay: 1 };
}

export function summarize(core: Core, rows: readonly TenancyJoinedRow[], paths?: Map<string, string>): TenancySummary[] {
  const today = core.today();
  const pathMap = paths ?? allSpacePaths(core);
  const ledgers = loadLedgers(core, rows.map((r) => r.id));
  return rows.map((r) => {
    const ledger = ledgers.get(r.id)!;
    const alloc = allocate(ledger);
    const rent = currentRent(ledger.schedule, today);
    const dates = tenancyDates(r);
    return {
      id: r.id,
      ref: r.ref,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      tenantPhone: r.tenant_phone,
      propertyId: r.property_id,
      propertyName: r.property_name,
      spaceId: r.space_id,
      spaceKind: r.space_kind,
      spacePath: pathMap.get(r.space_id) ?? "",
      startDate: r.start_date,
      endDate: r.end_date,
      movedInOn: r.moved_in_on,
      movedOutOn: r.moved_out_on,
      cancelledAt: r.cancelled_at,
      status: tenancyStatus(dates, today),
      needsMoveIn: needsMoveIn(dates, today),
      needsMoveOut: needsMoveOut(dates, today),
      monthlyRentSen: rent.amountSen,
      rentDueDay: rent.dueDay,
      balanceSen: alloc.balanceSen,
      overdueSen: overdueFrom(ledger, alloc, today),
    };
  });
}

/** A tenancy occupies its space on `day` (ignoring move-in bookkeeping). */
export function occupiesOn(r: Pick<TenancyRow, "start_date" | "end_date" | "moved_out_on" | "cancelled_at">, day: IsoDate): boolean {
  if (r.cancelled_at) return false;
  const end = r.moved_out_on ?? r.end_date;
  return r.start_date <= day && (end === null || day <= end);
}
