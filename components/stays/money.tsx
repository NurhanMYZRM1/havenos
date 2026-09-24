"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { moneyField, useToday } from "@/components/forms";
import { EmptyIllustration } from "@/components/illustrations";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/dialog";
import { Checkbox, DateInput, Field, FormError, MoneyInput, Select, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { EmptyState, Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage, notifyChanged } from "@/lib/api/client";
import type { CsvImportPreview, CsvImportResult, LedgerEntry } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { addDays, isIsoDate } from "@/lib/domain/dates";
import { LEDGER_KINDS, RESERVATION_CHANNELS, STAY_EXPENSE_CATEGORIES, type LedgerKind, type ReservationChannel, type StayExpenseCategory } from "@/lib/domain/enums";
import { formatDate } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { plural, t, type MessageKey } from "@/lib/i18n";
import { channelLabel, formatRange } from "./format";
import { AmountSourceTag, reservationHref, SpaceSelect, useSpaceOptions } from "./shared";

// ── Add a money entry ──────────────────────────────────────────────────────

export interface LedgerDefaults {
  reservationId?: string | null;
  propertyId?: string;
  spaceId?: string | null;
  channel?: ReservationChannel;
}

export function LedgerDialog({ open, defaults, onClose }: { open: boolean; defaults?: LedgerDefaults; onClose: () => void }) {
  const today = useToday();
  const toast = useToast();
  const properties = useApi("properties.list", { includeArchived: false });
  const spaces = useSpaceOptions(open);
  const create = useMutation("ledger.create");
  const [kind, setKind] = useState<LedgerKind>("expense");
  const [amount, setAmount] = useState("");
  const [negative, setNegative] = useState(false);
  const [date, setDate] = useState(today);
  const [propertyId, setPropertyId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [channel, setChannel] = useState<ReservationChannel>("direct");
  const [category, setCategory] = useState<StayExpenseCategory>("cleaning");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});

  useEffect(() => {
    if (!open) return;
    setKind(defaults?.reservationId ? "booking_value" : "expense");
    setAmount("");
    setNegative(false);
    setDate(today);
    setPropertyId(defaults?.propertyId ?? "");
    setSpaceId(defaults?.spaceId ?? "");
    setReservationId(defaults?.reservationId ?? "");
    setChannel(defaults?.channel ?? "direct");
    setCategory("cleaning");
    setDescription("");
    setErrors({});
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const around = isIsoDate(date) ? date : today;
  const reservations = useApi(
    "reservations.list",
    { from: addDays(around, -120), to: addDays(around, 120), propertyId: propertyId || null, spaceId: null, includeCancelled: false },
    { enabled: open && !!propertyId },
  );
  const spaceChoices = useMemo(() => (spaces.data ?? []).filter((s) => s.propertyId === propertyId), [spaces.data, propertyId]);

  const submit = async () => {
    const e: Record<string, MessageKey> = {};
    const m = moneyField(amount, { required: true, positive: true });
    if (m.error) e.amountSen = m.error;
    if (!propertyId) e.propertyId = "validation.chooseOne";
    if (!isIsoDate(date)) e.occurredOn = "validation.invalidDate";
    setErrors(e);
    if (Object.keys(e).length) return;
    const sen = kind === "adjustment" && negative ? -(m.sen ?? 0) : (m.sen ?? 0);
    const ok = await create.run({
      reservationId: reservationId || null,
      propertyId,
      spaceId: spaceId || null,
      channel,
      kind,
      amountSen: sen,
      occurredOn: date,
      category: kind === "expense" ? category : "",
      description,
    });
    if (ok) {
      toast({ tone: "success", message: t("shortStays.ledger.saved") });
      onClose();
    }
  };

  const fields = { ...create.fields, ...errors };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("shortStays.ledger.addTitle")}
      description={t("shortStays.ledger.addDescription")}
      width={640}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={create.pending}>
            {t("shortStays.ledger.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("shortStays.ledger.kind")} error={fields.kind}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as LedgerKind)} options={LEDGER_KINDS.map((k) => ({ value: k, label: t(`shortStays.enums.ledgerKind.${k}` as MessageKey) }))} data-autofocus />
        </Field>
        <Field label={t("shortStays.ledger.amount")} error={fields.amountSen}>
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {kind === "adjustment" && (
          <div className="sm:col-span-2">
            <Checkbox label={t("shortStays.ledger.deduction")} checked={negative} onChange={setNegative} />
          </div>
        )}
        {kind === "expense" && (
          <Field label={t("shortStays.ledger.category")} error={fields.category}>
            <Select value={category} onChange={(e) => setCategory(e.target.value as StayExpenseCategory)} options={STAY_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(`shortStays.enums.expenseCategory.${c}` as MessageKey) }))} />
          </Field>
        )}
        <Field label={t("shortStays.ledger.date")} error={fields.occurredOn}>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("shortStays.ledger.property")} error={fields.propertyId}>
          <Select
            value={propertyId}
            placeholder={t("common.selectPlaceholder")}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setSpaceId("");
              setReservationId("");
            }}
            options={(properties.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field label={t("shortStays.ledger.space")} optional error={fields.spaceId}>
          <SpaceSelect options={spaceChoices} value={spaceId} onChange={setSpaceId} disabled={!propertyId} allowEmptyLabel={t("shortStays.ledger.spaceNone")} />
        </Field>
        <Field label={t("shortStays.ledger.reservation")} optional error={fields.reservationId}>
          <Select
            value={reservationId}
            disabled={!propertyId}
            onChange={(e) => {
              const id = e.target.value;
              setReservationId(id);
              const r = reservations.data?.find((x) => x.id === id);
              if (r) {
                setChannel(r.channel);
                setSpaceId(r.spaceId);
              }
            }}
            options={[
              { value: "", label: t("shortStays.ledger.reservationNone") },
              ...(defaults?.reservationId && !(reservations.data ?? []).some((r) => r.id === defaults.reservationId) ? [{ value: defaults.reservationId, label: t("shortStays.turnover.stay") }] : []),
              ...(reservations.data ?? []).map((r) => {
                const params = { guest: r.guestName, channel: channelLabel(r.channel), dates: formatRange(r.checkIn, r.checkOut), space: r.spacePath };
                return { value: r.id, label: r.guestName ? t("shortStays.ledger.stayOption", params) : t("shortStays.ledger.stayOptionNoGuest", params) };
              }),
            ]}
          />
        </Field>
        <Field label={t("shortStays.ledger.channel")} error={fields.channel}>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as ReservationChannel)} options={RESERVATION_CHANNELS.map((c) => ({ value: c, label: channelLabel(c) }))} />
        </Field>
        <Field label={t("shortStays.ledger.description")} optional error={fields.description} className="sm:col-span-2">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={create.error} />
        </div>
      </div>
    </Modal>
  );
}

// ── Ledger list ────────────────────────────────────────────────────────────

export function LedgerTable({ entries, showStay = true }: { entries: LedgerEntry[]; showStay?: boolean }) {
  const toast = useToast();
  const voidEntry = useMutation("ledger.void");
  const [voiding, setVoiding] = useState<LedgerEntry | null>(null);

  if (entries.length === 0) {
    return <EmptyState illustration={<EmptyIllustration kind="receipt" />} title={t("shortStays.ledger.empty")} />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t("shortStays.ledger.cols.date")}</th>
            <th scope="col">{t("shortStays.ledger.cols.kind")}</th>
            <th scope="col">{t("shortStays.ledger.cols.description")}</th>
            <th scope="col">{t("shortStays.ledger.cols.where")}</th>
            <th scope="col">{t("shortStays.ledger.cols.source")}</th>
            <th scope="col" className="text-right">{t("shortStays.ledger.cols.amount")}</th>
            <th scope="col"><span className="sr-only">{t("shortStays.ledger.void")}</span></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className={e.voidedAt ? "opacity-55" : ""}>
              <td className="tnum whitespace-nowrap">{formatDate(e.occurredOn)}</td>
              <td>
                {t(`shortStays.enums.ledgerKind.${e.kind}` as MessageKey)}
                {e.category && <div className="text-[12px] text-ink-3">{t(`shortStays.enums.expenseCategory.${e.category}` as MessageKey)}</div>}
              </td>
              <td className={`max-w-[260px] ${e.voidedAt ? "line-through" : ""}`}>
                {e.description || "—"}
                {showStay && e.reservationId && (
                  <div>
                    <Link href={reservationHref(e.reservationId)} className="text-[12px] text-brass-bright hover:underline">
                      {t("shortStays.turnover.openStay")}
                    </Link>
                  </div>
                )}
              </td>
              <td>
                {e.propertyName}
                <div className="text-[12px] text-ink-3">
                  {e.spacePath ?? t("shortStays.ledger.spaceNone")} · {channelLabel(e.channel)}
                </div>
              </td>
              <td>
                <AmountSourceTag source={e.source} />
                {e.voidedAt && <div className="mt-1 text-[12px] text-ink-3">{t("shortStays.ledger.voided")}</div>}
              </td>
              <td className="tnum text-right">{formatRM(e.amountSen)}</td>
              <td className="text-right">
                {!e.voidedAt && (
                  <button type="button" className="text-[12.5px] text-ink-3 hover:text-ink" onClick={() => setVoiding(e)}>
                    {t("shortStays.ledger.void")}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={!!voiding}
        title={t("shortStays.ledger.voidTitle")}
        body={t("shortStays.ledger.voidBody")}
        confirmLabel={t("shortStays.ledger.void")}
        danger
        pending={voidEntry.pending}
        error={voidEntry.error}
        onClose={() => setVoiding(null)}
        onConfirm={async () => {
          if (!voiding) return;
          if ((await voidEntry.run({ id: voiding.id })) !== undefined) {
            toast({ tone: "success", message: t("shortStays.ledger.voidDone") });
            setVoiding(null);
          }
        }}
      />
    </div>
  );
}

// ── Airbnb CSV import ──────────────────────────────────────────────────────

/**
 * Pick the landlord's own Airbnb export → preview → match listings → import →
 * summary. Closing before importing discards the parsed file in main.
 */
export function CsvImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const spaces = useSpaceOptions(open);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [busy, setBusy] = useState<"pick" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setResult(null);
    setMap({});
    setError(null);
  }, [open]);

  const pick = async () => {
    setBusy("pick");
    setError(null);
    try {
      const p = await api("imports.pickAirbnbCsv");
      if (p) {
        setPreview(p);
        setMap(Object.fromEntries(p.listings.map((l) => [l.name, l.suggestedSpaceId ?? ""])));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy("commit");
    setError(null);
    try {
      const listingMap = Object.fromEntries(preview.listings.map((l) => [l.name, map[l.name] || null]));
      const r = await api("imports.commit", { token: preview.token, listingMap });
      setResult(r);
      setPreview(null);
      notifyChanged();
      toast({ tone: "success", message: t("shortStays.import.imported") });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    if (preview) void api("imports.discard", { token: preview.token }).catch(() => undefined);
    onClose();
  };

  const footer = result ? (
    <Button variant="primary" onClick={onClose}>
      {t("shortStays.import.done")}
    </Button>
  ) : preview ? (
    <>
      <Button onClick={close}>{t("shortStays.import.discard")}</Button>
      <Button variant="primary" loading={busy === "commit"} onClick={() => void commit()} icon={<Icon name="upload" size={15} />}>
        {t("shortStays.import.commit")}
      </Button>
    </>
  ) : (
    <>
      <Button onClick={close}>{t("common.cancel")}</Button>
      <Button variant="primary" loading={busy === "pick"} onClick={() => void pick()} icon={<Icon name="file" size={15} />}>
        {t("shortStays.import.choose")}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={close} title={result ? t("shortStays.import.resultTitle") : preview ? t("shortStays.import.previewTitle") : t("shortStays.import.title")} width={720} footer={footer}>
      <div className="space-y-4">
        {!preview && !result && (
          <>
            <p className="text-[13.5px] leading-relaxed text-ink-2">{t("shortStays.import.intro")}</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px]">
              <li>{t("shortStays.import.step1")}</li>
              <li>{t("shortStays.import.step2")}</li>
              <li>{t("shortStays.import.step3")}</li>
            </ol>
          </>
        )}

        {preview && (
          <>
            <dl className="grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-[auto_1fr]">
              <dt className="text-ink-3">{t("shortStays.import.file")}</dt>
              <dd className="break-all">{preview.fileName}</dd>
              <dt className="text-ink-3">{t("shortStays.import.kind")}</dt>
              <dd>{t(`shortStays.enums.importKind.${preview.kind}` as MessageKey)}</dd>
            </dl>
            <ul className="space-y-1 rounded-lg bg-surface-2 px-4 py-3 text-[13.5px]">
              <li className="font-medium">{t("shortStays.import.rows", { usable: preview.rowsUsable, total: preview.rowsTotal })}</li>
              {preview.rowsSkipped > 0 && <li className="text-ink-2">{t("shortStays.import.skipped", { n: preview.rowsSkipped })}</li>}
              {preview.duplicates > 0 && <li className="text-ink-2">{t("shortStays.import.duplicates", { n: preview.duplicates })}</li>}
              <li className="text-ink-2">{t("shortStays.import.matched", { n: preview.matchedReservations })}</li>
              <li className="text-ink-2">{t("shortStays.import.newReservations", { n: preview.newReservations })}</li>
              {preview.currency && <li className="text-ink-2">{t("shortStays.import.currency", { currency: preview.currency })}</li>}
            </ul>
            {preview.currency && preview.currency.toUpperCase() !== "MYR" && <Notice tone="warn">{t("shortStays.import.currencyWarn", { currency: preview.currency })}</Notice>}
            {preview.warnings.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[13px] font-semibold">{t("shortStays.import.warnings")}</h3>
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-warn">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.listings.length > 0 && (
              <div>
                <h3 className="text-[14px] font-semibold">{t("shortStays.import.listingsTitle")}</h3>
                <p className="mb-3 mt-1 text-[13px] text-ink-3">{t("shortStays.import.listingsHelp")}</p>
                <ul className="space-y-3">
                  {preview.listings.map((l) => (
                    <li key={l.name}>
                      <Field
                        label={
                          <span>
                            {l.name} <span className="font-normal text-ink-3">· {t("shortStays.import.listingRows", { n: l.rows })}</span>
                          </span>
                        }
                      >
                        <SpaceSelect
                          options={spaces.data ?? []}
                          value={map[l.name] ?? ""}
                          onChange={(v) => setMap((m) => ({ ...m, [l.name]: v }))}
                          allowEmptyLabel={t("shortStays.import.skipListing")}
                          note={(o) => (o.id === l.suggestedSpaceId ? t("shortStays.import.suggested") : null)}
                        />
                      </Field>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {result && (
          <>
            <ul className="space-y-1 rounded-lg bg-surface-2 px-4 py-3 text-[13.5px]">
              <li className="font-medium text-good">{t("shortStays.import.resultRows", { n: result.rowsImported })}</li>
              <li>{t("shortStays.import.resultLedger", { n: result.ledgerEntries })}</li>
              <li>{t("shortStays.import.resultCreated", { n: result.reservationsCreated })}</li>
              <li>{t("shortStays.import.resultUpdated", { n: result.reservationsUpdated })}</li>
              {result.duplicates > 0 && <li className="text-ink-2">{t("shortStays.import.resultDuplicates", { n: result.duplicates })}</li>}
              {result.rowsSkipped > 0 && <li className="text-ink-2">{t("shortStays.import.resultSkipped", { n: result.rowsSkipped })}</li>}
            </ul>
            <p className="text-[12.5px] text-ink-3">{t("shortStays.import.upcomingNote")}</p>
            {result.conflicts.length > 0 && (
              <div className="rounded-lg border border-warn/45 bg-warn/10 px-4 py-3">
                <h3 className="text-[13.5px] font-semibold">{t("shortStays.import.conflictsTitle")}</h3>
                <p className="mb-2 mt-1 text-[12.5px] text-ink-2">{t("shortStays.import.conflictsHelp")}</p>
                <ul className="space-y-1 text-[13px]">
                  {result.conflicts.map((c, i) => (
                    <li key={i}>
                      <span className="tnum font-medium">{c.confirmationCode}</span> — {c.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <FormError message={error} />
      </div>
    </Modal>
  );
}

/** "3 ranges to block" helper used by summary cards. */
export function rangesLabel(n: number) {
  return plural(n, "shortStays.pending.countOne", "shortStays.pending.countMany");
}

