"use client";

import Link from "next/link";
import { useState } from "react";
import { channelName, copyText, formatRange, formatWhen, nightsLabel } from "@/components/stays/format";
import { useNow } from "@/components/stays/shared";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Card, LoadError, Loading } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import type { PendingBlock } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { daysBetween } from "@/lib/domain/dates";
import { formatDate } from "@/lib/domain/format";
import { AIRBNB_IMPORT_DELAY_MINUTES } from "@/lib/domain/short-stay";
import { t, type MessageKey } from "@/lib/i18n";

function Item({ b, showConnection }: { b: PendingBlock; showConnection: boolean }) {
  const toast = useToast();
  const now = useNow();
  const ack = useMutation("channels.acknowledgeBlock");
  const [copied, setCopied] = useState(false);
  const nights = nightsLabel(daysBetween(b.start, b.end) + 1);
  const text = t("shortStays.pending.copyText", { space: b.spacePath, start: formatDate(b.start), end: formatDate(b.end), nights });
  const acked = !!b.acknowledgedAt;

  return (
    <li className={`flex flex-wrap items-start gap-4 py-3.5 ${acked ? "opacity-75" : ""}`}>
      <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${acked ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
        <Icon name={acked ? "check" : "calendar"} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="tnum text-[14.5px] font-semibold">{formatRange(b.start, b.end)}</p>
        <p className="text-[13px] text-ink-2">
          {t("shortStays.pending.nights", { start: formatDate(b.start), end: formatDate(b.end), nights })}
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          {b.spacePath}
          {showConnection && (
            <>
              {" · "}
              <Link href={`/settings/channels/?id=${b.connectionId}`} className="hover:underline">
                {t("shortStays.pending.onConnection", { channel: channelName(b.channel), name: b.connectionName })}
              </Link>
            </>
          )}
        </p>
        {b.reasons.length > 0 && (
          <p className="mt-1.5 text-[12.5px] text-ink-2">
            {t("shortStays.pending.because")}{" "}
            {b.reasons.map((r, i) => (
              <span key={`${r.kind}-${r.href}-${i}`}>
                {i > 0 && ", "}
                <Link href={r.href} className="text-brass-bright hover:underline">
                  {t(`shortStays.enums.conflictKind.${r.kind}` as MessageKey)}: {r.label}
                </Link>
              </span>
            ))}
          </p>
        )}
        {acked && <p className="mt-1.5 text-[12.5px] text-good">{t("shortStays.pending.acknowledged", { when: formatWhen(b.acknowledgedAt, now) })}</p>}
        {ack.error && <p className="mt-1.5 text-[12.5px] text-[#ff9d95]">{ack.error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon={<Icon name={copied ? "check" : "file"} size={14} />}
          onClick={async () => {
            const ok = await copyText(text);
            setCopied(ok);
            toast({ tone: ok ? "success" : "error", message: ok ? t("shortStays.pending.copied") : t("shortStays.pending.copyFailed") });
            if (ok) window.setTimeout(() => setCopied(false), 2500);
          }}
        >
          {t("shortStays.pending.copy")}
        </Button>
        <Button size="sm" variant={acked ? "ghost" : "secondary"} loading={ack.pending} onClick={() => void ack.run({ connectionId: b.connectionId, start: b.start, end: b.end, done: !acked })}>
          {acked ? t("shortStays.pending.undo") : t("shortStays.pending.markDone")}
        </Button>
      </div>
    </li>
  );
}

/** "Dates to block on Airbnb": nights taken in HavenOS the channel still shows as open. */
export function PendingBlocks({ connectionId }: { connectionId: string | null }) {
  const pending = useApi("channels.pendingBlocks", { connectionId });
  const items = pending.data ?? [];
  const open = items.filter((b) => !b.acknowledgedAt).length;
  return (
    <Card
      id={connectionId ? `pending-${connectionId}` : "pending-all"}
      title={
        <span>
          {t("shortStays.pending.title")}
          {open > 0 && <span className="tnum ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-[12px] font-semibold text-warn">{open}</span>}
        </span>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-2">{t("shortStays.pending.help")}</p>
      <p className="mt-1.5 text-[12.5px] text-ink-3">{t("shortStays.pending.delayNote", { hours: AIRBNB_IMPORT_DELAY_MINUTES / 60 })}</p>
      <div className="mt-3">
        {pending.error && <LoadError message={pending.error} onRetry={pending.reload} />}
        {!pending.data && !pending.error && <Loading />}
        {pending.data && items.length === 0 && (
          <p className="flex items-center gap-2 text-[13.5px] text-ink-2">
            <Icon name="check" className="text-good" />
            {t("shortStays.pending.empty")}
          </p>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-[var(--hairline)]">
            {items.map((b) => (
              <Item key={`${b.connectionId}-${b.start}-${b.end}`} b={b} showConnection={connectionId === null} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
