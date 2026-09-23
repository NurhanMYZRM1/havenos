"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoManager } from "@/components/files";
import { PropertyIllustration, SkylineIllustration } from "@/components/illustrations";
import { ArrangementStep, DetailsStep, RentStep, type Errors } from "@/components/onboarding/steps";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Card, LoadError, Loading, PageHeader } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage, notifyChanged } from "@/lib/api/client";
import type { OnboardingDraft, OnboardingDraftData } from "@/lib/api/contract";
import { useApi } from "@/lib/api/hooks";
import { formatTimestamp } from "@/lib/domain/format";
import { parseRinggit, formatRM } from "@/lib/domain/money";
import { draftLettables, emptyDraft, firstInvalidStep, ONBOARDING_STEPS, validateDraftStep } from "@/lib/domain/onboarding";
import { t, type MessageKey } from "@/lib/i18n";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string };

function Stepper({ step, maxReached, onGo }: { step: number; maxReached: number; onGo: (s: number) => void }) {
  return (
    <ol className="mb-6 grid grid-cols-5 gap-2" aria-label={t("onboarding.title")}>
      {ONBOARDING_STEPS.map((name, i) => {
        const current = i === step;
        const reachable = i <= maxReached;
        return (
          <li key={name}>
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onGo(i)}
              aria-current={current ? "step" : undefined}
              className={`flex w-full flex-col items-start gap-1.5 rounded-lg border-t-2 px-1 pt-2.5 text-left transition-colors disabled:cursor-default ${current ? "border-brass" : i < step ? "border-good/70" : "border-[var(--hairline-strong)]"}`}
            >
              <span className="microlabel flex items-center gap-1.5">
                {i < step ? <Icon name="check" size={12} className="text-good" /> : null}
                {t("onboarding.stepOf", { n: i + 1, total: ONBOARDING_STEPS.length })}
              </span>
              <span className={`text-[13px] font-medium ${current ? "text-ink" : reachable ? "text-ink-2" : "text-ink-3"}`}>{t(`onboarding.steps.${name}` as MessageKey)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Review({ data, photos, onEdit }: { data: OnboardingDraftData; photos: OnboardingDraft["photos"]; onEdit: (step: number) => void }) {
  const d = data.details;
  const lettables = draftLettables(data);
  const rent = (key: string) => {
    const p = parseRinggit(data.rent.rents[key] ?? "");
    return p.ok ? formatRM(p.sen) : t("onboarding.review.noRent");
  };
  const edit = (step: number) => (
    <Button size="sm" variant="ghost" onClick={() => onEdit(step)}>
      {t("onboarding.review.edit")}
    </Button>
  );
  return (
    <div className="space-y-4">
      <Card title={t("onboarding.review.property")} actions={edit(0)}>
        <p className="text-[15px] font-medium">{d.name}</p>
        <p className="mt-1 text-[13.5px] text-ink-2">
          {d.propertyType && t(`enums.propertyType.${d.propertyType}` as MessageKey)} · {d.addressLine1}
          {d.addressLine2 ? `, ${d.addressLine2}` : ""}, {d.postcode} {d.city}
          {d.state && `, ${t(`enums.state.${d.state}` as MessageKey)}`}
        </p>
      </Card>
      <Card title={t("onboarding.review.arrangement")} actions={edit(1)}>
        <p className="mb-3 text-[13.5px] text-ink-2">
          {t("common.unitMany", { n: data.arrangement.units.length })} · {t("onboarding.review.lettable", { n: lettables.length })}
        </p>
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {lettables.map((l) => (
            <li key={l.key} className="flex justify-between gap-3 text-[13.5px]">
              <span className="truncate">{l.path}</span>
              <span className="tnum shrink-0 text-ink-2">{rent(l.key)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t("onboarding.review.rent")} actions={edit(2)}>
        <p className="text-[13.5px] text-ink-2">
          {t("properties.rentDueDayValue", { n: data.rent.rentDueDay })} · {t("properties.securityDeposit")}: {t("properties.depositMonths", { n: data.rent.securityDepositMonths })} · {t("properties.utilityDeposit")}:{" "}
          {t("properties.depositMonths", { n: data.rent.utilityDepositMonths })} · {t("properties.tenancyLength")}: {t("common.monthMany", { n: data.rent.defaultTenancyMonths })}
        </p>
      </Card>
      <Card title={t("onboarding.review.photos")} actions={edit(3)}>
        {photos.length ? (
          <ul className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <li key={p.id} className="relative h-20 w-28 overflow-hidden rounded-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumbUrl} alt={p.fileName} className="size-full object-cover" />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-bg/85 px-1.5 text-[11px] font-semibold text-brass-bright">{t("photos.cover")}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-4">
            <div className="h-20 w-32 overflow-hidden rounded-md">
              <PropertyIllustration type={data.details.propertyType || "other"} className="size-full" />
            </div>
            <p className="text-[13.5px] text-ink-3">{t("onboarding.photosFallback")}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Landing({ draft, onStart, onResume, onDiscard }: { draft: OnboardingDraft | null; onStart: () => void; onResume: () => void; onDiscard: () => void }) {
  return (
    <div className="card overflow-hidden">
      <div className="relative h-60 md:h-80">
        <SkylineIllustration className="absolute inset-0 size-full" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, var(--color-surface) 2%, transparent 60%)" }} />
      </div>
      <div className="grid gap-8 px-6 pb-8 md:grid-cols-[1.2fr_1fr] md:px-10">
        <div>
          <h2 className="font-display text-[30px] font-light leading-tight">{t("onboarding.heroTitle")}</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{t("onboarding.heroBody")}</p>
          {draft ? (
            <div className="mt-6 rounded-xl border border-brass/40 bg-brass/5 p-4">
              <p className="text-[14px]">{t("onboarding.resumeBody", { name: draft.data.details.name || t("onboarding.untitled"), when: formatTimestamp(draft.updatedAt) })}</p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <Button variant="primary" onClick={onResume}>
                  {t("onboarding.resume")}
                </Button>
                <Button variant="ghost" onClick={onDiscard}>
                  {t("onboarding.discard")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Button variant="primary" onClick={onStart} icon={<Icon name="plus" size={15} />}>
                {t("onboarding.start")}
              </Button>
              <LinkButton href="/properties" variant="ghost">
                {t("onboarding.backToProperties")}
              </LinkButton>
            </div>
          )}
        </div>
        <ol className="self-end">
          {ONBOARDING_STEPS.map((s, i) => (
            <li key={s} className="hairline-b flex items-baseline gap-4 py-3">
              <span className="tnum font-display text-[15px] text-brass">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <div className="text-[14.5px] font-medium">{t(`onboarding.steps.${s}` as MessageKey)}</div>
                <div className="text-[12.5px] text-ink-3">{t(`onboarding.stepHelp.${s}` as MessageKey)}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const toast = useToast();
  const current = useApi("drafts.current", undefined);
  const [mode, setMode] = useState<"landing" | "wizard">("landing");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [data, setData] = useState<OnboardingDraftData>(emptyDraft);
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const photos = useApi("attachments.list", { owner: { kind: "draft", id: draftId ?? "none" } }, { enabled: !!draftId });

  /** Persist the draft now; returns its id. */
  const persist = useCallback(
    async (next: { data: OnboardingDraftData; step: number; id: string | null }) => {
      setSave({ kind: "saving" });
      try {
        const saved = await api("drafts.save", { id: next.id, step: next.step, data: next.data });
        setDraftId(saved.id);
        setSave({ kind: "saved", at: saved.updatedAt });
        dirty.current = false;
        return saved.id;
      } catch (err) {
        setSave({ kind: "error", message: errorMessage(err) });
        return null;
      }
    },
    [],
  );

  // Autosave shortly after typing stops.
  useEffect(() => {
    if (mode !== "wizard" || !dirty.current) return;
    const timer = window.setTimeout(() => void persist({ data, step, id: draftId }), 700);
    return () => window.clearTimeout(timer);
  }, [data, step, draftId, mode, persist]);

  useEffect(() => {
    if (mode === "wizard") heading.current?.focus();
  }, [step, mode]);

  const update = (fn: (d: OnboardingDraftData) => OnboardingDraftData) => {
    dirty.current = true;
    setData(fn);
  };

  const goTo = async (target: number) => {
    const id = await persist({ data, step: target, id: draftId });
    if (!id) return;
    setErrors({});
    setStep(target);
    setMaxReached((m) => Math.max(m, target));
  };

  const next = async () => {
    const found = validateDraftStep(data, step);
    setErrors(found);
    if (Object.keys(found).length) {
      window.setTimeout(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
      return;
    }
    await goTo(step + 1);
  };

  const complete = async () => {
    const bad = firstInvalidStep(data);
    if (bad !== null) {
      setErrors(validateDraftStep(data, bad));
      setStep(bad);
      return;
    }
    setCompleting(true);
    setCompleteError(null);
    const id = await persist({ data, step, id: draftId });
    if (!id) {
      setCompleting(false);
      return;
    }
    try {
      const { propertyId } = await api("drafts.complete", { id });
      notifyChanged();
      toast({ tone: "success", message: t("properties.created", { name: data.details.name }) });
      router.push(`/properties/view?id=${propertyId}`);
    } catch (err) {
      setCompleteError(errorMessage(err));
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setCompleting(false);
    }
  };

  if (current.error) return <LoadError message={current.error} onRetry={current.reload} />;
  if (current.loading && !current.data && mode === "landing") return <Loading />;

  if (mode === "landing") {
    return (
      <>
        <PageHeader title={t("onboarding.title")} back={{ href: "/properties", label: t("properties.title") }} />
        <Landing
          draft={current.data ?? null}
          onStart={() => {
            setData(emptyDraft());
            setDraftId(null);
            setStep(0);
            setMaxReached(0);
            setMode("wizard");
          }}
          onResume={() => {
            const d = current.data!;
            setData(d.data);
            setDraftId(d.id);
            setStep(d.step);
            setMaxReached(d.step);
            setSave({ kind: "saved", at: d.updatedAt });
            setMode("wizard");
          }}
          onDiscard={() => setConfirmDiscard(true)}
        />
        <ConfirmDialog
          open={confirmDiscard}
          title={t("onboarding.discard")}
          body={t("onboarding.discardConfirm")}
          confirmLabel={t("onboarding.discard")}
          danger
          onClose={() => setConfirmDiscard(false)}
          onConfirm={async () => {
            if (current.data) await api("drafts.discard", { id: current.data.id });
            notifyChanged();
            setConfirmDiscard(false);
          }}
        />
      </>
    );
  }

  const name = ONBOARDING_STEPS[step];
  const saveText =
    save.kind === "saving" ? t("onboarding.draftSaving") : save.kind === "saved" ? t("onboarding.draftSaved", { when: formatTimestamp(save.at) }) : save.kind === "error" ? `${t("onboarding.draftError")}: ${save.message}` : "";

  return (
    <>
      <PageHeader title={t("onboarding.title")} back={{ href: "/properties", label: t("properties.title") }} actions={<span className="text-[12.5px] text-ink-3" role="status">{saveText}</span>} />
      <Stepper step={step} maxReached={maxReached} onGo={(s) => void goTo(s)} />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step < ONBOARDING_STEPS.length - 1) void next();
          else void complete();
        }}
        className="card p-5 md:p-7"
      >
        <h2 ref={heading} tabIndex={-1} className="font-display text-[24px] font-light outline-none">
          {t(`onboarding.steps.${name}` as MessageKey)}
        </h2>
        <p className="mb-6 mt-1 text-[14px] text-ink-2">{t(`onboarding.stepHelp.${name}` as MessageKey)}</p>
        {Object.keys(errors).length > 0 && (
          <div className="mb-5">
            <FormError message={t("onboarding.fixErrors")} />
          </div>
        )}
        {step === 0 && <DetailsStep data={data} update={update} errors={errors} />}
        {step === 1 && <ArrangementStep data={data} update={update} errors={errors} />}
        {step === 2 && <RentStep data={data} update={update} errors={errors} />}
        {step === 3 && draftId && <PhotoManager owner={{ kind: "draft", id: draftId }} photos={photos.data ?? []} />}
        {step === 4 && <Review data={data} photos={photos.data ?? []} onEdit={(s) => void goTo(s)} />}
        {completeError && (
          <div className="mt-5">
            <FormError message={completeError} />
          </div>
        )}
        <div className="hairline-t mt-7 flex flex-wrap items-center justify-between gap-3 pt-5">
          <Button onClick={() => (step === 0 ? setMode("landing") : void goTo(step - 1))} icon={<Icon name="arrowLeft" size={15} />}>
            {t("common.back")}
          </Button>
          {step < ONBOARDING_STEPS.length - 1 ? (
            <Button type="submit" variant="primary">
              {t("common.next")}
            </Button>
          ) : (
            <Button type="submit" variant="primary" loading={completing} icon={<Icon name="check" size={15} />}>
              {completing ? t("onboarding.saving") : t("onboarding.save")}
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
