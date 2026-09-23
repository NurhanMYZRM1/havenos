"use client";

import { useRouter } from "next/navigation";
import { EmptyIllustration } from "@/components/illustrations";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/layout";
import { MaintenanceStatusPill, OverdueFlag, PriorityPill } from "@/components/ui/status";
import type { MaintenanceItem } from "@/lib/api/contract";
import { formatDate } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { t } from "@/lib/i18n";

export function MaintenanceTable({ rows, emptyAction }: { rows: MaintenanceItem[]; emptyAction?: React.ReactNode }) {
  const router = useRouter();
  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState illustration={<EmptyIllustration kind="tools" />} title={t("maintenance.empty")} body={t("maintenance.emptyBody")} actions={emptyAction} />
      </div>
    );
  }
  const open = (id: string) => router.push(`/maintenance/view?id=${id}`);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t("maintenance.columns.request")}</th>
            <th scope="col">{t("maintenance.columns.where")}</th>
            <th scope="col">{t("maintenance.columns.priority")}</th>
            <th scope="col">{t("maintenance.columns.status")}</th>
            <th scope="col">{t("maintenance.columns.due")}</th>
            <th scope="col">{t("maintenance.columns.assignee")}</th>
            <th scope="col" className="text-right">{t("maintenance.columns.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="row-link" onClick={() => open(m.id)}>
              <td className="max-w-[320px]">
                <a
                  href={`/maintenance/view?id=${m.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    open(m.id);
                  }}
                  className="font-medium hover:underline"
                >
                  {m.title}
                </a>
                <div className="flex items-center gap-2 text-[12px] text-ink-3">
                  <span className="tnum">{m.ref}</span>
                  {m.photoCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="camera" size={12} />
                      {m.photoCount}
                    </span>
                  )}
                </div>
              </td>
              <td>
                {m.propertyName}
                <div className="text-[12px] text-ink-3">{m.spacePath ?? t("common.wholeProperty")}</div>
              </td>
              <td>
                <PriorityPill priority={m.priority} />
              </td>
              <td>
                <MaintenanceStatusPill status={m.status} />
              </td>
              <td className="tnum whitespace-nowrap">
                {m.dueDate ? m.overdue ? <OverdueFlag>{formatDate(m.dueDate)}</OverdueFlag> : formatDate(m.dueDate) : <span className="text-ink-3">—</span>}
                {m.completedOn && <div className="text-[12px] text-ink-3">{t("maintenance.completedOn", { date: formatDate(m.completedOn) })}</div>}
              </td>
              <td>{m.assigneeName || <span className="text-ink-3">{t("maintenance.unassigned")}</span>}</td>
              <td className="tnum text-right">
                {m.actualCostSen !== null ? formatRM(m.actualCostSen) : m.estimatedCostSen !== null ? <span className="text-ink-3">~{formatRM(m.estimatedCostSen)}</span> : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
