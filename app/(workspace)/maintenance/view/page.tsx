"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AttachmentList, PhotoManager } from "@/components/files";
import { formFromItem, inputFromItem, MaintenanceFields, toInput, type MaintenanceFormState } from "@/components/maintenance/maintenance-form";
import { ContactLinks } from "@/components/tenancies/contact-links";
import { Button } from "@/components/ui/button";
import { Field, FormError, TextArea } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Card, DetailList, LoadError, Loading, PageHeader } from "@/components/ui/layout";
import { MaintenanceStatusPill, OverdueFlag, PriorityPill } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import type { MaintenanceEvent, MaintenanceField } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { isIsoDate } from "@/lib/domain/dates";
import type { MaintenanceStatus } from "@/lib/domain/enums";
import { formatDate, formatTimestamp } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";
import { t, type MessageKey } from "@/lib/i18n";

const FIELD_LABEL: Record<MaintenanceField, MessageKey> = {
  title: "maintenance.columns.request",
  description: "maintenance.fields.description",
  category: "maintenance.fields.category",
  priority: "maintenance.fields.priority",
  status: "maintenance.fields.status",
  dueDate: "maintenance.fields.dueDate",
  assigneeName: "maintenance.fields.assigneeName",
  assigneePhone: "maintenance.fields.assigneePhone",
  estimatedCostSen: "maintenance.fields.estimatedCost",
  actualCostSen: "maintenance.fields.actualCost",
  propertyId: "maintenance.fields.property",
  spaceId: "maintenance.fields.space",
  tenantId: "maintenance.fields.tenant",
  reportedOn: "maintenance.fields.reportedOn",
};

function showValue(field: MaintenanceField, v: string | number | null): string {
  if (v === null || v === "") return t("maintenance.event.empty");
  if (field === "status") return t(`enums.maintenanceStatus.${v}` as MessageKey);
  if (field === "priority") return t(`enums.maintenancePriority.${v}` as MessageKey);
  if (field === "category") return t(`enums.maintenanceCategory.${v}` as MessageKey);
  if (field === "estimatedCostSen" || field === "actualCostSen") return formatRM(Number(v));
  if (field === "assigneePhone") return formatPhone(String(v));
  if (typeof v === "string" && isIsoDate(v)) return formatDate(v);
  return String(v);
}

function EventItem({ e }: { e: MaintenanceEvent }) {
  const icon = e.kind === "note" ? "mail" : e.kind === "created" ? "plus" : e.kind.startsWith("attachment") ? "camera" : "history";
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
        <Icon name={icon} size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[13.5px] font-medium">{t(`maintenance.event.${e.kind}` as MessageKey)}</span>
          <time className="text-[12px] text-ink-3" dateTime={e.createdAt}>
            {formatTimestamp(e.createdAt)}
          </time>
        </div>
        {e.changes.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[13px] text-ink-2">
            {e.changes.map((c, i) => (
              <li key={i}>{t("maintenance.event.change", { field: t(FIELD_LABEL[c.field]), from: showValue(c.field, c.from), to: showValue(c.field, c.to) })}</li>
            ))}
          </ul>
        )}
        {e.note && <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{e.note}</p>}
      </div>
    </li>
  );
}

const NEXT: Partial<Record<MaintenanceStatus, MaintenanceStatus>> = { triage: "scheduled", scheduled: "in_progress", in_progress: "done", blocked: "in_progress" };

function MaintenanceView() {
  const id = useSearchParams().get("id") ?? "";
  const toast = useToast();
  const item = useApi("maintenance.get", { id }, { enabled: !!id });
  const update = useMutation("maintenance.update");
  const addNote = useMutation("maintenance.addNote");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<MaintenanceFormState | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [note, setNote] = useState("");

  if (item.error) return <LoadError message={item.error} onRetry={item.reload} />;
  if (!item.data) return <Loading />;
  const m = item.data;
  const images = m.photos.filter((p) => p.isImage);
  const files = m.photos.filter((p) => !p.isImage);

  const setStatus = async (status: MaintenanceStatus) => {
    if (await update.run({ id: m.id, ...inputFromItem(m), status })) toast({ tone: "success", message: t("maintenance.saved") });
  };

  const save = async () => {
    if (!form) return;
    const { input, errors: e } = toInput(form);
    setErrors(e);
    if (!input) return;
    if (await update.run({ id: m.id, ...input })) {
      toast({ tone: "success", message: t("maintenance.saved") });
      setEditing(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ href: "/maintenance", label: t("maintenance.title") }}
        eyebrow={m.ref}
        title={m.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/properties/view?id=${m.propertyId}`} className="hover:underline">
              {m.propertyName}
            </Link>
            · {m.spacePath ?? t("common.wholeProperty")}
            <PriorityPill priority={m.priority} />
            <MaintenanceStatusPill status={m.status} />
            {m.overdue && <OverdueFlag>{t("maintenance.overdue")}</OverdueFlag>}
          </span>
        }
        actions={
          !editing && (
            <>
              {NEXT[m.status] && (
                <Button variant="primary" loading={update.pending} onClick={() => void setStatus(NEXT[m.status]!)}>
                  {t(`maintenance.advance.${m.status}` as MessageKey)}
                </Button>
              )}
              {m.status !== "blocked" && m.status !== "done" && m.status !== "cancelled" && <Button onClick={() => void setStatus("blocked")}>{t("enums.maintenanceStatus.blocked")}</Button>}
              <Button
                onClick={() => {
                  setForm(formFromItem(m));
                  setErrors({});
                  update.reset();
                  setEditing(true);
                }}
              >
                {t("common.edit")}
              </Button>
            </>
          )
        }
      />
      {!editing && <FormError message={update.error} />}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          {editing && form ? (
            <Card title={t("common.edit")}>
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <MaintenanceFields form={form} setForm={setForm} errors={{ ...update.fields, ...errors }} />
                <div className="mt-4">
                  <FormError message={update.error} />
                </div>
                <div className="mt-5 flex justify-end gap-2.5">
                  <Button onClick={() => setEditing(false)}>{t("common.cancel")}</Button>
                  <Button type="submit" variant="primary" loading={update.pending}>
                    {t("common.saveChanges")}
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card title={t("common.details")}>
              <DetailList
                items={[
                  { label: t("maintenance.fields.description"), value: m.description ? <span className="whitespace-pre-wrap">{m.description}</span> : "—" },
                  { label: t("maintenance.fields.category"), value: t(`enums.maintenanceCategory.${m.category}` as MessageKey) },
                  { label: t("maintenance.fields.dueDate"), value: m.dueDate ? m.overdue ? <OverdueFlag>{formatDate(m.dueDate)}</OverdueFlag> : formatDate(m.dueDate) : t("maintenance.noDue") },
                  { label: t("maintenance.fields.assigneeName"), value: m.assigneeName || t("maintenance.unassigned") },
                  ...(m.assigneePhone ? [{ label: t("maintenance.fields.assigneePhone"), value: <ContactLinks phone={m.assigneePhone} label={formatPhone(m.assigneePhone)} /> }] : []),
                  { label: t("maintenance.fields.estimatedCost"), value: m.estimatedCostSen !== null ? formatRM(m.estimatedCostSen) : "—" },
                  { label: t("maintenance.fields.actualCost"), value: m.actualCostSen !== null ? formatRM(m.actualCostSen) : "—" },
                  { label: t("maintenance.fields.tenant"), value: m.tenantName ? <Link className="hover:underline" href={`/tenants/view?id=${m.tenantId}`}>{m.tenantName}</Link> : "—" },
                  { label: t("maintenance.fields.reportedOn"), value: formatDate(m.reportedOn) },
                  ...(m.completedOn ? [{ label: t("enums.maintenanceStatus.done"), value: formatDate(m.completedOn) }] : []),
                ]}
              />
            </Card>
          )}
          <Card title={t("maintenance.photos")}>
            <p className="mb-4 text-[13px] text-ink-3">{t("maintenance.photosHelp")}</p>
            <PhotoManager owner={{ kind: "maintenance", id: m.id }} photos={images} compact />
            <div className="mt-5">
              <AttachmentList owner={{ kind: "maintenance", id: m.id }} files={files} />
            </div>
          </Card>
        </div>

        <Card title={t("maintenance.history")}>
          <form
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (await addNote.run({ id: m.id, note })) setNote("");
            }}
          >
            <Field label={t("maintenance.notes")} error={addNote.fields.note}>
              <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={t("maintenance.notePlaceholder")} />
            </Field>
            <div className="mt-2 flex justify-end">
              <Button type="submit" size="sm" loading={addNote.pending} disabled={!note.trim()}>
                {t("maintenance.addNote")}
              </Button>
            </div>
            <FormError message={addNote.error} />
          </form>
          <ol className="mt-3 divide-y divide-[var(--hairline)]">
            {m.events.map((e) => (
              <EventItem key={e.id} e={e} />
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

export default function MaintenanceViewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MaintenanceView />
    </Suspense>
  );
}
