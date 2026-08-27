"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Bed, PortfolioStats, Property, Unit, UnitType, WorkOrder } from "@/lib/types";
import { bedRollup } from "@/lib/types";
import { StatTile } from "./stat-tile";
import { OccupancyMeter } from "./occupancy-meter";
import { BedCell, BedLegend } from "@/components/ui/status-glyph";
import { BedSheet } from "@/components/ui/bed-sheet";
import { WorkOrderBoard } from "@/components/work-orders/work-order-board";
import { tap } from "@/lib/native";

const UNIT_TYPE_LABEL: Record<UnitType, string> = {
  studio: "Studio",
  one_bed: "1 Bed",
  two_bed: "2 Bed",
  suite: "Suite",
  shared_room: "Shared",
};

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const rise = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
};

/** Section heading that stacks its caption on mobile instead of colliding. */
function SectionHead({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="hairline-b flex flex-col gap-1 pb-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <h2 className="font-display text-[20px] font-light tracking-wide md:text-[22px]">{title}</h2>
      <span className="microlabel shrink-0">{caption}</span>
    </div>
  );
}

export function PropertyDashboard({
  properties,
  stats,
  workOrders,
}: {
  properties: Property[];
  stats: PortfolioStats;
  workOrders: WorkOrder[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ bed: Bed; unit: Unit } | null>(null);

  return (
    <div className="mx-auto max-w-6xl px-5 pb-tabbar md:px-6 md:pb-24">
      {/* ── Headline stats ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-2.5 pt-6 md:gap-3 md:pt-8 lg:grid-cols-4">
        <StatTile label="Occupancy" value={stats.occupancyPct} format="pct" sub="44 of 52 beds" />
        <StatTile label="Monthly revenue" value={stats.mrrCents / 100} format="money" sub="+RM 8,400 vs July" />
        <StatTile
          label="Open orders"
          value={stats.openWorkOrders}
          format="int"
          sub={`${stats.criticalWorkOrders} critical`}
          alert={stats.criticalWorkOrders > 0}
        />
        <StatTile label="Average stay" value={stats.avgStayMonths} format="months" sub="rolling 12 mo" />
      </section>

      {/* ── Property hub ───────────────────────────────────────────────── */}
      <section className="mt-10 md:mt-12">
        <SectionHead title="Portfolio" caption={`${properties.length} properties · Property → Unit → Bed`} />

        <motion.div
          className="mt-4 grid gap-3 md:mt-5 md:gap-4 lg:grid-cols-3"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {properties.map((property) => {
            const roll = bedRollup(property);
            const expanded = expandedId === property.id;
            const beds = property.units.flatMap((u) => u.beds);
            return (
              <motion.article
                key={property.id}
                variants={rise}
                className={`card p-4 md:p-5 ${expanded ? "lg:col-span-3" : ""}`}
              >
                {/* The whole header is the toggle — a real button, so it is
                    keyboard-reachable and announces its expanded state. */}
                <button
                  type="button"
                  onClick={() => {
                    void tap("light");
                    setExpandedId(expanded ? null : property.id);
                  }}
                  aria-expanded={expanded}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-[18px] font-light md:text-[19px]">
                        {property.name}
                      </h3>
                      <p className="mt-0.5 truncate text-[12px] text-ink-3">
                        {property.addressLine1} · {property.city}
                      </p>
                    </div>
                    <motion.span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center text-[18px] leading-none text-ink-3"
                      animate={{ rotate: expanded ? 45 : 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      +
                    </motion.span>
                  </div>

                  <div className="mt-4">
                    <div className="microlabel mb-2">Occupancy</div>
                    <OccupancyMeter pct={roll.occupancyPct} />
                  </div>

                  <div className="mt-3 text-[12px] text-ink-2">
                    <span className="tnum">{roll.total}</span> beds ·{" "}
                    <span className="tnum">{roll.occupied}</span> occupied ·{" "}
                    <span className="tnum">{roll.available}</span> open
                    {roll.down > 0 && (
                      <>
                        {" "}· <span className="tnum">{roll.down}</span> down
                      </>
                    )}
                  </div>
                </button>

                {/* Unit → Bed drill-down */}
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="hairline-t mt-5 pt-4">
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="microlabel">Units & beds — tap a bed</span>
                          <BedLegend
                            counts={{
                              occupied: roll.occupied,
                              available: roll.available,
                              hold: roll.hold,
                              turnover: beds.filter((b) => b.status === "turnover").length,
                              maintenance: beds.filter((b) => b.status === "maintenance").length,
                            }}
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {property.units.map((unit, i) => (
                            <motion.div
                              key={unit.id}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.08 + i * 0.05 }}
                              className="hairline flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-3"
                            >
                              <div className="min-w-0">
                                <div className="text-[13px] font-medium">Unit {unit.label}</div>
                                <div className="truncate text-[11px] text-ink-3">
                                  {UNIT_TYPE_LABEL[unit.type]} · Fl {unit.floor} ·{" "}
                                  <span className="tnum">{unit.sqm}</span> m²
                                </div>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                {unit.beds.map((bed) => (
                                  <BedCell
                                    key={bed.id}
                                    label={`${unit.label}-${bed.label}`}
                                    status={bed.status}
                                    onSelect={() => {
                                      void tap("light");
                                      setSelected({ bed, unit });
                                    }}
                                  />
                                ))}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.article>
            );
          })}
        </motion.div>
      </section>

      {/* ── Maintenance ────────────────────────────────────────────────── */}
      <section className="mt-12 md:mt-14">
        <SectionHead title="Maintenance" caption="Live work-order board" />
        <div className="mt-4 md:mt-5">
          <WorkOrderBoard initial={workOrders} />
        </div>
      </section>

      <BedSheet
        bed={selected?.bed ?? null}
        unit={selected?.unit ?? null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
