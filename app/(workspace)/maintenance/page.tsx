"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { MaintenanceBoard } from "@/components/maintenance/maintenance-board";
import { MaintenanceTable } from "@/components/maintenance/maintenance-table";
import { useActions } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { LoadError, Loading, PageHeader } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api/client";
import type { MaintenanceFilter } from "@/lib/api/contract";
import { useApi } from "@/lib/api/hooks";
import { isOneOf, MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES, type MaintenancePriority } from "@/lib/domain/enums";
import { t, type MessageKey } from "@/lib/i18n";

function MaintenanceInner() {
  const params = useSearchParams();
  const actions = useActions();
  const toast = useToast();
  const [view, setView] = useState<"list" | "board">("list");
  const initialPriority = params.get("priority");
  const [filter, setFilter] = useState<MaintenanceFilter>({
    propertyId: params.get("propertyId"),
    status: "open",
    priority: isOneOf(MAINTENANCE_PRIORITIES, initialPriority) ? initialPriority : null,
    overdueOnly: params.get("overdue") === "1",
    query: "",
  });
  const properties = useApi("properties.list", { includeArchived: true });
  // The board always shows every status so work can move between columns.
  const list = useApi("maintenance.list", view === "board" ? { ...filter, status: "all" } : filter);
  const set = <K extends keyof MaintenanceFilter>(k: K, v: MaintenanceFilter[K]) => setFilter((f) => ({ ...f, [k]: v }));

  const exportCsv = async () => {
    try {
      const r = await api("export.dataset", { dataset: "maintenance" });
      if (r) toast({ tone: "success", message: t("settings.exported", { path: r.path }) });
    } catch (err) {
      toast({ tone: "error", message: errorMessage(err) });
    }
  };

  const open = list.data?.filter((m) => m.status !== "done" && m.status !== "cancelled").length ?? 0;
  const overdue = list.data?.filter((m) => m.overdue).length ?? 0;

  return (
    <>
      <PageHeader
        title={t("maintenance.title")}
        subtitle={list.data ? t("maintenance.summary", { open, overdue }) : t("maintenance.subtitle")}
        actions={
          <>
            <Button variant="primary" onClick={() => actions.newMaintenance({ propertyId: filter.propertyId ?? undefined })} icon={<Icon name="plus" size={15} />}>
              {t("maintenance.new")}
            </Button>
            <Button onClick={() => void exportCsv()} icon={<Icon name="download" size={15} />}>
              {t("common.exportCsv")}
            </Button>
          </>
        }
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="control pl-10" value={filter.query} onChange={(e) => set("query", e.target.value)} placeholder={t("maintenance.searchPlaceholder")} aria-label={t("maintenance.searchPlaceholder")} />
        </div>
        <div className="w-52">
          <Select aria-label={t("maintenance.filterProperty")} value={filter.propertyId ?? ""} onChange={(e) => set("propertyId", e.target.value || null)} options={[{ value: "", label: t("maintenance.allProperties") }, ...(properties.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        </div>
        {view === "list" && (
          <div className="w-44">
            <Select
              aria-label={t("maintenance.filterStatus")}
              value={filter.status}
              onChange={(e) => set("status", e.target.value as MaintenanceFilter["status"])}
              options={[
                { value: "open", label: t("maintenance.statusOpen") },
                { value: "all", label: t("maintenance.statusAll") },
                ...MAINTENANCE_STATUSES.map((s) => ({ value: s, label: t(`enums.maintenanceStatus.${s}` as MessageKey) })),
              ]}
            />
          </div>
        )}
        <div className="w-40">
          <Select aria-label={t("maintenance.filterPriority")} value={filter.priority ?? ""} onChange={(e) => set("priority", (e.target.value || null) as MaintenancePriority | null)} options={[{ value: "", label: t("maintenance.anyPriority") }, ...MAINTENANCE_PRIORITIES.map((p) => ({ value: p, label: t(`enums.maintenancePriority.${p}` as MessageKey) }))]} />
        </div>
        <div className="pb-2.5">
          <Checkbox label={t("maintenance.overdueOnly")} checked={filter.overdueOnly} onChange={(v) => set("overdueOnly", v)} />
        </div>
        <div className="ml-auto flex rounded-lg border border-[var(--hairline-strong)] p-0.5" role="group" aria-label={t("maintenance.title")}>
          {(["list", "board"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${view === v ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink-2"}`}>
              <Icon name={v === "list" ? "list" : "board"} size={14} />
              {v === "list" ? t("maintenance.viewList") : t("maintenance.viewBoard")}
            </button>
          ))}
        </div>
      </div>
      {list.error && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data &&
        (view === "list" ? (
          <MaintenanceTable rows={list.data} emptyAction={<Button variant="primary" onClick={() => actions.newMaintenance()}>{t("maintenance.new")}</Button>} />
        ) : (
          <MaintenanceBoard rows={list.data} />
        ))}
    </>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={<Loading />}>
      <MaintenanceInner />
    </Suspense>
  );
}
