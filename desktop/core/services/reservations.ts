import type { IsoDate } from "../../../lib/domain/dates";
import type { ReservationChannel } from "../../../lib/domain/enums";
import type { Core } from "../context";
import { AppError, notFound } from "../errors";
import { conflictError, findConflict } from "./availability";
import { newId } from "./shared";

/**
 * Short-stay reservations (nights, check-out day free). Kept apart from
 * long-term tenancies — no rent schedule, deposits or move-in/out — but
 * booked against the same unit/room/bed tree, so a room let on a tenancy
 * can never also be sold as a short stay, and vice versa.
 *
 * There is no reservation UI in this release; this is the foundation a
 * channel adapter (see ../integrations/channels.ts) will write through.
 */
export interface ReservationInput {
  spaceId: string;
  guestName: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  status: "tentative" | "confirmed";
  channel: ReservationChannel;
  channelReservationId: string | null;
  totalSen: number | null;
  notes: string;
}

export function createReservation(core: Core, input: ReservationInput): string {
  if (!(input.checkOut > input.checkIn)) throw new AppError("VALIDATION", "validation.endBeforeStart", { fields: { checkOut: "validation.endBeforeStart" } });
  const space = core.db.get<{ property_id: string }>("SELECT property_id FROM spaces WHERE id = ? AND archived_at IS NULL", [input.spaceId]);
  if (!space) throw notFound();
  return core.db.tx(() => {
    // Reservation nights run check-in … check-out − 1.
    const lastNight = new Date(Date.parse(`${input.checkOut}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const conflict = findConflict(core, input.spaceId, input.checkIn, lastNight);
    if (conflict) throw conflictError(core, conflict);
    const id = newId();
    const now = core.nowIso();
    core.db.run(
      `INSERT INTO reservations (id, space_id, property_id, guest_name, check_in, check_out, status, channel, channel_reservation_id, total_sen, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.spaceId, space.property_id, input.guestName, input.checkIn, input.checkOut, input.status, input.channel, input.channelReservationId, input.totalSen, input.notes, now, now],
    );
    return id;
  });
}

export function cancelReservation(core: Core, id: string) {
  const changed = core.db.run("UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ?", [core.nowIso(), id]);
  if (!changed.changes) throw notFound();
}
