"use client";

import Link from "next/link";
import { useEffect, useMemo, type SelectHTMLAttributes } from "react";
import { Spinner } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/status";
import type { AmountSource, ChannelHealth, PerformanceFigure, ReservationSummary, SpaceOption, StayAlert, TurnoverItem } from "@/lib/api/contract";
import { useApi, useChannelSync } from "@/lib/api/hooks";
import { addDays, isIsoDate, type IsoDate } from "@/lib/domain/dates";
import type { ReservationChannel, ReservationSource, ReservationStatus, TurnoverStatus } from "@/lib/domain/enums";
import { formatDate, formatDateLong } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { t, type MessageKey } from "@/lib/i18n";
import { channelLabel, formatClock, formatHours, guestDisplay, nightsLabel } from "./format";

type Tone = Parameters<typeof Pill>[0]["tone"];

// ── Pills (colour + glyph + words, never colour alone) ─────────────────────

const RESERVATION: Record<ReservationStatus, [Tone, string]> = {
  tentative: ["info", "◷"],
  confirmed: ["good", "●"],
  cancelled: ["muted", "✕"],
};

export function ReservationStatusPill({ status }: { status: ReservationStatus }) {
  const [tone, glyph] = RESERVATION[status];
  return <Pill tone={tone} glyph={glyph}>{t(`shortStays.enums.reservationStatus.${status}` as MessageKey)}</Pill>;
}

const TURNOVER: Record<TurnoverStatus, [Tone, string]> = {
  pending: ["neutral", "○"],
  scheduled: ["info", "◷"],
  in_progress: ["warn", "◐"],
  done: ["good", "✓"],
  skipped: ["muted", "✕"],
};

export function TurnoverStatusPill({ status }: { status: TurnoverStatus }) {
  const [tone, glyph] = TURNOVER[status];
  return <Pill tone={tone} glyph={glyph}>{t(`shortStays.enums.turnoverStatus.${status}` as MessageKey)}</Pill>;
}

const HEALTH: Record<ChannelHealth, [Tone, string]> = {
  ok: ["good", "●"],
  syncing: ["info", "↻"],
  stale: ["warn", "◐"],
  error: ["critical", "▲"],
  paused: ["muted", "❚❚"],
  never_synced: ["neutral", "○"],
  feed_link_missing: ["serious", "▲"],
};

export function ChannelHealthPill({ health }: { health: ChannelHealth }) {
  const [tone, glyph] = HEALTH[health];
  return <Pill tone={tone} glyph={glyph}>{t(`shortStays.enums.health.${health}` as MessageKey)}</Pill>;
}

export function LatePill() {
  return <Pill tone="critical" glyph="▲">{t("shortStays.turnover.late")}</Pill>;
}

export function MissingPill({ channel }: { channel: ReservationChannel }) {
  return (
    <Pill tone="serious" glyph="?">
      {t("shortStays.reservation.missingTitle", { channel: channelLabel(channel) }).replace(/\.$/, "")}
    </Pill>
  );
}

/** Where a reservation's data came from: calendar sync, CSV import, or typed. */
export function SourceBadge({ source, channel }: { source: ReservationSource; channel: ReservationChannel }) {
  const icon = source === "feed" ? "calendar" : source === "csv" ? "file" : "key";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--hairline-strong)] px-2 py-0.5 text-[12px] font-medium text-ink-2">
      <Icon name={icon} size={12} />
      {t(`shortStays.enums.source.${source}` as MessageKey, { channel: channelLabel(channel) })}
    </span>
  );
}

/** A neutral tag, e.g. the connection method "Airbnb calendar (iCal) · dates only". */
export function Tag({ children, icon }: { children: React.ReactNode; icon?: Parameters<typeof Icon>[0]["name"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--hairline-strong)] bg-surface-2 px-2 py-0.5 text-[12px] font-medium text-ink-2">
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function AmountSourceTag({ source }: { source: AmountSource }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide ${source === "imported" ? "bg-info/15 text-info" : "bg-brass/15 text-brass-bright"}`}>
      {t(`shortStays.enums.amountSource.${source}` as MessageKey)}
    </span>
  );
}

/** A money total with its Imported / Entered breakdown underneath. */
export function FigureCell({ f }: { f: PerformanceFigure }) {
  if (f.totalSen === 0 && f.importedSen === 0 && f.enteredSen === 0) return <span className="text-ink-3">—</span>;
  const parts = [
    f.importedSen !== 0 ? t("shortStays.performance.imported", { amount: formatRM(f.importedSen) }) : null,
    f.enteredSen !== 0 ? t("shortStays.performance.entered", { amount: formatRM(f.enteredSen) }) : null,
  ].filter(Boolean) as string[];
  return (
    <span title={parts.join(" · ")}>
      <span className="block">{formatRM(f.totalSen)}</span>
      {parts.length > 0 && <span className="block text-[11.5px] text-ink-3">{parts.join(" · ")}</span>}
    </span>
  );
}

// ── Clock that re-renders relative times ───────────────────────────────────

export function useNow(intervalMs = 30_000): number {
  const { data, reload } = useApi("app.now", undefined);
  useEffect(() => {
    const id = window.setInterval(reload, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, reload]);
  // Until the app clock answers, fall back to the device clock on every render
  // (the interval above keeps re-rendering, so relative times never freeze).
  // eslint-disable-next-line react-hooks/purity
  return data ?? Date.now();
}

// ── Sync indicator ─────────────────────────────────────────────────────────

/** Small live "Reading linked calendars…" note while any feed is being read. */
export function SyncIndicator() {
  const running = useChannelSync();
  return (
    <span aria-live="polite" className="inline-flex min-h-8 items-center">
      {running.length > 0 && (
        <span className="inline-flex items-center gap-2 rounded-full border border-info/40 bg-info/10 px-3 py-1 text-[12.5px] text-ink">
          <Spinner size={12} />
          {t("shortStays.sync.running")}
        </span>
      )}
    </span>
  );
}

// ── Pickers ────────────────────────────────────────────────────────────────

/** Lettable spaces across every property, grouped by property. */
export function useSpaceOptions(enabled = true) {
  return useApi("spaces.options", { propertyId: null, startDate: null, endDate: null, excludeTenancyId: null }, { enabled });
}

export function SpaceSelect({
  options,
  value,
  onChange,
  placeholder,
  note,
  allowEmptyLabel,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  options: SpaceOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Extra words after an option, e.g. "already linked". Return null for none. */
  note?: (o: SpaceOption) => string | null;
  /** When set, the empty option is selectable with this label. */
  allowEmptyLabel?: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: SpaceOption[] }>();
    for (const o of options) {
      const g = map.get(o.propertyId) ?? { name: o.propertyName, items: [] };
      g.items.push(o);
      map.set(o.propertyId, g);
    }
    return [...map.entries()];
  }, [options]);
  return (
    <select {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={`control ${rest.className ?? ""}`}>
      {allowEmptyLabel !== undefined ? <option value="">{allowEmptyLabel}</option> : <option value="" disabled>{placeholder ?? t("shortStays.spacePicker.placeholder")}</option>}
      {groups.map(([id, g]) => (
        <optgroup key={id} label={g.name}>
          {g.items.map((o) => {
            const depth = o.path.split(" › ").length - 1;
            const extra = note?.(o);
            return (
              <option key={o.id} value={o.id}>
                {`${"  ".repeat(depth)}${o.path.split(" › ").pop()} (${t(`enums.spaceKind.${o.kind}` as MessageKey).toLowerCase()})${!o.lettable ? ` ${t("shortStays.spacePicker.outsideArrangement")}` : ""}${extra ? ` — ${extra}` : ""}`}
              </option>
            );
          })}
        </optgroup>
      ))}
    </select>
  );
}

/** Previous / next day with the date in words and a jump-to date field. */
export function DaySwitcher({ value, onChange, today }: { value: IsoDate; onChange: (d: IsoDate) => void; today: IsoDate }) {
  const btn = "grid size-9 place-items-center rounded-lg border border-[var(--hairline-strong)] text-ink-2 hover:text-ink";
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("shortStays.today.dayLabel")}>
      <button type="button" className={btn} onClick={() => onChange(addDays(value, -1))} aria-label={t("shortStays.today.previousDay")}>
        <Icon name="chevronLeft" />
      </button>
      <output className="min-w-[210px] text-center text-[15px] font-semibold" aria-live="polite">
        {formatDateLong(value)}
      </output>
      <button type="button" className={btn} onClick={() => onChange(addDays(value, 1))} aria-label={t("shortStays.today.nextDay")}>
        <Icon name="chevronRight" />
      </button>
      <input
        type="date"
        className="control tnum !w-auto"
        value={value}
        aria-label={t("shortStays.today.jumpTo")}
        onChange={(e) => {
          if (isIsoDate(e.target.value)) onChange(e.target.value);
        }}
      />
      {value !== today && (
        <button type="button" onClick={() => onChange(today)} className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-brass-bright hover:bg-surface-2">
          {t("common.today")}
        </button>
      )}
    </div>
  );
}

// ── Alerts ─────────────────────────────────────────────────────────────────

const SEVERITY: Record<StayAlert["severity"], [string, string]> = {
  critical: ["▲", "text-critical"],
  warning: ["◆", "text-warn"],
  info: ["●", "text-info"],
};

export function alertMessage(a: StayAlert): string {
  const where = a.spacePath ? `${a.spacePath} (${a.propertyName})` : a.propertyName;
  const date = a.date ? formatDate(a.date) : t("shortStays.alerts.noDate");
  // Our own values last, so a raw ISO `date` param can't override the formatted one.
  return t(`shortStays.alerts.kinds.${a.kind}` as MessageKey, { ...a.params, where, date });
}

export function AlertList({ alerts, limit }: { alerts: StayAlert[]; limit?: number }) {
  const shown = limit ? alerts.slice(0, limit) : alerts;
  return (
    <ul className="divide-y divide-[var(--hairline)]">
      {shown.map((a) => {
        const [glyph, color] = SEVERITY[a.severity];
        return (
          <li key={a.id} className="flex flex-wrap items-start gap-3 py-2.5">
            <span className={`mt-0.5 text-[11px] ${color}`} aria-hidden>
              {glyph}
            </span>
            <span className="sr-only">{t(`shortStays.enums.alertSeverity.${a.severity}` as MessageKey)}:</span>
            <p className="min-w-0 flex-1 text-[13.5px] leading-snug">{alertMessage(a)}</p>
            {a.href && (
              <Link href={a.href} className="shrink-0 rounded-md px-2 py-0.5 text-[13px] font-semibold text-brass-bright hover:bg-surface-2">
                {t(`shortStays.alerts.actions.${a.kind}` as MessageKey)}
                <span className="sr-only"> — {alertMessage(a)}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Rows ───────────────────────────────────────────────────────────────────

export function reservationHref(id: string) {
  return `/stays/reservation/?id=${id}`;
}

export function turnoverHref(id: string) {
  return `/stays/turnover/?id=${id}`;
}

/** One reservation in a compact list. */
export function ReservationRow({ r, detail }: { r: ReservationSummary; detail?: React.ReactNode }) {
  return (
    <li>
      <Link href={reservationHref(r.id)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[14px] font-medium ${r.guestName ? "" : "text-ink-2"}`}>{guestDisplay(r)}</div>
          <div className="truncate text-[12.5px] text-ink-3">
            {r.spacePath} · {r.propertyName} · {channelLabel(r.channel)}
            {r.channelReservationId ? ` ${r.channelReservationId}` : ""} · {nightsLabel(r.nights)}
            {r.guestCount ? ` · ${r.guestCount}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          {detail && <div className="text-[13px] text-ink-2">{detail}</div>}
          <div className="flex gap-1.5">
            {r.missingSince && <MissingPill channel={r.channel} />}
            {r.status !== "confirmed" && <ReservationStatusPill status={r.status} />}
          </div>
        </div>
      </Link>
    </li>
  );
}

/** One turnover in a compact list. */
export function TurnoverRow({ tv }: { tv: TurnoverItem }) {
  return (
    <li>
      <Link href={turnoverHref(tv.id)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">
            {tv.spacePath} <span className="font-normal text-ink-3">· {tv.propertyName}</span>
          </div>
          <div className="truncate text-[12.5px] text-ink-3">
            {t("shortStays.today.checkOutAt", { time: formatClock(tv.checkoutTime) })} · {formatDate(tv.dueDate)}
            {tv.nextCheckIn
              ? ` · ${t("shortStays.turnover.nextCheckIn")}: ${formatDate(tv.nextCheckIn.date)}${tv.nextCheckIn.time ? ` ${formatClock(tv.nextCheckIn.time)}` : ""}${tv.windowHours !== null ? ` (${t("shortStays.turnovers.window", { time: formatHours(tv.windowHours) })})` : ""}`
              : ` · ${t("shortStays.turnover.noNext")}`}
          </div>
          <div className="truncate text-[12.5px]">
            {tv.unassigned ? (
              <span className="font-medium text-warn">{t("shortStays.turnover.unassigned")}</span>
            ) : (
              <span className="text-ink-2">{tv.assigneeName}</span>
            )}
            {tv.photoCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-ink-3">
                <Icon name="camera" size={12} />
                {tv.photoCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <TurnoverStatusPill status={tv.status} />
          {tv.late && <LatePill />}
        </div>
      </Link>
    </li>
  );
}
