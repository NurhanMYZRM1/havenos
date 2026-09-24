"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { channelName } from "@/components/stays/format";
import { SpaceSelect, useSpaceOptions } from "@/components/stays/shared";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, FormError, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import type { ChannelCapabilities, ChannelConnection } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import type { ChannelId } from "@/lib/domain/enums";
import { AIRBNB_IMPORT_DELAY_MINUTES, CHANNEL_SYNC_INTERVAL_MINUTES, isClockTime } from "@/lib/domain/short-stay";
import { t, type MessageKey } from "@/lib/i18n";

/** What a calendar-link connection does today, before one exists. */
const ICAL_CAPABILITIES: ChannelCapabilities = {
  method: "ical",
  incremental: false,
  pushAvailability: false,
  guestDetails: false,
  money: false,
  channelImportDelayMinutes: AIRBNB_IMPORT_DELAY_MINUTES,
};

/**
 * "What this link can and can't do", read from the connection's capabilities
 * so it stays true if a richer method is ever added.
 */
export function CapabilitiesBox({ channel, capabilities = ICAL_CAPABILITIES }: { channel: ChannelId; capabilities?: ChannelCapabilities }) {
  const name = channelName(channel);
  const can: string[] = [t("shortStays.capabilities.canDates", { channel: name }), t("shortStays.capabilities.canCodes"), t("shortStays.capabilities.canMissing")];
  const cant: string[] = [];
  (capabilities.guestDetails ? can : cant).push(capabilities.guestDetails ? t("shortStays.capabilities.canGuests") : t("shortStays.capabilities.cantGuests"));
  (capabilities.money ? can : cant).push(capabilities.money ? t("shortStays.capabilities.canMoney") : t("shortStays.capabilities.cantMoney"));
  cant.push(t("shortStays.capabilities.cantMessages"));
  (capabilities.pushAvailability ? can : cant).push(capabilities.pushAvailability ? t("shortStays.capabilities.canWrite", { channel: name }) : t("shortStays.capabilities.cantWrite", { channel: name }));
  const delayHours = capabilities.channelImportDelayMinutes ? Math.round(capabilities.channelImportDelayMinutes / 60) : null;

  return (
    <section className="rounded-xl border border-[var(--hairline-strong)] bg-surface-2/60 px-4 py-3.5" aria-labelledby="capabilities-title">
      <h3 id="capabilities-title" className="text-[14px] font-semibold">
        {t("shortStays.capabilities.title")}
      </h3>
      <div className="mt-2.5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="microlabel mb-1.5">{t("shortStays.capabilities.can")}</p>
          <ul className="space-y-1.5 text-[13px] leading-snug">
            {can.map((x) => (
              <li key={x} className="flex gap-2">
                <Icon name="check" size={14} className="mt-0.5 text-good" />
                {x}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="microlabel mb-1.5">{t("shortStays.capabilities.cant")}</p>
          <ul className="space-y-1.5 text-[13px] leading-snug">
            {cant.map((x) => (
              <li key={x} className="flex gap-2">
                <Icon name="close" size={14} className="mt-0.5 text-critical" />
                {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
        {t("shortStays.capabilities.timing", { interval: CHANNEL_SYNC_INTERVAL_MINUTES })}
        {channel === "airbnb" && delayHours ? ` ${t("shortStays.capabilities.airbnbDelay", { hours: delayHours })}` : ""}
      </p>
    </section>
  );
}

export function AirbnbInstructions({ channel }: { channel: ChannelId }) {
  if (channel !== "airbnb") {
    return (
      <div className="rounded-xl border border-[var(--hairline)] px-4 py-3.5">
        <h3 className="text-[14px] font-semibold">{t("shortStays.instructions.otherTitle")}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{t("shortStays.instructions.otherBody")}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--hairline)] px-4 py-3.5">
      <h3 className="text-[14px] font-semibold">{t("shortStays.instructions.title")}</h3>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-snug">
        {(["step1", "step2", "step3", "step4", "step5"] as const).map((s) => (
          <li key={s} className="break-words">
            {t(`shortStays.instructions.${s}`)}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[12.5px] text-ink-3">{t("shortStays.instructions.renamed")}</p>
    </div>
  );
}

/**
 * Add or edit a calendar connection. The feed link is a secret: it's sent to
 * main once and never shown again — editing shows only `feedLinkHint`.
 */
export function ConnectionDialog({ open, connection, onClose }: { open: boolean; connection: ChannelConnection | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const spaces = useSpaceOptions(open);
  const connections = useApi("channels.list", undefined, { enabled: open });
  const create = useMutation("channels.create");
  const update = useMutation("channels.update");
  const save = connection ? update : create;
  const [channel, setChannel] = useState<ChannelId>("airbnb");
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [checkInTime, setCheckInTime] = useState("15:00");
  const [checkOutTime, setCheckOutTime] = useState("12:00");
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});

  useEffect(() => {
    if (!open) return;
    setChannel(connection?.channel ?? "airbnb");
    setName(connection?.name ?? "");
    setSpaceId(connection?.spaceId ?? "");
    setFeedUrl("");
    setCheckInTime(connection?.checkInTime ?? "15:00");
    setCheckOutTime(connection?.checkOutTime ?? "12:00");
    setErrors({});
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection?.id]);

  const takenBy = (id: string) => (connections.data ?? []).find((c) => c.spaceId === id && c.channel === channel && c.id !== connection?.id);

  const submit = async () => {
    const e: Record<string, MessageKey> = {};
    if (!name.trim()) e.name = "validation.required";
    if (!spaceId) e.spaceId = "validation.notLettable";
    const url = feedUrl.trim();
    if (!connection && !url) e.feedUrl = "shortStays.form.feedUrlRequired";
    else if (url && !/^https:\/\//i.test(url)) e.feedUrl = "shortStays.form.feedUrlHttps";
    if (!isClockTime(checkInTime)) e.checkInTime = "shortStays.form.invalidTime";
    if (!isClockTime(checkOutTime)) e.checkOutTime = "shortStays.form.invalidTime";
    setErrors(e);
    if (Object.keys(e).length) return;
    if (connection) {
      const saved = await update.run({ id: connection.id, name: name.trim(), spaceId, feedUrl: url || null, checkInTime, checkOutTime, turnoverChecklist: connection.turnoverChecklist });
      if (saved) {
        setFeedUrl("");
        toast({ tone: "success", message: t("shortStays.connections.saved") });
        onClose();
      }
      return;
    }
    const created = await create.run({ channel, name: name.trim(), spaceId, feedUrl: url, checkInTime, checkOutTime });
    if (created) {
      setFeedUrl("");
      toast({ tone: "success", message: t("shortStays.connections.created") });
      onClose();
      router.push(`/settings/channels/?id=${created.id}`);
    }
  };

  const fields = { ...save.fields, ...errors };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={connection ? t("shortStays.form.editTitle") : t("shortStays.form.addTitle")}
      description={t("shortStays.form.description")}
      width={760}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={save.pending}>
            {connection ? t("common.saveChanges") : save.pending ? t("shortStays.form.creating") : t("shortStays.form.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {!connection && (
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">{t("shortStays.form.channel")}</legend>
            <div className="flex flex-wrap gap-2.5">
              {(["airbnb", "other"] as const).map((c) => (
                <label key={c} className={`flex min-w-[180px] flex-1 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[13.5px] font-medium ${channel === c ? "border-brass/60 bg-brass/10" : "border-[var(--hairline-strong)]"}`}>
                  <input type="radio" name="connection-channel" className="accent-[var(--color-brass)]" checked={channel === c} onChange={() => setChannel(c)} />
                  {c === "airbnb" ? t("shortStays.form.channelAirbnb") : t("shortStays.form.channelOther")}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {!connection && <AirbnbInstructions channel={channel} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("shortStays.form.name")} hint={t("shortStays.form.nameHint")} error={fields.name} className="sm:col-span-2">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-autofocus />
          </Field>
          <Field label={t("shortStays.form.space")} hint={t("shortStays.form.spaceHint")} error={fields.spaceId} className="sm:col-span-2">
            <SpaceSelect
              options={spaces.data ?? []}
              value={spaceId}
              onChange={(v) => {
                setSpaceId(v);
                const o = spaces.data?.find((s) => s.id === v);
                if (o && !name.trim()) setName(`${o.propertyName} ${o.path.split(" › ").pop()} (${t(`shortStays.enums.reservationChannel.${channel}` as MessageKey)})`);
              }}
              note={(o) => {
                const c = takenBy(o.id);
                return c ? t("shortStays.form.spaceTaken", { name: c.name }) : null;
              }}
            />
          </Field>
          <Field
            label={connection ? t("shortStays.form.feedUrlReplace") : t("shortStays.form.feedUrl")}
            optional={!!connection}
            hint={
              <>
                {connection ? (connection.feedLinkHint ? t("shortStays.form.feedUrlKeep", { hint: connection.feedLinkHint }) : t("shortStays.form.feedUrlKeepNoHint")) : t("shortStays.form.feedUrlHint")}{" "}
                {t("shortStays.capabilities.secret")}
              </>
            }
            error={fields.feedUrl}
            className="sm:col-span-2"
          >
            <TextInput type="url" inputMode="url" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} autoComplete="off" spellCheck={false} placeholder="https://www.airbnb.com/calendar/ical/….ics?s=…" />
          </Field>
          <Field label={t("shortStays.form.checkIn")} error={fields.checkInTime}>
            <TextInput type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
          </Field>
          <Field label={t("shortStays.form.checkOut")} error={fields.checkOutTime}>
            <TextInput type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
          </Field>
          <p className="-mt-2 text-[12.5px] text-ink-3 sm:col-span-2">{t("shortStays.form.timesHint")}</p>
        </div>

        <CapabilitiesBox channel={connection?.channel ?? channel} capabilities={connection?.capabilities} />
        <FormError message={save.error} />
      </div>
    </Modal>
  );
}

