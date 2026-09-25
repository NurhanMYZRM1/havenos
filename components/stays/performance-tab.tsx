"use client";

import { useId, useState } from "react";
import { EmptyIllustration } from "@/components/illustrations";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Card, EmptyState, LoadError, Loading, Notice } from "@/components/ui/layout";
import type { PerformanceGroup, PerformanceRow } from "@/lib/api/contract";
import { useApi } from "@/lib/api/hooks";
import { addMonthsToMonth, firstOfMonth, isYearMonth, lastOfMonth, monthOf, type IsoDate, type YearMonth } from "@/lib/domain/dates";
import { formatMonthShort } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { CsvImportDialog, LedgerDialog, LedgerTable } from "./money";
import { AmountSourceTag, FigureCell } from "./shared";

const GROUPS: PerformanceGroup[] = ["property", "space", "channel", "month"];

function rowLabel(row: PerformanceRow, groupBy: PerformanceGroup): string {
  if (groupBy === "month" && isYearMonth(row.key)) return formatMonthShort(row.key);
  const key = `shortStays.enums.reservationChannel.${row.key}`;
  if (groupBy === "channel" && isMessageKey(key)) return t(key);
  return row.label;
}

function ReportRow({ row, label, total = false }: { row: PerformanceRow; label: string; total?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const figures = ["bookingValue", "cleaningFees", "channelFees", "taxes", "adjustments", "expenses", "payouts"] as const;
  return (
    <>
      <tr className={total ? "border-t-2 border-[var(--hairline-strong)] bg-surface-2/60" : undefined}>
        <th scope="row" className="sticky left-0 z-10 bg-surface !whitespace-normal !text-left !text-[13.5px] !font-medium !normal-case !tracking-normal !text-ink">
          <button type="button" className="flex w-full items-center gap-2 rounded text-left" aria-expanded={expanded} aria-controls={detailsId} title={t("shortStays.performance.showBreakdown")} onClick={() => setExpanded(!expanded)}>
            <Icon name={expanded ? "chevronDown" : "chevronRight"} size={13} className="shrink-0" />
            <span className="break-words">{label}</span>
          </button>
        </th>
        <td className="tnum text-right">{row.stays}</td>
        <td className="tnum text-right">{row.nights}</td>
        <td className="tnum text-right">{formatRM(row.bookingValue.totalSen)}</td>
        <td className={`tnum text-right font-semibold ${row.estimatedNetSen < 0 ? "text-[#ff9d95]" : ""}`}>{formatRM(row.estimatedNetSen)}</td>
      </tr>
      <tr id={detailsId} hidden={!expanded}>
        <td colSpan={5} className="!p-4 bg-surface-2/40">
          <h3 className="mb-3 text-[12px] font-medium text-ink-2">{t("shortStays.performance.breakdown")}</h3>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 xl:grid-cols-4">
            {figures.map((key) => (
              <div key={key}>
                <dt className="mb-1 text-[12px] text-ink-3">{t(`shortStays.performance.cols.${key}` as MessageKey)}</dt>
                <dd className="tnum"><FigureCell f={row[key]} /></dd>
              </div>
            ))}
            <div>
              <dt className="text-[12px] text-ink-3">{t("shortStays.performance.cols.occupancy")}</dt>
              <dd className="tnum">{row.occupancyPct === null ? "—" : `${Number.isInteger(row.occupancyPct) ? row.occupancyPct : row.occupancyPct.toFixed(1)}%`}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-3">{t("shortStays.performance.cols.avgNightly")}</dt>
              <dd className="tnum">{row.averageNightlySen === null ? "—" : formatRM(row.averageNightlySen)}</dd>
            </div>
          </dl>
        </td>
      </tr>
    </>
  );
}

export function PerformanceTab({ today }: { today: IsoDate }) {
  const current = monthOf(today);
  const [from, setFrom] = useState<YearMonth>(addMonthsToMonth(current, -2));
  const [to, setTo] = useState<YearMonth>(current);
  const [groupBy, setGroupBy] = useState<PerformanceGroup>("property");
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"import" | "entry" | null>(null);
  const properties = useApi("properties.list", { includeArchived: false });
  const validRange = isYearMonth(from) && isYearMonth(to) && from <= to;
  const report = useApi("stays.performance", { from, to, groupBy, propertyId }, { enabled: validRange });
  const ledger = useApi("ledger.list", { from: validRange ? firstOfMonth(from) : today, to: validRange ? lastOfMonth(to) : today, propertyId, reservationId: null }, { enabled: validRange });

  const cols: MessageKey[] = [
    "shortStays.performance.cols.stays",
    "shortStays.performance.cols.nights",
    "shortStays.performance.cols.bookingValue",
    "shortStays.performance.cols.net",
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("shortStays.performance.from")} className="w-44">
          <input type="month" className="control tnum" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("shortStays.performance.to")} className="w-44">
          <input type="month" className="control tnum" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t("shortStays.performance.groupBy")} className="w-48">
          <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as PerformanceGroup)} options={GROUPS.map((g) => ({ value: g, label: t(`shortStays.enums.performanceGroup.${g}` as MessageKey) }))} />
        </Field>
        <Field label={t("shortStays.performance.property")} className="w-52">
          <Select value={propertyId ?? ""} onChange={(e) => setPropertyId(e.target.value || null)} options={[{ value: "", label: t("shortStays.performance.allProperties") }, ...(properties.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        </Field>
        <div className="ml-auto flex flex-wrap gap-2.5">
          <Button variant="primary" onClick={() => setDialog("import")} icon={<Icon name="upload" size={15} />}>
            {t("shortStays.performance.importCsv")}
          </Button>
          <Button onClick={() => setDialog("entry")} icon={<Icon name="plus" size={15} />}>
            {t("shortStays.performance.addEntry")}
          </Button>
        </div>
      </div>

      {!validRange && <Notice tone="warn">{t("shortStays.performance.rangeInvalid")}</Notice>}
      {validRange && report.error && <LoadError message={report.error} onRetry={report.reload} />}
      {validRange && !report.data && !report.error && <Loading />}
      {validRange && report.data && (
        <>
          {report.data.totals.staysWithoutMoney > 0 && <Notice tone="info">{t("shortStays.performance.withoutMoney", { n: report.data.totals.staysWithoutMoney })}</Notice>}
          {report.data.rows.length === 0 ? (
            <div className="card">
              <EmptyState illustration={<EmptyIllustration kind="receipt" />} title={t("shortStays.performance.empty")} body={t("shortStays.performance.emptyBody")} />
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table" aria-label={t("shortStays.tabs.performance")}>
                <caption className="px-3 py-2 text-left text-[12px] text-ink-3">{t("shortStays.performance.showBreakdown")}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 z-10 bg-surface">{t(`shortStays.enums.performanceGroup.${groupBy}` as MessageKey)}</th>
                    {cols.map((c) => (
                      <th key={c} scope="col" className="!whitespace-normal !text-right">
                        {t(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row) => (
                    <ReportRow key={row.key} row={row} label={rowLabel(row, groupBy)} />
                  ))}
                  <ReportRow row={report.data.totals} label={t("shortStays.performance.total")} total />
                </tbody>
              </table>
            </div>
          )}
          <div className="card space-y-2 px-5 py-4 text-[12.5px] leading-relaxed text-ink-2">
            <p>{t("shortStays.performance.legend")}</p>
            <ul className="space-y-1">
              <li className="flex items-center gap-2">
                <AmountSourceTag source="imported" /> {t("shortStays.performance.legendImported")}
              </li>
              <li className="flex items-center gap-2">
                <AmountSourceTag source="entered" /> {t("shortStays.performance.legendEntered")}
              </li>
            </ul>
            <p>{t("shortStays.performance.netHelp")}</p>
            <p>{t("shortStays.performance.occupancyHelp")}</p>
            <p className="text-ink-3">{t("shortStays.performance.noPricing")}</p>
          </div>
        </>
      )}

      {validRange && (
        <Card title={t("shortStays.performance.ledgerTitle")} padded={false}>
          <p className="px-5 pt-4 text-[13px] text-ink-3">{t("shortStays.performance.ledgerHelp")}</p>
          {ledger.error && (
            <div className="p-5">
              <LoadError message={ledger.error} onRetry={ledger.reload} />
            </div>
          )}
          {!ledger.data && !ledger.error && <Loading />}
          {ledger.data && <LedgerTable entries={ledger.data} />}
        </Card>
      )}

      <CsvImportDialog open={dialog === "import"} onClose={() => setDialog(null)} />
      <LedgerDialog open={dialog === "entry"} defaults={propertyId ? { propertyId } : undefined} onClose={() => setDialog(null)} />
    </div>
  );
}
