"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OccupancyMeter } from "@/components/dashboard/occupancy-meter";
import { PropertyCover } from "@/components/files";
import { useToday } from "@/components/forms";
import { SkylineIllustration } from "@/components/illustrations";
import { ShortStaysTodayCard } from "@/components/stays/dashboard-card";
import { useActions } from "@/components/shell/app-shell";
import { TenancyLink } from "@/components/tenancies/tenancy-link";
import { Button, LinkButton } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icons";
import { Card, LoadError, Loading, Notice, PageHeader } from "@/components/ui/layout";
import { MonthSwitcher } from "@/components/ui/month-switcher";
import { MaintenanceStatusPill, OverdueFlag, PriorityPill } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage, notifyChanged } from "@/lib/api/client";
import type { DashboardSummary } from "@/lib/api/contract";
import { useApi } from "@/lib/api/hooks";
import { daysBetween, monthOf, timestampParts, type YearMonth } from "@/lib/domain/dates";
import { formatDate, formatDateLong, formatMonth, formatRelativeDay, formatTimestamp } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { t } from "@/lib/i18n";

function greeting(): string {
  const { hour } = timestampParts(new Date().toISOString());
  return hour < 12 ? t("dashboard.greetingMorning") : hour < 18 ? t("dashboard.greetingAfternoon") : t("dashboard.greetingEvening");
}

function Stat({ label, value, sub, help, tone, children }: { label: string; value: string; sub?: string; help: string; tone?: "critical" | "good"; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col p-5">
      <div className="microlabel">{label}</div>
      <div className={`tnum mt-2 font-display text-[30px] font-light leading-none tracking-tight ${tone === "critical" ? "text-[#ff9d95]" : ""}`}>{value}</div>
      {sub && <div className="mt-2 text-[13px] text-ink-2">{sub}</div>}
      {children}
      <p className="mt-auto pt-3 text-[12px] leading-snug text-ink-3">{help}</p>
    </div>
  );
}

function Welcome() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const openSample = async () => {
    setBusy(true);
    try {
      await api("workspace.switch", { workspace: "sample" });
      notifyChanged();
    } catch (err) {
      toast({ tone: "error", message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card overflow-hidden">
      <div className="relative h-56 md:h-72">
        <SkylineIllustration className="absolute inset-0 size-full" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, var(--color-surface) 3%, transparent 65%)" }} />
      </div>
      <div className="px-6 pb-8 md:px-10">
        <h2 className="font-display text-[30px] font-light">{t("dashboard.emptyTitle")}</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-2">{t("dashboard.emptyBody")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href="/onboarding" variant="primary" icon={<Icon name="building" size={16} />}>
            {t("dashboard.emptyAdd")}
          </LinkButton>
          <Button onClick={() => void openSample()} loading={busy} icon={<Icon name="sparkle" size={16} />}>
            {t("dashboard.emptySample")}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/settings?tab=storage&do=restore")} icon={<Icon name="upload" size={16} />}>
            {t("dashboard.emptyRestore")}
          </Button>
        </div>
        <p className="mt-3 text-[12.5px] text-ink-3">{t("dashboard.emptySampleHelp")}</p>
      </div>
    </div>
  );
}

function QuickActions() {
  const actions = useActions();
  const router = useRouter();
  const items: { label: string; icon: IconName; run: () => void }[] = [
    { label: t("dashboard.actionAddProperty"), icon: "building", run: () => router.push("/onboarding") },
    { label: t("dashboard.actionAddTenancy"), icon: "key", run: () => router.push("/tenancies/new") },
    { label: t("dashboard.actionRecordPayment"), icon: "wallet", run: () => actions.recordPayment() },
    { label: t("dashboard.actionLogMaintenance"), icon: "wrench", run: () => actions.newMaintenance() },
    { label: t("dashboard.actionBackup"), icon: "hardDrive", run: () => router.push("/settings?tab=storage&do=backup") },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label={t("dashboard.quickActions")}>
      {items.map((item) => (
        <button key={item.label} type="button" onClick={item.run} className="card flex items-center gap-3 px-4 py-3.5 text-left text-[13.5px] font-medium">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-brass-bright">
            <Icon name={item.icon} size={17} />
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Figures({ d }: { d: DashboardSummary }) {
  const month = formatMonth(d.month);
  const pctCollected = d.rent.expectedSen > 0 ? Math.min(100, Math.round((d.rent.collectedSen / d.rent.expectedSen) * 100)) : 0;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Stat
        label={t("dashboard.occupancy")}
        value={t("dashboard.occupancyValue", { occupied: d.occupancy.occupied, total: d.occupancy.lettable })}
        sub={t("dashboard.occupancyBreakdown", {
          units: `${d.occupancy.byKind.unit.occupied}/${d.occupancy.byKind.unit.total}`,
          rooms: `${d.occupancy.byKind.room.occupied}/${d.occupancy.byKind.room.total}`,
          beds: `${d.occupancy.byKind.bed.occupied}/${d.occupancy.byKind.bed.total}`,
        })}
        help={t("dashboard.occupancyHelp")}
      >
        <div className="mt-3">
          <OccupancyMeter value={d.occupancy.occupied} total={d.occupancy.lettable} label={t("dashboard.occupancy")} />
        </div>
      </Stat>
      <Stat label={t("dashboard.rentDue")} value={formatRM(d.rent.expectedSen)} sub={t("dashboard.outstanding", { amount: formatRM(d.rent.outstandingSen) })} help={t("dashboard.rentDueHelp", { month })} />
      <Stat label={t("dashboard.collected")} value={formatRM(d.rent.collectedSen)} sub={t("dashboard.receivedInMonth", { amount: formatRM(d.rent.receivedInMonthSen), month })} help={t("dashboard.collectedHelp", { month })}>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--hairline-strong)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctCollected} aria-label={t("dashboard.collected")}>
          <div className="h-full rounded-full bg-good" style={{ width: `${pctCollected}%` }} />
        </div>
      </Stat>
      <Stat label={t("dashboard.overdue")} value={formatRM(d.rent.overdueAllSen)} tone={d.rent.overdueAllSen > 0 ? "critical" : undefined} sub={t("dashboard.depositsHeld", { amount: formatRM(d.depositsHeldSen) })} help={t("dashboard.overdueHelp")} />
    </div>
  );
}

export default function DashboardPage() {
  const today = useToday();
  const currentMonth = monthOf(today);
  const [month, setMonth] = useState<YearMonth>(currentMonth);
  useEffect(() => setMonth(currentMonth), [currentMonth]);
  const summary = useApi("dashboard.summary", { month });
  const properties = useApi("properties.list", { includeArchived: false });
  const actions = useActions();

  if (summary.error) return <LoadError message={summary.error} onRetry={summary.reload} />;
  if (!summary.data || !properties.data) return <Loading />;
  const d = summary.data;

  if (properties.data.length === 0) {
    return (
      <>
        <PageHeader title={greeting()} subtitle={t("dashboard.todayIs", { date: formatDateLong(d.today) })} />
        <Welcome />
      </>
    );
  }

  const backupDue = !d.lastLocalBackupAt || daysBetween(d.lastLocalBackupAt.slice(0, 10), d.today) > 30;

  return (
    <>
      <PageHeader
        title={greeting()}
        subtitle={t("dashboard.todayIs", { date: formatDateLong(d.today) })}
        actions={<MonthSwitcher value={month} onChange={setMonth} current={currentMonth} label={t("dashboard.monthLabel")} />}
      />
      <div className="space-y-6">
        {backupDue && (
          <Notice tone="warn" action={<LinkButton href="/settings?tab=storage&do=backup" size="sm">{t("dashboard.actionBackup")}</LinkButton>}>
            <strong className="font-semibold">{d.lastLocalBackupAt ? t("dashboard.lastBackup", { when: formatTimestamp(d.lastLocalBackupAt) }) : t("dashboard.neverBackedUp")}.</strong>{" "}
            {t("dashboard.backupReminder")}
          </Notice>
        )}
        <Figures d={d} />
        <QuickActions />

        <div className="grid gap-4 xl:grid-cols-2">
          <ShortStaysTodayCard today={d.today} />
          {d.needsAttention.length > 0 && (
            <Card title={t("dashboard.attention")} className="xl:col-span-2">
              <ul className="-mx-3 -my-2">
                {d.needsAttention.map((x) => (
                  <TenancyLink key={x.id} tenancy={x} detail={<OverdueFlag>{x.needsMoveOut ? t("dashboard.attentionMoveOut", { date: formatDate(x.endDate) }) : t("dashboard.attentionMoveIn", { date: formatDate(x.startDate) })}</OverdueFlag>} />
                ))}
              </ul>
            </Card>
          )}
          <Card title={t("dashboard.endingSoon")}>
            {d.endingSoon.length === 0 ? (
              <p className="text-[13.5px] text-ink-3">{t("dashboard.endingSoonEmpty")}</p>
            ) : (
              <ul className="-mx-3 -my-2">
                {d.endingSoon.map((x) => (
                  <TenancyLink key={x.id} tenancy={x} showStatus={false} detail={<>{t("dashboard.endsOn", { date: formatDate(x.endDate) })} · {formatRelativeDay(x.endDate!, d.today)}</>} />
                ))}
              </ul>
            )}
          </Card>
          <Card
            title={t("dashboard.maintenance")}
            actions={
              <Link href="/maintenance" className="text-[13px] font-medium text-brass-bright hover:underline">
                {t("dashboard.maintenanceViewAll")}
              </Link>
            }
          >
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              {[
                { label: t("dashboard.maintenanceOpen"), n: d.maintenance.open, href: "/maintenance" },
                { label: t("dashboard.maintenanceOverdue"), n: d.maintenance.overdue, href: "/maintenance?overdue=1", critical: d.maintenance.overdue > 0 },
                { label: t("dashboard.maintenanceUrgent"), n: d.maintenance.urgent, href: "/maintenance?priority=critical", critical: d.maintenance.urgent > 0 },
              ].map((s) => (
                <Link key={s.label} href={s.href} className="rounded-lg bg-surface-2 px-2 py-3 hover:bg-surface-3">
                  <div className={`tnum font-display text-[24px] font-light ${s.critical ? "text-[#ff9d95]" : ""}`}>{s.n}</div>
                  <div className="text-[12px] text-ink-3">{s.label}</div>
                </Link>
              ))}
            </div>
            {d.maintenance.top.length === 0 ? (
              <p className="text-[13.5px] text-ink-3">{t("dashboard.maintenanceEmpty")}</p>
            ) : (
              <ul className="-mx-3">
                {d.maintenance.top.map((m) => (
                  <li key={m.id}>
                    <Link href={`/maintenance/view?id=${m.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{m.title}</div>
                        <div className="truncate text-[12px] text-ink-3">
                          {m.ref} · {m.propertyName}
                          {m.spacePath ? ` · ${m.spacePath}` : ""}
                          {m.dueDate ? " · " : ""}
                          {m.dueDate && (m.overdue ? <OverdueFlag>{t("maintenance.dueOn", { date: formatDate(m.dueDate) })}</OverdueFlag> : t("maintenance.dueOn", { date: formatDate(m.dueDate) }))}
                        </div>
                      </div>
                      <PriorityPill priority={m.priority} />
                      <MaintenanceStatusPill status={m.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Button size="sm" className="mt-3" onClick={() => actions.newMaintenance()} icon={<Icon name="plus" size={14} />}>
              {t("maintenance.new")}
            </Button>
          </Card>
          <Card title={t("dashboard.moveIns")}>
            {d.moveIns.length === 0 ? (
              <p className="text-[13.5px] text-ink-3">{t("dashboard.moveInsEmpty")}</p>
            ) : (
              <ul className="-mx-3 -my-2">
                {d.moveIns.map((x) => (
                  <TenancyLink key={x.id} tenancy={x} showStatus={false} detail={<>{t("dashboard.startsOn", { date: formatDate(x.startDate) })} · {formatRelativeDay(x.startDate, d.today)}</>} />
                ))}
              </ul>
            )}
          </Card>
          <Card title={t("dashboard.moveOuts")}>
            {d.moveOuts.length === 0 ? (
              <p className="text-[13.5px] text-ink-3">{t("dashboard.moveOutsEmpty")}</p>
            ) : (
              <ul className="-mx-3 -my-2">
                {d.moveOuts.map((x) => (
                  <TenancyLink key={x.id} tenancy={x} showStatus={false} detail={<>{t("dashboard.endsOn", { date: formatDate(x.endDate) })} · {formatRelativeDay(x.endDate!, d.today)}</>} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title={t("nav.properties")} actions={<Link href="/properties" className="text-[13px] font-medium text-brass-bright hover:underline">{t("common.view")}</Link>}>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {properties.data.map((p) => (
              <li key={p.id}>
                <Link href={`/properties/view?id=${p.id}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md">
                    <PropertyCover cover={p.cover} type={p.propertyType} name={p.name} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{p.name}</div>
                    <div className="mb-1.5 truncate text-[12px] text-ink-3">{p.lettable ? t("properties.occupancy", { occupied: p.occupied, total: p.lettable }) : t("properties.noLettable")}</div>
                    <OccupancyMeter value={p.occupied} total={p.lettable} label={`${t("dashboard.occupancy")} — ${p.name}`} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
