import type { ChannelHealth } from "../../../lib/api/contract";
import type { ChannelId } from "../../../lib/domain/enums";
import { channelHealth } from "../../../lib/domain/short-stay";
import type { Core } from "../context";

/**
 * What the short-stay views need to know about the running sync scheduler,
 * passed in by the IPC handler so these services stay free of it (and tests
 * can pass a fixed answer).
 */
export interface ChannelRuntime {
  /** A feed link is stored for this connection (in the OS credential store). */
  hasFeedLink(connectionId: string): boolean;
  /** This connection's feed is being read right now. */
  isRunning(connectionId: string): boolean;
}

/** No links, nothing running: every active connection reads as feed_link_missing. */
export const NO_CHANNEL_RUNTIME: ChannelRuntime = { hasFeedLink: () => false, isRunning: () => false };

export interface LiveConnectionRow {
  id: string;
  channel: ChannelId;
  name: string;
  space_id: string;
  property_id: string;
  property_name: string;
  status: "active" | "paused";
  check_in_time: string;
  check_out_time: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  created_at: string;
}

export interface LiveConnection extends LiveConnectionRow {
  health: ChannelHealth;
}

/** Every connection that hasn't been removed, with its health. Active ones first. */
export function liveConnections(core: Core, runtime: ChannelRuntime): LiveConnection[] {
  const now = core.now();
  return core.db
    .all<LiveConnectionRow>(
      `SELECT c.id, c.channel, c.name, c.space_id, c.property_id, p.name AS property_name, c.status, c.check_in_time, c.check_out_time,
         c.last_success_at, c.last_error_at, c.last_error_code, c.created_at
       FROM channel_connections c JOIN properties p ON p.id = c.property_id
       WHERE c.removed_at IS NULL
       ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END, c.created_at, c.id`,
    )
    .map((c) => ({
      ...c,
      health: channelHealth(
        {
          status: c.status,
          lastSuccessAt: c.last_success_at,
          lastErrorAt: c.last_error_at,
          hasFeedLink: safe(() => runtime.hasFeedLink(c.id)),
          running: safe(() => runtime.isRunning(c.id)),
        },
        now,
      ),
    }));
}

function safe(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

export function connectionHref(id: string): string {
  return `/settings/channels/?id=${id}`;
}

export const STALE_HEALTH: readonly ChannelHealth[] = ["stale", "never_synced"];
export const FAILING_HEALTH: readonly ChannelHealth[] = ["error", "feed_link_missing"];
