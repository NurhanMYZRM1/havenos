"use client";

import { useState } from "react";
import { ArrangementIllustration } from "@/components/illustrations";
import { stateOptions, typeOptions } from "@/components/properties/property-forms";
import { Button } from "@/components/ui/button";
import { Field, MoneyInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import type { DraftUnit, OnboardingDraftData } from "@/lib/api/contract";
import { RENTAL_MODES, ROOM_TYPES, type MyState, type PropertyType, type RentalMode, type RoomType } from "@/lib/domain/enums";
import { draftLettables, makeKey, MAX_BEDS_PER_ROOM, MAX_ROOMS_PER_UNIT, MAX_UNITS, newRoom, newUnit } from "@/lib/domain/onboarding";
import { t, type MessageKey } from "@/lib/i18n";

export type Errors = Record<string, MessageKey>;
type Update = (fn: (d: OnboardingDraftData) => OnboardingDraftData) => void;

const LANDED: PropertyType[] = ["terrace", "semi_d", "bungalow", "townhouse"];

export function DetailsStep({ data, update, errors }: { data: OnboardingDraftData; update: Update; errors: Errors }) {
  const set = (k: keyof OnboardingDraftData["details"]) => (e: { target: { value: string } }) =>
    update((d) => ({ ...d, details: { ...d.details, [k]: e.target.value } }));
  const v = data.details;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("onboarding.name")} hint={t("onboarding.nameHint")} error={errors["details.name"]} className="sm:col-span-2">
        <TextInput value={v.name} onChange={set("name")} data-autofocus />
      </Field>
      <Field label={t("onboarding.type")} error={errors["details.propertyType"]} className="sm:col-span-2">
        <Select value={v.propertyType} onChange={set("propertyType")} placeholder={t("common.selectPlaceholder")} options={typeOptions()} />
      </Field>
      <Field label={t("onboarding.addressLine1")} hint={t("onboarding.addressLine1Hint")} error={errors["details.addressLine1"]} className="sm:col-span-2">
        <TextInput value={v.addressLine1} onChange={set("addressLine1")} autoComplete="address-line1" />
      </Field>
      <Field label={t("onboarding.addressLine2")} optional className="sm:col-span-2">
        <TextInput value={v.addressLine2} onChange={set("addressLine2")} autoComplete="address-line2" />
      </Field>
      <Field label={t("onboarding.postcode")} error={errors["details.postcode"]}>
        <TextInput value={v.postcode} onChange={set("postcode")} inputMode="numeric" maxLength={5} autoComplete="postal-code" />
      </Field>
      <Field label={t("onboarding.city")} error={errors["details.city"]}>
        <TextInput value={v.city} onChange={set("city")} autoComplete="address-level2" />
      </Field>
      <Field label={t("onboarding.state")} error={errors["details.state"]} className="sm:col-span-2">
        <Select value={v.state} onChange={(e) => update((d) => ({ ...d, details: { ...d.details, state: e.target.value as MyState } }))} placeholder={t("common.selectPlaceholder")} options={stateOptions()} />
      </Field>
      <Field label={t("onboarding.notes")} optional className="sm:col-span-2">
        <TextArea value={v.notes} onChange={set("notes")} rows={3} />
      </Field>
    </div>
  );
}

/** Give a unit the rooms/beds its arrangement needs (without discarding what's there). */
function shapeUnit(u: DraftUnit, mode: RentalMode): DraftUnit {
  let rooms = u.rooms;
  if (mode !== "whole_unit" && rooms.length === 0) rooms = Array.from({ length: 3 }, (_, i) => newRoom(i, 0));
  if (mode === "by_bed") rooms = rooms.map((r) => (r.beds.length ? r : { ...r, beds: [0, 1].map((i) => ({ key: makeKey(), label: `Bed ${i + 1}` })) }));
  return { ...u, rentalMode: mode, rooms };
}

function UnitEditor({ unit, index, total, update, errors, onCopyLayout }: { unit: DraftUnit; index: number; total: number; update: Update; errors: Errors; onCopyLayout: () => void }) {
  const [details, setDetails] = useState(!!(unit.floor || unit.sizeSqft || unit.bedrooms));
  const p = `arrangement.units.${index}`;
  const edit = (fn: (u: DraftUnit) => DraftUnit) =>
    update((d) => ({ ...d, arrangement: { ...d.arrangement, units: d.arrangement.units.map((u, i) => (i === index ? fn(u) : u)) } }));
  const remove = () => update((d) => ({ ...d, arrangement: { ...d.arrangement, units: d.arrangement.units.filter((_, i) => i !== index) } }));

  return (
    <li className="card p-4 md:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <Field label={t("onboarding.unitLabel")} hint={t("properties.unitLabelHint")} error={errors[`${p}.label`]} className="min-w-[200px] flex-1">
          <TextInput value={unit.label} onChange={(e) => edit((u) => ({ ...u, label: e.target.value }))} />
        </Field>
        <Field label={t("onboarding.unitArrangement")} className="min-w-[180px]">
          <Select value={unit.rentalMode} onChange={(e) => edit((u) => shapeUnit(u, e.target.value as RentalMode))} options={RENTAL_MODES.map((m) => ({ value: m, label: t(`enums.rentalMode.${m}` as MessageKey) }))} />
        </Field>
        {total > 1 && (
          <Button variant="ghost" size="sm" className="mt-7" onClick={remove} icon={<Icon name="trash" size={14} />}>
            {t("onboarding.removeUnit")}
          </Button>
        )}
      </div>

      <button type="button" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink" aria-expanded={details} onClick={() => setDetails((x) => !x)}>
        <Icon name={details ? "chevronDown" : "chevronRight"} size={14} />
        {t("onboarding.unitDetails")}
      </button>
      {details && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={t("properties.floor")} optional>
            <TextInput value={unit.floor} onChange={(e) => edit((u) => ({ ...u, floor: e.target.value }))} />
          </Field>
          <Field label={`${t("properties.size")} (${t("common.sqft")})`} optional error={errors[`${p}.sizeSqft`]}>
            <TextInput value={unit.sizeSqft} inputMode="numeric" onChange={(e) => edit((u) => ({ ...u, sizeSqft: e.target.value }))} />
          </Field>
          <Field label={t("properties.bedrooms")} optional error={errors[`${p}.bedrooms`]}>
            <TextInput value={unit.bedrooms} inputMode="numeric" onChange={(e) => edit((u) => ({ ...u, bedrooms: e.target.value }))} />
          </Field>
        </div>
      )}

      {unit.rentalMode !== "whole_unit" && (
        <fieldset className="mt-4 rounded-xl border border-[var(--hairline)] p-3.5">
          <legend className="px-1.5 text-[13px] font-semibold">{t("onboarding.rooms")}</legend>
          {errors[`${p}.rooms`] && <p className="mb-2 text-[12.5px] text-[#ff9d95]" role="alert">▲ {t(errors[`${p}.rooms`])}</p>}
          <ul className="space-y-3">
            {unit.rooms.map((room, j) => {
              const rp = `${p}.rooms.${j}`;
              const editRoom = (fn: (r: typeof room) => typeof room) => edit((u) => ({ ...u, rooms: u.rooms.map((r, k) => (k === j ? fn(r) : r)) }));
              return (
                <li key={room.key} className="rounded-lg bg-surface-2 p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label={t("onboarding.roomLabel")} error={errors[`${rp}.label`]} className="min-w-[180px] flex-1">
                      <TextInput value={room.label} onChange={(e) => editRoom((r) => ({ ...r, label: e.target.value }))} />
                    </Field>
                    <Field label={t("properties.roomType")} className="min-w-[160px]">
                      <Select value={room.roomType} onChange={(e) => editRoom((r) => ({ ...r, roomType: e.target.value as RoomType }))} options={ROOM_TYPES.map((r) => ({ value: r, label: t(`enums.roomType.${r}` as MessageKey) }))} />
                    </Field>
                    <Button variant="ghost" size="sm" onClick={() => edit((u) => ({ ...u, rooms: u.rooms.filter((_, k) => k !== j) }))} aria-label={`${t("onboarding.removeRoom")}: ${room.label}`} icon={<Icon name="trash" size={14} />}>
                      {t("onboarding.removeRoom")}
                    </Button>
                  </div>
                  {unit.rentalMode === "by_bed" && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">{t("onboarding.beds")}</div>
                      {errors[`${rp}.beds`] && <p className="mb-2 text-[12.5px] text-[#ff9d95]" role="alert">▲ {t(errors[`${rp}.beds`])}</p>}
                      <ul className="flex flex-wrap gap-2">
                        {room.beds.map((bed, k) => (
                          <li key={bed.key} className="flex items-center gap-1">
                            <label className="sr-only" htmlFor={`bed-${bed.key}`}>
                              {t("onboarding.bedLabel")}
                            </label>
                            <input
                              id={`bed-${bed.key}`}
                              className="control !min-h-9 w-28 !py-1.5"
                              value={bed.label}
                              aria-invalid={errors[`${rp}.beds.${k}.label`] ? true : undefined}
                              onChange={(e) => editRoom((r) => ({ ...r, beds: r.beds.map((b, x) => (x === k ? { ...b, label: e.target.value } : b)) }))}
                            />
                            <button type="button" className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label={`${t("onboarding.removeBed")}: ${bed.label}`} onClick={() => editRoom((r) => ({ ...r, beds: r.beds.filter((_, x) => x !== k) }))}>
                              <Icon name="close" size={13} />
                            </button>
                          </li>
                        ))}
                        {room.beds.length < MAX_BEDS_PER_ROOM && (
                          <li>
                            <Button size="sm" variant="ghost" icon={<Icon name="plus" size={13} />} onClick={() => editRoom((r) => ({ ...r, beds: [...r.beds, { key: makeKey(), label: `Bed ${r.beds.length + 1}` }] }))}>
                              {t("onboarding.addBed")}
                            </Button>
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {unit.rooms.length < MAX_ROOMS_PER_UNIT && (
              <Button size="sm" icon={<Icon name="plus" size={13} />} onClick={() => edit((u) => ({ ...u, rooms: [...u.rooms, newRoom(u.rooms.length, u.rentalMode === "by_bed" ? 2 : 0, "medium")] }))}>
                {t("onboarding.addRoom")}
              </Button>
            )}
            {total > 1 && (
              <Button size="sm" variant="ghost" onClick={onCopyLayout}>
                {t("onboarding.applyRoomsToAll")}
              </Button>
            )}
          </div>
        </fieldset>
      )}
    </li>
  );
}

export function ArrangementStep({ data, update, errors }: { data: OnboardingDraftData; update: Update; errors: Errors }) {
  const units = data.arrangement.units;
  const choose = (mode: RentalMode) =>
    update((d) => {
      const type = d.details.propertyType;
      const existing = d.arrangement.units.length
        ? d.arrangement.units.map((u) => shapeUnit(u, mode))
        : [newUnit(type && LANDED.includes(type) ? "House" : "Unit 1", mode)];
      return { ...d, arrangement: { defaultMode: mode, units: existing } };
    });
  const addUnit = () =>
    update((d) => ({
      ...d,
      arrangement: { ...d.arrangement, units: [...d.arrangement.units, newUnit(`Unit ${d.arrangement.units.length + 1}`, (d.arrangement.defaultMode || "whole_unit") as RentalMode)] },
    }));
  const copyLayout = (from: number) =>
    update((d) => {
      const src = d.arrangement.units[from];
      return {
        ...d,
        arrangement: {
          ...d.arrangement,
          units: d.arrangement.units.map((u, i) =>
            i === from
              ? u
              : { ...u, rentalMode: src.rentalMode, rooms: src.rooms.map((r) => ({ ...r, key: makeKey(), beds: r.beds.map((b) => ({ ...b, key: makeKey() })) })) },
          ),
        },
      };
    });

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-1 text-[15px] font-semibold">{t("onboarding.chooseArrangement")}</legend>
        <p className="mb-3 text-[13px] text-ink-3">{t("onboarding.arrangementHint")}</p>
        {errors["arrangement.defaultMode"] && <p className="mb-2 text-[12.5px] text-[#ff9d95]" role="alert">▲ {t(errors["arrangement.defaultMode"])}</p>}
        <div className="grid gap-3 md:grid-cols-3">
          {RENTAL_MODES.map((mode) => {
            const checked = data.arrangement.defaultMode === mode;
            return (
              <label key={mode} className={`card flex cursor-pointer flex-col gap-3 p-4 transition-colors ${checked ? "!border-brass bg-brass/5" : "hover:border-brass/40"}`}>
                <input type="radio" name="arrangement" value={mode} checked={checked} onChange={() => choose(mode)} className="sr-only" />
                <ArrangementIllustration mode={mode} className="h-auto w-full" />
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  <span aria-hidden className={`grid size-4 place-items-center rounded-full border ${checked ? "border-brass" : "border-[var(--hairline-strong)]"}`}>
                    {checked && <span className="size-2 rounded-full bg-brass" />}
                  </span>
                  {t(`enums.rentalMode.${mode}` as MessageKey)}
                </span>
                <span className="text-[13px] leading-snug text-ink-2">{t(`enums.rentalModeHelp.${mode}` as MessageKey)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {data.arrangement.defaultMode && (
        <section aria-labelledby="units-heading">
          <h3 id="units-heading" className="text-[15px] font-semibold">
            {t("onboarding.units")}
          </h3>
          <p className="mb-3 text-[13px] text-ink-3">{t("onboarding.unitsHint")}</p>
          {errors["arrangement.units"] && <p className="mb-2 text-[12.5px] text-[#ff9d95]" role="alert">▲ {t(errors["arrangement.units"])}</p>}
          <ol className="space-y-3">
            {units.map((unit, i) => (
              <UnitEditor key={unit.key} unit={unit} index={i} total={units.length} update={update} errors={errors} onCopyLayout={() => copyLayout(i)} />
            ))}
          </ol>
          {units.length < MAX_UNITS && (
            <Button className="mt-3" onClick={addUnit} icon={<Icon name="plus" size={14} />}>
              {t("onboarding.addUnit")}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

export function RentStep({ data, update, errors }: { data: OnboardingDraftData; update: Update; errors: Errors }) {
  const [same, setSame] = useState("");
  const r = data.rent;
  const set = (k: Exclude<keyof OnboardingDraftData["rent"], "rents">) => (e: { target: { value: string } }) =>
    update((d) => ({ ...d, rent: { ...d.rent, [k]: e.target.value } }));
  const lettables = draftLettables(data);
  const setRent = (key: string, value: string) => update((d) => ({ ...d, rent: { ...d.rent, rents: { ...d.rent.rents, [key]: value } } }));

  return (
    <div className="space-y-6">
      <section aria-labelledby="rents-heading">
        <h3 id="rents-heading" className="text-[15px] font-semibold">
          {t("onboarding.rentsTitle")}
        </h3>
        <p className="mb-3 text-[13px] text-ink-3">{t("onboarding.rentsHint")}</p>
        {lettables.length > 1 && (
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Field label={t("onboarding.sameForAll")} optional className="w-56">
              <MoneyInput value={same} onChange={(e) => setSame(e.target.value)} />
            </Field>
            <Button
              onClick={() =>
                update((d) => ({ ...d, rent: { ...d.rent, rents: { ...d.rent.rents, ...Object.fromEntries(lettables.map((l) => [l.key, same])) } } }))
              }
              disabled={!same.trim()}
            >
              {t("onboarding.sameForAllApply")}
            </Button>
          </div>
        )}
        <div className="card divide-y divide-[var(--hairline)]">
          {lettables.map((l) => (
            <div key={l.key} className="grid items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_220px]">
              <label htmlFor={`rent-${l.key}`} className="text-[14px]">
                {l.path}
                <span className="ml-2 text-[12px] text-ink-3">{t(`enums.spaceKind.${l.kind}` as MessageKey)}</span>
              </label>
              <div>
                <MoneyInput id={`rent-${l.key}`} value={r.rents[l.key] ?? ""} onChange={(e) => setRent(l.key, e.target.value)} aria-invalid={errors[`rent.rents.${l.key}`] ? true : undefined} aria-label={t("onboarding.rentFor", { space: l.path })} />
                {errors[`rent.rents.${l.key}`] && <p className="mt-1 text-[12px] text-[#ff9d95]">▲ {t(errors[`rent.rents.${l.key}`])}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label={t("onboarding.dueDay")} hint={t("onboarding.dueDayHint")} error={errors["rent.rentDueDay"]}>
          <TextInput value={r.rentDueDay} onChange={set("rentDueDay")} inputMode="numeric" />
        </Field>
        <Field label={t("onboarding.tenancyMonths")} hint={t("onboarding.tenancyMonthsHint")} error={errors["rent.defaultTenancyMonths"]}>
          <TextInput value={r.defaultTenancyMonths} onChange={set("defaultTenancyMonths")} inputMode="numeric" />
        </Field>
        <Field label={t("onboarding.securityDepositMonths")} hint={t("onboarding.depositMonthsHint")} error={errors["rent.securityDepositMonths"]}>
          <TextInput value={r.securityDepositMonths} onChange={set("securityDepositMonths")} inputMode="decimal" />
        </Field>
        <Field label={t("onboarding.utilityDepositMonths")} hint={t("onboarding.depositMonthsHint")} error={errors["rent.utilityDepositMonths"]}>
          <TextInput value={r.utilityDepositMonths} onChange={set("utilityDepositMonths")} inputMode="decimal" />
        </Field>
        <Field label={t("onboarding.terms")} hint={t("onboarding.termsHint")} optional className="sm:col-span-2">
          <TextArea value={r.defaultTerms} onChange={set("defaultTerms")} rows={4} />
        </Field>
      </section>
    </div>
  );
}
