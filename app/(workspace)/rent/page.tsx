"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToday } from "@/components/forms";
import { EmptyIllustration } from "@/components/illustrations";
import { useActions } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Card, EmptyState, LoadError, Loading, Notice, PageHeader } from "@/components/ui/layout";
import { MonthSwitcher } from "@/components/ui/month-switcher";
import { ChargeStatePill } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import { monthOf, type YearMonth } from "@/lib/domain/dates";
import type { ExportDataset } from "@/lib/domain/enums";
import { formatDate } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { t, type MessageKey } from "@/lib/i18n";

function Total({ label, value, help, tone }: { label: string; value: number; help: string; tone?: "critical" | "good" }) {
  return (
    <div className="card p-4">
      <div className="microlabel">{label}</div>
      <div className={`tnum mt-1.5 font-display text-[26px] font-light ${tone === "critical" && value > 0 ? "text-[#ff9d95]" : tone === "good" ? "text-good" : ""}`}>{formatRM(value)}</div>
      <p className="mt-1 text-[12px] text-ink-3">{help}</p>
    </div>
  );
}

export default function RentPage() {
  const today = useToday();
  const current = monthOf(today);
  const [month, setMonth] = useState<YearMonth>(current);
  useEffect(() => setMonth(current), [current]);
  const view = useApi("rent.month", { month });
  const actions = useActions();
  const toast = useToast();
  const router = useRouter();

  const exportCsv = async (dataset: ExportDataset) => {
    try {
      const r = await api("export.dataset", { dataset });
      if (r) toast({ tone: "success", message: t("settings.exported", { path: r.path }) });
    } catch (err) {
      toast({ tone: "error", message: errorMessage(err) });
    }
  };

  return (
    <>
      <PageHeader
        title={t("rent.title")}
        subtitle={t("rent.subtitle")}
        actions={
          <>
            <Button variant="primary" onClick={() => actions.recordPayment()} icon={<Icon name="wallet" size={15} />}>
              {t("rent.recordPayment")}
            </Button>
            <Button onClick={() => void exportCsv("payments")} icon={<Icon name="download" size={15} />}>
              {t("rent.exportPayments")}
            </Button>
            <Button onClick={() => void exportCsv("charges")} icon={<Icon name="download" size={15} />}>
              {t("rent.exportCharges")}
            </Button>
          </>
        }
      />
      <div className="mb-5">
        <MonthSwitcher value={month} onChange={setMonth} current={current} />
      </div>
      {view.error && <LoadError message={view.error} onRetry={view.reload} />}
      {!view.data && !view.error && <Loading />}
      {view.data && (
        <div className="space-y-5">
          {view.data.projected && <Notice tone="info">{t("rent.projected")}</Notice>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Total label={t("rent.expected")} value={view.data.totals.expectedSen} help={t("rent.expectedHelp")} />
            <Total label={t("rent.collected")} value={view.data.totals.collectedSen} help={t("rent.collectedHelp")} tone="good" />
            <Total label={t("rent.outstanding")} value={view.data.totals.outstandingSen} help={t("rent.outstandingHelp")} />
            <Total label={t("rent.overdue")} value={view.data.totals.overdueSen} help={t("rent.overdueHelp")} tone="critical" />
            <Total label={t("rent.receivedInMonth")} value={view.data.totals.receivedInMonthSen} help={t("rent.receivedHelp")} />
          </div>

          <Card title={t("rent.rowsTitle")} padded={false}>
            {view.data.rows.length === 0 ? (
              <EmptyState illustration={<EmptyIllustration kind="receipt" />} title={t("rent.rowsEmpty")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t("common.tenant")}</th>
                      <th scope="col">{t("common.space")}</th>
                      <th scope="col">{t("common.description")}</th>
                      <th scope="col">{t("rent.due")}</th>
                      <th scope="col" className="text-right">{t("common.amount")}</th>
                      <th scope="col" className="text-right">{t("rent.paid")}</th>
                      <th scope="col" className="text-right">{t("rent.balance")}</th>
                      <th scope="col">{t("common.status")}</th>
                      <th scope="col"><span className="sr-only">{t("rent.recordPayment")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.data.rows.map((r, i) => (
                      <tr key={r.chargeId ?? `p-${r.tenancyId}-${i}`} className="row-link" onClick={() => router.push(`/tenancies/view?id=${r.tenancyId}`)}>
                        <td>
                          <Link href={`/tenancies/view?id=${r.tenancyId}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
                            {r.tenantName}
                          </Link>
                        </td>
                        <td>
                          {r.spacePath}
                          <div className="text-[12px] text-ink-3">{r.propertyName}</div>
                        </td>
                        <td>{r.description}</td>
                        <td className="tnum whitespace-nowrap">{formatDate(r.dueDate)}</td>
                        <td className="tnum text-right">{formatRM(r.amountSen)}</td>
                        <td className="tnum text-right">{formatRM(r.paidSen)}</td>
                        <td className="tnum text-right">{formatRM(r.balanceSen)}</td>
                        <td><ChargeStatePill state={r.state} /></td>
                        <td className="text-right">
                          {r.balanceSen > 0 && !view.data!.projected && (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                actions.recordPayment(r.tenancyId);
                              }}
                            >
                              {t("rent.recordPayment")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t("rent.paymentsTitle")} padded={false}>
            {view.data.payments.length === 0 ? (
              <p className="px-5 py-5 text-[13.5px] text-ink-3">{t("rent.paymentsEmpty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t("receipt.receiptNo")}</th>
                      <th scope="col">{t("rent.receivedOn")}</th>
                      <th scope="col">{t("common.tenant")}</th>
                      <th scope="col">{t("rent.method")}</th>
                      <th scope="col">{t("common.reference")}</th>
                      <th scope="col" className="text-right">{t("common.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.data.payments.map((p) => (
                      <tr key={p.id} className={`row-link ${p.voided ? "opacity-55" : ""}`} onClick={() => router.push(`/receipt?id=${p.id}`)}>
                        <td className="tnum">
                          <Link href={`/receipt?id=${p.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                            {p.receiptNo}
                          </Link>
                          {p.voided && <span className="ml-2 text-[12px] text-ink-3">{t("rent.voided")}</span>}
                        </td>
                        <td className="tnum whitespace-nowrap">{formatDate(p.receivedOn)}</td>
                        <td>
                          {p.tenantName}
                          <div className="text-[12px] text-ink-3">{p.spacePath}</div>
                        </td>
                        <td>{t(`enums.paymentMethod.${p.method}` as MessageKey)}</td>
                        <td>{p.reference || "—"}</td>
                        <td className="tnum text-right">{formatRM(p.amountSen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
