// Native redesign of app/(workspace)/stays/page.tsx. Today and Turnovers are
// native lists; the booking calendar and the money charts stay as the
// desktop's web views (a native shell around web sub-trees).
import { MenuView } from "@expo/ui/community/menu";
import SegmentedControl from "@expo/ui/community/segmented-control";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ReservationSummary, TurnoverFilter, TurnoverItem } from "@/lib/api/contract";
import { channelLabel, formatClock, formatHours, guestDisplay, nightsLabel } from "@/components/stays/format";
import { addDays, todayInMalaysia, type IsoDate } from "@/lib/domain/dates";
import { formatDate, formatDateLong } from "@/lib/domain/format";
import { t, type MessageKey } from "@/lib/i18n";
import StaysCalendar from "~/dom/pages/stays-calendar";
import StaysPerformance from "~/dom/pages/stays-performance";
import { useDomProps } from "../dom-props";
import { alertMessage, stayHref } from "../stays";
import { colors } from "../theme";
import { Card, ErrorState, Loading, Muted, Pill, Row } from "../ui";
import { useCore } from "../use-core";

const TABS = ["today", "calendar", "turnovers", "performance"] as const;
type Tab = (typeof TABS)[number];

function ReservationRows({ items, detail }: { items: ReservationSummary[]; detail: (r: ReservationSummary) => string | null }) {
  return (
    <>
      {items.map((r, i) => (
        <Row
          key={r.id}
          title={guestDisplay(r)}
          subtitle={[r.spacePath, r.propertyName, `${channelLabel(r.channel)}${r.channelReservationId ? ` ${r.channelReservationId}` : ""}`, nightsLabel(r.nights), detail(r)].filter(Boolean).join(" · ")}
          trailing={r.missingSince ? <Pill label={t("shortStays.reservation.missingTitle", { channel: channelLabel(r.channel) }).replace(/\.$/, "")} tone="warn" /> : undefined}
          href={`/stays/reservation?id=${r.id}`}
          last={i === items.length - 1}
        />
      ))}
    </>
  );
}

function TurnoverRows({ items }: { items: TurnoverItem[] }) {
  return (
    <>
      {items.map((tv, i) => (
        <Row
          key={tv.id}
          title={`${tv.spacePath} · ${tv.propertyName}`}
          subtitle={[
            t("shortStays.today.checkOutAt", { time: formatClock(tv.checkoutTime) }),
            formatDate(tv.dueDate),
            tv.nextCheckIn
              ? `${t("shortStays.turnover.nextCheckIn")}: ${formatDate(tv.nextCheckIn.date)}${tv.windowHours !== null ? ` (${t("shortStays.turnovers.window", { time: formatHours(tv.windowHours) })})` : ""}`
              : t("shortStays.turnover.noNext"),
            tv.assigneeName || null,
          ]
            .filter(Boolean)
            .join(" · ")}
          trailing={
            tv.late ? (
              <Pill label={t("shortStays.turnover.late")} tone="critical" />
            ) : (
              <Pill label={t(`shortStays.enums.turnoverStatus.${tv.status}` as MessageKey)} tone={tv.status === "done" ? "good" : tv.unassigned ? "warn" : "neutral"} />
            )
          }
          href={`/stays/turnover?id=${tv.id}`}
          last={i === items.length - 1}
        />
      ))}
    </>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <Card title={`${title}  ${count}`}>
      {count === 0 ? <Muted>{empty}</Muted> : children}
    </Card>
  );
}

function DaySwitcher({ date, today, onChange }: { date: IsoDate; today: IsoDate; onChange: (d: IsoDate) => void }) {
  const step = (n: number) => {
    void Haptics.selectionAsync();
    onChange(addDays(date, n));
  };
  return (
    <View style={s.dayRow}>
      <Pressable hitSlop={10} onPress={() => step(-1)} style={s.dayButton} accessibilityLabel="Previous day">
        <SymbolView name="chevron.left" size={15} tintColor={colors.ink2} />
      </Pressable>
      <Text style={s.dayLabel}>{date === today ? t("shortStays.tabs.today") : formatDateLong(date)}</Text>
      <Pressable hitSlop={10} onPress={() => step(1)} style={s.dayButton} accessibilityLabel="Next day">
        <SymbolView name="chevron.right" size={15} tintColor={colors.ink2} />
      </Pressable>
      {date !== today && (
        <Pressable onPress={() => onChange(today)} hitSlop={6}>
          <Text style={s.todayLink}>{t("shortStays.tabs.today")}</Text>
        </Pressable>
      )}
    </View>
  );
}

function TodayView() {
  const today = todayInMalaysia();
  const [date, setDate] = useState<IsoDate>(today);
  const day = useCore("stays.day", { date });
  const [refreshing, setRefreshing] = useState(false);
  if (day.error) return <ErrorState message={day.error} onRetry={() => void day.reload()} />;
  if (!day.data) return <Loading />;
  const d = day.data;
  const quiet = d.arrivals.length + d.departures.length + d.inHouse.length + d.turnovers.length + d.maintenance.length === 0;
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.brass}
          onRefresh={async () => {
            setRefreshing(true);
            await day.reload();
            setRefreshing(false);
          }}
        />
      }
    >
      <DaySwitcher date={date} today={today} onChange={setDate} />
      <Pressable onPress={() => router.push("/settings/channels")} style={s.banner}>
        <SymbolView name="calendar.badge.clock" size={18} tintColor={d.channels.failing ? colors.critical : d.channels.total ? colors.good : colors.info} />
        <Text style={s.bannerText}>
          {d.channels.total === 0
            ? t("shortStays.banner.noneTitle")
            : `${t("shortStays.banner.summary", { active: d.channels.active, total: d.channels.total })}${d.channels.failing ? ` · ${t("shortStays.banner.failing", { n: d.channels.failing })}` : ""}${d.channels.stale ? ` · ${t("shortStays.banner.stale", { n: d.channels.stale })}` : ""}`}
        </Text>
        <SymbolView name="chevron.right" size={13} tintColor={colors.ink3} />
      </Pressable>
      <Card title={t("shortStays.alerts.title")}>
        {d.alerts.length === 0 ? (
          <Muted>{t("shortStays.alerts.empty")}</Muted>
        ) : (
          d.alerts.map((a, i) => (
            <Row
              key={a.id}
              title={alertMessage(a)}
              leading={<SymbolView name={a.severity === "info" ? "info.circle" : "exclamationmark.triangle"} size={16} tintColor={a.severity === "critical" ? colors.critical : a.severity === "warning" ? colors.warn : colors.info} />}
              href={stayHref(a.href) as Href}
              last={i === d.alerts.length - 1}
            />
          ))
        )}
      </Card>
      {quiet ? (
        <Card>
          <Muted>{t("shortStays.dashboard.quiet")}</Muted>
        </Card>
      ) : (
        <>
          <Section title={t("shortStays.today.arrivals")} count={d.arrivals.length} empty={t("shortStays.today.arrivalsEmpty")}>
            <ReservationRows items={d.arrivals} detail={(r) => (r.checkInTime ? t("shortStays.today.checkInAt", { time: formatClock(r.checkInTime) }) : null)} />
          </Section>
          <Section title={t("shortStays.today.departures")} count={d.departures.length} empty={t("shortStays.today.departuresEmpty")}>
            <ReservationRows items={d.departures} detail={(r) => (r.checkOutTime ? t("shortStays.today.checkOutAt", { time: formatClock(r.checkOutTime) }) : null)} />
          </Section>
          <Section title={t("shortStays.today.turnovers")} count={d.turnovers.length} empty={t("shortStays.today.turnoversEmpty")}>
            <TurnoverRows items={d.turnovers} />
          </Section>
          <Section title={t("shortStays.today.inHouse")} count={d.inHouse.length} empty={t("shortStays.today.inHouseEmpty")}>
            <ReservationRows items={d.inHouse} detail={(r) => t("shortStays.today.untilDate", { date: formatDate(r.checkOut) })} />
          </Section>
          <Section title={t("shortStays.today.maintenance")} count={d.maintenance.length} empty={t("shortStays.today.maintenanceEmpty")}>
            {d.maintenance.map((m, i) => (
              <Row key={m.id} title={m.title} subtitle={`${m.ref} · ${m.propertyName}${m.spacePath ? ` · ${m.spacePath}` : ""}`} href={`/maintenance/view?id=${m.id}`} last={i === d.maintenance.length - 1} />
            ))}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function TurnoversView() {
  const [status, setStatus] = useState<TurnoverFilter["status"]>("open");
  const list = useCore("turnovers.list", { from: null, to: null, status, propertyId: null });
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
      <View style={s.filterRow}>
        {(["open", "all"] as const).map((v) => (
          <Pressable key={v} onPress={() => setStatus(v)} style={[s.chip, status === v && s.chipOn]}>
            <Text style={[s.chipText, status === v && s.chipTextOn]}>{t(`shortStays.turnovers.${v}` as MessageKey)}</Text>
          </Pressable>
        ))}
      </View>
      {list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <Card>{list.data.length === 0 ? <Muted>{t("shortStays.turnovers.empty")}</Muted> : <TurnoverRows items={list.data} />}</Card>
      )}
    </ScrollView>
  );
}

export default function StaysScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(TABS.includes(params.tab as Tab) ? (params.tab as Tab) : "today");
  const domProps = useDomProps();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: t("shortStays.title"),
          headerRight: () => (
            <MenuView
              colorScheme="dark"
              actions={[
                { id: "calendar", title: t("shortStays.actions.addReservation"), image: "plus" },
                { id: "connections", title: t("shortStays.actions.connections"), image: "calendar.badge.clock" },
              ]}
              onPressAction={(e) => {
                void Haptics.selectionAsync();
                if (e.nativeEvent.event === "connections") router.push("/settings/channels");
                else setTab("calendar");
              }}
            >
              <View style={{ paddingHorizontal: 6 }}>
                <SymbolView name="ellipsis.circle" size={20} tintColor={colors.brassBright} />
              </View>
            </MenuView>
          ),
        }}
      />
      <View style={s.segments}>
        <SegmentedControl
          values={TABS.map((v) => t(`shortStays.tabs.${v}` as MessageKey))}
          selectedIndex={TABS.indexOf(tab)}
          onChange={(e) => {
            void Haptics.selectionAsync();
            setTab(TABS[e.nativeEvent.selectedSegmentIndex]);
          }}
          appearance="dark"
        />
      </View>
      {tab === "today" && <TodayView />}
      {tab === "turnovers" && <TurnoversView />}
      {tab === "calendar" && <StaysCalendar {...domProps} />}
      {tab === "performance" && <StaysPerformance {...domProps} />}
    </View>
  );
}

const s = StyleSheet.create({
  segments: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 14, paddingTop: 4 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dayButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 },
  dayLabel: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  todayLink: { color: colors.brassBright, fontSize: 14, fontWeight: "600" },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.surface },
  bannerText: { flex: 1, color: colors.ink2, fontSize: 14 },
  filterRow: { flexDirection: "row", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface2 },
  chipOn: { backgroundColor: colors.brass },
  chipText: { color: colors.ink2, fontSize: 14, fontWeight: "600" },
  chipTextOn: { color: colors.bg },
});
