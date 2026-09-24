import type { HandlerContext, Handlers } from "./handler-utils";
import { idParam, ok, text } from "./handler-utils";
import { cancelBlock, createBlock, listBlocks, updateBlock } from "./services/blocks";
import { stayAlerts } from "./services/stay-alerts";
import type { ChannelRuntime } from "./services/stay-channels";
import {
  validateBlockInput,
  validateBlockList,
  validateBlockUpdate,
  validateCalendarParams,
  validateDayParams,
  validateReservationCreate,
  validateReservationFilter,
  validateReservationUpdate,
  validateTurnoverFilter,
  validateTurnoverUpdate,
} from "./services/stay-validate";
import { stayCalendar, stayDay } from "./services/stay-views";
import { cancelManualReservation, createManualReservation, getReservation, listReservations, updateManualReservation } from "./services/stays";
import { getTurnover, listTurnovers, updateTurnover } from "./services/turnovers";

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

/** What the sync scheduler knows right now, snapshotted once per request. */
function runtimeOf(ctx: HandlerContext): ChannelRuntime {
  let running: Set<string>;
  try {
    running = new Set(ctx.channels.running());
  } catch {
    running = new Set();
  }
  return {
    hasFeedLink: (id) => {
      try {
        return !!ctx.channels.secrets.get(id);
      } catch {
        return false;
      }
    },
    isRunning: (id) => running.has(id),
  };
}

/** Reservations, availability blocks, turnovers and the day/calendar views. Validate every param. */
export function stayHandlers(ctx: HandlerContext): Pick<Handlers, StayMethods> {
  const core = () => ctx.core();
  return {
    "reservations.list": (p) => listReservations(core(), ok(validateReservationFilter(p))),
    "reservations.get": (p) => getReservation(core(), idParam(p)),
    "reservations.create": (p) => createManualReservation(core(), ok(validateReservationCreate(p))),
    "reservations.update": (p) => updateManualReservation(core(), ok(validateReservationUpdate(p))),
    "reservations.cancel": (p) => cancelManualReservation(core(), idParam(p), text(p, "reason", 500)),

    "blocks.list": (p) => listBlocks(core(), ok(validateBlockList(p))),
    "blocks.create": (p) => createBlock(core(), ok(validateBlockInput(p))),
    "blocks.update": (p) => updateBlock(core(), ok(validateBlockUpdate(p))),
    "blocks.cancel": (p) => cancelBlock(core(), idParam(p)),

    "turnovers.list": (p) => listTurnovers(core(), ok(validateTurnoverFilter(p))),
    "turnovers.get": (p) => getTurnover(core(), idParam(p)),
    "turnovers.update": (p) => updateTurnover(core(), ok(validateTurnoverUpdate(p))),

    "stays.day": (p) => stayDay(core(), ok(validateDayParams(p)).date, runtimeOf(ctx)),
    "stays.calendar": (p) => stayCalendar(core(), ok(validateCalendarParams(p)), runtimeOf(ctx)),
    "stays.alerts": () => stayAlerts(core(), runtimeOf(ctx)),
  };
}
