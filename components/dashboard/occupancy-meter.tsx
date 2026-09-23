"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Single-measure meter. The fill is --gold (the data colour); the value is
 * always printed beside it, so the number never depends on the mark.
 */
export function OccupancyMeter({ value, total, label }: { value: number; total: number; label: string }) {
  const reduce = useReducedMotion();
  const pct = total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full"
        style={{ background: "var(--hairline-strong)" }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
        aria-label={label}
        aria-valuetext={`${value} / ${total}`}
      >
        <motion.div
          className="h-full rounded-full bg-gold"
          initial={{ width: reduce ? `${pct}%` : 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
        />
      </div>
      <span className="tnum w-14 text-right text-[13px] font-medium text-ink">{total ? `${pct.toFixed(0)}%` : "—"}</span>
    </div>
  );
}
