import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { addMonthsToMonth, type YearMonth } from "@/lib/domain/dates";
import { formatMonth } from "@/lib/domain/format";
import { colors } from "./theme";

export function MonthSwitcher({ month, onChange }: { month: YearMonth; onChange: (m: YearMonth) => void }) {
  const step = (n: number) => {
    void Haptics.selectionAsync();
    onChange(addMonthsToMonth(month, n));
  };
  return (
    <View style={s.row}>
      <Pressable hitSlop={10} onPress={() => step(-1)} accessibilityLabel="Previous month" style={s.button}>
        <SymbolView name="chevron.left" size={15} tintColor={colors.ink2} />
      </Pressable>
      <Text style={s.label}>{formatMonth(month)}</Text>
      <Pressable hitSlop={10} onPress={() => step(1)} accessibilityLabel="Next month" style={s.button}>
        <SymbolView name="chevron.right" size={15} tintColor={colors.ink2} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  button: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 },
  label: { color: colors.ink, fontSize: 16, fontWeight: "600", minWidth: 130, textAlign: "center" },
});
