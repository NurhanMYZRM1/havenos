import { isYearMonth, monthRange } from "../../lib/domain/dates";
import { asObject, readDate, readEnum, readId, type FieldErrors } from "../../lib/domain/validate";
import type { PerformanceGroup } from "../../lib/api/contract";
import { validationError } from "./errors";
import { idParam, ok, type HandlerContext, type Handlers } from "./handler-utils";
import { ImportSessions } from "./imports/import-session";
import { createLedgerEntry, listLedger, validateLedgerInput, voidLedgerEntry } from "./services/ledger";
import { MAX_REPORT_MONTHS, performanceReport } from "./services/performance";

type MoneyMethods = "stays.performance" | "ledger.list" | "ledger.create" | "ledger.void" | "imports.pickAirbnbCsv" | "imports.commit" | "imports.discard";

const GROUPS: readonly PerformanceGroup[] = ["property", "space", "channel", "month"];

function token(params: unknown): string {
  return idParam(params, "token");
}

/** Short-stay ledger, Airbnb CSV import and the performance report. Validate every param. */
export function moneyHandlers(ctx: HandlerContext): Pick<Handlers, MoneyMethods> {
  // Import previews live in memory, keyed by token, for 30 minutes (measured on the core's clock).
  const imports = new ImportSessions(() => ctx.core().now().getTime());

  return {
    "stays.performance": (p) => {
      const o = asObject(p);
      const f: FieldErrors = {};
      if (!isYearMonth(o.from)) f.from = "validation.invalidMonth";
      if (!isYearMonth(o.to)) f.to = "validation.invalidMonth";
      const groupBy = readEnum(o, "groupBy", GROUPS, f);
      const propertyId = readId(o, "propertyId", f, { required: false });
      if (!f.from && !f.to) {
        const from = o.from as string;
        const to = o.to as string;
        if (to < from) f.to = "validation.endBeforeStart";
        else if (monthRange(from, to).length > MAX_REPORT_MONTHS) f.to = "errors.money.rangeTooLong";
      }
      if (Object.keys(f).length) throw validationError(f);
      return performanceReport(ctx.core(), { from: o.from as string, to: o.to as string, groupBy, propertyId });
    },

    "ledger.list": (p) => {
      const o = asObject(p);
      const f: FieldErrors = {};
      const from = readDate(o, "from", f, { required: true });
      const to = readDate(o, "to", f, { required: true });
      const propertyId = readId(o, "propertyId", f, { required: false });
      const reservationId = readId(o, "reservationId", f, { required: false });
      if (from && to && to < from) f.to = "validation.endBeforeStart";
      if (Object.keys(f).length) throw validationError(f);
      return listLedger(ctx.core(), { from: from!, to: to!, propertyId, reservationId });
    },
    "ledger.create": (p) => createLedgerEntry(ctx.core(), ok(validateLedgerInput(p))),
    "ledger.void": (p) => {
      voidLedgerEntry(ctx.core(), idParam(p));
      return null;
    },

    "imports.pickAirbnbCsv": async () => {
      const file = await ctx.platform.pickImportFile();
      if (!file) return null;
      return imports.open(ctx.core(), file);
    },
    "imports.commit": (p) => {
      const t = token(p);
      const raw = asObject(p).listingMap;
      const f: FieldErrors = {};
      const listingMap: Record<string, string | null> = Object.create(null);
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) f.listingMap = "validation.required";
      else {
        const entries = Object.entries(raw as Record<string, unknown>);
        if (entries.length > 500) f.listingMap = "validation.tooLong";
        for (const [name, value] of entries) {
          if (name.length > 200) {
            f.listingMap = "validation.tooLong";
            continue;
          }
          if (value === null) listingMap[name] = null;
          else if (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)) listingMap[name] = value;
          else f[`listingMap.${name}`] = "validation.chooseOne";
        }
      }
      if (Object.keys(f).length) throw validationError(f);
      return imports.commit(ctx.core(), t, listingMap);
    },
    "imports.discard": (p) => {
      imports.discard(token(p));
      return null;
    },
  };
}
