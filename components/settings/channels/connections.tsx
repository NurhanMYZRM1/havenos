"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyIllustration } from "@/components/illustrations";
import { channelErrorText, channelName, formatAgo, formatRange, formatStay, formatWhen, formatClock, linkedLabel, methodLabel } from "@/components/stays/format";
import { ChannelHealthPill, ReservationRow, Tag, useNow } from "@/components/stays/shared";
import { IconButton } from "@/components/files";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormError, TextInput } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Card, DetailList, EmptyState, LoadError, Loading, Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { ChannelConnection, ChannelConnectionDetail, ChannelEventAction, ChannelEventView } from "@/lib/api/contract";
import { useApi, useChannelSync, useMutation } from "@/lib/api/hooks";
import { formatDate, formatTimestamp } from "@/lib/domain/format";
import { CHANNEL_SYNC_INTERVAL_MINUTES, DEFAULT_TURNOVER_CHECKLIST } from "@/lib/domain/short-stay";
import { t, type MessageKey } from "@/lib/i18n";
import { CapabilitiesBox, ConnectionDialog } from "./connection-dialog";
import { PendingBlocks } from "./pending-blocks";

// ── Shared status pieces ───────────────────────────────────────────────────

function useLiveHealth(c: ChannelConnection) {
  const running = useChannelSync();
  return running.includes(c.id) ? "syncing" : c.health;
}

/** Last error in plain words, plus the safe technical detail. */
function ErrorLine({ c }: { c: ChannelConnection }) {
  const now = useNow();
  if (!c.lastError || (c.lastSuccessAt && c.lastError.at < c.lastSuccessAt && c.lastError.code !== "feed_shrank")) return null;
  return (
    <div className="rounded-lg border border-critical/40 bg-critical/10 px-3.5 py-2.5 text-[13px]">
      <p className="leading-snug text-ink">{channelErrorText(c.lastError.code, c.channel)}</p>
      <p className="mt-1 text-[12px] text-ink-3">
        {formatWhen(c.lastError.at, now)}
        {c.lastError.detail ? ` · ${t("shortStays.channelErrors.detail", { detail: c.lastError.detail })}` : ""}
      </p>
    </div>
  );
}

function StaleLine({ c }: { c: ChannelConnection }) {
  if (!c.stale || c.status === "paused") return null;
  return (
    <Notice tone="warn">
      {c.lastSuccessAt ? t("shortStays.connections.staleWarning", { channel: channelName(c.channel), when: formatTimestamp(c.lastSuccessAt) }) : t("shortStays.connections.staleNever")}
    </Notice>
  );
}

function nextSyncText(c: ChannelConnection, now: number): string {
  if (c.status === "paused") return t("shortStays.connections.nextSyncPaused");
  if (c.nextSyncAt) return t("shortStays.connections.nextSyncAt", { when: formatAgo(c.nextSyncAt, now) });
  return t("shortStays.connections.nextSyncOnOpen");
}

function statusItems(c: ChannelConnection, now: number) {
  return [
    {
      label: t("shortStays.connections.linkedTo"),
      value: (
        <Link href={`/properties/view?id=${c.propertyId}`} className="hover:underline">
          {c.spacePath} · {c.propertyName}
        </Link>
      ),
    },
    { label: t("shortStays.connections.lastSuccess"), value: formatWhen(c.lastSuccessAt, now) },
    ...(c.lastAttemptAt && c.lastAttemptAt !== c.lastSuccessAt ? [{ label: t("shortStays.connections.lastAttempt"), value: formatWhen(c.lastAttemptAt, now) }] : []),
    { label: t("shortStays.connections.nextSync"), value: nextSyncText(c, now) },
    { label: t("shortStays.connections.linkHint"), value: c.hasFeedLink ? <span className="text-ink-2">{c.feedLinkHint ?? "••••"}</span> : <span className="text-warn">{t("shortStays.connections.linkHintNone")}</span> },
    { label: t("shortStays.connections.times"), value: t("shortStays.connections.timesValue", { checkIn: formatClock(c.checkInTime), checkOut: formatClock(c.checkOutTime) }) },
  ];
}

function Counts({ c }: { c: ChannelConnection }) {
  const items: { n: number; key: MessageKey; tone: string; href: string }[] = [
    { n: c.counts.upcoming, key: "shortStays.connections.counts.upcoming", tone: "text-ink-2", href: "/stays/?tab=calendar" },
    { n: c.counts.conflicts, key: "shortStays.connections.counts.conflicts", tone: c.counts.conflicts ? "text-[#ff9d95] font-semibold" : "text-ink-3", href: `/settings/channels/?id=${c.id}#conflicts` },
    { n: c.counts.missing, key: "shortStays.connections.counts.missing", tone: c.counts.missing ? "text-warn font-semibold" : "text-ink-3", href: `/settings/channels/?id=${c.id}#missing` },
    { n: c.counts.pendingBlocks, key: "shortStays.connections.counts.pendingBlocks", tone: c.counts.pendingBlocks ? "text-warn font-semibold" : "text-ink-3", href: `/settings/channels/?id=${c.id}#pending-${c.id}` },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
      {items.map((i) => (
        <li key={i.key}>
          <Link href={i.href} className={`tnum hover:underline ${i.tone}`}>
            {t(i.key, { n: i.n, channel: channelName(c.channel) })}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Refresh / pause / edit / remove, shared by the list and the detail page. */
function useConnectionActions(c: ChannelConnection) {
  const toast = useToast();
  const router = useRouter();
  const refresh = useMutation("channels.refresh");
  const pause = useMutation("channels.setPaused");
  const remove = useMutation("channels.remove");
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const running = useChannelSync().includes(c.id);

  const buttons = (
    <>
      <Button
        size="sm"
        variant="primary"
        loading={refresh.pending || running}
        disabled={c.status === "paused" || !c.hasFeedLink}
        icon={<Icon name="history" size={14} />}
        onClick={async () => {
          const r = await refresh.run({ id: c.id, acceptShrink: false });
          const mine = r?.find((x) => x.id === c.id);
          if (mine) toast({ tone: mine.health === "error" ? "error" : "success", message: mine.health === "error" ? t("shortStays.connections.refreshedFailed") : t("shortStays.connections.refreshed") });
        }}
      >
        {t("shortStays.connections.refreshNow")}
      </Button>
      <Button
        size="sm"
        loading={pause.pending}
        onClick={async () => {
          const paused = c.status !== "paused";
          if (await pause.run({ id: c.id, paused })) toast({ tone: "success", message: paused ? t("shortStays.connections.paused") : t("shortStays.connections.resumed") });
        }}
      >
        {c.status === "paused" ? t("shortStays.connections.resume") : t("shortStays.connections.pause")}
      </Button>
      <Button size="sm" onClick={() => setEditing(true)}>
        {t("shortStays.connections.edit")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setRemoving(true)} icon={<Icon name="trash" size={14} />}>
        {t("shortStays.connections.remove")}
      </Button>
    </>
  );

  const dialogs = (
    <>
      <ConnectionDialog open={editing} connection={c} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={removing}
        title={t("shortStays.connections.removeTitle")}
        body={t("shortStays.connections.removeBody", { name: c.name })}
        confirmLabel={t("shortStays.connections.remove")}
        danger
        pending={remove.pending}
        error={remove.error}
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          if ((await remove.run({ id: c.id })) !== undefined) {
            toast({ tone: "success", message: t("shortStays.connections.removed") });
            setRemoving(false);
            router.push("/settings/channels/");
          }
        }}
      />
    </>
  );

  const error = refresh.error ?? pause.error;
  return { buttons, dialogs, error };
}

// ── List ───────────────────────────────────────────────────────────────────

function ConnectionCard({ c }: { c: ChannelConnection }) {
  const now = useNow();
  const health = useLiveHealth(c);
  const { buttons, dialogs, error } = useConnectionActions(c);
  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold">
            <Link href={`/settings/channels/?id=${c.id}`} className="hover:underline">
              {c.name}
            </Link>
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Tag icon="calendar">{methodLabel(c)}</Tag>
            <ChannelHealthPill health={health} />
          </div>
        </div>
        <Link href={`/settings/channels/?id=${c.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brass-bright hover:underline">
          {t("shortStays.connections.details")}
          <Icon name="chevronRight" size={14} />
        </Link>
      </div>
      <div className="mt-4">
        <DetailList items={statusItems(c, now)} />
      </div>
      <div className="mt-4 space-y-3">
        <ErrorLine c={c} />
        <StaleLine c={c} />
        <Counts c={c} />
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">{buttons}</div>
      </div>
      {dialogs}
    </li>
  );
}

export function ConnectionsList({ sample }: { sample: boolean }) {
  const list = useApi("channels.list", undefined);
  const [adding, setAdding] = useState(false);
  if (list.error) return <LoadError message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  return (
    <div className="space-y-4">
      <Card title={t("shortStays.connections.howTitle")}>
        <ul className="space-y-2 text-[13.5px] leading-relaxed">
          <li className="flex gap-2.5"><Icon name="calendar" className="mt-0.5 text-brass-bright" />{t("shortStays.connections.howDates")}</li>
          <li className="flex gap-2.5"><Icon name="history" className="mt-0.5 text-info" />{t("shortStays.connections.howTiming", { interval: CHANNEL_SYNC_INTERVAL_MINUTES })}</li>
          <li className="flex gap-2.5"><Icon name="alert" className="mt-0.5 text-warn" />{t("shortStays.connections.howBlock")}</li>
          <li className="flex gap-2.5"><Icon name="wallet" className="mt-0.5 text-ink-3" />{t("shortStays.connections.howMoney")}</li>
        </ul>
      </Card>

      {list.data.length === 0 ? (
        <div className="card">
          <EmptyState
            illustration={<EmptyIllustration kind="keys" />}
            title={t("shortStays.connections.empty")}
            body={t("shortStays.connections.emptyBody")}
            actions={
              !sample && (
                <Button variant="primary" onClick={() => setAdding(true)} icon={<Icon name="plus" size={15} />}>
                  {t("shortStays.connections.add")}
                </Button>
              )
            }
          />
        </div>
      ) : (
        <section aria-labelledby="linked-title">
          <h2 id="linked-title" className="sr-only">
            {t("shortStays.connections.list")}
          </h2>
          <ul className="grid gap-4 xl:grid-cols-2">
            {list.data.map((c) => (
              <ConnectionCard key={c.id} c={c} />
            ))}
          </ul>
        </section>
      )}
      {list.data.length > 0 && <PendingBlocks connectionId={null} />}
      <ConnectionDialog open={adding} connection={null} onClose={() => setAdding(false)} />
    </div>
  );
}

// ── Detail ─────────────────────────────────────────────────────────────────

function ConflictCard({ e, channel, dismissed }: { e: ChannelEventView; channel: ChannelConnection["channel"]; dismissed: boolean }) {
  const toast = useToast();
  const resolve = useMutation("channels.resolveEvent");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const name = channelName(channel);
  const replaceable = e.conflicts.length > 0 && e.conflicts.every((c) => c.replaceable);
  const run = async (action: ChannelEventAction) => {
    if (await resolve.run({ eventId: e.id, action })) {
      toast({ tone: "success", message: t("shortStays.conflicts.resolved") });
      setConfirmReplace(false);
    }
  };
  const title = e.kind === "block" ? t("shortStays.conflicts.blockOnChannel", { channel: name }) : e.confirmationCode ? t("shortStays.conflicts.booking", { channel: name, code: e.confirmationCode }) : t("shortStays.conflicts.bookingNoCode", { channel: name });

  return (
    <li className={`rounded-xl border px-4 py-3.5 ${dismissed ? "border-[var(--hairline)] opacity-80" : "border-critical/45 bg-critical/5"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[14px] font-semibold">
          {!dismissed && <span aria-hidden className="mr-1.5 text-critical">▲</span>}
          {title}
        </h4>
        <span className="text-[12px] text-ink-3">{t("shortStays.conflicts.firstSeen", { when: formatTimestamp(e.firstSeenAt) })}</span>
      </div>
      <p className="tnum mt-1 text-[13.5px]">{formatStay(e.checkIn, e.checkOut)}</p>
      {e.currentDates && <p className="mt-1 text-[13px] text-ink-2">{t("shortStays.conflicts.dateChange", { channel: name, dates: formatStay(e.currentDates.checkIn, e.currentDates.checkOut) })}</p>}
      {e.conflicts.length > 0 && (
        <div className="mt-2.5">
          <p className="microlabel mb-1">{t("shortStays.conflicts.clashesWith")}</p>
          <ul className="space-y-1 text-[13px]">
            {e.conflicts.map((c) => (
              <li key={`${c.kind}-${c.id}`}>
                <Link href={c.href} className="text-brass-bright hover:underline">
                  {t(`shortStays.enums.conflictKind.${c.kind}` as MessageKey)}: {c.who}
                </Link>{" "}
                <span className="text-ink-2">
                  · {c.spacePath} · {c.end ? formatRange(c.start, c.end) : `${formatDate(c.start)} – ${t("shortStays.conflicts.noEnd")}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" loading={resolve.pending} onClick={() => void run("retry")} title={t("shortStays.conflicts.retryHelp")}>
          {t("shortStays.conflicts.retry")}
        </Button>
        {!dismissed && (
          <Button size="sm" loading={resolve.pending} onClick={() => void run("dismiss")} title={t("shortStays.conflicts.dismissHelp", { channel: name })}>
            {t("shortStays.conflicts.dismiss")}
          </Button>
        )}
        {replaceable && (
          <Button size="sm" variant="danger" onClick={() => setConfirmReplace(true)}>
            {t("shortStays.conflicts.replace")}
          </Button>
        )}
      </div>
      <p className="mt-2 text-[12px] text-ink-3">
        {t("shortStays.conflicts.retryHelp")} {!dismissed && t("shortStays.conflicts.dismissHelp", { channel: name })} {replaceable ? t("shortStays.conflicts.replaceHelp", { channel: name }) : t("shortStays.conflicts.replaceOnly")}
      </p>
      {resolve.error && !confirmReplace && (
        <div className="mt-2">
          <FormError message={resolve.error} />
        </div>
      )}
      <ConfirmDialog
        open={confirmReplace}
        title={t("shortStays.conflicts.replaceTitle")}
        body={t("shortStays.conflicts.replaceBody", { channel: name })}
        confirmLabel={t("shortStays.conflicts.replace")}
        danger
        pending={resolve.pending}
        error={resolve.error}
        onClose={() => setConfirmReplace(false)}
        onConfirm={() => void run("replace")}
      />
    </li>
  );
}

function MissingList({ d }: { d: ChannelConnectionDetail }) {
  const toast = useToast();
  const cancel = useMutation("reservations.cancel");
  const [confirming, setConfirming] = useState<string | null>(null);
  const name = channelName(d.channel);
  return (
    <Card title={t("shortStays.missing.title")} id="missing">
      <p className="mb-3 text-[13px] leading-relaxed text-ink-2">{t("shortStays.missing.help", { channel: name })}</p>
      {d.missingReservations.length === 0 ? (
        <p className="text-[13.5px] text-ink-3">{t("shortStays.missing.empty")}</p>
      ) : (
        <>
          <ul className="-mx-3">
            {d.missingReservations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 pr-3">
                <ul className="min-w-0 flex-1">
                  <ReservationRow r={r} detail={r.missingSince ? t("shortStays.missing.since", { when: formatTimestamp(r.missingSince) }) : null} />
                </ul>
                <Button size="sm" variant="danger" onClick={() => setConfirming(r.id)}>
                  {t("shortStays.missing.confirm")}
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-ink-3">{t("shortStays.missing.stillBooked")}</p>
        </>
      )}
      <ConfirmDialog
        open={!!confirming}
        title={t("shortStays.missing.confirmTitle")}
        body={t("shortStays.missing.confirmBody")}
        confirmLabel={t("shortStays.missing.confirm")}
        danger
        pending={cancel.pending}
        error={cancel.error}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (!confirming) return;
          if (await cancel.run({ id: confirming, reason: t("shortStays.missing.reason", { channel: name }) })) {
            toast({ tone: "success", message: t("shortStays.missing.confirmed") });
            setConfirming(null);
          }
        }}
      />
    </Card>
  );
}

function ChecklistEditor({ c }: { c: ChannelConnection }) {
  const toast = useToast();
  const save = useMutation("channels.update");
  const [items, setItems] = useState<string[]>(c.turnoverChecklist);
  const [draft, setDraft] = useState("");
  const key = c.turnoverChecklist.join("\n");
  useEffect(() => setItems(c.turnoverChecklist), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = items.join("\n") !== key;
  const move = (i: number, to: number) => setItems((all) => {
    const next = [...all];
    const [x] = next.splice(i, 1);
    next.splice(to, 0, x);
    return next;
  });

  return (
    <Card title={t("shortStays.checklist.title")} actions={dirty && <span className="text-[12.5px] font-medium text-warn">{t("shortStays.checklist.unsaved")}</span>}>
      <p className="mb-3 text-[13px] text-ink-3">{t("shortStays.checklist.help")}</p>
      {items.length === 0 ? (
        <p className="text-[13.5px] text-ink-3">{t("shortStays.checklist.empty")}</p>
      ) : (
        <ol className="divide-y divide-[var(--hairline)]">
          {items.map((item, i) => (
            <li key={`${i}-${item}`} className="flex items-center gap-2 py-1.5">
              <span className="tnum w-6 text-right text-[12px] text-ink-3">{i + 1}.</span>
              <span className="min-w-0 flex-1 text-[13.5px]">{item}</span>
              <IconButton label={t("shortStays.checklist.moveUp", { item })} icon="chevronLeft" disabled={i === 0} onClick={() => move(i, i - 1)} />
              <IconButton label={t("shortStays.checklist.moveDown", { item })} icon="chevronRight" disabled={i === items.length - 1} onClick={() => move(i, i + 1)} />
              <IconButton label={t("shortStays.checklist.remove", { item })} icon="trash" onClick={() => setItems((all) => all.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ol>
      )}
      <form
        noValidate
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (!v) return;
          setItems((all) => [...all, v]);
          setDraft("");
        }}
      >
        <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("shortStays.checklist.placeholder")} aria-label={t("shortStays.checklist.add")} />
        <Button type="submit" disabled={!draft.trim()}>
          {t("shortStays.checklist.add")}
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!dirty}
          loading={save.pending}
          onClick={async () => {
            if (await save.run({ id: c.id, name: c.name, spaceId: c.spaceId, feedUrl: null, checkInTime: c.checkInTime, checkOutTime: c.checkOutTime, turnoverChecklist: items })) toast({ tone: "success", message: t("shortStays.checklist.saved") });
          }}
        >
          {t("shortStays.checklist.save")}
        </Button>
        <Button variant="ghost" onClick={() => setItems([...DEFAULT_TURNOVER_CHECKLIST])}>
          {t("shortStays.checklist.reset")}
        </Button>
      </div>
      <div className="mt-3">
        <FormError message={save.error} />
      </div>
    </Card>
  );
}

function Runs({ d }: { d: ChannelConnectionDetail }) {
  return (
    <Card title={t("shortStays.detail.runs")} padded={false}>
      {d.runs.length === 0 ? (
        <p className="p-5 text-[13.5px] text-ink-3">{t("shortStays.detail.runsEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("shortStays.detail.runCols.started")}</th>
                <th scope="col">{t("shortStays.detail.runCols.trigger")}</th>
                <th scope="col">{t("shortStays.detail.runCols.outcome")}</th>
                <th scope="col">{t("shortStays.detail.runCols.found")}</th>
                <th scope="col">{t("shortStays.detail.runCols.changes")}</th>
              </tr>
            </thead>
            <tbody>
              {d.runs.map((r) => (
                <tr key={r.id}>
                  <td className="tnum whitespace-nowrap">{formatTimestamp(r.startedAt)}</td>
                  <td>{t(`shortStays.enums.syncTrigger.${r.trigger}` as MessageKey, { n: CHANNEL_SYNC_INTERVAL_MINUTES })}</td>
                  <td>
                    <span className={r.outcome === "ok" ? "text-good" : r.outcome === null ? "text-info" : "text-[#ff9d95]"}>{t(`shortStays.enums.syncOutcome.${r.outcome ?? "running"}` as MessageKey)}</span>
                    {r.errorCode && <div className="text-[12px] text-ink-3">{r.errorCode}</div>}
                    {r.diagnostic && <p className="mt-1 max-w-64 whitespace-normal break-words text-[12px] text-ink-2">{r.diagnostic}</p>}
                  </td>
                  <td className="tnum">{r.outcome ? t("shortStays.detail.runFound", { n: r.eventsSeen }) : "—"}</td>
                  <td className="tnum text-[12.5px] text-ink-2">{r.outcome ? t("shortStays.detail.runChanges", { created: r.created, updated: r.updated, missing: r.missing, conflicts: r.conflicts }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ShrankNotice({ c }: { c: ChannelConnection }) {
  const toast = useToast();
  const refresh = useMutation("channels.refresh");
  const [confirming, setConfirming] = useState(false);
  const name = channelName(c.channel);
  if (c.lastError?.code !== "feed_shrank") return null;
  return (
    <div role="alert" className="rounded-xl border-2 border-critical/60 bg-critical/10 px-5 py-4">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <Icon name="alert" className="text-critical" />
        {t("shortStays.detail.shrankTitle")}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed">{t("shortStays.detail.shrankBody", { channel: name })}</p>
      <p className="mt-2 text-[13.5px] font-medium leading-relaxed text-[#ffc2bd]">{t("shortStays.detail.shrankWarn", { channel: name })}</p>
      <div className="mt-3">
        <Button variant="danger" onClick={() => setConfirming(true)}>
          {t("shortStays.detail.applyAnyway")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={t("shortStays.detail.applyAnywayTitle")}
        body={t("shortStays.detail.applyAnywayBody", { channel: name })}
        confirmLabel={t("shortStays.detail.applyAnyway")}
        danger
        pending={refresh.pending}
        error={refresh.error}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          if (await refresh.run({ id: c.id, acceptShrink: true })) {
            toast({ tone: "success", message: t("shortStays.detail.applied") });
            setConfirming(false);
          }
        }}
      />
    </div>
  );
}

export function ConnectionDetailView({ d }: { d: ChannelConnectionDetail }) {
  const now = useNow();
  const health = useLiveHealth(d);
  const { buttons, dialogs, error } = useConnectionActions(d);
  const open = d.events.filter((e) => e.state === "conflict");
  const dismissed = d.events.filter((e) => e.state === "dismissed");
  const name = channelName(d.channel);

  return (
    <div className="space-y-4">
      <ShrankNotice c={d} />
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card title={t("shortStays.detail.status")} actions={<ChannelHealthPill health={health} />}>
          <p className="mb-4 text-[13px] text-ink-2">{linkedLabel(d)}</p>
          <DetailList items={statusItems(d, now)} />
          <div className="mt-4 space-y-3">
            <ErrorLine c={d} />
            <StaleLine c={d} />
            <Counts c={d} />
            <FormError message={error} />
            <div className="flex flex-wrap gap-2">{buttons}</div>
          </div>
        </Card>
        <CapabilitiesBox channel={d.channel} capabilities={d.capabilities} />
      </div>

      <Card title={t("shortStays.conflicts.title")} id="conflicts">
        <p className="mb-3 text-[13px] text-ink-2">{t("shortStays.conflicts.help")}</p>
        {open.length === 0 ? (
          <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
            <Icon name="check" className="text-good" />
            {t("shortStays.conflicts.empty")}
          </p>
        ) : (
          <ul className="space-y-3">
            {open.map((e) => (
              <ConflictCard key={e.id} e={e} channel={d.channel} dismissed={false} />
            ))}
          </ul>
        )}
        {dismissed.length > 0 && (
          <div className="mt-5">
            <h3 className="text-[13.5px] font-semibold">{t("shortStays.conflicts.dismissedTitle")}</h3>
            <p className="mb-2 mt-0.5 text-[12.5px] text-ink-3">{t("shortStays.conflicts.dismissedHelp", { channel: name })}</p>
            <ul className="space-y-3">
              {dismissed.map((e) => (
                <ConflictCard key={e.id} e={e} channel={d.channel} dismissed />
              ))}
            </ul>
          </div>
        )}
      </Card>

      <MissingList d={d} />
      <PendingBlocks connectionId={d.id} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ChecklistEditor c={d} />
        <Runs d={d} />
      </div>
      {dialogs}
    </div>
  );
}
