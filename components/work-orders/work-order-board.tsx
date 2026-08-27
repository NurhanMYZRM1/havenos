"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { WorkOrder, WorkOrderStatus } from "@/lib/types";
import { PriorityPill } from "@/components/ui/status-glyph";
import { capturePhoto, notifyHaptic, tap } from "@/lib/native";

const COLUMNS: { status: WorkOrderStatus; label: string; short: string }[] = [
  { status: "triage", label: "Triage", short: "Triage" },
  { status: "scheduled", label: "Scheduled", short: "Sched" },
  { status: "in_progress", label: "In progress", short: "Active" },
  { status: "done", label: "Done", short: "Done" },
];

const NEXT: Partial<Record<WorkOrderStatus, WorkOrderStatus>> = {
  triage: "scheduled",
  scheduled: "in_progress",
  in_progress: "done",
};

const NEXT_LABEL: Partial<Record<WorkOrderStatus, string>> = {
  triage: "Schedule",
  scheduled: "Start work",
  in_progress: "Mark done",
};

export function WorkOrderBoard({ initial }: { initial: WorkOrder[] }) {
  const [orders, setOrders] = useState(initial);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [activeTab, setActiveTab] = useState<WorkOrderStatus>("triage");

  const advance = (id: string) => {
    void notifyHaptic("success");
    setOrders((prev) =>
      prev.map((wo) =>
        wo.id === id && NEXT[wo.status] ? { ...wo, status: NEXT[wo.status]! } : wo,
      ),
    );
  };

  const attach = async (id: string) => {
    void tap("medium");
    const photo = await capturePhoto();
    if (!photo) return;
    void notifyHaptic("success");
    setPhotos((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), photo.dataUrl] }));
  };

  // `scope` keeps keys unique: both the mobile and desktop trees are in the DOM
  // (toggled by CSS), so a shared layoutId would collide between them.
  const card = (wo: WorkOrder, scope: "m" | "d") => (
    <motion.div
      key={`${scope}-${wo.id}`}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="card group p-3.5"
      style={
        wo.priority === "critical" && wo.status !== "done"
          ? { borderColor: "color-mix(in oklab, var(--color-critical) 45%, transparent)" }
          : undefined
      }
    >
      <div className="flex items-center justify-between">
        <span className="tnum text-[10px] tracking-wider text-ink-3">{wo.ref}</span>
        <PriorityPill priority={wo.priority} />
      </div>

      <div className="mt-1.5 text-[14px] font-medium leading-snug md:text-[13px]">{wo.title}</div>
      <div className="mt-1 text-[12px] text-ink-3 md:text-[11px]">
        {wo.propertyName} · {wo.location}
      </div>

      {photos[wo.id]?.length ? (
        <div className="mt-2.5 flex gap-1.5">
          {photos[wo.id].map((src, i) => (
            // Data-URL previews of just-captured photos; next/image adds nothing here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt={`Attachment ${i + 1} for ${wo.ref}`}
              className="size-11 rounded-md object-cover"
              style={{ border: "1px solid var(--hairline)" }}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="tnum text-[11px] text-ink-2">due {wo.dueAt.slice(5)}</span>

        {/*
         * Actions are ALWAYS visible on touch. The previous hover-reveal made
         * them unreachable on phones — the primary action of the whole screen.
         */}
        <div className="flex items-center gap-1.5">
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={() => void attach(wo.id)}
            className="hairline grid size-9 shrink-0 place-items-center rounded-md text-ink-2 active:bg-surface-2 md:size-8"
            aria-label={`Attach a photo to ${wo.ref}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 5h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
              <circle cx="12" cy="12.5" r="3" />
            </svg>
          </motion.button>

          {NEXT[wo.status] && (
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => advance(wo.id)}
              className="hairline min-h-9 rounded-md px-3 text-[12px] font-semibold text-ink transition-colors active:bg-surface-2 md:min-h-8 md:text-[11px] md:font-medium md:text-ink-2 md:opacity-0 md:transition-all md:duration-200 md:hover:border-brass/40 md:hover:text-ink md:group-hover:opacity-100"
            >
              {NEXT_LABEL[wo.status]}
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );

  return (
    <>
      {/* ── Mobile: segmented status control + single list ──────────────── */}
      <div className="md:hidden">
        <div
          className="hairline flex gap-0.5 rounded-lg bg-surface/60 p-1"
          role="tablist"
          aria-label="Work order status"
        >
          {COLUMNS.map((col) => {
            const count = orders.filter((w) => w.status === col.status).length;
            const active = activeTab === col.status;
            return (
              <button
                key={col.status}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  void tap("light");
                  setActiveTab(col.status);
                }}
                className="relative min-h-9 flex-1 rounded-md px-1 text-[12px] font-medium"
              >
                {active && (
                  <motion.span
                    layoutId="wo-seg"
                    className="absolute inset-0 rounded-md bg-surface-2"
                    style={{ border: "1px solid var(--hairline-strong)" }}
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <span className={`relative ${active ? "text-ink" : "text-ink-3"}`}>
                  {col.short}
                  <span className="tnum ml-1 text-[10px] opacity-70">{count}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/*
         * Keyed on the tab so the list swaps as ONE unit — animating each card
         * separately made outgoing and incoming sets overlap mid-fade.
         *
         * Deliberately NOT wrapped in AnimatePresence: an exit animation here
         * has to finish before the next list mounts, and with `layout` on the
         * cards that handoff stalls, leaving the incoming list stuck at
         * opacity 0. Changing the key remounts the subtree, so initial→animate
         * replays on every switch with nothing to wait on.
         */}
        <motion.div
          key={activeTab}
          className="mt-3 flex flex-col gap-2.5"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {orders.filter((w) => w.status === activeTab).map((wo) => card(wo, "m"))}
          {orders.filter((w) => w.status === activeTab).length === 0 && (
            <div className="grid place-items-center rounded-lg border border-dashed border-[var(--hairline)] py-12 text-[12px] text-ink-3">
              Nothing in {COLUMNS.find((c) => c.status === activeTab)?.label.toLowerCase()}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Desktop: full four-column board ─────────────────────────────── */}
      <div className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = orders.filter((wo) => wo.status === col.status);
          return (
            <div key={col.status} className="hairline rounded-xl bg-surface/50 p-2.5">
              <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
                <span className="microlabel">{col.label}</span>
                <span className="tnum text-[11px] text-ink-3">{items.length}</span>
              </div>
              <div className="flex min-h-24 flex-col gap-2">
                <AnimatePresence mode="popLayout">
                  {items.map((wo) => card(wo, "d"))}
                </AnimatePresence>
                {items.length === 0 && (
                  <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-[var(--hairline)] py-6 text-[11px] text-ink-3">
                    Clear
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
