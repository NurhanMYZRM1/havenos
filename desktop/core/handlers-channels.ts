import {
  createConnection,
  getConnection,
  getConnectionDetail,
  getConnectionRow,
  listConnections,
  removeConnection,
  setConnectionPaused,
  updateConnection,
} from "./channels/connections";
import { acknowledgeBlock, pendingBlocks } from "./channels/pending";
import { resolveEvent } from "./channels/sync";
import {
  validateAcknowledgeBlock,
  validateConnectionCreate,
  validateConnectionUpdate,
  validatePendingBlocks,
  validateRefresh,
  validateResolveEvent,
  validateSetPaused,
} from "./channels/validate";
import { AppError } from "./errors";
import type { HandlerContext, Handlers } from "./handler-utils";
import { idParam, ok } from "./handler-utils";

type ChannelMethods =
  | "channels.list"
  | "channels.get"
  | "channels.create"
  | "channels.update"
  | "channels.setPaused"
  | "channels.remove"
  | "channels.refresh"
  | "channels.resolveEvent"
  | "channels.pendingBlocks"
  | "channels.acknowledgeBlock";

/** Channel connections and calendar sync. Validate every param: IPC input is untrusted. */
export function channelHandlers(ctx: HandlerContext): Pick<Handlers, ChannelMethods> {
  const { channels } = ctx;

  /** Read a feed in the background; its outcome shows on the connection (and via the channel-sync event). */
  const syncInBackground = (connectionId: string, trigger: "setup" | "manual") => {
    channels.syncNow({ connectionId, trigger, acceptShrink: false }).catch(() => undefined);
  };

  const requireMain = () => {
    if (ctx.ws.workspace !== "main") throw new AppError("NOT_ALLOWED", "errors.channels.sampleWorkspace");
  };

  return {
    "channels.list": () => listConnections(ctx.core(), channels),
    "channels.get": (p) => getConnectionDetail(ctx.core(), channels, idParam(p)),
    "channels.create": (p) => {
      const input = ok(validateConnectionCreate(p));
      requireMain();
      const core = ctx.core();
      const id = createConnection(core, channels.secrets, input);
      syncInBackground(id, "setup");
      return getConnection(core, channels, id);
    },
    "channels.update": (p) => {
      const input = ok(validateConnectionUpdate(p));
      const core = ctx.core();
      const { linkChanged } = updateConnection(core, channels.secrets, input);
      if (linkChanged) syncInBackground(input.id, "setup");
      return getConnection(core, channels, input.id);
    },
    "channels.setPaused": (p) => {
      const input = ok(validateSetPaused(p));
      const core = ctx.core();
      setConnectionPaused(core, input.id, input.paused);
      if (!input.paused) syncInBackground(input.id, "manual");
      return getConnection(core, channels, input.id);
    },
    "channels.remove": (p) => {
      removeConnection(ctx.core(), channels.secrets, idParam(p));
      return null;
    },
    "channels.refresh": async (p) => {
      const input = ok(validateRefresh(p));
      if (input.id) getConnectionRow(ctx.core(), input.id);
      await channels.syncNow({ connectionId: input.id, trigger: "manual", acceptShrink: input.acceptShrink });
      return listConnections(ctx.core(), channels);
    },
    "channels.resolveEvent": (p) => {
      const input = ok(validateResolveEvent(p));
      const core = ctx.core();
      const connectionId = resolveEvent(core, input.eventId, input.action);
      return getConnectionDetail(core, channels, connectionId);
    },
    "channels.pendingBlocks": (p) => {
      const input = ok(validatePendingBlocks(p));
      return pendingBlocks(ctx.core(), input.connectionId);
    },
    "channels.acknowledgeBlock": (p) => {
      const input = ok(validateAcknowledgeBlock(p));
      const core = ctx.core();
      getConnectionRow(core, input.connectionId);
      acknowledgeBlock(core, input.connectionId, input.start, input.end, input.done);
      return pendingBlocks(core, null);
    },
  };
}
