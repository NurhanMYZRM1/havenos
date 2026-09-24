import type { HandlerContext, Handlers } from "./handler-utils";
import { notImplemented } from "./handler-utils";

type MoneyMethods = "stays.performance" | "ledger.list" | "ledger.create" | "ledger.void" | "imports.pickAirbnbCsv" | "imports.commit" | "imports.discard";

/** Short-stay ledger, Airbnb CSV import and the performance report. Validate every param. */
export function moneyHandlers(_ctx: HandlerContext): Pick<Handlers, MoneyMethods> {
  return {
    "stays.performance": () => notImplemented("stays.performance"),
    "ledger.list": () => notImplemented("ledger.list"),
    "ledger.create": () => notImplemented("ledger.create"),
    "ledger.void": () => notImplemented("ledger.void"),
    "imports.pickAirbnbCsv": () => notImplemented("imports.pickAirbnbCsv"),
    "imports.commit": () => notImplemented("imports.commit"),
    "imports.discard": () => notImplemented("imports.discard"),
  };
}
