"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, FormError, TextArea, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { Tenant, TenantInput } from "@/lib/api/contract";
import { useMutation } from "@/lib/api/hooks";
import { formatPhone } from "@/lib/domain/phone";
import { t, type MessageKey } from "@/lib/i18n";

export const emptyTenant = (): TenantInput => ({ fullName: "", phone: "", email: "", emergencyName: "", emergencyPhone: "", notes: "" });

/** Contact fields shared by the tenant dialog and the new-tenancy form. */
export function TenantFields({ value, onChange, errors, prefix = "" }: { value: TenantInput; onChange: (v: TenantInput) => void; errors: Record<string, MessageKey | undefined>; prefix?: string }) {
  const set = (k: keyof TenantInput) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const err = (k: string) => errors[`${prefix}${k}`];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("tenants.fullName")} error={err("fullName")} className="sm:col-span-2">
        <TextInput value={value.fullName} onChange={set("fullName")} autoComplete="off" />
      </Field>
      <Field label={t("tenants.phone")} hint={t("tenants.phoneHint")} optional error={err("phone")}>
        <TextInput type="tel" value={value.phone} onChange={set("phone")} autoComplete="off" />
      </Field>
      <Field label={t("tenants.email")} optional error={err("email")}>
        <TextInput type="email" value={value.email} onChange={set("email")} autoComplete="off" />
      </Field>
      <Field label={t("tenants.emergencyName")} optional error={err("emergencyName")}>
        <TextInput value={value.emergencyName} onChange={set("emergencyName")} />
      </Field>
      <Field label={t("tenants.emergencyPhone")} optional error={err("emergencyPhone")}>
        <TextInput type="tel" value={value.emergencyPhone} onChange={set("emergencyPhone")} />
      </Field>
      <Field label={t("tenants.notes")} optional className="sm:col-span-2">
        <TextArea value={value.notes} onChange={set("notes")} rows={2} />
      </Field>
    </div>
  );
}

export function TenantDialog({ open, tenant, onClose, onSaved }: { open: boolean; tenant: Tenant | null; onClose: () => void; onSaved?: (t: Tenant) => void }) {
  const toast = useToast();
  const create = useMutation("tenants.create");
  const update = useMutation("tenants.update");
  const m = tenant ? update : create;
  const [value, setValue] = useState<TenantInput>(emptyTenant);
  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    setValue(
      tenant
        ? { fullName: tenant.fullName, phone: formatPhone(tenant.phone), email: tenant.email, emergencyName: tenant.emergencyName, emergencyPhone: formatPhone(tenant.emergencyPhone), notes: tenant.notes }
        : emptyTenant(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenant]);

  const submit = async () => {
    const saved = tenant ? await update.run({ id: tenant.id, ...value }) : await create.run(value);
    if (saved) {
      toast({ tone: "success", message: t("tenants.saved") });
      onSaved?.(saved);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tenant ? t("tenants.edit") : t("tenants.addTenant")}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={m.pending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <TenantFields value={value} onChange={setValue} errors={m.fields} />
      <div className="mt-4">
        <FormError message={m.error} />
      </div>
    </Modal>
  );
}
