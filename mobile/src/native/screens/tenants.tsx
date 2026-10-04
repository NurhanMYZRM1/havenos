// Native redesign of app/(workspace)/tenants/page.tsx: tenancies and the
// tenant directory as lists, with native status filters and search.
import { MenuView } from "@expo/ui/community/menu";
import SegmentedControl from "@expo/ui/community/segmented-control";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Tenant, TenancyFilter, TenancySummary } from "@/lib/api/contract";
import type { TenancyStatus } from "@/lib/domain/enums";
import { formatDate } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";
import { t, type MessageKey } from "@/lib/i18n";
import { colors } from "../theme";
import { ErrorState, Loading, Pill, Row } from "../ui";
import { useCore } from "../use-core";

const FILTERS: TenancyFilter[] = ["current", "active", "expiring", "upcoming", "ended", "cancelled", "all"];
const STATUS_TONE: Record<TenancyStatus, "info" | "good" | "warn" | "neutral"> = {
  upcoming: "info",
  active: "good",
  expiring: "warn",
  ended: "neutral",
  cancelled: "neutral",
};

function balanceText(balanceSen: number, overdueSen: number) {
  if (overdueSen > 0) return { text: formatRM(balanceSen), tone: colors.critical };
  if (balanceSen < 0) return { text: t("tenants.inCredit", { amount: formatRM(-balanceSen) }), tone: colors.good };
  return { text: formatRM(balanceSen), tone: colors.ink2 };
}

function TenancyRow({ r, last }: { r: TenancySummary; last: boolean }) {
  const b = balanceText(r.balanceSen, r.overdueSen);
  return (
    <Row
      title={r.tenantName}
      subtitle={`${r.spacePath} · ${r.propertyName}`}
      detail={
        <View style={s.meta}>
          <Pill label={t(`enums.tenancyStatus.${r.status}` as MessageKey)} tone={STATUS_TONE[r.status]} />
          <Text style={s.metaText}>
            {formatDate(r.startDate)} – {r.endDate ? formatDate(r.endDate) : t("tenancies.noEnd")}
          </Text>
        </View>
      }
      trailing={
        <View style={{ alignItems: "flex-end" }}>
          <Text style={s.amount}>{formatRM(r.monthlyRentSen)}</Text>
          <Text style={[s.metaText, { color: b.tone }]}>{b.text}</Text>
        </View>
      }
      href={`/tenancies/view?id=${r.id}`}
      last={last}
    />
  );
}

function TenantRow({ x, last }: { x: Tenant; last: boolean }) {
  const balance =
    x.balanceSen > 0
      ? { text: t("tenants.owes", { amount: formatRM(x.balanceSen) }), tone: colors.critical }
      : x.balanceSen < 0
        ? { text: t("tenants.inCredit", { amount: formatRM(-x.balanceSen) }), tone: colors.good }
        : { text: t("tenants.settled"), tone: colors.ink3 };
  return (
    <Row
      title={x.fullName}
      subtitle={[formatPhone(x.phone), t("tenants.current", { n: x.currentTenancies })].filter(Boolean).join(" · ")}
      trailing={<Text style={[s.metaText, { color: balance.tone }]}>{balance.text}</Text>}
      href={`/tenants/view?id=${x.id}`}
      last={last}
    />
  );
}

function Tenancies() {
  const [filter, setFilter] = useState<TenancyFilter>("current");
  const list = useCore("tenancies.list", { filter, propertyId: null, tenantId: null });
  return (
    <FlatList
      style={{ flex: 1 }}
      data={list.data ?? []}
      keyExtractor={(r) => r.id}
      renderItem={({ item, index }) => <TenancyRow r={item} last={index === (list.data?.length ?? 0) - 1} />}
      contentContainerStyle={{ paddingBottom: 120 }}
      ListHeaderComponent={
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {FILTERS.map((f) => (
            <Pressable
              key={f}
              onPress={() => {
                void Haptics.selectionAsync();
                setFilter(f);
              }}
              style={[s.chip, filter === f && s.chipOn]}
              accessibilityState={{ selected: filter === f }}
            >
              <Text style={[s.chipText, filter === f && s.chipTextOn]}>{t(`tenants.filters.${f}` as MessageKey)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      }
      ListEmptyComponent={
        list.error ? (
          <ErrorState message={list.error} onRetry={() => void list.reload()} />
        ) : !list.data ? (
          <Loading />
        ) : (
          <Text style={s.empty}>{t("tenants.emptyTenancies")}</Text>
        )
      }
    />
  );
}

function Directory({ query }: { query: string }) {
  const list = useCore("tenants.list", { query });
  return (
    <FlatList
      style={{ flex: 1 }}
      data={list.data ?? []}
      keyExtractor={(x) => x.id}
      renderItem={({ item, index }) => <TenantRow x={item} last={index === (list.data?.length ?? 0) - 1} />}
      contentContainerStyle={{ paddingBottom: 120 }}
      ListEmptyComponent={
        list.error ? (
          <ErrorState message={list.error} onRetry={() => void list.reload()} />
        ) : !list.data ? (
          <Loading />
        ) : (
          <Text style={s.empty}>{t("tenants.empty")}</Text>
        )
      }
    />
  );
}

export default function TenantsScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<"tenancies" | "directory">(params.tab === "directory" ? "directory" : "tenancies");
  const [query, setQuery] = useState("");
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: t("tenants.title"),
          headerSearchBarOptions:
            tab === "directory"
              ? { placeholder: t("tenants.searchPlaceholder"), onChangeText: (e) => setQuery(e.nativeEvent.text), tintColor: colors.brassBright, textColor: colors.ink }
              : undefined,
          headerRight: () => (
            <MenuView
              colorScheme="dark"
              actions={[
                { id: "tenancy", title: t("tenants.newTenancy"), image: "key" },
                { id: "tenant", title: t("tenants.addTenant"), image: "person.badge.plus" },
              ]}
              onPressAction={(e) => {
                void Haptics.selectionAsync();
                router.push(e.nativeEvent.event === "tenant" ? "/tenants/new" : "/tenancies/new");
              }}
            >
              <View style={{ paddingHorizontal: 6 }} accessibilityLabel={t("tenants.newTenancy")}>
                <SymbolView name="plus" size={20} tintColor={colors.brassBright} />
              </View>
            </MenuView>
          ),
        }}
      />
      <View style={s.segments}>
        <SegmentedControl
          values={[t("tenants.tabs.tenancies"), t("tenants.tabs.directory")]}
          selectedIndex={tab === "tenancies" ? 0 : 1}
          onChange={(e) => {
            void Haptics.selectionAsync();
            setTab(e.nativeEvent.selectedSegmentIndex === 0 ? "tenancies" : "directory");
          }}
          appearance="dark"
        />
      </View>
      {tab === "tenancies" ? <Tenancies /> : <Directory query={query} />}
    </View>
  );
}

const s = StyleSheet.create({
  segments: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface2 },
  chipOn: { backgroundColor: colors.brass },
  chipText: { color: colors.ink2, fontSize: 14, fontWeight: "600" },
  chipTextOn: { color: colors.bg },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" },
  metaText: { color: colors.ink3, fontSize: 12.5 },
  amount: { color: colors.ink, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  empty: { color: colors.ink3, fontSize: 15, textAlign: "center", paddingTop: 60, paddingHorizontal: 32 },
});
