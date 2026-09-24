import type { Core } from "../core/context";
import { insertReservation, type ReservationWrite } from "../core/services/reservations";
import { newId } from "../core/services/shared";
import { FIXED_NOW, newTenant } from "./helpers";

/** Shared fixtures for the stays-* tests. */

export function addConnection(
  core: Core,
  spaceId: string,
  opts: { checkIn?: string; checkOut?: string; checklist?: string[]; status?: "active" | "paused"; lastSuccessAt?: string | null; lastErrorAt?: string | null; lastErrorCode?: string | null; name?: string } = {},
): string {
  const id = newId();
  const property = core.db.get<{ property_id: string }>("SELECT property_id FROM spaces WHERE id = ?", [spaceId])!.property_id;
  const now = FIXED_NOW.toISOString();
  core.db.run(
    `INSERT INTO channel_connections (id, channel, method, name, space_id, property_id, status, check_in_time, check_out_time, turnover_checklist,
       last_success_at, last_error_at, last_error_code, created_at, updated_at)
     VALUES (?, 'airbnb', 'ical', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.name ?? "Test listing",
      spaceId,
      property,
      opts.status ?? "active",
      opts.checkIn ?? "15:00",
      opts.checkOut ?? "11:00",
      JSON.stringify(opts.checklist ?? []),
      opts.lastSuccessAt === undefined ? now : opts.lastSuccessAt,
      opts.lastErrorAt ?? null,
      opts.lastErrorCode ?? null,
      now,
      now,
    ],
  );
  return id;
}

export function stay(core: Core, input: Partial<ReservationWrite> & Pick<ReservationWrite, "spaceId" | "checkIn" | "checkOut">): string {
  return insertReservation(core, {
    guestName: "Guest",
    guestCount: null,
    checkInTime: null,
    checkOutTime: null,
    status: "confirmed",
    channel: "direct",
    channelReservationId: null,
    connectionId: null,
    source: "manual",
    notes: "",
    ...input,
  });
}

export function turnoverIdFor(core: Core, reservationId: string): string {
  return core.db.get<{ id: string }>("SELECT id FROM turnovers WHERE reservation_id = ?", [reservationId])!.id;
}

export function addChannelEvent(
  core: Core,
  connectionId: string,
  opts: { kind: "reservation" | "block"; state: "applied" | "conflict" | "dismissed"; start: string; end: string; code?: string },
): string {
  const id = newId();
  const now = FIXED_NOW.toISOString();
  core.db.run(
    `INSERT INTO channel_events (id, connection_id, kind, external_uid, confirmation_code, start_date, end_date, summary, state, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Reserved', ?, ?, ?)`,
    [id, connectionId, opts.kind, `uid-${id}`, opts.code ?? null, opts.start, opts.end, opts.state, now, now],
  );
  return id;
}

export const tenancyInput = (spaceId: string, startDate: string, endDate: string | null) => ({
  tenantId: null,
  newTenant: newTenant("Long Stay Tenant"),
  spaceId,
  startDate,
  endDate,
  monthlyRentSen: 100000,
  rentDueDay: 7,
  rentStartMonth: startDate.slice(0, 7),
  securityDepositSen: 0,
  utilityDepositSen: 0,
  terms: "",
  stagingKey: null,
});

export const maintenanceInput = (propertyId: string, spaceId: string | null, priority: "low" | "standard" | "high" | "critical", title = "Repair") => ({
  propertyId,
  spaceId,
  tenantId: null,
  title,
  description: "",
  category: "general" as const,
  priority,
  status: "triage" as const,
  dueDate: null,
  assigneeName: "",
  assigneePhone: "",
  estimatedCostSen: null,
  actualCostSen: null,
  reportedOn: "2026-09-20",
  stagingKey: null,
});
