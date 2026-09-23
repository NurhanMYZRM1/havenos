"use client";

import Link from "next/link";
import { inputFromItem } from "@/components/maintenance/maintenance-form";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { OverdueFlag, PriorityPill } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import type { MaintenanceItem } from "@/lib/api/contract";
import { useMutation } from "@/lib/api/hooks";
import type { MaintenanceStatus } from "@/lib/domain/enums";
import { formatDate } from "@/lib/domain/format";
import { t, type MessageKey } from "@/lib/i18n";

const COLUMNS: MaintenanceStatus[] = ["triage", "scheduled", "in_progress", "blocked", "done"];
const NEXT: Partial<Record<MaintenanceStatus, MaintenanceStatus>> = {
  triage: "scheduled",
  scheduled: "in_progress",
  in_progress: "done",
  blocked: "in_progress",
};

/**
 * The board view of the old Work Orders screen, now backed by saved records:
 * advancing a card updates the request and adds a history entry.
 */
export function MaintenanceBoard({ rows }: { rows: MaintenanceItem[] }) {
  const toast = useToast();
  const update = useMutation("maintenance.update");

  const advance = async (m: MaintenanceItem) => {
    const next = NEXT[m.status];
    if (!next) return;
    const saved = await update.run({ id: m.id, ...inputFromItem(m), status: next });
    if (saved) toast({ tone: "success", message: `${m.ref}: ${t(`enums.maintenanceStatus.${next}` as MessageKey)}` });
  };

  return (
    <>
    <FormError message={update.error} />
    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {COLUMNS.map((status) => {
        const items = rows.filter((r) => r.status === status);
        return (
          <section key={status} aria-label={t(`enums.maintenanceStatus.${status}` as MessageKey)} className="rounded-xl border border-[var(--hairline)] bg-surface/50 p-2.5">
            <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
              <h3 className="microlabel">{status === "done" ? t("maintenance.board.done") : t(`enums.maintenanceStatus.${status}` as MessageKey)}</h3>
              <span className="tnum text-[12px] text-ink-3">{items.length}</span>
            </div>
            <ul className="flex min-h-24 flex-col gap-2">
              {items.map((m) => (
                <li
                  key={m.id}
                  className="card p-3"
                  style={m.priority === "critical" && status !== "done" ? { borderColor: "color-mix(in oklab, var(--color-critical) 50%, transparent)" } : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="tnum text-[11.5px] text-ink-3">{m.ref}</span>
                    <PriorityPill priority={m.priority} />
                  </div>
                  <Link href={`/maintenance/view?id=${m.id}`} className="mt-1.5 block text-[13.5px] font-medium leading-snug hover:underline">
                    {m.title}
                  </Link>
                  <div className="mt-1 text-[12px] text-ink-3">
                    {m.propertyName}
                    {m.spacePath ? ` · ${m.spacePath}` : ""}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink-2">
                      {m.dueDate ? m.overdue ? <OverdueFlag>{formatDate(m.dueDate)}</OverdueFlag> : formatDate(m.dueDate) : ""}
                      {m.photoCount > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 text-ink-3">
                          <Icon name="camera" size={12} />
                          {m.photoCount}
                        </span>
                      )}
                    </span>
                    {NEXT[m.status] && (
                      <Button size="sm" onClick={() => void advance(m)} disabled={update.pending}>
                        {t(`maintenance.advance.${m.status}` as MessageKey)}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
              {items.length === 0 && <li className="grid flex-1 place-items-center rounded-lg border border-dashed border-[var(--hairline)] py-6 text-[12px] text-ink-3">—</li>}
            </ul>
          </section>
        );
      })}
    </div>
    </>
  );
}
