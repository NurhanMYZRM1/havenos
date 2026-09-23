"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AttachmentList } from "@/components/files";
import { moneyField, newStagingKey, senText, useToday } from "@/components/forms";
import { emptyTenant, TenantFields } from "@/components/tenancies/tenant-dialog";
import { Button } from "@/components/ui/button";
import { DateInput, Field, FormError, MoneyInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { Card, Loading, Notice, PageHeader } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { TenantInput } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { isIsoDate, isYearMonth, monthOf } from "@/lib/domain/dates";
import { formatMonth } from "@/lib/domain/format";
import { monthsOfRent } from "@/lib/domain/money";
import { defaultEndDate, defaultRentStartMonth } from "@/lib/domain/tenancy";
import { t, type MessageKey } from "@/lib/i18n";

function NewTenancy() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const today = useToday();
  const tenants = useApi("tenants.list", { query: "" });
  const properties = useApi("properties.list", { includeArchived: false });

  const [tenantMode, setTenantMode] = useState<"existing" | "new">(params.get("tenantId") ? "existing" : "new");
  const [tenantId, setTenantId] = useState(params.get("tenantId") ?? "");
  const [newTenant, setNewTenant] = useState<TenantInput>(emptyTenant);
  const [propertyId, setPropertyId] = useState(params.get("propertyId") ?? "");
  const [spaceId, setSpaceId] = useState(params.get("spaceId") ?? "");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [rent, setRent] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [rentStart, setRentStart] = useState("");
  const [rentStartTouched, setRentStartTouched] = useState(false);
  const [security, setSecurity] = useState("");
  const [utility, setUtility] = useState("");
  const [depositsTouched, setDepositsTouched] = useState(false);
  const [terms, setTerms] = useState("");
  const [stagingKey] = useState(newStagingKey);
  const [local, setLocal] = useState<Record<string, MessageKey>>({});
  const create = useMutation("tenancies.create");
  const staged = useApi("attachments.list", { owner: { kind: "staging", id: stagingKey } });

  // Pick up the property of a pre-selected space.
  const allOptions = useApi("spaces.options", { propertyId: null, startDate: null, endDate: null, excludeTenancyId: null });
  useEffect(() => {
    if (!propertyId && spaceId && allOptions.data) {
      const o = allOptions.data.find((x) => x.id === spaceId);
      if (o) setPropertyId(o.propertyId);
    }
  }, [allOptions.data, spaceId, propertyId]);
  useEffect(() => setStartDate((s) => s || today), [today]);

  const property = useApi("properties.get", { id: propertyId }, { enabled: !!propertyId });
  const validRange = isIsoDate(startDate) && (!endDate || (isIsoDate(endDate) && endDate >= startDate));
  const options = useApi(
    "spaces.options",
    { propertyId: propertyId || null, startDate: validRange ? startDate : null, endDate: validRange && endDate ? endDate : null, excludeTenancyId: null },
    { enabled: !!propertyId },
  );
  const selected = options.data?.find((o) => o.id === spaceId);

  // Defaults from the property once it's chosen.
  useEffect(() => {
    const p = property.data;
    if (!p) return;
    setDueDay(String(p.rentDueDay));
    setTerms(p.defaultTerms);
    if (isIsoDate(startDate)) setEndDate(defaultEndDate(startDate, p.defaultTenancyMonths));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.data?.id]);

  // Rent from the chosen space's default.
  useEffect(() => {
    if (selected && selected.defaultRentSen > 0) setRent(senText(selected.defaultRentSen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Deposits follow the rent (as months of rent) until edited by hand.
  useEffect(() => {
    const p = property.data;
    const r = moneyField(rent);
    if (!p || depositsTouched || r.sen === null) return;
    setSecurity(senText(monthsOfRent(r.sen, p.securityDepositTenths)));
    setUtility(senText(monthsOfRent(r.sen, p.utilityDepositTenths)));
  }, [rent, property.data, depositsTouched]);

  useEffect(() => {
    if (!rentStartTouched && isIsoDate(startDate)) setRentStart(defaultRentStartMonth(startDate, today));
  }, [startDate, today, rentStartTouched]);

  const spaceChoices = useMemo(
    () =>
      (options.data ?? []).map((o) => {
        const depth = o.path.split(" › ").length - 1;
        const note = !o.available ? ` — ${t("tenancies.optionTaken", { who: o.conflict ?? "" })}` : !o.lettable ? ` ${t("tenancies.spaceOutsideArrangement")}` : "";
        return { value: o.id, label: `${" ".repeat(depth)}${o.path.split(" › ").pop()} (${t(`enums.spaceKind.${o.kind}` as MessageKey).toLowerCase()})${note}`, disabled: !o.available };
      }),
    [options.data],
  );

  const setLength = (months: number) => {
    if (isIsoDate(startDate)) setEndDate(defaultEndDate(startDate, months));
  };

  const submit = async () => {
    const errors: Record<string, MessageKey> = {};
    const r = moneyField(rent, { required: true, positive: true });
    const s = moneyField(security);
    const u = moneyField(utility);
    if (r.error) errors.monthlyRentSen = r.error;
    if (s.error) errors.securityDepositSen = s.error;
    if (u.error) errors.utilityDepositSen = u.error;
    if (!spaceId) errors.spaceId = "validation.notLettable";
    if (tenantMode === "existing" && !tenantId) errors.tenantId = "validation.chooseTenant";
    setLocal(errors);
    if (Object.keys(errors).length) return;
    const created = await create.run({
      tenantId: tenantMode === "existing" ? tenantId : null,
      newTenant: tenantMode === "new" ? newTenant : null,
      spaceId,
      startDate,
      endDate: endDate || null,
      monthlyRentSen: r.sen!,
      rentDueDay: Number(dueDay),
      rentStartMonth: rentStart,
      securityDepositSen: s.sen ?? 0,
      utilityDepositSen: u.sen ?? 0,
      terms,
      stagingKey,
    });
    if (created) {
      toast({ tone: "success", message: t("tenancies.created", { ref: created.ref }) });
      router.push(`/tenancies/view?id=${created.id}`);
    }
  };

  const err = (k: string) => local[k] ?? create.fields[k] ?? null;

  if (!tenants.data || !properties.data) return <Loading />;

  return (
    <>
      <PageHeader back={{ href: "/tenants", label: t("tenants.title") }} title={t("tenancies.newTitle")} subtitle={t("tenancies.newSubtitle")} />
      {properties.data.length === 0 && (
        <div className="mb-5">
          <Notice tone="info">{t("properties.emptyBody")}</Notice>
        </div>
      )}
      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Card title={t("tenancies.tenantSection")}>
          <div className="mb-4 flex gap-2" role="radiogroup" aria-label={t("tenancies.tenantSection")}>
            {(["existing", "new"] as const).map((m) => (
              <label key={m} className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[13px] font-medium ${tenantMode === m ? "border-brass bg-brass/10" : "border-[var(--hairline-strong)] text-ink-2"}`}>
                <input type="radio" className="sr-only" name="tenant-mode" checked={tenantMode === m} onChange={() => setTenantMode(m)} disabled={m === "existing" && tenants.data!.length === 0} />
                {m === "existing" ? t("tenancies.existingTenant") : t("tenancies.newTenant")}
              </label>
            ))}
          </div>
          {tenantMode === "existing" ? (
            <Field label={t("tenancies.chooseTenant")} error={err("tenantId")}>
              <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder={t("common.selectPlaceholder")} options={tenants.data.map((x) => ({ value: x.id, label: x.fullName }))} />
            </Field>
          ) : (
            <TenantFields value={newTenant} onChange={setNewTenant} errors={create.fields} prefix="newTenant." />
          )}
        </Card>

        <Card title={t("tenancies.spaceSection")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("common.property")}>
              <Select
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setSpaceId("");
                }}
                placeholder={t("common.selectPlaceholder")}
                options={properties.data.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label={t("tenancies.chooseSpace")} error={err("spaceId")}>
              <Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} disabled={!propertyId} placeholder={options.loading ? t("common.loading") : t("common.selectPlaceholder")} options={spaceChoices} />
            </Field>
          </div>
          {selected && !selected.available && (
            <div className="mt-3">
              <Notice tone="critical">{t("tenancies.spaceTaken", { space: selected.path, who: selected.conflict ?? "" })}</Notice>
            </div>
          )}
        </Card>

        <Card title={t("tenancies.datesSection")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("tenancies.startDate")} error={err("startDate")}>
              <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label={t("tenancies.endDate")} hint={t("tenancies.endDateHint")} optional error={err("endDate")}>
              <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-3">{t("tenancies.lengthMonths")}:</span>
            {[6, 12, 24].map((m) => (
              <Button key={m} size="sm" variant="ghost" onClick={() => setLength(m)}>
                {t("common.monthMany", { n: m })}
              </Button>
            ))}
          </div>
        </Card>

        <Card title={t("tenancies.rentSection")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("tenancies.monthlyRent")} error={err("monthlyRentSen")}>
              <MoneyInput value={rent} onChange={(e) => setRent(e.target.value)} />
            </Field>
            <Field label={t("tenancies.dueDay")} hint={t("onboarding.dueDayHint")} error={err("rentDueDay")}>
              <TextInput value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label={t("tenancies.rentStartMonth")} error={err("rentStartMonth")} hint={isYearMonth(rentStart) ? formatMonth(rentStart) : undefined}>
              <input
                type="month"
                className="control tnum"
                value={rentStart}
                min={isIsoDate(startDate) ? monthOf(startDate) : undefined}
                onChange={(e) => {
                  setRentStart(e.target.value);
                  setRentStartTouched(true);
                }}
              />
            </Field>
          </div>
          <p className="mt-3 text-[13px] text-ink-3">{t("tenancies.rentStartHint")}</p>
        </Card>

        <Card title={t("tenancies.depositsSection")}>
          <p className="mb-4 text-[13px] text-ink-3">{t("tenancies.depositsHint")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("tenancies.securityDeposit")} error={err("securityDepositSen")}>
              <MoneyInput
                value={security}
                onChange={(e) => {
                  setSecurity(e.target.value);
                  setDepositsTouched(true);
                }}
              />
            </Field>
            <Field label={t("tenancies.utilityDeposit")} error={err("utilityDepositSen")}>
              <MoneyInput
                value={utility}
                onChange={(e) => {
                  setUtility(e.target.value);
                  setDepositsTouched(true);
                }}
              />
            </Field>
          </div>
        </Card>

        <Card title={t("tenancies.terms")}>
          <Field label={t("tenancies.terms")} hint={t("tenancies.termsHint")} optional>
            <TextArea value={terms} onChange={(e) => setTerms(e.target.value)} rows={5} />
          </Field>
        </Card>

        <Card title={t("tenancies.documents")}>
          <AttachmentList owner={{ kind: "staging", id: stagingKey }} files={staged.data ?? []} help={t("tenancies.documentsHelp")} />
        </Card>

        <FormError message={create.error} />
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => router.back()}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={create.pending}>
            {create.pending ? t("tenancies.creating") : t("tenancies.create")}
          </Button>
        </div>
      </form>
    </>
  );
}

export default function NewTenancyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewTenancy />
    </Suspense>
  );
}
