"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AttachmentList, IconButton, PhotoManager } from "@/components/files";
import { moneyField, senText } from "@/components/forms";
import { formatClock, formatHours, formatWhen } from "@/components/stays/format";
import { LatePill, reservationHref, TurnoverStatusPill, useNow } from "@/components/stays/shared";
import { statusOptions, turnoverUpdate } from "@/components/stays/turnovers-tab";
import { ContactLinks } from "@/components/tenancies/contact-links";
import { Button } from "@/components/ui/button";
import { Field, FormError, MoneyInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { Card, DetailList, LoadError, Loading, Notice, PageHeader } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { ChecklistItem, TurnoverDetail } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import type { TurnoverStatus } from "@/lib/domain/enums";
import { formatDate, formatDateLong, formatTimestamp } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";
import { isClockTime } from "@/lib/domain/short-stay";
import { t, type MessageKey } from "@/lib/i18n";

function Checklist({ tv }: { tv: TurnoverDetail }) {
  const save = useMutation("turnovers.update");
  const [items, setItems] = useState<ChecklistItem[]>(tv.checklist);
  const [draft, setDraft] = useState("");
  useEffect(() => setItems(tv.checklist), [tv.checklist]);

  const commit = async (next: ChecklistItem[]) => {
    const before = items;
    setItems(next);
    if (!(await save.run(turnoverUpdate(tv, { checklist: next })))) setItems(before);
  };
  const done = items.filter((i) => i.done).length;
  const readOnly = tv.status === "skipped";

  return (
    <Card title={t("shortStays.turnover.checklist")} actions={items.length > 0 && <span className="tnum text-[13px] text-ink-3">{t("shortStays.turnover.checklistProgress", { done, total: items.length })}</span>}>
      {items.length > 0 && (
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-[var(--hairline-strong)]" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label={t("shortStays.turnover.checklist")}>
          <div className="h-full rounded-full bg-good" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-[13.5px] text-ink-3">{t("shortStays.turnover.checklistEmpty")}</p>
      ) : (
        <ul className="divide-y divide-[var(--hairline)]">
          {items.map((item, i) => (
            <li key={`${i}-${item.label}`} className="flex items-center gap-3 py-2">
              <input
                id={`check-${i}`}
                type="checkbox"
                className="check"
                checked={item.done}
                disabled={readOnly || save.pending}
                onChange={(e) => void commit(items.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))}
              />
              <label htmlFor={`check-${i}`} className={`min-w-0 flex-1 text-[13.5px] ${item.done ? "text-ink-3 line-through" : ""}`}>
                {item.label}
              </label>
              {!readOnly && <IconButton label={t("shortStays.turnover.removeItem", { item: item.label })} icon="trash" onClick={() => void commit(items.filter((_, j) => j !== i))} />}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form
          noValidate
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const label = draft.trim();
            if (!label) return;
            setDraft("");
            void commit([...items, { label, done: false }]);
          }}
        >
          <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("shortStays.turnover.addPlaceholder")} aria-label={t("shortStays.turnover.addPlaceholder")} />
          <Button type="submit" disabled={!draft.trim()} loading={save.pending}>
            {t("shortStays.turnover.addItem")}
          </Button>
        </form>
      )}
      <div className="mt-3">
        <FormError message={save.error} />
      </div>
    </Card>
  );
}

function DetailsForm({ tv }: { tv: TurnoverDetail }) {
  const toast = useToast();
  const save = useMutation("turnovers.update");
  const [f, setF] = useState(() => ({ status: tv.status, assigneeName: tv.assigneeName, assigneePhone: tv.assigneePhone ? formatPhone(tv.assigneePhone) : "", checkoutTime: tv.checkoutTime, cost: senText(tv.costSen), notes: tv.notes }));
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  useEffect(() => {
    setF({ status: tv.status, assigneeName: tv.assigneeName, assigneePhone: tv.assigneePhone ? formatPhone(tv.assigneePhone) : "", checkoutTime: tv.checkoutTime, cost: senText(tv.costSen), notes: tv.notes });
    // Only when the saved values change, so ticking the checklist keeps unsaved edits here.
  }, [tv.id, tv.status, tv.assigneeName, tv.assigneePhone, tv.checkoutTime, tv.costSen, tv.notes]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    const e: Record<string, MessageKey> = {};
    const cost = moneyField(f.cost);
    if (cost.error) e.costSen = cost.error;
    if (!isClockTime(f.checkoutTime)) e.checkoutTime = "shortStays.form.invalidTime";
    setErrors(e);
    if (Object.keys(e).length) return;
    if (await save.run(turnoverUpdate(tv, { status: f.status, assigneeName: f.assigneeName.trim(), assigneePhone: f.assigneePhone.trim(), checkoutTime: f.checkoutTime, costSen: cost.sen, notes: f.notes }))) {
      toast({ tone: "success", message: t("shortStays.turnover.saved") });
    }
  };
  const fields = { ...save.fields, ...errors };

  return (
    <Card title={t("shortStays.turnover.details")}>
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("shortStays.turnover.status")} error={fields.status}>
          <Select value={f.status} onChange={(e) => set("status", e.target.value as TurnoverStatus)} options={statusOptions().map((o) => ({ ...o, disabled: o.value === "skipped" && tv.status !== "skipped" }))} />
        </Field>
        <Field label={t("shortStays.turnover.checkoutTime")} error={fields.checkoutTime}>
          <TextInput type="time" value={f.checkoutTime} onChange={(e) => set("checkoutTime", e.target.value)} />
        </Field>
        <Field label={t("shortStays.turnover.assignee")} optional error={fields.assigneeName}>
          <TextInput value={f.assigneeName} onChange={(e) => set("assigneeName", e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t("shortStays.turnover.assigneePhone")} optional hint={t("tenants.phoneHint")} error={fields.assigneePhone}>
          <TextInput type="tel" value={f.assigneePhone} onChange={(e) => set("assigneePhone", e.target.value)} />
        </Field>
        <Field label={t("shortStays.turnover.cost")} optional error={fields.costSen}>
          <MoneyInput value={f.cost} onChange={(e) => set("cost", e.target.value)} />
        </Field>
        <Field label={t("shortStays.turnover.notes")} optional error={fields.notes} className="sm:col-span-2">
          <TextArea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={save.error} />
        </div>
        <div>
          <Button type="submit" variant="primary" loading={save.pending}>
            {t("common.saveChanges")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

const NEXT: Partial<Record<TurnoverStatus, [TurnoverStatus, MessageKey]>> = {
  pending: ["in_progress", "shortStays.turnover.start"],
  scheduled: ["in_progress", "shortStays.turnover.start"],
  in_progress: ["done", "shortStays.turnover.markDone"],
  done: ["in_progress", "shortStays.turnover.reopen"],
};

function TurnoverView() {
  const id = useSearchParams().get("id") ?? "";
  const toast = useToast();
  const now = useNow();
  const detail = useApi("turnovers.get", { id }, { enabled: !!id });
  const quick = useMutation("turnovers.update");

  if (!id) return <LoadError message={t("shortStays.turnover.notFound")} />;
  if (detail.error) return <LoadError message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading />;
  const tv = detail.data;
  const images = tv.photos.filter((p) => p.isImage);
  const files = tv.photos.filter((p) => !p.isImage);
  const next = NEXT[tv.status];
  const nextWhen = tv.nextCheckIn ? `${formatDate(tv.nextCheckIn.date)}${tv.nextCheckIn.time ? `, ${formatClock(tv.nextCheckIn.time)}` : ""}` : null;

  return (
    <>
      <PageHeader
        back={{ href: "/stays/?tab=turnovers", label: t("shortStays.turnover.back") }}
        eyebrow={t("shortStays.turnover.eyebrow")}
        title={tv.spacePath}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/properties/view?id=${tv.propertyId}`} className="hover:underline">
              {tv.propertyName}
            </Link>
            · {formatDateLong(tv.dueDate)} · {t("shortStays.today.checkOutAt", { time: formatClock(tv.checkoutTime) })}
            <TurnoverStatusPill status={tv.status} />
            {tv.late && <LatePill />}
          </span>
        }
        actions={
          next && (
            <Button
              variant={next[0] === "done" ? "primary" : "secondary"}
              loading={quick.pending}
              onClick={async () => {
                if (await quick.run(turnoverUpdate(tv, { status: next[0] }))) toast({ tone: "success", message: t("shortStays.turnover.saved") });
              }}
            >
              {t(next[1])}
            </Button>
          )
        }
      />
      <div className="mb-5 space-y-3">
        <FormError message={quick.error} />
        {tv.late && <Notice tone="critical">{nextWhen ? t("shortStays.turnover.lateWarningNext", { when: nextWhen }) : t("shortStays.turnover.lateWarning")}</Notice>}
        {tv.unassigned && tv.status !== "done" && tv.status !== "skipped" && <Notice tone="warn">{t("shortStays.turnover.unassignedWarning")}</Notice>}
        {tv.completedAt && <Notice tone="good">{t("shortStays.turnover.completedAt", { when: formatWhen(tv.completedAt, now) })}</Notice>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          <Card title={t("shortStays.turnover.stay")}>
            <DetailList
              items={[
                { label: t("shortStays.turnover.checkout"), value: `${formatDate(tv.dueDate)}, ${formatClock(tv.checkoutTime)}` },
                {
                  label: t("shortStays.turnover.guest"),
                  value: (
                    <Link href={reservationHref(tv.reservationId)} className="text-brass-bright hover:underline">
                      {tv.guestName || t("shortStays.turnover.openStay")}
                    </Link>
                  ),
                },
                {
                  label: t("shortStays.turnover.nextCheckIn"),
                  value: tv.nextCheckIn ? (
                    <Link href={reservationHref(tv.nextCheckIn.reservationId)} className="hover:underline">
                      {nextWhen}
                      {tv.nextCheckIn.guestName ? ` · ${tv.nextCheckIn.guestName}` : ""}
                    </Link>
                  ) : (
                    <span className="text-ink-3">{t("shortStays.turnover.noNext")}</span>
                  ),
                },
                ...(tv.windowHours !== null ? [{ label: t("shortStays.turnover.window"), value: <span className={tv.windowHours < 4 ? "font-medium text-warn" : ""}>{formatHours(tv.windowHours)}</span> }] : []),
                {
                  label: t("shortStays.turnover.assignee"),
                  value: tv.assigneeName ? (
                    <span>
                      {tv.assigneeName}
                      {tv.assigneePhone && (
                        <span className="mt-1 block">
                          <ContactLinks phone={tv.assigneePhone} label={formatPhone(tv.assigneePhone)} />
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="font-medium text-warn">{t("shortStays.turnover.unassigned")}</span>
                  ),
                },
                ...(tv.costSen !== null ? [{ label: t("shortStays.turnover.cost"), value: formatRM(tv.costSen) }] : []),
                ...(tv.completedAt ? [{ label: t("enums.maintenanceStatus.done"), value: formatTimestamp(tv.completedAt) }] : []),
              ]}
            />
          </Card>
          <Checklist tv={tv} />
          <Card title={t("shortStays.turnover.photos")}>
            <p className="mb-4 text-[13px] text-ink-3">{t("shortStays.turnover.photosHelp")}</p>
            <PhotoManager owner={{ kind: "turnover", id: tv.id }} photos={images} compact />
            <div className="mt-5">
              <AttachmentList owner={{ kind: "turnover", id: tv.id }} files={files} />
            </div>
          </Card>
        </div>
        <DetailsForm tv={tv} />
      </div>
    </>
  );
}

export default function TurnoverPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TurnoverView />
    </Suspense>
  );
}
