"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PhotoManager } from "@/components/files";
import { moneyField, newStagingKey, senText, useToday } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { DateInput, Field, FormError, MoneyInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { MaintenanceInput, MaintenanceItem, SpaceNode } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "@/lib/domain/enums";
import { t, type MessageKey } from "@/lib/i18n";

export interface MaintenanceFormState {
  propertyId: string;
  spaceId: string;
  tenantId: string;
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  dueDate: string;
  assigneeName: string;
  assigneePhone: string;
  estimatedCost: string;
  actualCost: string;
  reportedOn: string;
}

export function formFromItem(m: MaintenanceItem): MaintenanceFormState {
  return {
    propertyId: m.propertyId,
    spaceId: m.spaceId ?? "",
    tenantId: m.tenantId ?? "",
    title: m.title,
    description: m.description,
    category: m.category,
    priority: m.priority,
    status: m.status,
    dueDate: m.dueDate ?? "",
    assigneeName: m.assigneeName,
    assigneePhone: m.assigneePhone,
    estimatedCost: senText(m.estimatedCostSen),
    actualCost: senText(m.actualCostSen),
    reportedOn: m.reportedOn,
  };
}

/** The editable fields of a saved request, e.g. to change only its status. */
export function inputFromItem(m: MaintenanceItem): MaintenanceInput {
  return {
    propertyId: m.propertyId,
    spaceId: m.spaceId,
    tenantId: m.tenantId,
    title: m.title,
    description: m.description,
    category: m.category,
    priority: m.priority,
    status: m.status,
    dueDate: m.dueDate,
    assigneeName: m.assigneeName,
    assigneePhone: m.assigneePhone,
    estimatedCostSen: m.estimatedCostSen,
    actualCostSen: m.actualCostSen,
    reportedOn: m.reportedOn,
  };
}

export function blankForm(today: string, defaults: { propertyId?: string; spaceId?: string | null; tenantId?: string | null } = {}): MaintenanceFormState {
  return {
    propertyId: defaults.propertyId ?? "",
    spaceId: defaults.spaceId ?? "",
    tenantId: defaults.tenantId ?? "",
    title: "",
    description: "",
    category: "general",
    priority: "standard",
    status: "triage",
    dueDate: "",
    assigneeName: "",
    assigneePhone: "",
    estimatedCost: "",
    actualCost: "",
    reportedOn: today,
  };
}

/** Convert form text to the API shape; money errors are reported per field. */
export function toInput(f: MaintenanceFormState): { input: MaintenanceInput | null; errors: Record<string, MessageKey> } {
  const errors: Record<string, MessageKey> = {};
  if (!f.propertyId) errors.propertyId = "validation.chooseOne";
  if (!f.title.trim()) errors.title = "validation.required";
  const est = moneyField(f.estimatedCost);
  const act = moneyField(f.actualCost);
  if (est.error) errors.estimatedCostSen = est.error;
  if (act.error) errors.actualCostSen = act.error;
  if (Object.keys(errors).length) return { input: null, errors };
  return {
    errors,
    input: {
      propertyId: f.propertyId,
      spaceId: f.spaceId || null,
      tenantId: f.tenantId || null,
      title: f.title,
      description: f.description,
      category: f.category,
      priority: f.priority,
      status: f.status,
      dueDate: f.dueDate || null,
      assigneeName: f.assigneeName,
      assigneePhone: f.assigneePhone,
      estimatedCostSen: est.sen,
      actualCostSen: act.sen,
      reportedOn: f.reportedOn,
    },
  };
}

function flatten(nodes: SpaceNode[], depth = 0): { id: string; label: string }[] {
  return nodes.flatMap((n) => [
    { id: n.id, label: `${" ".repeat(depth)}${n.label}${n.archived ? ` (${t("common.archived")})` : ""}` },
    ...flatten(n.children, depth + 1),
  ]);
}

/** The fields for a maintenance request — used when creating and editing. */
export function MaintenanceFields({ form, setForm, errors }: { form: MaintenanceFormState; setForm: (f: MaintenanceFormState) => void; errors: Record<string, MessageKey | undefined> }) {
  const properties = useApi("properties.list", { includeArchived: false });
  const property = useApi("properties.get", { id: form.propertyId }, { enabled: !!form.propertyId });
  const tenants = useApi("tenants.list", { query: "" });
  const spaces = useMemo(() => flatten(property.data?.units ?? []), [property.data]);
  const set = <K extends keyof MaintenanceFormState>(k: K, v: MaintenanceFormState[K]) => setForm({ ...form, [k]: v });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("maintenance.fields.title")} hint={t("maintenance.fields.titleHint")} error={errors.title} className="sm:col-span-2">
        <TextInput value={form.title} onChange={(e) => set("title", e.target.value)} data-autofocus />
      </Field>
      <Field label={t("maintenance.fields.property")} error={errors.propertyId}>
        <Select
          value={form.propertyId}
          onChange={(e) => setForm({ ...form, propertyId: e.target.value, spaceId: "" })}
          placeholder={t("common.selectPlaceholder")}
          options={(properties.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        />
      </Field>
      <Field label={t("maintenance.fields.space")} error={errors.spaceId}>
        <Select value={form.spaceId} onChange={(e) => set("spaceId", e.target.value)} disabled={!form.propertyId} options={[{ value: "", label: t("common.wholeProperty") }, ...spaces.map((s) => ({ value: s.id, label: s.label }))]} />
      </Field>
      <Field label={t("maintenance.fields.category")}>
        <Select value={form.category} onChange={(e) => set("category", e.target.value as MaintenanceCategory)} options={MAINTENANCE_CATEGORIES.map((c) => ({ value: c, label: t(`enums.maintenanceCategory.${c}` as MessageKey) }))} />
      </Field>
      <Field label={t("maintenance.fields.priority")}>
        <Select value={form.priority} onChange={(e) => set("priority", e.target.value as MaintenancePriority)} options={MAINTENANCE_PRIORITIES.map((p) => ({ value: p, label: t(`enums.maintenancePriority.${p}` as MessageKey) }))} />
      </Field>
      <Field label={t("maintenance.fields.status")}>
        <Select value={form.status} onChange={(e) => set("status", e.target.value as MaintenanceStatus)} options={MAINTENANCE_STATUSES.map((s) => ({ value: s, label: t(`enums.maintenanceStatus.${s}` as MessageKey) }))} />
      </Field>
      <Field label={t("maintenance.fields.dueDate")} optional error={errors.dueDate}>
        <DateInput value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
      </Field>
      <Field label={t("maintenance.fields.description")} optional className="sm:col-span-2">
        <TextArea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} />
      </Field>
      <Field label={t("maintenance.fields.assigneeName")} optional>
        <TextInput value={form.assigneeName} onChange={(e) => set("assigneeName", e.target.value)} />
      </Field>
      <Field label={t("maintenance.fields.assigneePhone")} optional error={errors.assigneePhone} hint={t("tenants.phoneHint")}>
        <TextInput type="tel" value={form.assigneePhone} onChange={(e) => set("assigneePhone", e.target.value)} />
      </Field>
      <Field label={t("maintenance.fields.estimatedCost")} optional error={errors.estimatedCostSen}>
        <MoneyInput value={form.estimatedCost} onChange={(e) => set("estimatedCost", e.target.value)} />
      </Field>
      <Field label={t("maintenance.fields.actualCost")} optional error={errors.actualCostSen}>
        <MoneyInput value={form.actualCost} onChange={(e) => set("actualCost", e.target.value)} />
      </Field>
      <Field label={t("maintenance.fields.tenant")} optional>
        <Select value={form.tenantId} onChange={(e) => set("tenantId", e.target.value)} options={[{ value: "", label: t("maintenance.fields.noTenant") }, ...(tenants.data ?? []).map((x) => ({ value: x.id, label: x.fullName }))]} />
      </Field>
      <Field label={t("maintenance.fields.reportedOn")} error={errors.reportedOn}>
        <DateInput value={form.reportedOn} onChange={(e) => set("reportedOn", e.target.value)} />
      </Field>
    </div>
  );
}

export function NewMaintenanceDialog({ open, defaults, onClose }: { open: boolean; defaults: { propertyId?: string; spaceId?: string | null; tenantId?: string | null }; onClose: () => void }) {
  const today = useToday();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(() => blankForm(today, defaults));
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [stagingKey, setStagingKey] = useState(newStagingKey);
  const create = useMutation("maintenance.create");
  const staged = useApi("attachments.list", { owner: { kind: "staging", id: stagingKey } }, { enabled: open });

  useEffect(() => {
    if (!open) return;
    setForm(blankForm(today, defaults));
    setErrors({});
    setStagingKey(newStagingKey());
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    const { input, errors: e } = toInput(form);
    setErrors(e);
    if (!input) return;
    const created = await create.run({ ...input, stagingKey });
    if (created) {
      toast({ tone: "success", message: t("maintenance.created", { ref: created.ref }), action: { label: t("common.view"), onClick: () => router.push(`/maintenance/view?id=${created.id}`) } });
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("maintenance.newTitle")}
      width={720}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={create.pending}>
            {create.pending ? t("maintenance.creating") : t("maintenance.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <MaintenanceFields form={form} setForm={setForm} errors={{ ...create.fields, ...errors }} />
        <div>
          <div className="mb-2 text-[13px] font-medium">{t("maintenance.photos")}</div>
          <PhotoManager owner={{ kind: "staging", id: stagingKey }} photos={staged.data ?? []} compact />
        </div>
        <FormError message={create.error} />
      </div>
    </Modal>
  );
}
