"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { Bed, Unit } from "@/lib/types";
import { BED_STATUS_META } from "./status-glyph";

/**
 * Bottom sheet with a bed's detail. Replaces the `title` tooltip, which
 * never fires on touch — the info was effectively invisible on a phone.
 *
 * The slide-in and the drag-to-dismiss live on SEPARATE elements on purpose:
 * `drag` takes ownership of a `y` transform, so putting both on one node
 * leaves the sheet stranded partway through its entrance.
 */
export function BedSheet({
  bed,
  unit,
  onClose,
}: {
  bed: Bed | null;
  unit: Unit | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!bed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bed, onClose]);

  const meta = bed ? BED_STATUS_META[bed.status] : null;

  return (
    <AnimatePresence>
      {bed && unit && meta && (
        <>
          <motion.div
            className="fixed inset-0 z-[65] bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />

          {/* Slide layer — owns enter/exit only */}
          <motion.div
            className="fixed inset-x-0 bottom-0 z-[70] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-80"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
          >
            {/* Drag layer — owns the dismiss gesture only */}
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={`Bed ${unit.label}-${bed.label}`}
              className="rounded-t-2xl bg-surface px-5 pt-2 sm:rounded-2xl"
              style={{
                border: "1px solid var(--hairline-strong)",
                paddingBottom: "calc(20px + var(--safe-bottom))",
              }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.4 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 90) onClose();
              }}
            >
              {/* grab handle */}
              <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-[var(--hairline-strong)] sm:hidden" />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="microlabel">Unit {unit.label}</div>
                  <h3 className="mt-1 font-display text-[24px] font-light leading-none">
                    Bed {bed.label}
                  </h3>
                </div>
                <button
                  onClick={onClose}
                  className="hairline grid size-9 shrink-0 place-items-center rounded-full text-ink-2 active:bg-surface-2"
                  aria-label="Close"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              <dl className="mt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <dt className="text-[13px] text-ink-3">Status</dt>
                  <dd className="flex items-center gap-2 text-[13px] font-medium">
                    <span
                      className="size-2.5 rounded-[3px]"
                      style={
                        meta.variant === "outline"
                          ? { border: `1.5px solid ${meta.color}` }
                          : { background: meta.color }
                      }
                      aria-hidden
                    />
                    {meta.label}
                  </dd>
                </div>
                <div className="hairline-t flex items-center justify-between pt-3">
                  <dt className="text-[13px] text-ink-3">Monthly rent</dt>
                  <dd className="tnum text-[13px] font-medium">
                    RM {(bed.rentCents / 100).toLocaleString("en-MY")}
                  </dd>
                </div>
                <div className="hairline-t flex items-center justify-between pt-3">
                  <dt className="text-[13px] text-ink-3">Unit type</dt>
                  <dd className="text-[13px] font-medium">
                    <span className="capitalize">{unit.type.replace("_", " ")}</span> ·{" "}
                    <span className="tnum">{unit.sqm}</span> m²
                  </dd>
                </div>
              </dl>

              <button className="mt-5 min-h-11 w-full rounded-lg bg-ink text-[13px] font-semibold text-bg active:opacity-80">
                {bed.status === "available" ? "Create lease" : "View lease"}
              </button>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
