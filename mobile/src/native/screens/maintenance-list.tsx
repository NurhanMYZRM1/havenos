// Native redesign of app/(workspace)/maintenance/page.tsx: the table becomes
// a virtualized list, filters become a segmented control, a header search
// field and a native menu.
import { MenuView, type MenuAction } from "@expo/ui/community/menu";
import SegmentedControl from "@expo/ui/community/segmented-control";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import type { MaintenanceFilter, MaintenanceItem } from "@/lib/api/contract";
import { formatDate } from "@/lib/domain/format";
import { isOneOf, MAINTENANCE_PRIORITIES, type MaintenancePriority, type MaintenanceStatus } from "@/lib/domain/enums";
import { t, type MessageKey } from "@/lib/i18n";
import { colors } from "../theme";
import { ErrorState, Loading, Pill, styles as ui } from "../ui";
import { useCore } from "../use-core";

const SEGMENTS = ["open", "overdue", "all"] as const;
type Segment = (typeof SEGMENTS)[number];

const PRIORITY_TONE: Record<MaintenancePriority, "neutral" | "info" | "warn" | "critical"> = { low: "neutral", standard: "info", high: "warn", critical: "critical" };
const STATUS_TONE: Partial<Record<MaintenanceStatus, "neutral" | "info" | "warn" | "critical" | "good">> = {
  triage: "info",
  scheduled: "neutral",
  in_progress: "warn",
  blocked: "critical",
  done: "good",
};

function MaintenanceRow({ m }: { m: MaintenanceItem }) {
  const where = [m.propertyName, m.spacePath].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        router.push(`/maintenance/view?id=${m.id}`);
      }}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surface2 }]}
      accessibilityRole="button"
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={2} style={ui.rowTitle}>
          {m.title}
        </Text>
        <Text numberOfLines={1} style={ui.rowSubtitle}>
          {m.ref} · {where}
        </Text>
        <View style={s.pills}>
          <Pill label={t(`enums.maintenancePriority.${m.priority}` as MessageKey)} tone={PRIORITY_TONE[m.priority]} />
          <Pill label={t(`enums.maintenanceStatus.${m.status}` as MessageKey)} tone={STATUS_TONE[m.status] ?? "neutral"} />
          {m.dueDate && (
            <Text style={[s.due, m.overdue && { color: "#ff9d95" }]}>
              {m.overdue ? "⚠︎ " : ""}
              {t("maintenance.dueOn", { date: formatDate(m.dueDate) })}
            </Text>
          )}
          {m.photoCount > 0 && (
            <View style={s.photos}>
              <SymbolView name="photo" size={11} tintColor={colors.ink3} />
              <Text style={s.due}>{m.photoCount}</Text>
            </View>
          )}
        </View>
      </View>
      <SymbolView name="chevron.right" size={13} tintColor={colors.ink3} />
    </Pressable>
  );
}

export default function MaintenanceListScreen() {
  const params = useLocalSearchParams<{ overdue?: string; priority?: string; propertyId?: string }>();
  const [segment, setSegment] = useState<Segment>(params.overdue === "1" ? "overdue" : "open");
  const [query, setQuery] = useState("");
  const [propertyId, setPropertyId] = useState<string | null>(params.propertyId ?? null);
  const [priority, setPriority] = useState<MaintenancePriority | null>(isOneOf(MAINTENANCE_PRIORITIES, params.priority) ? params.priority : null);
  const [refreshing, setRefreshing] = useState(false);

  const filter: MaintenanceFilter = {
    propertyId,
    status: segment === "all" ? "all" : "open",
    priority,
    overdueOnly: segment === "overdue",
    query,
  };
  const list = useCore("maintenance.list", filter);
  const properties = useCore("properties.list", { includeArchived: true });

  const open = list.data?.filter((m) => m.status !== "done" && m.status !== "cancelled").length ?? 0;
  const overdue = list.data?.filter((m) => m.overdue).length ?? 0;

  const menu = useMemo<MenuAction[]>(
    () => [
      {
        id: "property",
        title: t("maintenance.filterProperty"),
        image: "building.2",
        subactions: [
          { id: "property:", title: t("maintenance.allProperties"), state: propertyId === null ? "on" : "off" },
          ...(properties.data ?? []).map((p) => ({ id: `property:${p.id}`, title: p.name, state: (propertyId === p.id ? "on" : "off") as "on" | "off" })),
        ],
      },
      {
        id: "priority",
        title: t("maintenance.filterPriority"),
        image: "flag",
        subactions: [
          { id: "priority:", title: t("maintenance.anyPriority"), state: priority === null ? "on" : "off" },
          ...MAINTENANCE_PRIORITIES.map((p) => ({ id: `priority:${p}`, title: t(`enums.maintenancePriority.${p}` as MessageKey), state: (priority === p ? "on" : "off") as "on" | "off" })),
        ],
      },
    ],
    [properties.data, propertyId, priority],
  );

  const onMenu = (id: string) => {
    void Haptics.selectionAsync();
    const [kind, value] = id.split(":");
    if (kind === "property") setPropertyId(value || null);
    if (kind === "priority") setPriority(isOneOf(MAINTENANCE_PRIORITIES, value) ? value : null);
  };

  const filtered = propertyId !== null || priority !== null;

  return (
    <>
      <Stack.Screen
        options={{
          title: t("maintenance.title"),
          headerLargeTitle: true,
          headerSearchBarOptions: {
            placeholder: t("maintenance.searchPlaceholder"),
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            hideWhenScrolling: true,
            tintColor: colors.brassBright,
            textColor: colors.ink,
          },
          headerLeft: () => (
            <MenuView actions={menu} onPressAction={(e) => onMenu(e.nativeEvent.event)} colorScheme="dark">
              <View style={{ paddingHorizontal: 6 }}>
                <SymbolView name={filtered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"} size={22} tintColor={colors.brassBright} />
              </View>
            </MenuView>
          ),
          headerRight: () => (
            <Pressable hitSlop={10} onPress={() => router.push(propertyId ? `/maintenance/new?propertyId=${propertyId}` : "/maintenance/new")} accessibilityLabel={t("maintenance.new")} style={{ paddingHorizontal: 6 }}>
              <SymbolView name="plus" size={20} tintColor={colors.brassBright} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentInsetAdjustmentBehavior="automatic"
        data={list.data ?? []}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MaintenanceRow m={item} />}
        ItemSeparatorComponent={() => <View style={s.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brass}
            onRefresh={async () => {
              setRefreshing(true);
              await list.reload();
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={
          <View style={s.header}>
            <SegmentedControl
              values={[t("maintenance.statusOpen"), t("maintenance.overdueOnly"), t("maintenance.statusAll")]}
              selectedIndex={SEGMENTS.indexOf(segment)}
              onChange={(e) => {
                void Haptics.selectionAsync();
                setSegment(SEGMENTS[e.nativeEvent.selectedSegmentIndex]);
              }}
              appearance="dark"
            />
            {list.data && <Text style={s.summary}>{t("maintenance.summary", { open, overdue })}</Text>}
          </View>
        }
        ListEmptyComponent={
          list.error ? (
            <ErrorState message={list.error} onRetry={() => void list.reload()} />
          ) : !list.data ? (
            <Loading />
          ) : (
            <View style={s.empty}>
              <SymbolView name="checkmark.seal" size={34} tintColor={colors.good} />
              <Text style={s.emptyText}>{t("maintenance.empty")}</Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      />
    </>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, gap: 10 },
  summary: { color: colors.ink3, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.bg },
  pills: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 },
  due: { color: colors.ink3, fontSize: 12 },
  photos: { flexDirection: "row", alignItems: "center", gap: 3 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: 16 },
  empty: { alignItems: "center", gap: 12, paddingTop: 80, paddingHorizontal: 32 },
  emptyText: { color: colors.ink2, fontSize: 15, textAlign: "center" },
});
