// Native building blocks in the desktop app's visual language (charcoal,
// brass, Fraunces for figures) for screens redesigned natively.
import { Fraunces_300Light, Fraunces_400Regular, useFonts } from "@expo-google-fonts/fraunces";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "./theme";

export function useBrandFonts() {
  const [loaded] = useFonts({ Fraunces_300Light, Fraunces_400Regular });
  return loaded;
}

export const display = (loaded: boolean) => (loaded ? "Fraunces_300Light" : undefined);

export function Card({ title, action, children, style }: { title?: string; action?: { label: string; href: Href }; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.card, style]}>
      {(title || action) && (
        <View style={styles.cardHeader}>
          {title && <Text style={styles.cardTitle}>{title}</Text>}
          {action && (
            <Pressable hitSlop={8} onPress={() => router.push(action.href)}>
              <Text style={styles.cardAction}>{action.label}</Text>
            </Pressable>
          )}
        </View>
      )}
      {children}
    </View>
  );
}

export function Microlabel({ children }: { children: string }) {
  return <Text style={styles.microlabel}>{children.toUpperCase()}</Text>;
}

export function Figure({ value, tone, fonts, size = 30 }: { value: string; tone?: "critical" | "good"; fonts: boolean; size?: number }) {
  return (
    <Text
      adjustsFontSizeToFit
      numberOfLines={1}
      style={[styles.figure, { fontSize: size, fontFamily: display(fonts) }, tone === "critical" && { color: "#ff9d95" }, tone === "good" && { color: colors.good }]}
    >
      {value}
    </Text>
  );
}

export function Meter({ value, total, color = colors.gold }: { value: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <View style={styles.meter} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={[styles.meterFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Row({
  title,
  subtitle,
  detail,
  trailing,
  href,
  leading,
  last,
}: {
  title: string;
  subtitle?: string;
  detail?: ReactNode;
  trailing?: ReactNode;
  href?: Href;
  leading?: ReactNode;
  last?: boolean;
}) {
  const content = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.rowSubtitle}>
            {subtitle}
          </Text>
        ) : null}
        {detail}
      </View>
      {trailing}
      {href && <SymbolView name="chevron.right" size={13} tintColor={colors.ink3} />}
    </View>
  );
  if (!href) return content;
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        router.push(href);
      }}
      style={({ pressed }) => pressed && { backgroundColor: colors.surface2 }}
    >
      {content}
    </Pressable>
  );
}

export function Pill({ label, tone = "neutral", icon }: { label: string; tone?: "neutral" | "warn" | "critical" | "good" | "info"; icon?: SFSymbol }) {
  const color = { neutral: colors.ink2, warn: colors.warn, critical: colors.critical, good: colors.good, info: colors.info }[tone];
  return (
    <View style={[styles.pill, { borderColor: color + "55", backgroundColor: color + "18" }]}>
      {icon && <SymbolView name={icon} size={10} tintColor={color} />}
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function Counter({ n, label, critical, href, fonts }: { n: number; label: string; critical?: boolean; href: Href; fonts: boolean }) {
  return (
    <Pressable
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.counter, pressed && { backgroundColor: colors.surface3 }]}
      accessibilityRole="button"
      accessibilityLabel={`${n} ${label}`}
    >
      <Text style={[styles.counterValue, { fontFamily: display(fonts) }, critical && n > 0 && { color: "#ff9d95" }]}>{n}</Text>
      <Text style={styles.counterLabel}>{label}</Text>
    </Pressable>
  );
}

export function Thumb({ uri, icon, size = { width: 64, height: 46 } }: { uri?: string | null; icon: SFSymbol; size?: { width: number; height: number } }) {
  return (
    <View style={[styles.thumb, size]}>
      {uri && uri.startsWith("data:") ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : (
        <SymbolView name={icon} size={20} tintColor={colors.brass} />
      )}
    </View>
  );
}

export function Muted({ children }: { children: string }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.brass} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 32, backgroundColor: colors.bg }}>
      <Text style={{ color: colors.ink2, fontSize: 15, textAlign: "center" }}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.button}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(245,244,240,0.12)",
    overflow: "hidden",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  cardAction: { color: colors.brassBright, fontSize: 14, fontWeight: "500" },
  microlabel: { color: colors.ink3, fontSize: 11, fontWeight: "600", letterSpacing: 1.1 },
  figure: { color: colors.ink, letterSpacing: -0.5, marginTop: 6, fontVariant: ["tabular-nums"] },
  meter: { height: 6, borderRadius: 3, backgroundColor: "rgba(245,244,240,0.14)", overflow: "hidden", marginTop: 10 },
  meterFill: { height: "100%", borderRadius: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 52 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: "500" },
  rowSubtitle: { color: colors.ink3, fontSize: 13, marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  pillText: { fontSize: 11.5, fontWeight: "600" },
  counter: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.surface2 },
  counterValue: { color: colors.ink, fontSize: 26, fontVariant: ["tabular-nums"] },
  counterLabel: { color: colors.ink3, fontSize: 12, marginTop: 2 },
  thumb: { borderRadius: 8, borderCurve: "continuous", backgroundColor: colors.surface2, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  muted: { color: colors.ink3, fontSize: 14, paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4 },
  button: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, borderCurve: "continuous", backgroundColor: colors.surface2 },
  buttonText: { color: colors.brassBright, fontSize: 15, fontWeight: "600" },
});
