import type { AvailabilityBlock, AvailabilityBlockInput } from "../../../lib/api/contract";
import type { IsoDate } from "../../../lib/domain/dates";
import type { BlockReason } from "../../../lib/domain/enums";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { conflictError, findConflict } from "./availability";
import { allSpacePaths, newId } from "./shared";

/**
 * Manual availability blocks: dates the landlord takes a space off the market
 * (maintenance, personal use, an owner stay). Inclusive last day. They block
 * tenancies and reservations across the unit → room → bed tree through the
 * shared rule in services/availability.ts (and the database triggers).
 * Cancelling keeps the row, so the history of what was blocked survives.
 */

interface BlockRow {
  id: string;
  space_id: string;
  property_id: string;
  start_date: string;
  end_date: string;
  reason: BlockReason;
  maintenance_id: string | null;
  notes: string;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  property_name: string;
}

const SELECT = `SELECT k.*, p.name AS property_name FROM availability_blocks k JOIN properties p ON p.id = k.property_id`;

function toBlock(r: BlockRow, paths: Map<string, string>): AvailabilityBlock {
  return {
    id: r.id,
    spaceId: r.space_id,
    propertyId: r.property_id,
    propertyName: r.property_name,
    spacePath: paths.get(r.space_id) ?? "",
    startDate: r.start_date,
    endDate: r.end_date,
    reason: r.reason,
    maintenanceId: r.maintenance_id,
    notes: r.notes,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function blockHref(id: string): string {
  return `/stays/?tab=calendar&block=${id}`;
}

export function listBlocks(core: Core, params: { from: IsoDate; to: IsoDate; propertyId: string | null; includeCancelled: boolean }): AvailabilityBlock[] {
  const where = ["k.start_date <= $to", "k.end_date >= $from"];
  if (params.propertyId) where.push("k.property_id = $propertyId");
  if (!params.includeCancelled) where.push("k.cancelled_at IS NULL");
  const rows = core.db.all<BlockRow>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY k.start_date, k.created_at LIMIT 5000`, {
    from: params.from,
    to: params.to,
    propertyId: params.propertyId,
  });
  const paths = allSpacePaths(core);
  return rows.map((r) => toBlock(r, paths));
}

export function getBlock(core: Core, id: string): AvailabilityBlock {
  const row = core.db.get<BlockRow>(`${SELECT} WHERE k.id = ?`, [id]);
  if (!row) throw notFound();
  return toBlock(row, allSpacePaths(core));
}

/** Checks shared by create and update; returns the space's property. */
function checkInput(core: Core, input: AvailabilityBlockInput, excludeBlockId: string | null): string {
  const space = core.db.get<{ property_id: string }>(
    `SELECT s.property_id FROM spaces s JOIN spaces u ON u.id = s.unit_id JOIN properties p ON p.id = s.property_id
     WHERE s.id = ? AND s.archived_at IS NULL AND u.archived_at IS NULL AND p.archived_at IS NULL`,
    [input.spaceId],
  );
  if (!space) throw new AppError("VALIDATION", "errors.stays.spaceUnavailable", { fields: { spaceId: "errors.stays.spaceUnavailable" } });
  if (input.endDate < input.startDate) {
    throw new AppError("VALIDATION", "validation.endBeforeStart", { fields: { endDate: "validation.endBeforeStart" } });
  }
  if (input.maintenanceId) {
    const m = core.db.get<{ property_id: string }>("SELECT property_id FROM maintenance_requests WHERE id = ?", [input.maintenanceId]);
    if (!m || m.property_id !== space.property_id) {
      throw new AppError("VALIDATION", "errors.stays.maintenanceOtherProperty", { fields: { maintenanceId: "errors.stays.maintenanceOtherProperty" } });
    }
  }
  const conflict = findConflict(core, input.spaceId, input.startDate, input.endDate, { excludeBlockId });
  if (conflict) throw conflictError(core, conflict);
  return space.property_id;
}

export function createBlock(core: Core, input: AvailabilityBlockInput): AvailabilityBlock {
  const id = newId();
  core.db.tx(() => {
    const propertyId = checkInput(core, input, null);
    const now = core.nowIso();
    core.db.run(
      `INSERT INTO availability_blocks (id, space_id, property_id, start_date, end_date, reason, maintenance_id, notes, created_at, updated_at)
       VALUES ($id, $spaceId, $propertyId, $startDate, $endDate, $reason, $maintenanceId, $notes, $now, $now)`,
      { ...input, notes: input.notes.trim(), id, propertyId, now },
    );
  });
  return getBlock(core, id);
}

function loadLive(core: Core, id: string): BlockRow {
  const row = core.db.get<BlockRow>(`${SELECT} WHERE k.id = ?`, [id]);
  if (!row) throw notFound();
  if (row.cancelled_at) throw new AppError("NOT_ALLOWED", "errors.stays.blockCancelled");
  return row;
}

export function updateBlock(core: Core, input: AvailabilityBlockInput & { id: string }): AvailabilityBlock {
  core.db.tx(() => {
    loadLive(core, input.id);
    const propertyId = checkInput(core, input, input.id);
    core.db.run(
      `UPDATE availability_blocks SET space_id = $spaceId, property_id = $propertyId, start_date = $startDate, end_date = $endDate,
         reason = $reason, maintenance_id = $maintenanceId, notes = $notes, updated_at = $now
       WHERE id = $id`,
      { ...input, notes: input.notes.trim(), propertyId, now: core.nowIso() },
    );
  });
  return getBlock(core, input.id);
}

export function cancelBlock(core: Core, id: string): AvailabilityBlock {
  core.db.tx(() => {
    loadLive(core, id);
    const now = core.nowIso();
    core.db.run("UPDATE availability_blocks SET cancelled_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
  });
  return getBlock(core, id);
}
