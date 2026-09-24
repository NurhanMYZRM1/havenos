import type { HandlerContext, Handlers } from "./handler-utils";
import { notImplemented } from "./handler-utils";

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
export function channelHandlers(_ctx: HandlerContext): Pick<Handlers, ChannelMethods> {
  return {
    "channels.list": () => notImplemented("channels.list"),
    "channels.get": () => notImplemented("channels.get"),
    "channels.create": () => notImplemented("channels.create"),
    "channels.update": () => notImplemented("channels.update"),
    "channels.setPaused": () => notImplemented("channels.setPaused"),
    "channels.remove": () => notImplemented("channels.remove"),
    "channels.refresh": () => notImplemented("channels.refresh"),
    "channels.resolveEvent": () => notImplemented("channels.resolveEvent"),
    "channels.pendingBlocks": () => notImplemented("channels.pendingBlocks"),
    "channels.acknowledgeBlock": () => notImplemented("channels.acknowledgeBlock"),
  };
}
