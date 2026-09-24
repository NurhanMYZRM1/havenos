"use client";

import { useState } from "react";
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

function Cells({ row }: { row: PerformanceRow }) {
  return (
    <>
      <td className="tnum text-right">{row.stays}</td>
      <td className="tnum text-right">{row.nights}</td>
      <td className={`tnum text-right font-semibold ${row.estimatedNetSen < 0 ? "text-[#ff9d95]" : ""}`}>{formatRM(row.estimatedNetSen)}</td>
      <td className="tnum text-right">{row.occupancyPct === null ? <span className="text-ink-3">—</span> : `${Number.isInteger(row.occupancyPct) ? row.occupancyPct : row.occupancyPct.toFixed(1)}%`}</td>
      <td className="tnum text-right"><FigureCell f={row.bookingValue} /></td>
      <td className="tnum text-right"><FigureCell f={row.channelFees} /></td>
      <td className="tnum text-right"><FigureCell f={row.taxes} /></td>
      <td className="tnum text-right"><FigureCell f={row.expenses} /></td>
      <td className="tnum text-right"><FigureCell f={row.payouts} /></td>
      <td className="tnum text-right">{row.averageNightlySen === null ? <span className="text-ink-3">—</span> : formatRM(row.averageNightlySen)}</td>
      <td className="tnum text-right"><FigureCell f={row.cleaningFees} /></td>
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
    // Estimated net first, then what it's made of (booking value − fees − taxes − expenses).
    // Cleaning fees are already inside booking value, so they come last.
    "shortStays.performance.cols.net",
    "shortStays.performance.cols.occupancy",
    "shortStays.performance.cols.bookingValue",
    "shortStays.performance.cols.channelFees",
    "shortStays.performance.cols.taxes",
    "shortStays.performance.cols.expenses",
    "shortStays.performance.cols.payouts",
    "shortStays.performance.cols.avgNightly",
    "shortStays.performance.cols.cleaningFees",
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
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t(`shortStays.enums.performanceGroup.${groupBy}` as MessageKey)}</th>
                    {cols.map((c) => (
                      <th key={c} scope="col" className="text-right">
                        {t(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="!text-left !text-[13.5px] !font-medium !normal-case !tracking-normal !text-ink">
                        {rowLabel(row, groupBy)}
                      </th>
                      <Cells row={row} />
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--hairline-strong)] bg-surface-2/60">
                    <th scope="row" className="!text-left !text-[13.5px] !font-semibold !normal-case !tracking-normal !text-ink">
                      {t("shortStays.performance.total")}
                    </th>
                    <Cells row={report.data.totals} />
                  </tr>
                </tfoot>
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
