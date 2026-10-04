// Native redesign of app/(workspace)/properties/page.tsx: one card per
// property with its cover photo, address, letting arrangement and occupancy.
import { Host, Switch } from "@expo/ui";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { PropertySummary } from "@/lib/api/contract";
import { t, type MessageKey } from "@/lib/i18n";
import { colors } from "../theme";
import { ErrorState, Loading, Meter, Pill, display, useBrandFonts } from "../ui";
import { useCore } from "../use-core";

function PropertyCard({ p, fonts }: { p: PropertySummary; fonts: boolean }) {
  const cover = p.cover?.thumbUrl?.startsWith("data:") ? p.cover.thumbUrl : null;
  const mode = p.rentalModes.length === 1 ? t(`enums.rentalMode.${p.rentalModes[0]}` as MessageKey) : p.rentalModes.length ? t("properties.mixed") : "—";
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        router.push(`/properties/view?id=${p.id}`);
      }}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={p.name}
    >
      <View style={s.cover}>
        {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : <SymbolView name="building.2" size={34} tintColor={colors.brass} />}
        {p.archived && (
          <View style={s.archived}>
            <Text style={s.archivedText}>{t("common.archived")}</Text>
          </View>
        )}
      </View>
      <View style={s.body}>
        <Text style={[s.name, { fontFamily: display(fonts) }]} numberOfLines={2}>
          {p.name}
        </Text>
        <Text style={s.address} numberOfLines={1}>
          {p.addressLine1}, {p.postcode} {p.city} · {t(`enums.state.${p.state}` as MessageKey)}
        </Text>
        <View style={s.metaRow}>
          <Text style={s.meta} numberOfLines={1}>
            {t(`enums.propertyType.${p.propertyType}` as MessageKey)} · {mode}
          </Text>
          {p.openMaintenance > 0 && <Pill label={t("properties.openRequests", { n: p.openMaintenance })} tone="warn" icon="wrench.and.screwdriver" />}
        </View>
        <Text style={s.occupancy}>{p.lettable ? t("properties.occupancy", { occupied: p.occupied, total: p.lettable }) : t("properties.noLettable")}</Text>
        <Meter value={p.occupied} total={p.lettable} />
      </View>
    </Pressable>
  );
}

export default function PropertiesScreen() {
  const fonts = useBrandFonts();
  const [showArchived, setShowArchived] = useState(false);
  const list = useCore("properties.list", { includeArchived: showArchived });

  return (
    <>
      <Stack.Screen
        options={{
          title: t("properties.title"),
          headerRight: () => (
            <Pressable hitSlop={10} onPress={() => router.push("/onboarding")} accessibilityLabel={t("properties.add")} style={{ paddingHorizontal: 6 }}>
              <SymbolView name="plus" size={20} tintColor={colors.brassBright} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentInsetAdjustmentBehavior="automatic"
        data={list.data ?? []}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PropertyCard p={item} fonts={fonts} />}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <View style={s.header}>
            <Text style={s.subtitle}>{t("properties.subtitle")}</Text>
            <View style={s.toggleRow}>
              <Text style={s.toggleLabel}>{t("common.showArchived")}</Text>
              <Host matchContents>
                <Switch value={showArchived} onValueChange={setShowArchived} />
              </Host>
            </View>
          </View>
        }
        ListEmptyComponent={
          list.error ? (
            <ErrorState message={list.error} onRetry={() => void list.reload()} />
          ) : !list.data ? (
            <Loading />
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>{t("properties.empty")}</Text>
              <Text style={s.emptyBody}>{t("properties.emptyBody")}</Text>
              <Pressable style={s.primary} onPress={() => router.push("/onboarding")}>
                <Text style={s.primaryText}>{t("properties.add")}</Text>
              </Pressable>
            </View>
          )
        }
      />
    </>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 14 },
  header: { gap: 12, paddingTop: 4 },
  subtitle: { color: colors.ink2, fontSize: 15 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  toggleLabel: { color: colors.ink, fontSize: 15 },
  card: { borderRadius: 18, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(245,244,240,0.12)" },
  cover: { height: 150, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  archived: { position: "absolute", left: 12, top: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(11,11,13,0.85)" },
  archivedText: { color: colors.ink2, fontSize: 12, fontWeight: "600" },
  body: { padding: 16, gap: 6 },
  name: { color: colors.ink, fontSize: 22 },
  address: { color: colors.ink3, fontSize: 13 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  meta: { color: colors.ink2, fontSize: 13.5, flexShrink: 1 },
  occupancy: { color: colors.ink3, fontSize: 12.5, marginTop: 6 },
  empty: { alignItems: "center", gap: 10, paddingTop: 60, paddingHorizontal: 24 },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: "600" },
  emptyBody: { color: colors.ink2, fontSize: 14.5, textAlign: "center", lineHeight: 20 },
  primary: { marginTop: 8, backgroundColor: colors.ink, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 12, borderCurve: "continuous" },
  primaryText: { color: colors.bg, fontSize: 16, fontWeight: "600" },
});
