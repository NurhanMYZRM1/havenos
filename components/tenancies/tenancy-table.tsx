"use client";

import { useRouter } from "next/navigation";
import { EmptyIllustration } from "@/components/illustrations";
import { EmptyState } from "@/components/ui/layout";
import { OverdueFlag, TenancyStatusPill } from "@/components/ui/status";
import type { TenancySummary } from "@/lib/api/contract";
import { formatDate } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { t } from "@/lib/i18n";

export function TenancyTable({ rows, emptyAction }: { rows: TenancySummary[]; emptyAction?: React.ReactNode }) {
  const router = useRouter();
  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState illustration={<EmptyIllustration kind="keys" />} title={t("tenants.emptyTenancies")} body={t("tenants.emptyTenanciesBody")} actions={emptyAction} />
      </div>
    );
  }
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t("common.tenant")}</th>
            <th scope="col">{t("common.space")}</th>
            <th scope="col">{t("tenancies.period")}</th>
            <th scope="col" className="text-right">{t("tenancies.currentRent")}</th>
            <th scope="col" className="text-right">{t("tenancies.balance")}</th>
            <th scope="col">{t("common.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="row-link" onClick={() => router.push(`/tenancies/view?id=${r.id}`)}>
              <td>
                <a href={`/tenancies/view?id=${r.id}`} onClick={(e) => { e.preventDefault(); router.push(`/tenancies/view?id=${r.id}`); }} className="font-medium hover:underline">
                  {r.tenantName}
                </a>
                <div className="text-[12px] text-ink-3">{r.ref}</div>
              </td>
              <td>
                {r.spacePath}
                <div className="text-[12px] text-ink-3">{r.propertyName}</div>
              </td>
              <td className="tnum whitespace-nowrap">
                {formatDate(r.startDate)} – {r.endDate ? formatDate(r.endDate) : t("tenancies.noEnd")}
                {(r.needsMoveIn || r.needsMoveOut) && (
                  <div className="text-[12px]">
                    <OverdueFlag>{r.needsMoveOut ? t("tenancies.actions.moveOut") : t("tenancies.actions.moveIn")}</OverdueFlag>
                  </div>
                )}
              </td>
              <td className="tnum text-right">{formatRM(r.monthlyRentSen)}</td>
              <td className="tnum text-right">
                {r.overdueSen > 0 ? <OverdueFlag>{formatRM(r.balanceSen)}</OverdueFlag> : r.balanceSen < 0 ? <span className="text-good">{t("tenants.inCredit", { amount: formatRM(-r.balanceSen) })}</span> : formatRM(r.balanceSen)}
              </td>
              <td>
                <TenancyStatusPill status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
