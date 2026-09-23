"use client";

import type { OccupancyState } from "@/lib/api/contract";
import type { ChargeState, MaintenancePriority, MaintenanceStatus, TenancyStatus } from "@/lib/domain/enums";
import { formatDate } from "@/lib/domain/format";
import { t, type MessageKey } from "@/lib/i18n";

// Every status has three channels — colour, a glyph, and words — so it never
// relies on colour alone.

type Tone = "good" | "info" | "warn" | "serious" | "critical" | "neutral" | "muted";

const TONE: Record<Tone, string> = {
  good: "var(--color-good)",
  info: "var(--color-info)",
  warn: "var(--color-warn)",
  serious: "var(--color-serious)",
  critical: "var(--color-critical)",
  neutral: "var(--color-ink-2)",
  muted: "var(--color-ink-3)",
};

export function Pill({ tone, glyph, children }: { tone: Tone; glyph: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-sans text-[12px] font-medium tracking-normal"
      style={{ borderColor: `color-mix(in oklab, ${TONE[tone]} 45%, transparent)`, color: tone === "muted" || tone === "neutral" ? TONE[tone] : "var(--color-ink)", background: `color-mix(in oklab, ${TONE[tone]} 12%, transparent)` }}
    >
      <span aria-hidden style={{ color: TONE[tone], fontSize: 9 }}>
        {glyph}
      </span>
      {children}
    </span>
  );
}

const TENANCY: Record<TenancyStatus, [Tone, string]> = {
  upcoming: ["info", "◷"],
  active: ["good", "●"],
  expiring: ["warn", "◐"],
  ended: ["muted", "○"],
  cancelled: ["muted", "✕"],
};

export function TenancyStatusPill({ status }: { status: TenancyStatus }) {
  const [tone, glyph] = TENANCY[status];
  return <Pill tone={tone} glyph={glyph}>{t(`enums.tenancyStatus.${status}` as MessageKey)}</Pill>;
}

const CHARGE: Record<ChargeState, [Tone, string]> = {
  paid: ["good", "✓"],
  part_paid: ["info", "◐"],
  due: ["neutral", "○"],
  overdue: ["critical", "▲"],
  void: ["muted", "✕"],
};

export function ChargeStatePill({ state }: { state: ChargeState }) {
  const [tone, glyph] = CHARGE[state];
  return <Pill tone={tone} glyph={glyph}>{t(`enums.chargeState.${state}` as MessageKey)}</Pill>;
}

const MAINT_STATUS: Record<MaintenanceStatus, [Tone, string]> = {
  triage: ["info", "●"],
  scheduled: ["neutral", "◷"],
  in_progress: ["warn", "◐"],
  blocked: ["serious", "❚❚"],
  done: ["good", "✓"],
  cancelled: ["muted", "✕"],
};

export function MaintenanceStatusPill({ status }: { status: MaintenanceStatus }) {
  const [tone, glyph] = MAINT_STATUS[status];
  return <Pill tone={tone} glyph={glyph}>{t(`enums.maintenanceStatus.${status}` as MessageKey)}</Pill>;
}

export const PRIORITY: Record<MaintenancePriority, [Tone, string]> = {
  low: ["muted", "○"],
  standard: ["neutral", "◇"],
  high: ["warn", "▲"],
  critical: ["critical", "◆"],
};

export function PriorityPill({ priority }: { priority: MaintenancePriority }) {
  const [tone, glyph] = PRIORITY[priority];
  return <Pill tone={tone} glyph={glyph}>{t(`enums.maintenancePriority.${priority}` as MessageKey)}</Pill>;
}

const OCCUPANCY: Record<OccupancyState, [Tone, string]> = {
  vacant: ["good", "○"],
  let: ["neutral", "●"],
  upcoming: ["info", "◷"],
  part_let: ["warn", "◐"],
  covered: ["muted", "▣"],
};

export function OccupancyPill({ state, date }: { state: OccupancyState; date?: string | null }) {
  const [tone, glyph] = OCCUPANCY[state];
  return (
    <Pill tone={tone} glyph={glyph}>
      {t(`enums.occupancy.${state}` as MessageKey, { date: date ? formatDate(date) : "" })}
    </Pill>
  );
}

export function OverdueFlag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-[#ff9d95]">
      <span aria-hidden style={{ fontSize: 9 }}>▲</span>
      {children}
    </span>
  );
}
