"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { formatClock, formatStay, formatWhen, guestDisplay, channelLabel, channelName, nightsLabel } from "@/components/stays/format";
import { LedgerDialog, LedgerTable } from "@/components/stays/money";
import { MissingPill, ReservationStatusPill, SourceBadge, TurnoverStatusPill, turnoverHref, useNow } from "@/components/stays/shared";
import { ReservationDialog } from "@/components/stays/stay-dialogs";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Card, DetailList, LoadError, Loading, Notice, PageHeader } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { ReservationDetail, ReservationEvent } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { isIsoDate } from "@/lib/domain/dates";
import { formatDate, formatTimestamp } from "@/lib/domain/format";
import { isMessageKey, t, type MessageKey } from "@/lib/i18n";

function showValue(field: string, v: string | number | null): string {
  if (v === null || v === "") return t("shortStays.reservation.empty");
  if (field === "status") {
    const key = `shortStays.enums.reservationStatus.${v}`;
    if (isMessageKey(key)) return t(key);
  }
  if ((field === "checkInTime" || field === "checkOutTime") && typeof v === "string") return formatClock(v);
  if (typeof v === "string" && isIsoDate(v)) return formatDate(v);
  return String(v);
}

function fieldLabel(field: string): string {
  const key = `shortStays.reservation.fields.${field}`;
  return isMessageKey(key) ? t(key) : field;
}

function EventItem({ e }: { e: ReservationEvent }) {
  const icon = e.kind === "note" ? "mail" : e.kind === "created" ? "plus" : e.kind === "cancelled" ? "close" : e.kind === "missing" || e.kind === "conflict" ? "alert" : e.kind === "dates_changed" ? "calendar" : "history";
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
        <Icon name={icon} size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[13.5px] font-medium">
            {t(`shortStays.enums.eventKind.${e.kind}` as MessageKey)} <span className="font-normal text-ink-3">{t(`shortStays.enums.eventSource.${e.source}` as MessageKey)}</span>
          </span>
          <time className="text-[12px] text-ink-3" dateTime={e.createdAt}>
            {formatTimestamp(e.createdAt)}
          </time>
        </div>
        {e.changes.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-[13px] text-ink-2">
            {e.changes.map((c, i) => (
              <li key={i}>{t("shortStays.reservation.change", { field: fieldLabel(c.field), from: showValue(c.field, c.from), to: showValue(c.field, c.to) })}</li>
            ))}
          </ul>
        )}
        {e.note && <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{e.note}</p>}
      </div>
    </li>
  );
}

function CancelDialog({ open, r, missing, onClose }: { open: boolean; r: ReservationDetail; missing: boolean; onClose: () => void }) {
  const toast = useToast();
  const cancel = useMutation("reservations.cancel");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) return;
    setReason(missing ? t("shortStays.missing.reason", { channel: channelName(r.channel) }) : "");
    cancel.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <ConfirmDialog
      open={open}
      title={missing ? t("shortStays.missing.confirmTitle") : t("shortStays.reservation.cancelTitle")}
      body={
        <>
          {missing ? t("shortStays.missing.confirmBody") : t("shortStays.reservation.cancelBody")}
          {!missing && r.channel !== "direct" && <span className="mt-2 block">{t("shortStays.reservation.cancelBodyChannel", { channel: channelName(r.channel) })}</span>}
        </>
      }
      confirmLabel={missing ? t("shortStays.missing.confirm") : t("shortStays.reservation.cancel")}
      danger
      pending={cancel.pending}
      error={cancel.error}
      onClose={onClose}
      onConfirm={async () => {
        if (await cancel.run({ id: r.id, reason })) {
          toast({ tone: "success", message: missing ? t("shortStays.missing.confirmed") : t("shortStays.reservation.cancelled") });
          onClose();
        }
      }}
    >
      <Field label={t("shortStays.reservation.cancelReason")} optional>
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

function ReservationView() {
  const id = useSearchParams().get("id") ?? "";
  const now = useNow();
  const res = useApi("reservations.get", { id }, { enabled: !!id });
  const [dialog, setDialog] = useState<"edit" | "cancel" | "missing" | "entry" | null>(null);

  if (!id) return <LoadError message={t("shortStays.reservation.notFound")} />;
  if (res.error) return <LoadError message={res.error} onRetry={res.reload} />;
  if (!res.data) return <Loading />;
  const r = res.data;
  const live = r.status !== "cancelled";
  const channel = channelName(r.channel);

  return (
    <>
      <PageHeader
        back={{ href: "/stays/?tab=calendar", label: t("shortStays.title") }}
        eyebrow={r.channelReservationId ? `${t("shortStays.reservation.eyebrow")} · ${r.channelReservationId}` : t("shortStays.reservation.eyebrow")}
        title={<span className={r.guestName ? "" : "text-ink-2"}>{guestDisplay(r)}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/properties/view?id=${r.propertyId}`} className="hover:underline">
              {r.spacePath} · {r.propertyName}
            </Link>
            <ReservationStatusPill status={r.status} />
            <SourceBadge source={r.source} channel={r.channel} />
            {r.missingSince && live && <MissingPill channel={r.channel} />}
          </span>
        }
        actions={
          live && (
            <>
              <Button onClick={() => setDialog("edit")}>{t("shortStays.reservation.edit")}</Button>
              <Button variant="ghost" onClick={() => setDialog("cancel")}>
                {t("shortStays.reservation.cancel")}
              </Button>
            </>
          )
        }
      />

      <div className="mb-5 space-y-3">
        {r.cancelledAt && <Notice tone="warn">{r.cancelReason ? t("shortStays.reservation.cancelledBannerReason", { when: formatTimestamp(r.cancelledAt), reason: r.cancelReason }) : t("shortStays.reservation.cancelledBanner", { when: formatTimestamp(r.cancelledAt) })}</Notice>}
        {r.missingSince && live && (
          <Notice tone="warn" action={<Button size="sm" variant="primary" onClick={() => setDialog("missing")}>{t("shortStays.reservation.missingConfirm")}</Button>}>
            <strong className="font-semibold">{t("shortStays.reservation.missingTitle", { channel: channelLabel(r.channel) })}</strong> {t("shortStays.reservation.missingBody", { when: formatTimestamp(r.missingSince), channel })}
            <span className="mt-1 block text-[12.5px] text-ink-2">{t("shortStays.reservation.missingStill")}</span>
          </Notice>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Card title={t("common.details")}>
            <DetailList
              items={[
                {
                  label: t("shortStays.reservation.dates"),
                  value: (
                    <span>
                      <span className="tnum">{formatStay(r.checkIn, r.checkOut)}</span>
                      <span className="mt-0.5 block text-[12.5px] text-ink-3">{t("shortStays.reservation.checkOutHint")}</span>
                      {r.datesLocked && (
                        <span className="mt-1 flex items-start gap-1.5 text-[12.5px] text-ink-2">
                          <Icon name="key" size={13} className="mt-0.5" />
                          {t("shortStays.reservation.datesLocked", { channel })}
                        </span>
                      )}
                    </span>
                  ),
                },
                { label: t("shortStays.reservation.nights"), value: nightsLabel(r.nights) },
                {
                  label: t("shortStays.reservation.times"),
                  value: r.checkInTime || r.checkOutTime ? t("shortStays.reservation.timesValue", { checkIn: formatClock(r.checkInTime), checkOut: formatClock(r.checkOutTime) }) : <span className="text-ink-3">{t("shortStays.reservation.timesUnknown")}</span>,
                },
                {
                  label: t("shortStays.reservation.guestName"),
                  value: (
                    <span>
                      {r.guestName || <span className="text-ink-3">{t("shortStays.guest.noName")}</span>}
                      {r.source === "feed" && !r.guestName && <span className="mt-0.5 block text-[12.5px] text-ink-3">{t("shortStays.reservation.guestNameHint")}</span>}
                    </span>
                  ),
                },
                { label: t("shortStays.reservation.guests"), value: r.guestCount ?? <span className="text-ink-3">{t("shortStays.reservation.guestsUnknown")}</span> },
                { label: t("shortStays.reservation.channel"), value: channelLabel(r.channel) },
                ...(r.channelReservationId ? [{ label: t("shortStays.reservation.code"), value: <span className="tnum">{r.channelReservationId}</span> }] : []),
                ...(r.connectionId
                  ? [{ label: t("shortStays.reservation.connection"), value: <Link href={`/settings/channels/?id=${r.connectionId}`} className="text-brass-bright hover:underline">{r.connectionName ?? t("shortStays.connections.details")}</Link> }]
                  : []),
                ...(r.lastSeenAt ? [{ label: t("shortStays.reservation.lastSeen"), value: formatWhen(r.lastSeenAt, now) }] : []),
                { label: t("shortStays.reservation.notes"), value: r.notes ? <span className="whitespace-pre-wrap">{r.notes}</span> : "—" },
                { label: t("shortStays.reservation.addedOn"), value: formatTimestamp(r.createdAt) },
              ]}
            />
          </Card>

          <Card title={t("shortStays.reservation.turnover")}>
            {r.turnoverId ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13.5px]">
                  {t("shortStays.today.checkOutAt", { time: formatClock(r.checkOutTime) })} · {formatDate(r.checkOut)}
                  {r.turnoverStatus && <TurnoverStatusPill status={r.turnoverStatus} />}
                </span>
                <LinkButton href={turnoverHref(r.turnoverId)} size="sm">
                  {t("shortStays.reservation.openTurnover")}
                </LinkButton>
              </div>
            ) : (
              <p className="text-[13.5px] text-ink-3">{t("shortStays.reservation.noTurnover")}</p>
            )}
          </Card>

          <Card
            title={t("shortStays.reservation.money")}
            padded={false}
            actions={
              <Button size="sm" onClick={() => setDialog("entry")} icon={<Icon name="plus" size={14} />}>
                {t("shortStays.performance.addEntry")}
              </Button>
            }
          >
            {r.ledger.length === 0 ? (
              <div className="p-5 text-[13.5px]">
                <p className="text-ink-3">{t("shortStays.reservation.moneyEmpty")}</p>
                {r.source === "feed" && <p className="mt-1 text-[12.5px] text-ink-3">{t("shortStays.reservation.moneyHelp")}</p>}
              </div>
            ) : (
              <LedgerTable entries={r.ledger} showStay={false} />
            )}
          </Card>
        </div>

        <Card title={t("shortStays.reservation.history")}>
          {r.events.length === 0 ? (
            <p className="text-[13.5px] text-ink-3">{t("shortStays.reservation.historyEmpty")}</p>
          ) : (
            <ol className="-my-3 divide-y divide-[var(--hairline)]">
              {r.events.map((e) => (
                <EventItem key={e.id} e={e} />
              ))}
            </ol>
          )}
        </Card>
      </div>

      <ReservationDialog open={dialog === "edit"} reservation={r} onClose={() => setDialog(null)} />
      <CancelDialog open={dialog === "cancel" || dialog === "missing"} r={r} missing={dialog === "missing"} onClose={() => setDialog(null)} />
      <LedgerDialog open={dialog === "entry"} defaults={{ reservationId: r.id, propertyId: r.propertyId, spaceId: r.spaceId, channel: r.channel }} onClose={() => setDialog(null)} />
    </>
  );
}

export default function ReservationPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ReservationView />
    </Suspense>
  );
}
