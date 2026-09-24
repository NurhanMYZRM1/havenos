"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyIllustration } from "@/components/illustrations";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, FormError, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { EmptyState, LoadError, Loading } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { TurnoverFilter, TurnoverItem, TurnoverUpdate } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { isIsoDate } from "@/lib/domain/dates";
import { TURNOVER_STATUSES, type TurnoverStatus } from "@/lib/domain/enums";
import { formatDate } from "@/lib/domain/format";
import { formatPhone } from "@/lib/domain/phone";
import { t, type MessageKey } from "@/lib/i18n";
import { formatClock, formatHours } from "./format";
import { LatePill, turnoverHref } from "./shared";

/** The editable fields of a turnover, e.g. to change only its status. */
export function turnoverUpdate(tv: TurnoverItem, changes: Partial<Omit<TurnoverUpdate, "id">> = {}): TurnoverUpdate {
  return {
    id: tv.id,
    status: tv.status,
    assigneeName: tv.assigneeName,
    assigneePhone: tv.assigneePhone,
    checkoutTime: tv.checkoutTime,
    checklist: tv.checklist,
    costSen: tv.costSen,
    notes: tv.notes,
    ...changes,
  };
}

export const statusOptions = () => TURNOVER_STATUSES.map((s) => ({ value: s, label: t(`shortStays.enums.turnoverStatus.${s}` as MessageKey) }));

export function AssignDialog({ turnover, onClose }: { turnover: TurnoverItem | null; onClose: () => void }) {
  const toast = useToast();
  const save = useMutation("turnovers.update");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    if (!turnover) return;
    setName(turnover.assigneeName);
    setPhone(turnover.assigneePhone ? formatPhone(turnover.assigneePhone) : "");
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnover?.id]);
  return (
    <Modal
      open={!!turnover}
      onClose={onClose}
      title={t("shortStays.turnover.assignTitle")}
      description={turnover ? `${turnover.spacePath} · ${turnover.propertyName} · ${formatDate(turnover.dueDate)}` : undefined}
      width={480}
      onSubmit={async () => {
        if (!turnover) return;
        const status: TurnoverStatus = turnover.status === "pending" && name.trim() ? "scheduled" : turnover.status;
        if (await save.run(turnoverUpdate(turnover, { assigneeName: name.trim(), assigneePhone: phone.trim(), status }))) {
          toast({ tone: "success", message: t("shortStays.turnover.saved") });
          onClose();
        }
      }}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={save.pending}>
            {t("shortStays.turnover.assign")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("shortStays.turnover.assignee")} error={save.fields.assigneeName}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t("shortStays.turnover.assigneePhone")} optional hint={t("tenants.phoneHint")} error={save.fields.assigneePhone}>
          <TextInput type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <FormError message={save.error} />
      </div>
    </Modal>
  );
}

export function TurnoversTab() {
  const router = useRouter();
  const toast = useToast();
  const properties = useApi("properties.list", { includeArchived: false });
  const [filter, setFilter] = useState<TurnoverFilter>({ from: null, to: null, status: "open", propertyId: null });
  const list = useApi("turnovers.list", filter);
  const update = useMutation("turnovers.update");
  const [assigning, setAssigning] = useState<TurnoverItem | null>(null);
  const set = <K extends keyof TurnoverFilter>(k: K, v: TurnoverFilter[K]) => setFilter((f) => ({ ...f, [k]: v }));

  const setStatus = async (tv: TurnoverItem, status: TurnoverStatus) => {
    if (await update.run(turnoverUpdate(tv, { status }))) toast({ tone: "success", message: t("shortStays.turnover.saved") });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("shortStays.turnovers.filterStatus")} className="w-44">
          <Select
            value={filter.status}
            onChange={(e) => set("status", e.target.value as TurnoverFilter["status"])}
            options={[{ value: "open", label: t("shortStays.turnovers.open") }, { value: "all", label: t("shortStays.turnovers.all") }, ...statusOptions()]}
          />
        </Field>
        <Field label={t("shortStays.turnovers.from")} className="w-44">
          <input type="date" className="control tnum" value={filter.from ?? ""} onChange={(e) => set("from", isIsoDate(e.target.value) ? e.target.value : null)} />
        </Field>
        <Field label={t("shortStays.turnovers.to")} className="w-44">
          <input type="date" className="control tnum" value={filter.to ?? ""} onChange={(e) => set("to", isIsoDate(e.target.value) ? e.target.value : null)} />
        </Field>
        <Field label={t("shortStays.performance.property")} className="w-52">
          <Select value={filter.propertyId ?? ""} onChange={(e) => set("propertyId", e.target.value || null)} options={[{ value: "", label: t("shortStays.calendar.allProperties") }, ...(properties.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        </Field>
      </div>

      <FormError message={update.error} />
      {list.error && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && list.data.length === 0 && (
        <div className="card">
          <EmptyState illustration={<EmptyIllustration kind="tools" />} title={t("shortStays.turnovers.empty")} body={t("shortStays.turnovers.emptyBody")} />
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("shortStays.turnovers.cols.space")}</th>
                <th scope="col">{t("shortStays.turnovers.cols.checkout")}</th>
                <th scope="col">{t("shortStays.turnovers.cols.next")}</th>
                <th scope="col">{t("shortStays.turnovers.cols.assignee")}</th>
                <th scope="col">{t("shortStays.turnovers.cols.status")}</th>
                <th scope="col" className="text-right">{t("shortStays.turnovers.cols.photos")}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((tv) => (
                <tr key={tv.id} className="row-link" onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, select, a")) return;
                  router.push(turnoverHref(tv.id));
                }}>
                  <td className="max-w-[260px]">
                    <Link href={turnoverHref(tv.id)} className="font-medium hover:underline">
                      {tv.spacePath}
                    </Link>
                    <div className="text-[12px] text-ink-3">{tv.propertyName}</div>
                  </td>
                  <td className="tnum whitespace-nowrap">
                    {formatDate(tv.dueDate)}
                    <div className="text-[12px] text-ink-3">{formatClock(tv.checkoutTime)}</div>
                    {tv.late && (
                      <div className="mt-1">
                        <LatePill />
                      </div>
                    )}
                  </td>
                  <td className="tnum whitespace-nowrap">
                    {tv.nextCheckIn ? (
                      <>
                        {formatDate(tv.nextCheckIn.date)} {tv.nextCheckIn.time ? formatClock(tv.nextCheckIn.time) : ""}
                        {tv.windowHours !== null && (
                          <div className={`text-[12px] ${tv.windowHours < 4 ? "font-medium text-warn" : "text-ink-3"}`}>{t("shortStays.turnovers.window", { time: formatHours(tv.windowHours) })}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-ink-3">{t("shortStays.turnover.noNext")}</span>
                    )}
                  </td>
                  <td>
                    {tv.unassigned ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-warn">
                        <span aria-hidden className="text-[9px]">▲</span>
                        {t("shortStays.turnover.unassigned")}
                      </span>
                    ) : (
                      <span>{tv.assigneeName}</span>
                    )}
                    {tv.status !== "done" && tv.status !== "skipped" && (
                      <button type="button" className="ml-2 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-brass-bright hover:bg-surface-2" onClick={() => setAssigning(tv)}>
                        {tv.unassigned ? t("shortStays.turnover.assign") : t("common.edit")}
                      </button>
                    )}
                  </td>
                  <td>
                    <select
                      className="control !min-h-8 !w-auto !py-1 text-[13px]"
                      value={tv.status}
                      aria-label={t("shortStays.turnovers.statusFor", { space: tv.spacePath })}
                      disabled={update.pending || tv.status === "skipped"}
                      onChange={(e) => void setStatus(tv, e.target.value as TurnoverStatus)}
                    >
                      {statusOptions().map((o) => (
                        <option key={o.value} value={o.value} disabled={o.value === "skipped"}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="tnum text-right text-ink-2">
                    {tv.photoCount > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Icon name="camera" size={13} />
                        {tv.photoCount}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AssignDialog turnover={assigning} onClose={() => setAssigning(null)} />
    </div>
  );
}
