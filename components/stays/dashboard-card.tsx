"use client";

import Link from "next/link";
import { Card } from "@/components/ui/layout";
import { useApi } from "@/lib/api/hooks";
import type { IsoDate } from "@/lib/domain/dates";
import { t } from "@/lib/i18n";
import { AlertList } from "./shared";

/**
 * "Short stays today" on the dashboard. Hidden for landlords with no short-stay
 * activity, and whenever the day view can't be read.
 */
export function ShortStaysTodayCard({ today }: { today: IsoDate }) {
  const day = useApi("stays.day", { date: today });
  const d = day.data;
  if (!d) return null;
  const turnovers = d.turnovers.length;
  const active = d.channels.total > 0 || d.arrivals.length + d.departures.length + d.inHouse.length + turnovers + d.alerts.length > 0;
  if (!active) return null;
  const stats = [
    { label: t("shortStays.dashboard.arrivals"), n: d.arrivals.length, href: "/stays/?tab=today#stay-arrivals" },
    { label: t("shortStays.dashboard.departures"), n: d.departures.length, href: "/stays/?tab=today#stay-departures" },
    { label: t("shortStays.dashboard.turnovers"), n: turnovers, href: "/stays/?tab=turnovers", critical: d.turnovers.some((x) => x.late) },
  ];
  return (
    <Card
      title={t("shortStays.dashboard.title")}
      className="xl:col-span-2"
      actions={
        <Link href="/stays/" className="text-[13px] font-medium text-brass-bright hover:underline">
          {t("shortStays.dashboard.open")}
        </Link>
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {stats.map((s) => (
              <Link key={s.label} href={s.href} className="rounded-lg bg-surface-2 px-2 py-3 hover:bg-surface-3">
                <div className={`tnum font-display text-[24px] font-light ${s.critical ? "text-[#ff9d95]" : ""}`}>{s.n}</div>
                <div className="text-[12px] text-ink-3">{s.label}</div>
              </Link>
            ))}
          </div>
          {d.channels.total > 0 && (
            <p className="mt-2.5 text-[12px] text-ink-3">
              {t("shortStays.banner.summary", { active: d.channels.active, total: d.channels.total })}
              {d.channels.stale + d.channels.failing > 0 ? ` · ${[d.channels.failing ? t("shortStays.banner.failing", { n: d.channels.failing }) : null, d.channels.stale ? t("shortStays.banner.stale", { n: d.channels.stale }) : null].filter(Boolean).join(" · ")}` : ""}
            </p>
          )}
        </div>
        <div>
          {d.alerts.length === 0 ? (
            <p className="text-[13.5px] text-ink-3">{d.arrivals.length + d.departures.length + turnovers === 0 ? t("shortStays.dashboard.quiet") : t("shortStays.alerts.empty")}</p>
          ) : (
            <div className="-my-2.5">
              <AlertList alerts={d.alerts} limit={3} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
