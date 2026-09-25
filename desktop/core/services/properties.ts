import type {
  PropertyDetail,
  PropertyInput,
  PropertySummary,
  SpaceInput,
  SpaceNode,
  SpaceOccupancy,
  SpaceOption,
  SpaceUpdate,
} from "../../../lib/api/contract";
import type { IsoDate } from "../../../lib/domain/dates";
import type { MyState, PropertyType, RentalMode } from "../../../lib/domain/enums";
import { spacesOverlap, type SpaceRef } from "../../../lib/domain/inventory";
import type { OnboardingPlan, PlannedSpace } from "../../../lib/domain/onboarding";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { SPACES_OVERLAP } from "../schema";
import { findConflict } from "./availability";
import {
  ATTACHMENT_COLUMNS,
  buildPaths,
  isLettable,
  newId,
  occupiesOn,
  toAttachment,
  type AttachmentRow,
  type SpaceRow,
  type TenancyRow,
} from "./shared";

interface PropertyRow {
  id: string;
  name: string;
  property_type: PropertyType;
  address_line1: string;
  address_line2: string;
  postcode: string;
  city: string;
  state: MyState;
  notes: string;
  rent_due_day: number;
  security_deposit_tenths: number;
  utility_deposit_tenths: number;
  default_tenancy_months: number;
  default_terms: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function toInput(r: PropertyRow): PropertyInput {
  return {
    name: r.name,
    propertyType: r.property_type,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    postcode: r.postcode,
    city: r.city,
    state: r.state,
    notes: r.notes,
    rentDueDay: r.rent_due_day,
    securityDepositTenths: r.security_deposit_tenths,
    utilityDepositTenths: r.utility_deposit_tenths,
    defaultTenancyMonths: r.default_tenancy_months,
    defaultTerms: r.default_terms,
  };
}

function ref(r: SpaceRow): SpaceRef {
  return { id: r.id, kind: r.kind, unitId: r.unit_id, roomId: r.room_id };
}

interface OccupancyTenancy extends TenancyRow {
  tenant_name: string;
}

/**
 * Occupancy today for every space in a set: whether it is let directly,
 * covered by a whole-unit / whole-room tenancy above it, partly let below
 * it, let from a future date, or vacant.
 */
function computeOccupancy(spaces: readonly SpaceRow[], tenancies: readonly OccupancyTenancy[], today: IsoDate) {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const current = tenancies.filter((t) => occupiesOn(t, today));
  const future = tenancies.filter((t) => !t.cancelled_at && t.start_date > today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const occupancy = new Map<string, SpaceOccupancy>();
  for (const s of spaces) {
    const direct = current.find((t) => t.space_id === s.id);
    let state: SpaceOccupancy = { state: "vacant", tenancyId: null, tenantName: null, until: null, nextStart: null };
    if (direct) {
      state = { state: "let", tenancyId: direct.id, tenantName: direct.tenant_name, until: direct.moved_out_on ?? direct.end_date, nextStart: null };
    } else {
      const related = current.find((t) => {
        const ts = byId.get(t.space_id);
        return ts ? spacesOverlap(ref(s), ref(ts)) : false;
      });
      if (related) {
        const ts = byId.get(related.space_id)!;
        const above = ts.kind === "unit" || (ts.kind === "room" && s.kind === "bed");
        state = {
          state: above ? "covered" : "part_let",
          tenancyId: above ? related.id : null,
          tenantName: above ? related.tenant_name : null,
          until: above ? related.moved_out_on ?? related.end_date : null,
          nextStart: null,
        };
      } else {
        const next = future.find((t) => t.space_id === s.id);
        if (next) state = { state: "upcoming", tenancyId: next.id, tenantName: next.tenant_name, until: next.end_date, nextStart: next.start_date };
      }
    }
    occupancy.set(s.id, state);
  }
  return { occupancy, current };
}

/** Lettable/occupied counts for one property's spaces. */
export function occupancyCounts(spaces: readonly SpaceRow[], current: readonly TenancyRow[]) {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  let lettable = 0;
  let occupied = 0;
  const byKind = { unit: { total: 0, occupied: 0 }, room: { total: 0, occupied: 0 }, bed: { total: 0, occupied: 0 } };
  for (const s of spaces) {
    if (s.archived_at) continue;
    const unit = byId.get(s.unit_id);
    if (!unit || unit.archived_at) continue;
    if (s.parent_id && byId.get(s.parent_id)?.archived_at) continue;
    if (!isLettable(s, unit.rental_mode)) continue;
    lettable++;
    byKind[s.kind].total++;
    const taken = current.some((t) => {
      const ts = byId.get(t.space_id);
      return ts ? spacesOverlap(ref(s), ref(ts)) : false;
    });
    if (taken) {
      occupied++;
      byKind[s.kind].occupied++;
    }
  }
  return { lettable, occupied, byKind };
}

function loadPropertyRow(core: Core, id: string): PropertyRow {
  const row = core.db.get<PropertyRow>("SELECT * FROM properties WHERE id = ?", [id]);
  if (!row) throw notFound();
  return row;
}

function loadTenancies(core: Core, propertyId: string | null): OccupancyTenancy[] {
  return core.db.all<OccupancyTenancy>(
    `SELECT t.*, tn.full_name AS tenant_name FROM tenancies t JOIN tenants tn ON tn.id = t.tenant_id
     WHERE t.cancelled_at IS NULL ${propertyId ? "AND t.property_id = ?" : ""}`,
    propertyId ? [propertyId] : [],
  );
}

export function listProperties(core: Core, params: { includeArchived: boolean }): PropertySummary[] {
  const rows = core.db.all<PropertyRow>(
    `SELECT * FROM properties ${params.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY archived_at IS NOT NULL, lower(name)`,
  );
  const spaces = core.db.all<SpaceRow>("SELECT * FROM spaces ORDER BY sort_order, created_at");
  const tenancies = loadTenancies(core, null);
  const today = core.today();
  const covers = new Map<string, AttachmentRow>();
  for (const a of core.db.all<AttachmentRow & { property_id: string }>(
    `SELECT ${ATTACHMENT_COLUMNS}, property_id FROM attachments a
     WHERE property_id IS NOT NULL AND purpose = 'photo'
       AND sort_order = (SELECT MIN(sort_order) FROM attachments b WHERE b.property_id = a.property_id AND b.purpose = 'photo')`,
  )) {
    if (!covers.has(a.property_id)) covers.set(a.property_id, a);
  }
  const openMaintenance = new Map(
    core.db
      .all<{ property_id: string; n: number }>(
        "SELECT property_id, COUNT(*) AS n FROM maintenance_requests WHERE status NOT IN ('done','cancelled') GROUP BY property_id",
      )
      .map((r) => [r.property_id, r.n]),
  );
  return rows.map((p) => {
    const ps = spaces.filter((s) => s.property_id === p.id);
    const current = tenancies.filter((t) => t.property_id === p.id && occupiesOn(t, today));
    const counts = occupancyCounts(ps, current);
    const units = ps.filter((s) => s.kind === "unit" && !s.archived_at);
    const cover = covers.get(p.id);
    return {
      id: p.id,
      name: p.name,
      propertyType: p.property_type,
      addressLine1: p.address_line1,
      city: p.city,
      postcode: p.postcode,
      state: p.state,
      cover: cover ? toAttachment(cover) : null,
      unitCount: units.length,
      lettable: counts.lettable,
      occupied: counts.occupied,
      rentalModes: [...new Set(units.map((u) => u.rental_mode as RentalMode))],
      openMaintenance: openMaintenance.get(p.id) ?? 0,
      archived: !!p.archived_at,
      createdAt: p.created_at,
    };
  });
}

export function getProperty(core: Core, id: string): PropertyDetail {
  const p = loadPropertyRow(core, id);
  const spaces = core.db.all<SpaceRow>("SELECT * FROM spaces WHERE property_id = ? ORDER BY sort_order, created_at", [id]);
  const tenancies = loadTenancies(core, id);
  const today = core.today();
  const { occupancy, current } = computeOccupancy(spaces, tenancies, today);
  const counts = occupancyCounts(spaces, current);
  const paths = buildPaths(spaces);
  const unitModes = new Map(spaces.filter((s) => s.kind === "unit").map((s) => [s.id, s.rental_mode]));

  const toNode = (s: SpaceRow): SpaceNode => ({
    id: s.id,
    propertyId: s.property_id,
    kind: s.kind,
    parentId: s.parent_id,
    label: s.label,
    path: paths.get(s.id) ?? s.label,
    rentalMode: s.rental_mode,
    floor: s.floor,
    sizeSqft: s.size_sqft,
    bedrooms: s.bedrooms,
    bathrooms: s.bathrooms,
    roomType: s.room_type,
    defaultRentSen: s.default_rent_sen,
    notes: s.notes,
    archived: !!s.archived_at,
    lettable: isLettable(s, unitModes.get(s.unit_id) ?? null),
    occupancy: occupancy.get(s.id)!,
    children: spaces.filter((c) => c.parent_id === s.id).map(toNode),
  });

  const photos = core.db
    .all<AttachmentRow>(
      `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE property_id = ? AND purpose = 'photo' ORDER BY sort_order, created_at`,
      [id],
    )
    .map(toAttachment);

  return {
    id: p.id,
    ...toInput(p),
    units: spaces.filter((s) => s.kind === "unit").map(toNode),
    photos,
    lettable: counts.lettable,
    occupied: counts.occupied,
    archivedAt: p.archived_at,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export function updateProperty(core: Core, id: string, input: PropertyInput): PropertyDetail {
  loadPropertyRow(core, id);
  core.db.run(
    `UPDATE properties SET name = $name, property_type = $propertyType, address_line1 = $addressLine1, address_line2 = $addressLine2,
       postcode = $postcode, city = $city, state = $state, notes = $notes, rent_due_day = $rentDueDay,
       security_deposit_tenths = $securityDepositTenths, utility_deposit_tenths = $utilityDepositTenths,
       default_tenancy_months = $defaultTenancyMonths, default_terms = $defaultTerms, updated_at = $now
     WHERE id = $id`,
    { ...input, id, now: core.nowIso() },
  );
  return getProperty(core, id);
}

export function setPropertyArchived(core: Core, id: string, archived: boolean): PropertyDetail {
  loadPropertyRow(core, id);
  core.db.run("UPDATE properties SET archived_at = ?, updated_at = ? WHERE id = ?", [archived ? core.nowIso() : null, core.nowIso(), id]);
  return getProperty(core, id);
}

export function deleteProperty(core: Core, id: string) {
  loadPropertyRow(core, id);
  const used = core.db.get<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM tenancies WHERE property_id = ?) + (SELECT COUNT(*) FROM reservations WHERE property_id = ?) AS n",
    [id, id],
  );
  if ((used?.n ?? 0) > 0) throw new AppError("CONFLICT", "errors.hasTenancies");
  core.db.run("DELETE FROM properties WHERE id = ?", [id]);
}

// ── Creation from the onboarding plan ──────────────────────────────────────

function insertSpace(
  core: Core,
  propertyId: string,
  planned: PlannedSpace,
  parent: { id: string; unitId: string } | null,
  sortOrder: number,
): string {
  const id = newId();
  const now = core.nowIso();
  const unitId = planned.kind === "unit" ? id : parent!.unitId;
  const roomId = planned.kind === "room" ? id : planned.kind === "bed" ? parent!.id : null;
  core.db.run(
    `INSERT INTO spaces (id, property_id, kind, parent_id, unit_id, room_id, label, rental_mode, floor, size_sqft, bedrooms, bathrooms,
       room_type, default_rent_sen, sort_order, notes, created_at, updated_at)
     VALUES ($id, $propertyId, $kind, $parentId, $unitId, $roomId, $label, $rentalMode, $floor, $sizeSqft, $bedrooms, NULL,
       $roomType, $rent, $sort, '', $now, $now)`,
    {
      id,
      propertyId,
      kind: planned.kind,
      parentId: parent?.id ?? null,
      unitId,
      roomId,
      label: planned.label,
      rentalMode: planned.rentalMode,
      floor: planned.floor,
      sizeSqft: planned.sizeSqft,
      bedrooms: planned.bedrooms,
      roomType: planned.roomType,
      rent: planned.defaultRentSen,
      sort: sortOrder,
      now,
    },
  );
  planned.children.forEach((child, i) => insertSpace(core, propertyId, child, { id, unitId }, i));
  return id;
}

/** Create a property and its whole inventory in one transaction. */
export function createPropertyFromPlan(core: Core, plan: OnboardingPlan): string {
  return core.db.tx(() => {
    const id = newId();
    const now = core.nowIso();
    core.db.run(
      `INSERT INTO properties (id, name, property_type, address_line1, address_line2, postcode, city, state, notes, rent_due_day,
         security_deposit_tenths, utility_deposit_tenths, default_tenancy_months, default_terms, created_at, updated_at)
       VALUES ($id, $name, $propertyType, $addressLine1, $addressLine2, $postcode, $city, $state, $notes, $rentDueDay,
         $securityDepositTenths, $utilityDepositTenths, $defaultTenancyMonths, $defaultTerms, $now, $now)`,
      { ...plan.property, id, now },
    );
    plan.units.forEach((unit, i) => insertSpace(core, id, unit, null, i));
    return id;
  });
}

// ── Editing inventory after creation ───────────────────────────────────────

function loadSpace(core: Core, id: string): SpaceRow {
  const s = core.db.get<SpaceRow>("SELECT * FROM spaces WHERE id = ?", [id]);
  if (!s) throw notFound();
  return s;
}

export function createSpace(core: Core, input: SpaceInput): PropertyDetail {
  loadPropertyRow(core, input.propertyId);
  let parent: SpaceRow | null = null;
  if (input.kind !== "unit") {
    parent = loadSpace(core, input.parentId!);
    const expected = input.kind === "room" ? "unit" : "room";
    if (parent.kind !== expected || parent.property_id !== input.propertyId) throw new AppError("VALIDATION", "errors.wrongParent");
  }
  const order =
    core.db.get<{ n: number }>("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM spaces WHERE property_id = ? AND parent_id IS ?", [
      input.propertyId,
      input.parentId,
    ])?.n ?? 0;
  core.db.tx(() =>
    insertSpace(
      core,
      input.propertyId,
      {
        kind: input.kind,
        label: input.label,
        rentalMode: input.kind === "unit" ? input.rentalMode ?? "whole_unit" : null,
        floor: input.floor,
        sizeSqft: input.sizeSqft,
        bedrooms: input.bedrooms,
        roomType: input.roomType,
        defaultRentSen: input.defaultRentSen,
        children: [],
      },
      parent ? { id: parent.id, unitId: parent.unit_id } : null,
      order,
    ),
  );
  return getProperty(core, input.propertyId);
}

export function spaceKind(core: Core, id: string) {
  return loadSpace(core, id).kind;
}

export function updateSpace(core: Core, input: SpaceUpdate): PropertyDetail {
  const s = loadSpace(core, input.id);
  core.db.run(
    `UPDATE spaces SET label = $label, rental_mode = $rentalMode, floor = $floor, size_sqft = $sizeSqft, bedrooms = $bedrooms,
       bathrooms = $bathrooms, room_type = $roomType, default_rent_sen = $defaultRentSen, notes = $notes, updated_at = $now
     WHERE id = $id`,
    {
      ...input,
      rentalMode: s.kind === "unit" ? input.rentalMode ?? s.rental_mode : null,
      now: core.nowIso(),
    },
  );
  return getProperty(core, s.property_id);
}

export function setSpaceArchived(core: Core, id: string, archived: boolean): PropertyDetail {
  const s = loadSpace(core, id);
  if (archived) {
    const connection = core.db.get<{ name: string }>(
      `SELECT c.name FROM channel_connections c JOIN spaces a ON a.id = c.space_id JOIN spaces b ON b.id = ?
       WHERE c.removed_at IS NULL AND ${SPACES_OVERLAP} LIMIT 1`,
      [id],
    );
    if (connection) throw new AppError("CONFLICT", "shortStays.connections.spaceHasConnection", { params: { name: connection.name } });
    // A space with a current or future tenancy (on it or inside it) stays live.
    const live = core.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tenancies t JOIN spaces x ON x.id = t.space_id
       WHERE t.cancelled_at IS NULL AND COALESCE(t.moved_out_on, t.end_date, '9999-12-31') >= ?
         AND (x.id = ? OR x.parent_id = ? OR (x.unit_id = ? AND ? = 'unit'))`,
      [core.today(), id, id, id, s.kind],
    );
    if ((live?.n ?? 0) > 0) throw new AppError("CONFLICT", "errors.hasTenancies");
  }
  core.db.tx(() => {
    const stamp = archived ? core.nowIso() : null;
    // Archiving a unit or room archives everything inside it too.
    core.db.run(
      "UPDATE spaces SET archived_at = ?, updated_at = ? WHERE id = ? OR parent_id = ? OR (unit_id = ? AND ? = 'unit')",
      [stamp, core.nowIso(), id, id, id, s.kind],
    );
  });
  return getProperty(core, s.property_id);
}

/** Every space with its availability for a date range, for the tenancy form. */
export function spaceOptions(
  core: Core,
  params: { propertyId: string | null; startDate: IsoDate | null; endDate: IsoDate | null; excludeTenancyId: string | null },
): SpaceOption[] {
  const spaces = core.db.all<SpaceRow & { property_name: string; unit_mode: RentalMode | null }>(
    `SELECT s.*, p.name AS property_name, u.rental_mode AS unit_mode
     FROM spaces s JOIN properties p ON p.id = s.property_id JOIN spaces u ON u.id = s.unit_id
     WHERE s.archived_at IS NULL AND u.archived_at IS NULL AND p.archived_at IS NULL
       AND (s.parent_id IS NULL OR (SELECT archived_at FROM spaces WHERE id = s.parent_id) IS NULL)
       ${params.propertyId ? "AND s.property_id = ?" : ""}
     ORDER BY lower(p.name), s.sort_order, s.created_at`,
    params.propertyId ? [params.propertyId] : [],
  );
  const allRows = core.db.all<SpaceRow>(
    `SELECT * FROM spaces ${params.propertyId ? "WHERE property_id = ?" : ""}`,
    params.propertyId ? [params.propertyId] : [],
  );
  const paths = buildPaths(allRows);
  // Depth-first order so rooms follow their unit and beds their room.
  const children = new Map<string | null, typeof spaces>();
  for (const s of spaces) {
    const key = s.parent_id;
    children.set(key, [...(children.get(key) ?? []), s]);
  }
  const ordered: typeof spaces = [];
  const walk = (parent: string | null) => {
    for (const s of children.get(parent) ?? []) {
      ordered.push(s);
      walk(s.id);
    }
  };
  walk(null);
  return ordered.map((s) => {
    const conflict = params.startDate
      ? findConflict(core, s.id, params.startDate, params.endDate, { excludeTenancyId: params.excludeTenancyId })
      : null;
    return {
      id: s.id,
      propertyId: s.property_id,
      propertyName: s.property_name,
      kind: s.kind,
      path: paths.get(s.id) ?? s.label,
      defaultRentSen: s.default_rent_sen,
      lettable: isLettable(s, s.unit_mode),
      available: !conflict,
      conflict: conflict ? conflict.who : null,
    };
  });
}
