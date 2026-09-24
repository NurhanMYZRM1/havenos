"use client";

import Link from "next/link";
import { EmptyIllustration } from "@/components/illustrations";
import { LinkButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Card, EmptyState, LoadError, Loading, Notice } from "@/components/ui/layout";
import { MaintenanceStatusPill, PriorityPill } from "@/components/ui/status";
import type { StayDay } from "@/lib/api/contract";
import { useApi } from "@/lib/api/hooks";
import type { IsoDate } from "@/lib/domain/dates";
import { formatDate } from "@/lib/domain/format";
import { AIRBNB_IMPORT_DELAY_MINUTES, CHANNEL_SYNC_INTERVAL_MINUTES } from "@/lib/domain/short-stay";
import { t } from "@/lib/i18n";
import { formatClock, formatWhen } from "./format";
import { AlertList, DaySwitcher, ReservationRow, TurnoverRow, useNow } from "./shared";

/**
 * How fresh the linked calendars are, and — whenever anything is stale,
 * failing or not yet blocked on Airbnb — why that can lead to a double booking.
 */
export function ChannelStatusBanner({ channels }: { channels: StayDay["channels"] }) {
  const now = useNow();
  const pending = useApi("channels.pendingBlocks", { connectionId: null }, { enabled: channels.total > 0 });
  const pendingCount = (pending.data ?? []).filter((b) => !b.acknowledgedAt).length;

  if (channels.total === 0) {
    return (
      <Notice tone="info" action={<LinkButton href="/settings/channels/" size="sm">{t("shortStays.banner.linkCta")}</LinkButton>}>
        <strong className="font-semibold">{t("shortStays.banner.noneTitle")}</strong> {t("shortStays.banner.noneBody")}
      </Notice>
    );
  }

  const trouble = channels.stale > 0 || channels.failing > 0 || pendingCount > 0;
  const tone = channels.failing > 0 ? "critical" : trouble ? "warn" : "good";
  const flags = [
    channels.failing > 0 ? t("shortStays.banner.failing", { n: channels.failing }) : null,
    channels.stale > 0 ? t("shortStays.banner.stale", { n: channels.stale }) : null,
    pendingCount > 0 ? t("shortStays.banner.pending", { n: pendingCount }) : null,
  ].filter(Boolean);

  return (
    <Notice tone={tone} action={<LinkButton href="/settings/channels/" size="sm">{t("shortStays.banner.open")}</LinkButton>}>
      <p>
        <strong className="font-semibold">{t("shortStays.banner.summary", { active: channels.active, total: channels.total })}.</strong>{" "}
        {channels.oldestSuccessAt ? t("shortStays.banner.oldest", { when: formatWhen(channels.oldestSuccessAt, now) }) : t("shortStays.banner.oldestNever")}{" "}
        {!trouble && t("shortStays.banner.allGood")}
        {flags.length > 0 && <span className="font-semibold"> {flags.join(" · ")}.</span>}
      </p>
      {trouble && (
        <p className="mt-1.5 text-[13px] text-ink-2">
          <strong className="font-semibold text-ink">{t("shortStays.banner.windowTitle")}</strong>{" "}
          {t("shortStays.banner.windowBody", { interval: CHANNEL_SYNC_INTERVAL_MINUTES, hours: AIRBNB_IMPORT_DELAY_MINUTES / 60 })}
        </p>
      )}
    </Notice>
  );
}

function Section({ title, count, empty, children, id }: { title: string; count: number; empty: string; children: React.ReactNode; id: string }) {
  return (
    <Card
      id={id}
      title={
        <span>
          {title} <span className="tnum ml-1 text-[13px] font-normal text-ink-3">{count}</span>
        </span>
      }
    >
      {count === 0 ? <p className="text-[13.5px] text-ink-3">{empty}</p> : <ul className="-mx-3 -my-2">{children}</ul>}
    </Card>
  );
}

export function TodayTab({ date, today, onDate }: { date: IsoDate; today: IsoDate; onDate: (d: IsoDate) => void }) {
  const day = useApi("stays.day", { date });

  return (
    <div className="space-y-4">
      <DaySwitcher value={date} onChange={onDate} today={today} />
      {day.error && <LoadError message={day.error} onRetry={day.reload} />}
      {!day.data && !day.error && <Loading />}
      {day.data && (
        <>
          <ChannelStatusBanner channels={day.data.channels} />
          <Card title={t("shortStays.alerts.title")} id="stay-alerts">
            {day.data.alerts.length === 0 ? <p className="text-[13.5px] text-ink-3">{t("shortStays.alerts.empty")}</p> : <AlertList alerts={day.data.alerts} />}
          </Card>
          {day.data.arrivals.length + day.data.departures.length + day.data.inHouse.length + day.data.turnovers.length === 0 && day.data.maintenance.length === 0 ? (
            <div className="card">
              <EmptyState illustration={<EmptyIllustration kind="keys" />} title={t("shortStays.dashboard.quiet")} />
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              <Section id="stay-arrivals" title={t("shortStays.today.arrivals")} count={day.data.arrivals.length} empty={t("shortStays.today.arrivalsEmpty")}>
                {day.data.arrivals.map((r) => (
                  <ReservationRow key={r.id} r={r} detail={r.checkInTime ? t("shortStays.today.checkInAt", { time: formatClock(r.checkInTime) }) : null} />
                ))}
              </Section>
              <Section id="stay-departures" title={t("shortStays.today.departures")} count={day.data.departures.length} empty={t("shortStays.today.departuresEmpty")}>
                {day.data.departures.map((r) => (
                  <ReservationRow key={r.id} r={r} detail={r.checkOutTime ? t("shortStays.today.checkOutAt", { time: formatClock(r.checkOutTime) }) : null} />
                ))}
              </Section>
              <Section id="stay-turnovers" title={t("shortStays.today.turnovers")} count={day.data.turnovers.length} empty={t("shortStays.today.turnoversEmpty")}>
                {day.data.turnovers.map((tv) => (
                  <TurnoverRow key={tv.id} tv={tv} />
                ))}
              </Section>
              <Section id="stay-inhouse" title={t("shortStays.today.inHouse")} count={day.data.inHouse.length} empty={t("shortStays.today.inHouseEmpty")}>
                {day.data.inHouse.map((r) => (
                  <ReservationRow key={r.id} r={r} detail={t("shortStays.today.untilDate", { date: formatDate(r.checkOut) })} />
                ))}
              </Section>
              <Section id="stay-maintenance" title={t("shortStays.today.maintenance")} count={day.data.maintenance.length} empty={t("shortStays.today.maintenanceEmpty")}>
                {day.data.maintenance.map((m) => (
                  <li key={m.id}>
                    <Link href={`/maintenance/view?id=${m.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-2">
                      <Icon name="wrench" className="text-ink-3" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{m.title}</div>
                        <div className="truncate text-[12px] text-ink-3">
                          {m.ref} · {m.propertyName}
                          {m.spacePath ? ` · ${m.spacePath}` : ""}
                        </div>
                      </div>
                      <PriorityPill priority={m.priority} />
                      <MaintenanceStatusPill status={m.status} />
                    </Link>
                  </li>
                ))}
              </Section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
