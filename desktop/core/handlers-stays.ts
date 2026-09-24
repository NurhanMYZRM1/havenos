import type { HandlerContext, Handlers } from "./handler-utils";
import { notImplemented } from "./handler-utils";

type StayMethods =
  | "reservations.list"
  | "reservations.get"
  | "reservations.create"
  | "reservations.update"
  | "reservations.cancel"
  | "blocks.list"
  | "blocks.create"
  | "blocks.update"
  | "blocks.cancel"
  | "turnovers.list"
  | "turnovers.get"
  | "turnovers.update"
  | "stays.day"
  | "stays.calendar"
  | "stays.alerts";

/** Reservations, availability blocks, turnovers and the day/calendar views. Validate every param. */
export function stayHandlers(_ctx: HandlerContext): Pick<Handlers, StayMethods> {
  return {
    "reservations.list": () => notImplemented("reservations.list"),
    "reservations.get": () => notImplemented("reservations.get"),
    "reservations.create": () => notImplemented("reservations.create"),
    "reservations.update": () => notImplemented("reservations.update"),
    "reservations.cancel": () => notImplemented("reservations.cancel"),
    "blocks.list": () => notImplemented("blocks.list"),
    "blocks.create": () => notImplemented("blocks.create"),
    "blocks.update": () => notImplemented("blocks.update"),
    "blocks.cancel": () => notImplemented("blocks.cancel"),
    "turnovers.list": () => notImplemented("turnovers.list"),
    "turnovers.get": () => notImplemented("turnovers.get"),
    "turnovers.update": () => notImplemented("turnovers.update"),
    "stays.day": () => notImplemented("stays.day"),
    "stays.calendar": () => notImplemented("stays.calendar"),
    "stays.alerts": () => notImplemented("stays.alerts"),
  };
}
