"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/dialog";
import { DateInput, Field, FormError, Select, TextArea, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { AvailabilityBlock, ErrorCode, ReservationDetail } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { addDays, daysBetween, isIsoDate, type IsoDate } from "@/lib/domain/dates";
import { BLOCK_REASONS, type BlockReason, type ReservationChannel } from "@/lib/domain/enums";
import { isClockTime } from "@/lib/domain/short-stay";
import { t, type MessageKey } from "@/lib/i18n";
import { channelName, nightsLabel } from "./format";
import { reservationHref, SpaceSelect, useSpaceOptions } from "./shared";

type Errors = Record<string, MessageKey | string>;

/** A save error; clashes with other bookings get a clear heading and next step. */
export function SaveError({ error, code }: { error: string | null; code: ErrorCode | null }) {
  if (!error) return null;
  if (code !== "CONFLICT") return <FormError message={error} />;
  return (
    <div role="alert" className="rounded-lg border border-critical/45 bg-critical/10 px-3.5 py-3 text-[13.5px]">
      <p className="flex items-center gap-2 font-semibold text-[#ffc2bd]">
        <Icon name="alert" size={15} className="text-critical" />
        {t("shortStays.reservation.conflictTitle")}
      </p>
      <p className="mt-1.5 leading-snug text-ink">{error}</p>
      <p className="mt-1.5 text-[12.5px] text-ink-2">{t("shortStays.reservation.conflictHelp")}</p>
    </div>
  );
}

/** Whether a space has a linked calendar (so we can say what HavenOS can't do there). */
function useConnectionFor(spaceId: string, enabled: boolean) {
  const connections = useApi("channels.list", undefined, { enabled });
  return (connections.data ?? []).find((c) => c.spaceId === spaceId) ?? null;
}

// ── Block dates ────────────────────────────────────────────────────────────

export function BlockDialog({
  open,
  block,
  defaults,
  onClose,
}: {
  open: boolean;
  /** Existing block to edit, or null to create one. */
  block: AvailabilityBlock | null;
  defaults?: { spaceId?: string; startDate?: IsoDate };
  onClose: () => void;
}) {
  const toast = useToast();
  const spaces = useSpaceOptions(open);
  const create = useMutation("blocks.create");
  const update = useMutation("blocks.update");
  const cancel = useMutation("blocks.cancel");
  const [spaceId, setSpaceId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState<BlockReason>("maintenance");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const connection = useConnectionFor(spaceId, open);
  const save = block ? update : create;

  useEffect(() => {
    if (!open) return;
    setSpaceId(block?.spaceId ?? defaults?.spaceId ?? "");
    setStartDate(block?.startDate ?? defaults?.startDate ?? "");
    setEndDate(block?.endDate ?? (defaults?.startDate ? defaults.startDate : ""));
    setReason(block?.reason ?? "maintenance");
    setNotes(block?.notes ?? "");
    setErrors({});
    create.reset();
    update.reset();
    cancel.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, block?.id]);

  const submit = async () => {
    const e: Errors = {};
    if (!spaceId) e.spaceId = "validation.notLettable";
    if (!isIsoDate(startDate)) e.startDate = "validation.invalidDate";
    if (!isIsoDate(endDate)) e.endDate = "validation.invalidDate";
    else if (isIsoDate(startDate) && endDate < startDate) e.endDate = "validation.endBeforeStart";
    setErrors(e);
    if (Object.keys(e).length) return;
    const input = { spaceId, startDate, endDate, reason, maintenanceId: block?.maintenanceId ?? null, notes };
    const ok = block ? await update.run({ ...input, id: block.id }) : await create.run(input);
    if (ok) {
      toast({ tone: "success", message: block ? t("shortStays.block.updated") : t("shortStays.block.created") });
      onClose();
    }
  };

  const nights = isIsoDate(startDate) && isIsoDate(endDate) && endDate >= startDate ? daysBetween(startDate, endDate) + 1 : null;
  const fields = { ...save.fields, ...errors };

  return (
    <>
      <Modal
        open={open && !confirmRemove}
        onClose={onClose}
        title={block ? t("shortStays.block.editTitle") : t("shortStays.block.newTitle")}
        description={t("shortStays.block.description")}
        width={600}
        onSubmit={() => void submit()}
        footer={
          <>
            {block && (
              <Button variant="ghost" className="mr-auto" onClick={() => setConfirmRemove(true)} icon={<Icon name="trash" size={14} />}>
                {t("shortStays.block.remove")}
              </Button>
            )}
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary" loading={save.pending}>
              {block ? t("common.saveChanges") : t("shortStays.block.create")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("shortStays.block.space")} error={fields.spaceId} className="sm:col-span-2">
            <SpaceSelect options={spaces.data ?? []} value={spaceId} onChange={setSpaceId} disabled={!!block} data-autofocus />
          </Field>
          <Field label={t("shortStays.block.firstNight")} error={fields.startDate}>
            <DateInput
              value={startDate}
              onChange={(e) => {
                const v = e.target.value;
                setStartDate(v);
                if (isIsoDate(v) && (!isIsoDate(endDate) || endDate < v)) setEndDate(v);
              }}
            />
          </Field>
          <Field label={t("shortStays.block.lastNight")} hint={t("shortStays.block.lastNightHint")} error={fields.endDate}>
            <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          {nights !== null && <p className="text-[13px] text-ink-2 sm:col-span-2">{t("shortStays.block.summary", { nights: nightsLabel(nights) })}</p>}
          <Field label={t("shortStays.block.reason")} error={fields.reason}>
            <Select value={reason} onChange={(e) => setReason(e.target.value as BlockReason)} options={BLOCK_REASONS.map((r) => ({ value: r, label: t(`shortStays.enums.blockReason.${r}` as MessageKey) }))} />
          </Field>
          <Field label={t("shortStays.block.notes")} optional error={fields.notes} className="sm:col-span-2">
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          {connection && (
            <div className="sm:col-span-2">
              <Notice tone="warn">{t("shortStays.block.channelNote")}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <SaveError error={save.error} code={save.code} />
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={open && confirmRemove}
        title={t("shortStays.block.removeTitle")}
        body={t("shortStays.block.removeBody")}
        confirmLabel={t("shortStays.block.remove")}
        danger
        pending={cancel.pending}
        error={cancel.error}
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          if (!block) return;
          if (await cancel.run({ id: block.id })) {
            toast({ tone: "success", message: t("shortStays.block.removed") });
            setConfirmRemove(false);
            onClose();
          }
        }}
      />
    </>
  );
}

// ── Reservations ───────────────────────────────────────────────────────────

const CHANNEL_CHOICES: ReservationChannel[] = ["direct", "airbnb", "other"];

/**
 * Add a direct booking (or one a calendar hasn't brought in yet), or edit a
 * reservation. Dates of calendar-synced reservations are locked.
 */
export function ReservationDialog({
  open,
  reservation,
  defaults,
  onClose,
}: {
  open: boolean;
  reservation: ReservationDetail | null;
  defaults?: { spaceId?: string; checkIn?: IsoDate };
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const spaces = useSpaceOptions(open);
  const create = useMutation("reservations.create");
  const update = useMutation("reservations.update");
  const save = reservation ? update : create;
  const [f, setF] = useState({
    spaceId: "",
    guestName: "",
    guestCount: "",
    checkIn: "",
    checkOut: "",
    checkInTime: "15:00",
    checkOutTime: "12:00",
    status: "confirmed" as "tentative" | "confirmed",
    channel: "direct" as ReservationChannel,
    code: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const connection = useConnectionFor(f.spaceId, open);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    const r = reservation;
    setF({
      spaceId: r?.spaceId ?? defaults?.spaceId ?? "",
      guestName: r?.guestName ?? "",
      guestCount: r?.guestCount ? String(r.guestCount) : "",
      checkIn: r?.checkIn ?? defaults?.checkIn ?? "",
      checkOut: r?.checkOut ?? (defaults?.checkIn ? addDays(defaults.checkIn, 1) : ""),
      checkInTime: r ? (r.checkInTime ?? "") : "15:00",
      checkOutTime: r ? (r.checkOutTime ?? "") : "12:00",
      status: r && r.status !== "cancelled" ? r.status : "confirmed",
      channel: r?.channel ?? "direct",
      code: r?.channelReservationId ?? "",
      notes: r?.notes ?? "",
    });
    setErrors({});
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reservation?.id]);

  // New reservation: take the usual times from the space's linked calendar.
  const connectionId = connection?.id;
  useEffect(() => {
    if (!open || reservation || !connection) return;
    setF((x) => ({ ...x, checkInTime: connection.checkInTime, checkOutTime: connection.checkOutTime }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, open]);

  const locked = !!reservation?.datesLocked;
  const nights = isIsoDate(f.checkIn) && isIsoDate(f.checkOut) && f.checkOut > f.checkIn ? daysBetween(f.checkIn, f.checkOut) : null;

  const submit = async () => {
    const e: Errors = {};
    if (!reservation && !f.spaceId) e.spaceId = "validation.notLettable";
    if (!isIsoDate(f.checkIn)) e.checkIn = "validation.invalidDate";
    if (!isIsoDate(f.checkOut)) e.checkOut = "validation.invalidDate";
    else if (isIsoDate(f.checkIn) && f.checkOut <= f.checkIn) e.checkOut = "validation.endBeforeStart";
    let guestCount: number | null = null;
    if (f.guestCount.trim()) {
      const n = Number(f.guestCount);
      if (!Number.isInteger(n) || n < 1 || n > 50) e.guestCount = "validation.countRange";
      else guestCount = n;
    }
    if (f.checkInTime && !isClockTime(f.checkInTime)) e.checkInTime = "shortStays.form.invalidTime";
    if (f.checkOutTime && !isClockTime(f.checkOutTime)) e.checkOutTime = "shortStays.form.invalidTime";
    setErrors(e);
    if (Object.keys(e).length) return;
    const common = {
      guestName: f.guestName.trim(),
      guestCount,
      checkIn: f.checkIn,
      checkOut: f.checkOut,
      checkInTime: f.checkInTime || null,
      checkOutTime: f.checkOutTime || null,
      status: f.status,
      notes: f.notes,
    };
    if (reservation) {
      if (await update.run({ ...common, id: reservation.id })) {
        toast({ tone: "success", message: t("shortStays.reservation.saved") });
        onClose();
      }
      return;
    }
    const created = await create.run({ ...common, spaceId: f.spaceId, channel: f.channel, channelReservationId: f.channel !== "direct" && f.code.trim() ? f.code.trim() : null });
    if (created) {
      toast({ tone: "success", message: t("shortStays.reservation.created"), action: { label: t("common.view"), onClick: () => router.push(reservationHref(created.id)) } });
      onClose();
    }
  };

  const fields = { ...save.fields, ...errors };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reservation ? t("shortStays.reservation.editTitle") : t("shortStays.reservation.newTitle")}
      description={reservation ? undefined : t("shortStays.reservation.newDescription")}
      width={680}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={save.pending}>
            {reservation ? t("common.saveChanges") : t("shortStays.reservation.create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!reservation && (
          <Field label={t("shortStays.reservation.space")} error={fields.spaceId} className="sm:col-span-2">
            <SpaceSelect options={spaces.data ?? []} value={f.spaceId} onChange={(v) => set("spaceId", v)} data-autofocus />
          </Field>
        )}
        {!reservation && (
          <Field label={t("shortStays.reservation.channel")}>
            <Select value={f.channel} onChange={(e) => set("channel", e.target.value as ReservationChannel)} options={CHANNEL_CHOICES.map((c) => ({ value: c, label: t(`shortStays.enums.reservationChannel.${c}` as MessageKey) }))} />
          </Field>
        )}
        {!reservation && f.channel !== "direct" && (
          <Field label={t("shortStays.reservation.code")} optional hint={t("shortStays.reservation.codeHint")} error={fields.channelReservationId}>
            <TextInput value={f.code} onChange={(e) => set("code", e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
        )}
        {!reservation && f.channel === "airbnb" && connection?.channel === "airbnb" && (
          <div className="sm:col-span-2">
            <Notice tone="info">{t("shortStays.reservation.linkedNote")}</Notice>
          </div>
        )}
        {locked && reservation && (
          <div className="sm:col-span-2">
            <Notice tone="info">{t("shortStays.reservation.datesLocked", { channel: channelName(reservation.channel) })}</Notice>
          </div>
        )}
        <Field label={t("shortStays.reservation.checkIn")} error={fields.checkIn}>
          <DateInput
            value={f.checkIn}
            disabled={locked}
            onChange={(e) => {
              const v = e.target.value;
              setF((x) => ({ ...x, checkIn: v, checkOut: isIsoDate(v) && (!isIsoDate(x.checkOut) || x.checkOut <= v) ? addDays(v, 1) : x.checkOut }));
            }}
          />
        </Field>
        <Field label={t("shortStays.reservation.checkOut")} hint={t("shortStays.reservation.checkOutHint")} error={fields.checkOut}>
          <DateInput value={f.checkOut} disabled={locked} onChange={(e) => set("checkOut", e.target.value)} />
        </Field>
        {nights !== null && <p className="-mt-1 text-[13px] font-medium text-ink-2 sm:col-span-2">{nightsLabel(nights)}</p>}
        <Field label={t("shortStays.reservation.checkInTime")} optional error={fields.checkInTime}>
          <TextInput type="time" value={f.checkInTime} onChange={(e) => set("checkInTime", e.target.value)} />
        </Field>
        <Field label={t("shortStays.reservation.checkOutTime")} optional error={fields.checkOutTime}>
          <TextInput type="time" value={f.checkOutTime} onChange={(e) => set("checkOutTime", e.target.value)} />
        </Field>
        <Field
          label={t("shortStays.reservation.guestName")}
          optional
          hint={reservation?.source === "feed" || f.channel === "airbnb" ? t("shortStays.reservation.guestNameHint") : undefined}
          error={fields.guestName}
        >
          <TextInput value={f.guestName} onChange={(e) => set("guestName", e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t("shortStays.reservation.guestCount")} optional error={fields.guestCount}>
          <TextInput inputMode="numeric" value={f.guestCount} onChange={(e) => set("guestCount", e.target.value)} />
        </Field>
        {!locked && (
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-[13px] font-medium">{t("shortStays.reservation.status")}</legend>
          <div className="flex flex-wrap gap-2.5">
            {(["confirmed", "tentative"] as const).map((s) => (
              <label key={s} className={`flex min-w-[200px] flex-1 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${f.status === s ? "border-brass/60 bg-brass/10" : "border-[var(--hairline-strong)]"}`}>
                <input type="radio" name="reservation-status" className="mt-1 accent-[var(--color-brass)]" checked={f.status === s} onChange={() => set("status", s)} />
                <span>
                  <span className="block text-[13.5px] font-medium">{t(`shortStays.enums.reservationStatus.${s}` as MessageKey)}</span>
                  <span className="block text-[12.5px] text-ink-3">{t(`shortStays.enums.reservationStatusHelp.${s}` as MessageKey)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        )}
        <Field label={t("shortStays.reservation.notes")} optional error={fields.notes} className="sm:col-span-2">
          <TextArea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
        </Field>
        <div className="sm:col-span-2">
          <SaveError error={save.error} code={save.code} />
        </div>
      </div>
    </Modal>
  );
}

// ── Pick what to add from a calendar day ───────────────────────────────────

export function QuickAddDialog({
  target,
  onClose,
  onPick,
}: {
  target: { spaceId: string; spaceLabel: string; date: IsoDate; dateLabel: string } | null;
  onClose: () => void;
  onPick: (kind: "reservation" | "block") => void;
}) {
  const label = useMemo(() => target, [target]);
  return (
    <Modal open={!!target} onClose={onClose} title={t("shortStays.calendar.quickAddTitle", { space: label?.spaceLabel ?? "" })} description={t("shortStays.calendar.quickAddBody", { date: label?.dateLabel ?? "" })} width={440}>
      <div className="flex flex-wrap gap-2.5 pb-2">
        <Button variant="primary" onClick={() => onPick("reservation")} icon={<Icon name="key" size={15} />} data-autofocus>
          {t("shortStays.actions.addReservation")}
        </Button>
        <Button onClick={() => onPick("block")} icon={<Icon name="calendar" size={15} />}>
          {t("shortStays.actions.blockDates")}
        </Button>
      </div>
    </Modal>
  );
}
