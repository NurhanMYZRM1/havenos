"use client";

import type { BedStatus, WorkOrderPriority } from "@/lib/types";

// Every status carries THREE channels: color, shape/texture, and a text label
// (or aria-label) — color never works alone.

export const BED_STATUS_META: Record<
  BedStatus,
  { label: string; color: string; variant: "outline" | "fill" | "half" | "stripe" }
> = {
  available:   { label: "Available",   color: "var(--color-good)",     variant: "outline" },
  occupied:    { label: "Occupied",    color: "#3f3f46",               variant: "fill" },
  hold:        { label: "On hold",     color: "var(--color-warn)",     variant: "half" },
  turnover:    { label: "Turnover",    color: "var(--color-serious)",  variant: "stripe" },
  maintenance: { label: "Maintenance", color: "var(--color-critical)", variant: "stripe" },
};

function cellStyle(status: BedStatus): React.CSSProperties {
  const meta = BED_STATUS_META[status];
  switch (meta.variant) {
    case "outline":
      return { border: `1.5px solid ${meta.color}` };
    case "fill":
      return { background: meta.color };
    case "half":
      return {
        background: `linear-gradient(135deg, ${meta.color} 50%, transparent 50%)`,
        border: `1px solid ${meta.color}`,
      };
    default:
      return { color: meta.color, border: `1px solid ${meta.color}` };
  }
}

/**
 * A bed. Tappable when `onSelect` is given — the hit area is padded out to
 * 44px via .touch-target while the mark stays visually small.
 */
export function BedCell({
  label,
  status,
  onSelect,
}: {
  label: string;
  status: BedStatus;
  onSelect?: () => void;
}) {
  const meta = BED_STATUS_META[status];
  const cls = `size-[18px] shrink-0 rounded-[4px] ${meta.variant === "stripe" ? "stripe" : ""}`;
  const description = label ? `Bed ${label} — ${meta.label}` : meta.label;

  if (!onSelect) {
    return <span className={cls} style={cellStyle(status)} aria-label={description} role="img" />;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      aria-label={description}
      className={`${cls} touch-target transition-transform active:scale-90 md:hover:scale-110`}
      style={cellStyle(status)}
    />
  );
}

export function BedLegend({ counts }: { counts: Partial<Record<BedStatus, number>> }) {
  const order: BedStatus[] = ["occupied", "available", "hold", "turnover", "maintenance"];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {order
        .filter((s) => (counts[s] ?? 0) > 0)
        .map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-[11px] text-ink-2">
            <BedCell label="" status={s} />
            <span className="tnum">{counts[s]}</span> {BED_STATUS_META[s].label.toLowerCase()}
          </span>
        ))}
    </div>
  );
}

export const PRIORITY_META: Record<WorkOrderPriority, { label: string; color: string; glyph: string }> = {
  low:      { label: "Low",      color: "#77756e",              glyph: "○" },
  standard: { label: "Standard", color: "var(--color-good)",     glyph: "◇" },
  high:     { label: "High",     color: "var(--color-warn)",     glyph: "▲" },
  critical: { label: "Critical", color: "var(--color-critical)", glyph: "◆" },
};

export function PriorityPill({ priority }: { priority: WorkOrderPriority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span className="hairline inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-2">
      <span aria-hidden style={{ color: meta.color, fontSize: 9 }}>{meta.glyph}</span>
      {meta.label}
    </span>
  );
}
