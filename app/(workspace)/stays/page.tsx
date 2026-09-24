"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { useToday } from "@/components/forms";
import { CalendarTab, StayAddActions } from "@/components/stays/calendar-tab";
import { PerformanceTab } from "@/components/stays/performance-tab";
import { SyncIndicator } from "@/components/stays/shared";
import { TodayTab } from "@/components/stays/today-tab";
import { TurnoversTab } from "@/components/stays/turnovers-tab";
import { LinkButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Loading, PageHeader, Tabs } from "@/components/ui/layout";
import { isIsoDate } from "@/lib/domain/dates";
import { t } from "@/lib/i18n";

type Tab = "today" | "calendar" | "turnovers" | "performance";
const TABS: Tab[] = ["today", "calendar", "turnovers", "performance"];

function StaysInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/stays/";
  const today = useToday();
  const rawTab = params.get("tab");
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "today";
  const rawDate = params.get("date");
  const date = rawDate && isIsoDate(rawDate) ? rawDate : today;
  const blockId = params.get("block");

  // The URL is the state: tab, day / calendar start, and the block being edited.
  const go = useCallback(
    (next: { tab?: Tab; date?: string | null; block?: string | null }) => {
      const q = new URLSearchParams();
      const nextTab = next.tab ?? tab;
      q.set("tab", nextTab);
      const nextDate = next.date === undefined ? rawDate : next.date;
      if (nextDate && (nextTab === "today" || nextTab === "calendar")) q.set("date", nextDate);
      const nextBlock = next.block === undefined ? blockId : next.block;
      if (nextBlock && nextTab === "calendar") q.set("block", nextBlock);
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [tab, rawDate, blockId, router, pathname],
  );

  return (
    <>
      <PageHeader
        title={t("shortStays.title")}
        subtitle={t("shortStays.subtitle")}
        actions={
          <>
            <SyncIndicator />
            <StayAddActions />
            <LinkButton href="/settings/channels/" variant="ghost" icon={<Icon name="settings" size={15} />}>
              {t("shortStays.actions.connections")}
            </LinkButton>
          </>
        }
      />
      <Tabs<Tab>
        label={t("shortStays.tabs.label")}
        value={tab}
        onChange={(v) => go({ tab: v, block: null })}
        tabs={TABS.map((v) => ({ value: v, label: t(`shortStays.tabs.${v}`) }))}
      />
      <div role="tabpanel" aria-label={t(`shortStays.tabs.${tab}`)} className="pt-5">
        {tab === "today" && <TodayTab date={date} today={today} onDate={(d) => go({ date: d === today ? null : d })} />}
        {tab === "calendar" && <CalendarTab from={date} today={today} onFrom={(d) => go({ date: d === today ? null : d })} blockId={blockId} onBlock={(id) => go({ block: id })} />}
        {tab === "turnovers" && <TurnoversTab />}
        {tab === "performance" && <PerformanceTab today={today} />}
      </div>
    </>
  );
}

export default function StaysPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StaysInner />
    </Suspense>
  );
}
