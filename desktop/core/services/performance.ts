import type { PerformanceFigure, PerformanceGroup, PerformanceReport, PerformanceRow } from "../../../lib/api/contract";
import { addDays, daysBetween, firstOfMonth, lastOfMonth, maxDate, minDate, monthOf, monthRange, type IsoDate, type YearMonth } from "../../../lib/domain/dates";
import { RESERVATION_CHANNELS, type LedgerKind, type ReservationChannel } from "../../../lib/domain/enums";
import { formatMonth } from "../../../lib/domain/format";
import { t } from "../../../lib/i18n";
import type { Core } from "../context";
import { AppError } from "../errors";
import { SPACES_OVERLAP } from "../schema";
import { allSpacePaths } from "./shared";

/**
 * Short-stay performance: the landlord's own figures, nothing else — no
 * market data, no pricing advice.
 *
 * Attribution
 *  - booking_value, cleaning_fee, channel_fee, tax and adjustment rows count
 *    in the linked stay's check-in month (else their own date);
 *  - payouts and expenses count on their own date; imported adjustments also
 *    count as payouts on their own date, because the channel netted them into
 *    a transfer (e.g. an Airbnb resolution deducted from the next payout);
 *  - turnover costs on the turnover's due date, maintenance actual costs on
 *    the completion date — both 'entered'. Maintenance counts only when it is
 *    on a space with short-stay activity (an active channel connection or a
 *    non-cancelled reservation) or on a space overlapping one (attributed to
 *    that short-stay space); property-level maintenance is left out.
 *  - Voided ledger rows are ignored.
 *
 * Figures
 *  - bookingValue = booking values + adjustments (signed). Booking value is
 *    what the guest paid for the stay, including the cleaning fee and any tax
 *    the host collects; cleaningFees is shown as a part of it and never added
 *    again.
 *  - estimatedNet = bookingValue − channelFees − taxes − expenses.
 *  - stays: non-cancelled reservations checking in within the period; nights:
 *    their booked nights inside the period (clipped). occupancyPct (space rows
 *    only) = nights ÷ (nights in range − nights under manual blocks on that
 *    space or an overlapping one), one decimal.
 *  - averageNightly = booking_value of counted stays that have one ÷ their
 *    full nights (adjustments excluded); staysWithoutMoney = counted stays
 *    with no booking value.
 */

export const MAX_REPORT_MONTHS = 24;

type FigureName = "bookingValue" | "cleaningFees" | "channelFees" | "taxes" | "payouts" | "expenses";
type Source = "imported" | "entered";

interface Acc {
  key: string;
  label: string;
  isSpace: boolean;
  spaceId: string | null;
  stays: number;
  nights: number;
  figures: Record<FigureName, { imported: number; entered: number }>;
  avgValue: number;
  avgNights: number;
  staysWithoutMoney: number;
}

interface Where {
  propertyId: string;
  spaceId: string | null;
  channel: ReservationChannel | null;
  month: YearMonth;
}

const EARNINGS: Partial<Record<LedgerKind, FigureName>> = {
  booking_value: "bookingValue",
  adjustment: "bookingValue",
  cleaning_fee: "cleaningFees",
  channel_fee: "channelFees",
  tax: "taxes",
};

function newAcc(key: string, label: string, isSpace = false, spaceId: string | null = null): Acc {
  const zero = () => ({ imported: 0, entered: 0 });
  return {
    key,
    label,
    isSpace,
    spaceId,
    stays: 0,
    nights: 0,
    figures: { bookingValue: zero(), cleaningFees: zero(), channelFees: zero(), taxes: zero(), payouts: zero(), expenses: zero() },
    avgValue: 0,
    avgNights: 0,
    staysWithoutMoney: 0,
  };
}

function figure(f: { imported: number; entered: number }): PerformanceFigure {
  return { importedSen: f.imported, enteredSen: f.entered, totalSen: f.imported + f.entered };
}

export function performanceReport(
  core: Core,
  opts: { from: YearMonth; to: YearMonth; groupBy: PerformanceGroup; propertyId: string | null },
): PerformanceReport {
  const { from, to, groupBy, propertyId } = opts;
  const months = from <= to ? monthRange(from, to) : [];
  if (!months.length) throw new AppError("VALIDATION", "validation.endBeforeStart", { fields: { to: "validation.endBeforeStart" } });
  if (months.length > MAX_REPORT_MONTHS) throw new AppError("VALIDATION", "errors.money.rangeTooLong", { fields: { to: "errors.money.rangeTooLong" } });
  const start = firstOfMonth(from);
  const end = lastOfMonth(to);
  const inRange = (d: IsoDate) => d >= start && d <= end;
  const prop = { propertyId };

  const propertyNames = new Map(core.db.all<{ id: string; name: string }>("SELECT id, name FROM properties").map((p) => [p.id, p.name]));
  const paths = allSpacePaths(core);
  const spaceProperty = new Map(core.db.all<{ id: string; property_id: string }>("SELECT id, property_id FROM spaces").map((s) => [s.id, s.property_id]));

  const rows = new Map<string, Acc>();
  const keyOf = (w: Where): [string, () => Acc] => {
    switch (groupBy) {
      case "property":
        return [w.propertyId, () => newAcc(w.propertyId, propertyNames.get(w.propertyId) ?? "")];
      case "space":
        if (!w.spaceId) {
          const key = `property:${w.propertyId}`;
          return [key, () => newAcc(key, t("errors.money.label.noSpace", { property: propertyNames.get(w.propertyId) ?? "" }))];
        }
        return [w.spaceId, () => newAcc(w.spaceId!, `${propertyNames.get(w.propertyId) ?? ""} · ${paths.get(w.spaceId!) ?? ""}`, true, w.spaceId)];
      case "channel": {
        const key = w.channel ?? "none";
        return [key, () => newAcc(key, w.channel ? t(`errors.money.label.channel.${w.channel}`) : t("errors.money.label.noChannel"))];
      }
      default:
        return [w.month, () => newAcc(w.month, formatMonth(w.month))];
    }
  };
  const acc = (w: Where): Acc => {
    const [key, make] = keyOf(w);
    let a = rows.get(key);
    if (!a) {
      a = make();
      rows.set(key, a);
    }
    return a;
  };

  if (groupBy === "month") for (const m of months) acc({ propertyId: "", spaceId: null, channel: null, month: m });
  if (groupBy === "property" || groupBy === "space") {
    // Short-stay spaces show up even in a quiet period (0% occupancy is worth seeing).
    for (const c of core.db.all<{ property_id: string; space_id: string }>(
      "SELECT DISTINCT property_id, space_id FROM channel_connections WHERE removed_at IS NULL AND ($propertyId IS NULL OR property_id = $propertyId)",
      prop,
    )) {
      acc({ propertyId: c.property_id, spaceId: c.space_id, channel: null, month: from });
    }
  }

  // ── Ledger ────────────────────────────────────────────────────────────────
  const ledger = core.db.all<{
    reservation_id: string | null;
    property_id: string;
    space_id: string | null;
    channel: ReservationChannel;
    kind: LedgerKind;
    amount_sen: number;
    occurred_on: string;
    source: Source;
    check_in: string | null;
  }>(
    `SELECT l.reservation_id, l.property_id, l.space_id, l.channel, l.kind, l.amount_sen, l.occurred_on, l.source, r.check_in
     FROM stay_ledger l LEFT JOIN reservations r ON r.id = l.reservation_id
     WHERE l.voided_at IS NULL AND ($propertyId IS NULL OR l.property_id = $propertyId)
       AND (l.occurred_on BETWEEN $start AND $end OR r.check_in BETWEEN $start AND $end)`,
    { ...prop, start, end },
  );
  const bookingByStay = new Map<string, number>();
  for (const l of ledger) {
    const where = (date: IsoDate): Where => ({ propertyId: l.property_id, spaceId: l.space_id, channel: l.channel, month: monthOf(date) });
    const earnings = EARNINGS[l.kind];
    if (earnings) {
      const date = l.check_in ?? l.occurred_on;
      if (inRange(date)) acc(where(date)).figures[earnings][l.source] += l.amount_sen;
      if (l.kind === "booking_value" && l.reservation_id) bookingByStay.set(l.reservation_id, (bookingByStay.get(l.reservation_id) ?? 0) + l.amount_sen);
    }
    const onDate = inRange(l.occurred_on);
    if (onDate && (l.kind === "payout" || (l.kind === "adjustment" && l.source === "imported"))) acc(where(l.occurred_on)).figures.payouts[l.source] += l.amount_sen;
    if (onDate && l.kind === "expense") acc(where(l.occurred_on)).figures.expenses[l.source] += l.amount_sen;
  }

  // ── Stays and nights ──────────────────────────────────────────────────────
  for (const r of core.db.all<{ id: string; property_id: string; space_id: string; channel: ReservationChannel; check_in: string; check_out: string }>(
    `SELECT id, property_id, space_id, channel, check_in, check_out FROM reservations
     WHERE status <> 'cancelled' AND check_in <= $end AND check_out > $start AND ($propertyId IS NULL OR property_id = $propertyId)`,
    { ...prop, start, end },
  )) {
    const base = { propertyId: r.property_id, spaceId: r.space_id, channel: r.channel };
    const firstNight = maxDate(r.check_in, start);
    const lastNight = minDate(addDays(r.check_out, -1), end);
    if (groupBy === "month") {
      for (const m of months) {
        const a = maxDate(firstNight, firstOfMonth(m));
        const b = minDate(lastNight, lastOfMonth(m));
        if (a <= b) acc({ ...base, month: m }).nights += daysBetween(a, b) + 1;
      }
    } else if (firstNight <= lastNight) {
      acc({ ...base, month: from }).nights += daysBetween(firstNight, lastNight) + 1;
    }
    if (inRange(r.check_in)) {
      const a = acc({ ...base, month: monthOf(r.check_in) });
      a.stays++;
      const value = bookingByStay.get(r.id);
      if (value === undefined) a.staysWithoutMoney++;
      else {
        a.avgValue += value;
        a.avgNights += daysBetween(r.check_in, r.check_out);
      }
    }
  }

  // ── Turnover costs ────────────────────────────────────────────────────────
  for (const tv of core.db.all<{ property_id: string; space_id: string; channel: ReservationChannel; due_date: string; cost_sen: number }>(
    `SELECT tv.property_id, tv.space_id, r.channel, tv.due_date, tv.cost_sen
     FROM turnovers tv JOIN reservations r ON r.id = tv.reservation_id
     WHERE tv.cost_sen IS NOT NULL AND tv.cost_sen > 0 AND tv.due_date BETWEEN $start AND $end
       AND ($propertyId IS NULL OR tv.property_id = $propertyId)`,
    { ...prop, start, end },
  )) {
    acc({ propertyId: tv.property_id, spaceId: tv.space_id, channel: tv.channel, month: monthOf(tv.due_date) }).figures.expenses.entered += tv.cost_sen;
  }

  // ── Maintenance on short-stay spaces ──────────────────────────────────────
  const shortStay = new Set(
    core.db
      .all<{ id: string }>(
        `SELECT space_id AS id FROM channel_connections WHERE removed_at IS NULL
         UNION SELECT space_id FROM reservations WHERE status <> 'cancelled'`,
      )
      .map((s) => s.id),
  );
  if (shortStay.size) {
    const tree = new Map(core.db.all<{ id: string; unit_id: string; room_id: string | null; sort_order: number }>("SELECT id, unit_id, room_id, sort_order FROM spaces").map((s) => [s.id, s]));
    const attribute = (spaceId: string): string | null => {
      if (shortStay.has(spaceId)) return spaceId;
      const s = tree.get(spaceId);
      if (!s) return null;
      if (s.room_id && s.room_id !== spaceId && shortStay.has(s.room_id)) return s.room_id;
      if (s.unit_id !== spaceId && shortStay.has(s.unit_id)) return s.unit_id;
      // A short-stay space inside this one (e.g. a room listed on its own, work on the whole unit).
      const inside = [...shortStay].filter((id) => {
        const c = tree.get(id);
        return c && id !== spaceId && (c.unit_id === spaceId || c.room_id === spaceId);
      });
      inside.sort((a, b) => (tree.get(a)!.sort_order - tree.get(b)!.sort_order) || a.localeCompare(b));
      return inside[0] ?? null;
    };
    for (const m of core.db.all<{ property_id: string; space_id: string; completed_on: string; actual_cost_sen: number }>(
      `SELECT property_id, space_id, completed_on, actual_cost_sen FROM maintenance_requests
       WHERE space_id IS NOT NULL AND actual_cost_sen IS NOT NULL AND actual_cost_sen > 0 AND status <> 'cancelled'
         AND completed_on BETWEEN $start AND $end AND ($propertyId IS NULL OR property_id = $propertyId)`,
      { ...prop, start, end },
    )) {
      const spaceId = attribute(m.space_id);
      if (!spaceId) continue;
      acc({ propertyId: spaceProperty.get(spaceId) ?? m.property_id, spaceId, channel: null, month: monthOf(m.completed_on) }).figures.expenses.entered += m.actual_cost_sen;
    }
  }

  // ── Rows ──────────────────────────────────────────────────────────────────
  const rangeNights = daysBetween(start, end) + 1;
  const toRow = (a: Acc, occupancyPct: number | null): PerformanceRow => {
    const f = a.figures;
    const total = (n: FigureName) => f[n].imported + f[n].entered;
    return {
      key: a.key,
      label: a.label,
      stays: a.stays,
      nights: a.nights,
      occupancyPct,
      bookingValue: figure(f.bookingValue),
      cleaningFees: figure(f.cleaningFees),
      channelFees: figure(f.channelFees),
      taxes: figure(f.taxes),
      payouts: figure(f.payouts),
      expenses: figure(f.expenses),
      estimatedNetSen: total("bookingValue") - total("channelFees") - total("taxes") - total("expenses"),
      averageNightlySen: a.avgNights > 0 ? Math.round(a.avgValue / a.avgNights) : null,
      staysWithoutMoney: a.staysWithoutMoney,
    };
  };
  const occupancy = (spaceId: string, nights: number): number | null => {
    const blocked = new Set<string>();
    for (const b of core.db.all<{ start_date: string; end_date: string }>(
      `SELECT k.start_date, k.end_date FROM availability_blocks k
       JOIN spaces a ON a.id = k.space_id JOIN spaces b ON b.id = $space
       WHERE k.cancelled_at IS NULL AND ${SPACES_OVERLAP} AND k.start_date <= $end AND k.end_date >= $start`,
      { space: spaceId, start, end },
    )) {
      for (let d = maxDate(b.start_date, start); d <= minDate(b.end_date, end); d = addDays(d, 1)) blocked.add(d);
    }
    const available = rangeNights - blocked.size;
    if (available <= 0) return null;
    return Math.min(100, Math.round((nights / available) * 1000) / 10);
  };

  const accs = [...rows.values()];
  const channelOrder = (k: string) => {
    const i = (RESERVATION_CHANNELS as readonly string[]).indexOf(k);
    return i < 0 ? RESERVATION_CHANNELS.length : i;
  };
  accs.sort((a, b) => {
    if (groupBy === "month") return a.key.localeCompare(b.key);
    if (groupBy === "channel") return channelOrder(a.key) - channelOrder(b.key);
    return a.label.localeCompare(b.label);
  });

  const totals = newAcc("total", t("errors.money.label.total"));
  for (const a of accs) {
    totals.stays += a.stays;
    totals.nights += a.nights;
    totals.avgValue += a.avgValue;
    totals.avgNights += a.avgNights;
    totals.staysWithoutMoney += a.staysWithoutMoney;
    for (const n of Object.keys(a.figures) as FigureName[]) {
      totals.figures[n].imported += a.figures[n].imported;
      totals.figures[n].entered += a.figures[n].entered;
    }
  }

  return {
    from,
    to,
    groupBy,
    rows: accs.map((a) => toRow(a, a.isSpace && a.spaceId ? occupancy(a.spaceId, a.nights) : null)),
    totals: toRow(totals, null),
  };
}
