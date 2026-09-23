"use client";

import { useEffect, useState } from "react";
import { moneyField, senText } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, FormError, MoneyInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { PropertyDetail, SpaceNode } from "@/lib/api/contract";
import { useMutation } from "@/lib/api/hooks";
import { MY_STATES, PROPERTY_TYPES, RENTAL_MODES, ROOM_TYPES, type MyState, type PropertyType, type RentalMode, type RoomType, type SpaceKind } from "@/lib/domain/enums";
import { formatTenths } from "@/lib/domain/format";
import { parseMonthsToTenths } from "@/lib/domain/validate";
import { t, type MessageKey } from "@/lib/i18n";

export const stateOptions = () => MY_STATES.map((s) => ({ value: s, label: t(`enums.state.${s}` as MessageKey) }));
export const typeOptions = () => PROPERTY_TYPES.map((p) => ({ value: p, label: t(`enums.propertyType.${p}` as MessageKey) }));

/** Edit a property's details and tenancy defaults. */
export function PropertyEditDialog({ open, property, onClose }: { open: boolean; property: PropertyDetail; onClose: () => void }) {
  const toast = useToast();
  const save = useMutation("properties.update");
  const init = () => ({
    name: property.name,
    propertyType: property.propertyType as PropertyType,
    addressLine1: property.addressLine1,
    addressLine2: property.addressLine2,
    postcode: property.postcode,
    city: property.city,
    state: property.state as MyState,
    notes: property.notes,
    rentDueDay: String(property.rentDueDay),
    security: formatTenths(property.securityDepositTenths),
    utility: formatTenths(property.utilityDepositTenths),
    months: String(property.defaultTenancyMonths),
    terms: property.defaultTerms,
  });
  const [f, setF] = useState(init);
  const [local, setLocal] = useState<Record<string, MessageKey>>({});
  useEffect(() => {
    if (open) {
      setF(init());
      setLocal({});
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    const errors: Record<string, MessageKey> = {};
    const sec = parseMonthsToTenths(f.security);
    const util = parseMonthsToTenths(f.utility);
    if (sec === null) errors.securityDepositTenths = "validation.depositMonthsRange";
    if (util === null) errors.utilityDepositTenths = "validation.depositMonthsRange";
    setLocal(errors);
    if (Object.keys(errors).length) return;
    const ok = await save.run({
      id: property.id,
      name: f.name,
      propertyType: f.propertyType,
      addressLine1: f.addressLine1,
      addressLine2: f.addressLine2,
      postcode: f.postcode,
      city: f.city,
      state: f.state,
      notes: f.notes,
      rentDueDay: Number(f.rentDueDay),
      securityDepositTenths: sec!,
      utilityDepositTenths: util!,
      defaultTenancyMonths: Number(f.months),
      defaultTerms: f.terms,
    });
    if (ok) {
      toast({ tone: "success", message: t("properties.saved") });
      onClose();
    }
  };
  const err = (k: string) => local[k] ?? save.fields[k] ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("properties.editDetails")}
      width={720}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={save.pending}>
            {t("common.saveChanges")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onboarding.name")} error={err("name")} className="sm:col-span-2">
          <TextInput value={f.name} onChange={set("name")} />
        </Field>
        <Field label={t("onboarding.type")} error={err("propertyType")}>
          <Select value={f.propertyType} onChange={set("propertyType")} options={typeOptions()} />
        </Field>
        <Field label={t("onboarding.state")} error={err("state")}>
          <Select value={f.state} onChange={set("state")} options={stateOptions()} />
        </Field>
        <Field label={t("onboarding.addressLine1")} error={err("addressLine1")} className="sm:col-span-2">
          <TextInput value={f.addressLine1} onChange={set("addressLine1")} autoComplete="address-line1" />
        </Field>
        <Field label={t("onboarding.addressLine2")} optional className="sm:col-span-2">
          <TextInput value={f.addressLine2} onChange={set("addressLine2")} autoComplete="address-line2" />
        </Field>
        <Field label={t("onboarding.postcode")} error={err("postcode")}>
          <TextInput value={f.postcode} onChange={set("postcode")} inputMode="numeric" maxLength={5} autoComplete="postal-code" />
        </Field>
        <Field label={t("onboarding.city")} error={err("city")}>
          <TextInput value={f.city} onChange={set("city")} autoComplete="address-level2" />
        </Field>
        <Field label={t("onboarding.dueDay")} hint={t("onboarding.dueDayHint")} error={err("rentDueDay")}>
          <TextInput value={f.rentDueDay} onChange={set("rentDueDay")} inputMode="numeric" />
        </Field>
        <Field label={t("onboarding.tenancyMonths")} hint={t("onboarding.tenancyMonthsHint")} error={err("defaultTenancyMonths")}>
          <TextInput value={f.months} onChange={set("months")} inputMode="numeric" />
        </Field>
        <Field label={t("onboarding.securityDepositMonths")} hint={t("onboarding.depositMonthsHint")} error={err("securityDepositTenths")}>
          <TextInput value={f.security} onChange={set("security")} inputMode="decimal" />
        </Field>
        <Field label={t("onboarding.utilityDepositMonths")} hint={t("onboarding.depositMonthsHint")} error={err("utilityDepositTenths")}>
          <TextInput value={f.utility} onChange={set("utility")} inputMode="decimal" />
        </Field>
        <Field label={t("onboarding.terms")} hint={t("onboarding.termsHint")} optional className="sm:col-span-2">
          <TextArea value={f.terms} onChange={set("terms")} rows={4} />
        </Field>
        <Field label={t("onboarding.notes")} optional className="sm:col-span-2">
          <TextArea value={f.notes} onChange={set("notes")} rows={2} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={save.error} />
        </div>
      </div>
    </Modal>
  );
}

export type SpaceDialogTarget =
  | { mode: "create"; kind: SpaceKind; parentId: string | null }
  | { mode: "edit"; node: SpaceNode };

/** Add or edit a unit, room or bed. */
export function SpaceDialog({ propertyId, target, onClose }: { propertyId: string; target: SpaceDialogTarget | null; onClose: () => void }) {
  const toast = useToast();
  const create = useMutation("spaces.create");
  const update = useMutation("spaces.update");
  const kind: SpaceKind = target?.mode === "edit" ? target.node.kind : target?.kind ?? "unit";
  const node = target?.mode === "edit" ? target.node : null;
  const [f, setF] = useState({ label: "", rentalMode: "whole_unit" as RentalMode, floor: "", sizeSqft: "", bedrooms: "", bathrooms: "", roomType: "medium" as RoomType, rent: "", notes: "" });
  const [local, setLocal] = useState<Record<string, MessageKey>>({});

  useEffect(() => {
    if (!target) return;
    setLocal({});
    create.reset();
    update.reset();
    setF({
      label: node?.label ?? "",
      rentalMode: node?.rentalMode ?? "whole_unit",
      floor: node?.floor ?? "",
      sizeSqft: node?.sizeSqft ? String(node.sizeSqft) : "",
      bedrooms: node?.bedrooms != null ? String(node.bedrooms) : "",
      bathrooms: node?.bathrooms != null ? String(node.bathrooms) : "",
      roomType: node?.roomType ?? "medium",
      rent: node ? senText(node.defaultRentSen || null) : "",
      notes: node?.notes ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v.trim() ? Number(v) : null);

  const submit = async () => {
    const rent = moneyField(f.rent);
    setLocal(rent.error ? { defaultRentSen: rent.error } : {});
    if (rent.error || !target) return;
    const common = {
      label: f.label,
      rentalMode: kind === "unit" ? f.rentalMode : null,
      floor: f.floor,
      sizeSqft: num(f.sizeSqft),
      bedrooms: kind === "unit" ? num(f.bedrooms) : null,
      bathrooms: kind === "unit" ? num(f.bathrooms) : null,
      roomType: kind === "room" ? f.roomType : null,
      defaultRentSen: rent.sen ?? 0,
      notes: f.notes,
    };
    const ok =
      target.mode === "edit"
        ? await update.run({ id: target.node.id, ...common })
        : await create.run({ propertyId, parentId: target.parentId, kind, ...common });
    if (ok) {
      toast({ tone: "success", message: t("common.saved") });
      onClose();
    }
  };

  const m = target?.mode === "edit" ? update : create;
  const err = (k: string) => local[k] ?? m.fields[k] ?? null;
  const kindLabel = t(`enums.spaceKind.${kind}` as MessageKey);

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={target?.mode === "edit" ? t("properties.editSpace", { kind: kindLabel.toLowerCase() }) : kind === "unit" ? t("properties.addUnit") : kind === "room" ? t("properties.addRoom") : t("properties.addBed")}
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("properties.label")} hint={kind === "unit" ? t("properties.unitLabelHint") : undefined} error={err("label")} className="sm:col-span-2">
          <TextInput value={f.label} onChange={set("label")} />
        </Field>
        {kind === "unit" && (
          <Field label={t("onboarding.unitArrangement")} className="sm:col-span-2" hint={t(`enums.rentalModeHelp.${f.rentalMode}` as MessageKey)}>
            <Select value={f.rentalMode} onChange={set("rentalMode")} options={RENTAL_MODES.map((r) => ({ value: r, label: t(`enums.rentalMode.${r}` as MessageKey) }))} />
          </Field>
        )}
        {kind === "room" && (
          <Field label={t("properties.roomType")}>
            <Select value={f.roomType} onChange={set("roomType")} options={ROOM_TYPES.map((r) => ({ value: r, label: t(`enums.roomType.${r}` as MessageKey) }))} />
          </Field>
        )}
        <Field label={t("properties.defaultRent")} optional error={err("defaultRentSen")} hint={t("onboarding.rentsHint")}>
          <MoneyInput value={f.rent} onChange={set("rent")} />
        </Field>
        {kind === "unit" && (
          <>
            <Field label={t("properties.floor")} optional>
              <TextInput value={f.floor} onChange={set("floor")} />
            </Field>
            <Field label={`${t("properties.size")} (${t("common.sqft")})`} optional error={err("sizeSqft")}>
              <TextInput value={f.sizeSqft} onChange={set("sizeSqft")} inputMode="numeric" />
            </Field>
            <Field label={t("properties.bedrooms")} optional error={err("bedrooms")}>
              <TextInput value={f.bedrooms} onChange={set("bedrooms")} inputMode="numeric" />
            </Field>
            <Field label={t("properties.bathrooms")} optional error={err("bathrooms")}>
              <TextInput value={f.bathrooms} onChange={set("bathrooms")} inputMode="numeric" />
            </Field>
          </>
        )}
        <Field label={t("common.notes")} optional className="sm:col-span-2">
          <TextArea value={f.notes} onChange={set("notes")} rows={2} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={m.error} />
        </div>
      </div>
    </Modal>
  );
}
