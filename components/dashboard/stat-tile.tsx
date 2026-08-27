"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";

type Format = "pct" | "money" | "int" | "months";

function formatValue(v: number, format: Format) {
  switch (format) {
    case "pct":
      return `${v.toFixed(1)}%`;
    case "money":
      // Compact on narrow screens: "RM 64.8k" instead of an overflowing "RM 64,830".
      return `RM ${Math.round(v).toLocaleString("en-MY")}`;
    case "months":
      return `${v.toFixed(1)} mo`;
    default:
      return `${Math.round(v)}`;
  }
}

export function StatTile({
  label,
  value,
  format = "int",
  sub,
  alert = false,
}: {
  label: string;
  value: number;
  format?: Format;
  sub?: string;
  alert?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setDisplay,
    });
    return () => controls.stop();
  }, [inView, value, reduceMotion]);

  return (
    <motion.div
      ref={ref}
      // flex column so every tile matches height regardless of label wrapping
      className="card flex flex-col px-4 py-3.5 md:px-5 md:py-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="microlabel leading-tight">{label}</div>
      <div className="tnum mt-2 font-display text-[26px] font-light leading-none tracking-tight md:text-[32px]">
        {formatValue(display, format)}
      </div>
      {sub && (
        <div className="mt-auto flex items-center gap-1.5 pt-2 text-[11px] text-ink-2 md:text-[12px]">
          {alert && (
            <motion.span
              aria-hidden
              className="inline-block size-1.5 shrink-0 rounded-full bg-critical"
              animate={{ opacity: [1, 0.35, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <span className="truncate">{sub}</span>
        </div>
      )}
    </motion.div>
  );
}
