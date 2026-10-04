// Native redesign of app/(workspace)/dashboard/page.tsx: the same figures and
// lists from `dashboard.summary`, as a phone-first scroll with native header,
// pull-to-refresh and haptics.
import { MenuView } from "@expo/ui/community/menu";
import * as Haptics from "expo-haptics";
import { router, Stack, type Href } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DashboardSummary, TenancySummary } from "@/lib/api/contract";
import { monthOf, timestampParts, todayInMalaysia, type YearMonth } from "@/lib/domain/dates";
import { formatDate, formatDateLong, formatMonth, formatRelativeDay } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { t } from "@/lib/i18n";
import { call } from "~/core/host";
import { MonthSwitcher } from "../month-switcher";
import { alertMessage, stayHref } from "../stays";
import { colors } from "../theme";
import { Card, Counter, ErrorState, Figure, Loading, Meter, Microlabel, Muted, Pill, Row, Thumb, display, useBrandFonts } from "../ui";
import { useCore } from "../use-core";

function greeting(): string {
  const { hour } = timestampParts(new Date().toISOString());
  return hour < 12 ? t("dashboard.greetingMorning") : hour < 18 ? t("dashboard.greetingAfternoon") : t("dashboard.greetingEvening");
}

const QUICK_ACTIONS: { label: () => string; href: Href; icon: SFSymbol }[] = [
  { label: () => t("dashboard.actionRecordPayment"), href: "/rent/record", icon: "banknote" },
  { label: () => t("dashboard.actionLogMaintenance"), href: "/maintenance/new", icon: "wrench.and.screwdriver" },
  { label: () => t("dashboard.actionAddTenancy"), href: "/tenancies/new", icon: "key" },
  { label: () => t("dashboard.actionAddProperty"), href: "/onboarding", icon: "building.2" },
];

function Stat({ label, value, sub, tone, fonts, children }: { label: string; value: string; sub?: string; tone?: "critical" | "good"; fonts: boolean; children?: React.ReactNode }) {
  return (
    <View style={[s.stat]}>
      <Microlabel>{label}</Microlabel>
      <Figure value={value} tone={tone} fonts={fonts} size={26} />
      {sub ? (
        <Text style={s.statSub} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function Figures({ d, fonts }: { d: DashboardSummary; fonts: boolean }) {
  const k = d.occupancy.byKind;
  return (
    <View style={s.grid}>
      <Stat
        label={t("dashboard.occupancy")}
        value={t("dashboard.occupancyValue", { occupied: d.occupancy.occupied, total: d.occupancy.lettable })}
        sub={t("dashboard.occupancyBreakdown", { units: `${k.unit.occupied}/${k.unit.total}`, rooms: `${k.room.occupied}/${k.room.total}`, beds: `${k.bed.occupied}/${k.bed.total}` })}
        fonts={fonts}
      >
        <Meter value={d.occupancy.occupied} total={d.occupancy.lettable} />
      </Stat>
      <Stat label={t("dashboard.rentDue")} value={formatRM(d.rent.expectedSen)} sub={t("dashboard.outstanding", { amount: formatRM(d.rent.outstandingSen) })} fonts={fonts} />
      <Stat
        label={t("dashboard.collected")}
        value={formatRM(d.rent.collectedSen)}
        sub={t("dashboard.receivedInMonth", { amount: formatRM(d.rent.receivedInMonthSen), month: formatMonth(d.month) })}
        tone="good"
        fonts={fonts}
      >
        <Meter value={d.rent.collectedSen} total={d.rent.expectedSen} color={colors.good} />
      </Stat>
      <Stat
        label={t("dashboard.overdue")}
        value={formatRM(d.rent.overdueAllSen)}
        tone={d.rent.overdueAllSen > 0 ? "critical" : undefined}
        sub={t("dashboard.depositsHeld", { amount: formatRM(d.depositsHeldSen) })}
        fonts={fonts}
      />
    </View>
  );
}

function TenancyRows({ items, detail }: { items: TenancySummary[]; detail: (x: TenancySummary) => string }) {
  return (
    <>
      {items.map((x, i) => (
        <Row key={x.id} title={x.tenantName} subtitle={`${x.propertyName} · ${x.spacePath} · ${detail(x)}`} href={`/tenancies/view?id=${x.id}`} last={i === items.length - 1} />
      ))}
    </>
  );
}

function StaysToday({ today, fonts }: { today: string; fonts: boolean }) {
  const day = useCore("stays.day", { date: today });
  const d = day.data;
  if (!d) return null;
  const active = d.channels.total > 0 || d.arrivals.length + d.departures.length + d.inHouse.length + d.turnovers.length + d.alerts.length > 0;
  if (!active) return null;
  return (
    <Card title={t("shortStays.dashboard.title")} action={{ label: t("shortStays.dashboard.open"), href: "/stays" }}>
      <View style={s.counters}>
        <Counter n={d.arrivals.length} label={t("shortStays.dashboard.arrivals")} href="/stays?tab=today" fonts={fonts} />
        <Counter n={d.departures.length} label={t("shortStays.dashboard.departures")} href="/stays?tab=today" fonts={fonts} />
        <Counter n={d.turnovers.length} label={t("shortStays.dashboard.turnovers")} critical={d.turnovers.some((x) => x.late)} href="/stays?tab=turnovers" fonts={fonts} />
      </View>
      {d.alerts.slice(0, 3).map((a, i, all) => (
        <Row
          key={a.id}
          title={alertMessage(a)}
          leading={<SymbolView name={a.severity === "info" ? "info.circle" : "exclamationmark.triangle"} size={16} tintColor={a.severity === "critical" ? colors.critical : a.severity === "warning" ? colors.warn : colors.info} />}
          href={stayHref(a.href) as Href}
          last={i === all.length - 1}
        />
      ))}
      {d.alerts.length === 0 && <Muted>{d.arrivals.length + d.departures.length + d.turnovers.length === 0 ? t("shortStays.dashboard.quiet") : t("shortStays.alerts.empty")}</Muted>}
    </Card>
  );
}

function Welcome({ fonts }: { fonts: boolean }) {
  const [busy, setBusy] = useState(false);
  const openSample = async () => {
    setBusy(true);
    try {
      await call("workspace.switch", { workspace: "sample" });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ padding: 20, gap: 12 }}>
      <Text style={[s.welcomeTitle, { fontFamily: display(fonts) }]}>{t("dashboard.emptyTitle")}</Text>
      <Text style={s.welcomeBody}>{t("dashboard.emptyBody")}</Text>
      <Pressable style={[s.primary]} onPress={() => router.push("/onboarding")}>
        <Text style={s.primaryText}>{t("dashboard.emptyAdd")}</Text>
      </Pressable>
      <Pressable style={s.secondary} disabled={busy} onPress={() => void openSample()}>
        <Text style={s.secondaryText}>{t("dashboard.emptySample")}</Text>
      </Pressable>
      <Text style={s.help}>{t("dashboard.emptySampleHelp")}</Text>
    </Card>
  );
}

export default function DashboardScreen() {
  const fonts = useBrandFonts();
  const current = monthOf(todayInMalaysia());
  const [month, setMonth] = useState<YearMonth>(current);
  useEffect(() => setMonth(current), [current]);
  const summary = useCore("dashboard.summary", { month });
  const properties = useCore("properties.list", { includeArchived: false });
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([summary.reload(), properties.reload()]);
    setRefreshing(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const header = (
    <Stack.Screen
      options={{
        title: greeting(),
        headerLargeTitle: true,
        headerRight: () => (
          <MenuView
            colorScheme="dark"
            actions={QUICK_ACTIONS.map((a, i) => ({ id: String(i), title: a.label(), image: a.icon }))}
            onPressAction={(e) => {
              void Haptics.selectionAsync();
              router.push(QUICK_ACTIONS[Number(e.nativeEvent.event)].href);
            }}
          >
            <View style={{ paddingHorizontal: 6 }} accessibilityLabel={t("common.add")}>
              <SymbolView name="plus" size={20} tintColor={colors.brassBright} />
            </View>
          </MenuView>
        ),
      }}
    />
  );

  if (summary.error) return (<>{header}<ErrorState message={summary.error} onRetry={() => void summary.reload()} /></>);
  if (!summary.data || !properties.data) return (<>{header}<Loading /></>);
  const d = summary.data;

  return (
    <>
      {header}
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.brass} />}
      >
        <Text style={s.today}>{t("dashboard.todayIs", { date: formatDateLong(d.today) })}</Text>
        {properties.data.length === 0 ? (
          <Welcome fonts={fonts} />
        ) : (
          <>
            <MonthSwitcher month={month} onChange={setMonth} />
            <Figures d={d} fonts={fonts} />
            <StaysToday today={d.today} fonts={fonts} />
            {d.needsAttention.length > 0 && (
              <Card title={t("dashboard.attention")}>
                <TenancyRows items={d.needsAttention} detail={(x) => (x.needsMoveOut ? t("dashboard.attentionMoveOut", { date: formatDate(x.endDate) }) : t("dashboard.attentionMoveIn", { date: formatDate(x.startDate) }))} />
              </Card>
            )}
            <Card title={t("dashboard.maintenance")} action={{ label: t("dashboard.maintenanceViewAll"), href: "/maintenance" }}>
              <View style={s.counters}>
                <Counter n={d.maintenance.open} label={t("dashboard.maintenanceOpen")} href="/maintenance" fonts={fonts} />
                <Counter n={d.maintenance.overdue} label={t("dashboard.maintenanceOverdue")} critical href="/maintenance?overdue=1" fonts={fonts} />
                <Counter n={d.maintenance.urgent} label={t("dashboard.maintenanceUrgent")} critical href="/maintenance?priority=critical" fonts={fonts} />
              </View>
              {d.maintenance.top.length === 0 ? (
                <Muted>{t("dashboard.maintenanceEmpty")}</Muted>
              ) : (
                d.maintenance.top.map((m, i) => (
                  <Row
                    key={m.id}
                    title={m.title}
                    subtitle={`${m.ref} · ${m.propertyName}${m.spacePath ? ` · ${m.spacePath}` : ""}`}
                    trailing={m.overdue ? <Pill label={t("dashboard.maintenanceOverdue")} tone="critical" /> : undefined}
                    href={`/maintenance/view?id=${m.id}`}
                    last={i === d.maintenance.top.length - 1}
                  />
                ))
              )}
            </Card>
            <Card title={t("dashboard.endingSoon")}>
              {d.endingSoon.length === 0 ? (
                <Muted>{t("dashboard.endingSoonEmpty")}</Muted>
              ) : (
                <TenancyRows items={d.endingSoon} detail={(x) => `${t("dashboard.endsOn", { date: formatDate(x.endDate) })} · ${formatRelativeDay(x.endDate!, d.today)}`} />
              )}
            </Card>
            <Card title={t("dashboard.moveIns")}>
              {d.moveIns.length === 0 ? (
                <Muted>{t("dashboard.moveInsEmpty")}</Muted>
              ) : (
                <TenancyRows items={d.moveIns} detail={(x) => `${t("dashboard.startsOn", { date: formatDate(x.startDate) })} · ${formatRelativeDay(x.startDate, d.today)}`} />
              )}
            </Card>
            <Card title={t("dashboard.moveOuts")}>
              {d.moveOuts.length === 0 ? (
                <Muted>{t("dashboard.moveOutsEmpty")}</Muted>
              ) : (
                <TenancyRows items={d.moveOuts} detail={(x) => `${t("dashboard.endsOn", { date: formatDate(x.endDate) })} · ${formatRelativeDay(x.endDate!, d.today)}`} />
              )}
            </Card>
            <Card title={t("nav.properties")} action={{ label: t("common.view"), href: "/properties" }}>
              {properties.data.map((p, i) => (
                <Row
                  key={p.id}
                  title={p.name}
                  subtitle={t("dashboard.occupancyValue", { occupied: p.occupied, total: p.lettable })}
                  leading={<Thumb uri={p.cover?.thumbUrl} icon="building.2" />}
                  href={`/properties/view?id=${p.id}`}
                  last={i === properties.data!.length - 1}
                />
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 14 },
  today: { color: colors.ink2, fontSize: 15, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: 14,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(245,244,240,0.12)",
  },
  statSub: { color: colors.ink2, fontSize: 12.5, marginTop: 6 },
  counters: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  welcomeTitle: { color: colors.ink, fontSize: 30 },
  welcomeBody: { color: colors.ink2, fontSize: 15, lineHeight: 22 },
  primary: { backgroundColor: colors.ink, paddingVertical: 13, borderRadius: 12, borderCurve: "continuous", alignItems: "center" },
  primaryText: { color: colors.bg, fontSize: 16, fontWeight: "600" },
  secondary: { backgroundColor: colors.surface2, paddingVertical: 13, borderRadius: 12, borderCurve: "continuous", alignItems: "center" },
  secondaryText: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  help: { color: colors.ink3, fontSize: 12.5 },
});
