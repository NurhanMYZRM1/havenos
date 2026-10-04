// Native redesign of app/(workspace)/rent/page.tsx: the month's totals, then
// charges and payments as lists instead of nine-column tables.
import { MenuView } from "@expo/ui/community/menu";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PaymentListItem, RentRow } from "@/lib/api/contract";
import { monthOf, todayInMalaysia, type YearMonth } from "@/lib/domain/dates";
import type { ChargeState, ExportDataset } from "@/lib/domain/enums";
import { formatDate } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { t, type MessageKey } from "@/lib/i18n";
import { call } from "~/core/host";
import { MonthSwitcher } from "../month-switcher";
import { colors } from "../theme";
import { Card, ErrorState, Figure, Loading, Microlabel, Muted, Pill, Row, useBrandFonts } from "../ui";
import { useCore } from "../use-core";

const CHARGE_TONE: Record<ChargeState, "good" | "info" | "neutral" | "critical"> = {
  paid: "good",
  part_paid: "info",
  due: "neutral",
  overdue: "critical",
  void: "neutral",
};

function Total({ label, value, tone, fonts }: { label: string; value: number; tone?: "critical" | "good"; fonts: boolean }) {
  return (
    <View style={s.total}>
      <Microlabel>{label}</Microlabel>
      <Figure value={formatRM(value)} tone={tone === "critical" && value <= 0 ? undefined : tone} fonts={fonts} size={22} />
    </View>
  );
}

function ChargeRow({ r, canPay, last }: { r: RentRow; canPay: boolean; last: boolean }) {
  return (
    <Row
      title={r.tenantName}
      subtitle={`${r.spacePath} · ${r.propertyName}`}
      detail={
        <View style={s.chargeMeta}>
          <Pill label={t(`enums.chargeState.${r.state}` as MessageKey)} tone={CHARGE_TONE[r.state]} />
          <Text style={s.metaText}>
            {r.description} · {t("rent.due")} {formatDate(r.dueDate)}
          </Text>
        </View>
      }
      trailing={
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={s.amount}>{formatRM(r.balanceSen > 0 ? r.balanceSen : r.amountSen)}</Text>
          {canPay ? (
            <Pressable
              hitSlop={6}
              onPress={() => {
                void Haptics.selectionAsync();
                router.push(`/rent/record?tenancyId=${r.tenancyId}`);
              }}
              style={s.payButton}
              accessibilityLabel={`${t("rent.recordPayment")}, ${r.tenantName}`}
            >
              <Text style={s.payText}>{t("rent.recordPayment")}</Text>
            </Pressable>
          ) : (
            <Text style={s.metaText}>
              {t("rent.paid")} {formatRM(r.paidSen)}
            </Text>
          )}
        </View>
      }
      href={`/tenancies/view?id=${r.tenancyId}`}
      last={last}
    />
  );
}

function PaymentRow({ p, last }: { p: PaymentListItem; last: boolean }) {
  return (
    <Row
      title={`${p.receiptNo} · ${p.tenantName}`}
      subtitle={`${formatDate(p.receivedOn)} · ${t(`enums.paymentMethod.${p.method}` as MessageKey)}${p.reference ? ` · ${p.reference}` : ""}`}
      trailing={
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[s.amount, p.voided && s.voided]}>{formatRM(p.amountSen)}</Text>
          {p.voided && <Text style={s.metaText}>{t("rent.voided")}</Text>}
        </View>
      }
      href={`/receipt?id=${p.id}`}
      last={last}
    />
  );
}

export default function RentScreen() {
  const fonts = useBrandFonts();
  const current = monthOf(todayInMalaysia());
  const [month, setMonth] = useState<YearMonth>(current);
  useEffect(() => setMonth(current), [current]);
  const view = useCore("rent.month", { month });
  const [refreshing, setRefreshing] = useState(false);

  const exportCsv = async (dataset: ExportDataset) => {
    await call("export.dataset", { dataset });
  };

  const header = (
    <Stack.Screen
      options={{
        title: t("rent.title"),
        headerLargeTitle: true,
        headerRight: () => (
          <MenuView
            colorScheme="dark"
            actions={[
              { id: "record", title: t("rent.recordPayment"), image: "banknote" },
              { id: "payments", title: t("rent.exportPayments"), image: "square.and.arrow.up" },
              { id: "charges", title: t("rent.exportCharges"), image: "square.and.arrow.up" },
            ]}
            onPressAction={(e) => {
              void Haptics.selectionAsync();
              const id = e.nativeEvent.event;
              if (id === "record") router.push("/rent/record");
              else void exportCsv(id as ExportDataset);
            }}
          >
            <View style={{ paddingHorizontal: 6 }} accessibilityLabel={t("rent.recordPayment")}>
              <SymbolView name="plus" size={20} tintColor={colors.brassBright} />
            </View>
          </MenuView>
        ),
      }}
    />
  );

  if (view.error) return (<>{header}<ErrorState message={view.error} onRetry={() => void view.reload()} /></>);
  if (!view.data) return (<>{header}<Loading /></>);
  const d = view.data;

  return (
    <>
      {header}
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brass}
            onRefresh={async () => {
              setRefreshing(true);
              await view.reload();
              setRefreshing(false);
            }}
          />
        }
      >
        <Text style={s.subtitle}>{t("rent.subtitle")}</Text>
        <MonthSwitcher month={month} onChange={setMonth} />
        {d.projected && (
          <View style={s.notice}>
            <SymbolView name="info.circle" size={16} tintColor={colors.info} />
            <Text style={s.noticeText}>{t("rent.projected")}</Text>
          </View>
        )}
        <View style={s.grid}>
          <Total label={t("rent.expected")} value={d.totals.expectedSen} fonts={fonts} />
          <Total label={t("rent.collected")} value={d.totals.collectedSen} tone="good" fonts={fonts} />
          <Total label={t("rent.outstanding")} value={d.totals.outstandingSen} fonts={fonts} />
          <Total label={t("rent.overdue")} value={d.totals.overdueSen} tone="critical" fonts={fonts} />
          <Total label={t("rent.receivedInMonth")} value={d.totals.receivedInMonthSen} fonts={fonts} />
        </View>
        <Card title={t("rent.rowsTitle")}>
          {d.rows.length === 0 ? (
            <Muted>{t("rent.rowsEmpty")}</Muted>
          ) : (
            d.rows.map((r, i) => <ChargeRow key={r.chargeId ?? `p-${r.tenancyId}-${i}`} r={r} canPay={r.balanceSen > 0 && !d.projected} last={i === d.rows.length - 1} />)
          )}
        </Card>
        <Card title={t("rent.paymentsTitle")}>
          {d.payments.length === 0 ? <Muted>{t("rent.paymentsEmpty")}</Muted> : d.payments.map((p, i) => <PaymentRow key={p.id} p={p} last={i === d.payments.length - 1} />)}
        </Card>
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 120, gap: 14 },
  subtitle: { color: colors.ink2, fontSize: 15 },
  notice: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12, borderCurve: "continuous", backgroundColor: "rgba(116,169,232,0.12)" },
  noticeText: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  total: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: 14,
    borderRadius: 16,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(245,244,240,0.12)",
  },
  chargeMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" },
  metaText: { color: colors.ink3, fontSize: 12.5 },
  amount: { color: colors.ink, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  voided: { textDecorationLine: "line-through", color: colors.ink3 },
  payButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderCurve: "continuous", backgroundColor: colors.surface3 },
  payText: { color: colors.brassBright, fontSize: 12.5, fontWeight: "600" },
});
