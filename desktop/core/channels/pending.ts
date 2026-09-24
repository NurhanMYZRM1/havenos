import type { PendingBlock } from "../../../lib/api/contract";
import type { Core } from "../context";

/**
 * Dates HavenOS knows are taken on a connection's space (tenancies, manual
 * blocks, reservations from other channels or direct) that the channel's
 * calendar — as last imported — still shows as open. Calendar feeds can't be
 * written to, so the landlord blocks these on the channel by hand.
 *
 * TODO(sync agent): implement. Used by the channels.pendingBlocks handler and
 * by the "block_not_on_channel" alert (services/stays.ts).
 */
export function pendingBlocks(_core: Core, _connectionId: string | null): PendingBlock[] {
  return [];
}
