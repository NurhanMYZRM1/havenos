import type {
  MaintenanceCreate,
  MaintenanceDetail,
  MaintenanceEvent,
  MaintenanceField,
  MaintenanceFilter,
  MaintenanceInput,
  MaintenanceItem,
} from "../../../lib/api/contract";
import type { IsoDate } from "../../../lib/domain/dates";
import type { MaintenanceCategory, MaintenancePriority, MaintenanceStatus } from "../../../lib/domain/enums";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { allSpacePaths, claimStaged, listAttachments, newId, nextRef, spacePath } from "./shared";

interface MaintenanceRow {
  id: string;
  ref: string;
  property_id: string;
  space_id: string | null;
  tenant_id: string | null;
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  due_date: IsoDate | null;
  assignee_name: string;
  assignee_phone: string;
  estimated_cost_sen: number | null;
  actual_cost_sen: number | null;
  reported_on: IsoDate;
  completed_on: IsoDate | null;
  created_at: string;
  updated_at: string;
  property_name: string;
  tenant_name: string | null;
  photo_count: number;
}

const SELECT = `
  SELECT m.*, p.name AS property_name, tn.full_name AS tenant_name,
    (SELECT COUNT(*) FROM attachments a WHERE a.maintenance_id = m.id) AS photo_count
  FROM maintenance_requests m
  JOIN properties p ON p.id = m.property_id
  LEFT JOIN tenants tn ON tn.id = m.tenant_id`;

const OPEN = "('triage','scheduled','in_progress','blocked')";
const PRIORITY_RANK: Record<MaintenancePriority, number> = { critical: 0, high: 1, standard: 2, low: 3 };

function isOpen(status: MaintenanceStatus) {
  return status !== "done" && status !== "cancelled";
}

function toItem(r: MaintenanceRow, paths: Map<string, string>, today: IsoDate): MaintenanceItem {
  return {
    id: r.id,
    ref: r.ref,
    propertyId: r.property_id,
    spaceId: r.space_id,
    tenantId: r.tenant_id,
    title: r.title,
    description: r.description,
    category: r.category,
    priority: r.priority,
    status: r.status,
    dueDate: r.due_date,
    assigneeName: r.assignee_name,
    assigneePhone: r.assignee_phone,
    estimatedCostSen: r.estimated_cost_sen,
    actualCostSen: r.actual_cost_sen,
    reportedOn: r.reported_on,
    propertyName: r.property_name,
    spacePath: r.space_id ? paths.get(r.space_id) ?? null : null,
    tenantName: r.tenant_name,
    overdue: isOpen(r.status) && !!r.due_date && r.due_date < today,
    photoCount: r.photo_count,
    completedOn: r.completed_on,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function sortMaintenance(items: MaintenanceItem[]): MaintenanceItem[] {
  return items.sort((a, b) => {
    const open = Number(!isOpen(a.status)) - Number(!isOpen(b.status));
    if (open) return open;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr) return pr;
    const ad = a.dueDate ?? "9999-12-31";
    const bd = b.dueDate ?? "9999-12-31";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function listMaintenance(core: Core, filter: MaintenanceFilter): MaintenanceItem[] {
  const where: string[] = [];
  const args: (string | null)[] = [];
  const today = core.today();
  if (filter.propertyId) {
    where.push("m.property_id = ?");
    args.push(filter.propertyId);
  }
  if (filter.status === "open") where.push(`m.status IN ${OPEN}`);
  else if (filter.status !== "all") {
    where.push("m.status = ?");
    args.push(filter.status);
  }
  if (filter.priority) {
    where.push("m.priority = ?");
    args.push(filter.priority);
  }
  if (filter.overdueOnly) {
    where.push(`m.status IN ${OPEN} AND m.due_date IS NOT NULL AND m.due_date < ?`);
    args.push(today);
  }
  const q = filter.query.trim().toLowerCase();
  if (q) {
    where.push("(lower(m.title) LIKE ? OR lower(m.ref) LIKE ? OR lower(m.assignee_name) LIKE ? OR lower(m.description) LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  const rows = core.db.all<MaintenanceRow>(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} LIMIT 2000`, args);
  const paths = allSpacePaths(core);
  return sortMaintenance(rows.map((r) => toItem(r, paths, today)));
}

interface EventRow {
  id: string;
  kind: MaintenanceEvent["kind"];
  changes: string;
  note: string;
  created_at: string;
}

export function getMaintenance(core: Core, id: string): MaintenanceDetail {
  const row = core.db.get<MaintenanceRow>(`${SELECT} WHERE m.id = ?`, [id]);
  if (!row) throw notFound();
  const events = core.db
    .all<EventRow>("SELECT * FROM maintenance_events WHERE request_id = ? ORDER BY created_at DESC, rowid DESC", [id])
    .map((e): MaintenanceEvent => ({ id: e.id, kind: e.kind, changes: JSON.parse(e.changes), note: e.note, createdAt: e.created_at }));
  return {
    ...toItem(row, allSpacePaths(core), core.today()),
    photos: listAttachments(core, { kind: "maintenance", id }),
    events,
  };
}

export function addMaintenanceEvent(
  core: Core,
  requestId: string,
  kind: MaintenanceEvent["kind"],
  changes: MaintenanceEvent["changes"] = [],
  note = "",
) {
  core.db.run("INSERT INTO maintenance_events (id, request_id, kind, changes, note, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    newId(),
    requestId,
    kind,
    JSON.stringify(changes),
    note,
    core.nowIso(),
  ]);
}

function assertSpaceInProperty(core: Core, input: MaintenanceInput) {
  if (!core.db.get("SELECT 1 FROM properties WHERE id = ?", [input.propertyId])) {
    throw new AppError("VALIDATION", "validation.chooseOne", { fields: { propertyId: "validation.chooseOne" } });
  }
  if (input.spaceId) {
    const s = core.db.get<{ property_id: string }>("SELECT property_id FROM spaces WHERE id = ?", [input.spaceId]);
    if (!s || s.property_id !== input.propertyId) {
      throw new AppError("VALIDATION", "validation.chooseOne", { fields: { spaceId: "validation.chooseOne" } });
    }
  }
  if (input.tenantId && !core.db.get("SELECT 1 FROM tenants WHERE id = ?", [input.tenantId])) {
    throw new AppError("VALIDATION", "validation.chooseOne", { fields: { tenantId: "validation.chooseOne" } });
  }
}

export function createMaintenance(core: Core, input: MaintenanceCreate): MaintenanceDetail {
  assertSpaceInProperty(core, input);
  const id = newId();
  core.db.tx(() => {
    const now = core.nowIso();
    core.db.run(
      `INSERT INTO maintenance_requests (id, ref, property_id, space_id, tenant_id, title, description, category, priority, status,
         due_date, assignee_name, assignee_phone, estimated_cost_sen, actual_cost_sen, reported_on, completed_on, created_at, updated_at)
       VALUES ($id, $ref, $propertyId, $spaceId, $tenantId, $title, $description, $category, $priority, $status,
         $dueDate, $assigneeName, $assigneePhone, $estimatedCostSen, $actualCostSen, $reportedOn, $completedOn, $now, $now)`,
      {
        ...input,
        stagingKey: undefined,
        id,
        ref: nextRef(core, "maintenance", "M"),
        completedOn: input.status === "done" ? core.today() : null,
        now,
      },
    );
    addMaintenanceEvent(core, id, "created");
    const staged = core.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM attachments WHERE staging_key = ?", [input.stagingKey ?? ""])?.n ?? 0;
    claimStaged(core, input.stagingKey, { kind: "maintenance", id });
    if (staged > 0) addMaintenanceEvent(core, id, "attachment_added", [], String(staged));
  });
  return getMaintenance(core, id);
}

const TRACKED: MaintenanceField[] = [
  "title",
  "description",
  "category",
  "priority",
  "status",
  "dueDate",
  "assigneeName",
  "assigneePhone",
  "estimatedCostSen",
  "actualCostSen",
  "propertyId",
  "spaceId",
  "tenantId",
  "reportedOn",
];

/** Human-readable value for the history, resolving ids to names at the time of the change. */
function displayValue(core: Core, field: MaintenanceField, value: unknown): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (field === "spaceId") return spacePath(core, String(value)) || null;
  if (field === "tenantId") return core.db.get<{ full_name: string }>("SELECT full_name FROM tenants WHERE id = ?", [String(value)])?.full_name ?? null;
  if (field === "propertyId") return core.db.get<{ name: string }>("SELECT name FROM properties WHERE id = ?", [String(value)])?.name ?? null;
  if (field === "description") return String(value).length > 140 ? `${String(value).slice(0, 140)}…` : String(value);
  return value as string | number;
}

export function updateMaintenance(core: Core, id: string, input: MaintenanceInput): MaintenanceDetail {
  const before = getMaintenance(core, id);
  assertSpaceInProperty(core, input);
  const changes: MaintenanceEvent["changes"] = [];
  for (const field of TRACKED) {
    const a = before[field] ?? null;
    const b = input[field] ?? null;
    if (a !== b) changes.push({ field, from: displayValue(core, field, a), to: displayValue(core, field, b) });
  }
  if (changes.length === 0) return before;
  let completedOn = before.completedOn;
  if (input.status === "done" && before.status !== "done") completedOn = core.today();
  if (input.status !== "done") completedOn = null;
  core.db.tx(() => {
    core.db.run(
      `UPDATE maintenance_requests SET property_id = $propertyId, space_id = $spaceId, tenant_id = $tenantId, title = $title,
         description = $description, category = $category, priority = $priority, status = $status, due_date = $dueDate,
         assignee_name = $assigneeName, assignee_phone = $assigneePhone, estimated_cost_sen = $estimatedCostSen,
         actual_cost_sen = $actualCostSen, reported_on = $reportedOn, completed_on = $completedOn, updated_at = $now
       WHERE id = $id`,
      { ...input, id, completedOn, now: core.nowIso() },
    );
    addMaintenanceEvent(core, id, "updated", changes);
  });
  return getMaintenance(core, id);
}

export function addMaintenanceNote(core: Core, id: string, note: string): MaintenanceDetail {
  const text = note.trim();
  if (!text) throw new AppError("VALIDATION", "validation.required", { fields: { note: "validation.required" } });
  if (!core.db.get("SELECT 1 FROM maintenance_requests WHERE id = ?", [id])) throw notFound();
  core.db.tx(() => {
    addMaintenanceEvent(core, id, "note", [], text.slice(0, 5000));
    core.db.run("UPDATE maintenance_requests SET updated_at = ? WHERE id = ?", [core.nowIso(), id]);
  });
  return getMaintenance(core, id);
}
