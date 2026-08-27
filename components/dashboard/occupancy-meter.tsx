"use client";

import { motion } from "framer-motion";

/**
 * Single-measure occupancy meter. The fill is --gold (the validated data
 * color); the value itself is printed in ink beside it, so the number never
 * depends on the mark.
 */
export function OccupancyMeter({ pct, delay = 0 }: { pct: number; delay?: number }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1 flex-1 overflow-hidden rounded-full"
        style={{ background: "var(--hairline-strong)" }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`Occupancy ${pct}%`}
      >
        <motion.div
          className="h-full rounded-full bg-gold"
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true }}
          transition={{ delay, type: "spring", stiffness: 60, damping: 18 }}
        />
      </div>
      <span className="tnum w-12 text-right text-[13px] font-medium text-ink">
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}
