"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { EmptyIllustration } from "@/components/illustrations";
import { TenantDialog } from "@/components/tenancies/tenant-dialog";
import { TenancyTable } from "@/components/tenancies/tenancy-table";
import { Button, LinkButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState, LoadError, Loading, PageHeader, Tabs } from "@/components/ui/layout";
import { OverdueFlag } from "@/components/ui/status";
import type { TenancyFilter } from "@/lib/api/contract";
import { useApi } from "@/lib/api/hooks";
import { formatRM } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";
import { t, type MessageKey } from "@/lib/i18n";

const FILTERS: TenancyFilter[] = ["current", "active", "expiring", "upcoming", "ended", "cancelled", "all"];

function TenancyList() {
  const [filter, setFilter] = useState<TenancyFilter>("current");
  const list = useApi("tenancies.list", { filter, propertyId: null, tenantId: null });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("common.status")}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium ${filter === f ? "border-brass bg-brass/10 text-ink" : "border-[var(--hairline-strong)] text-ink-2 hover:text-ink"}`}
          >
            {t(`tenants.filters.${f}` as MessageKey)}
          </button>
        ))}
      </div>
      {list.error && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && (
        <TenancyTable
          rows={list.data}
          emptyAction={
            <LinkButton href="/tenancies/new" variant="primary">
              {t("tenants.newTenancy")}
            </LinkButton>
          }
        />
      )}
    </div>
  );
}

function Directory({ onAdd }: { onAdd: () => void }) {
  const [query, setQuery] = useState("");
  const list = useApi("tenants.list", { query });
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input className="control pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("tenants.searchPlaceholder")} aria-label={t("tenants.searchPlaceholder")} />
      </div>
      {list.error && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && list.data.length === 0 && (
        <div className="card">
          <EmptyState illustration={<EmptyIllustration kind="keys" />} title={t("tenants.empty")} actions={<Button variant="primary" onClick={onAdd}>{t("tenants.addTenant")}</Button>} />
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("tenants.fullName")}</th>
                <th scope="col">{t("tenants.phone")}</th>
                <th scope="col">{t("tenants.email")}</th>
                <th scope="col">{t("tenants.tenancies")}</th>
                <th scope="col" className="text-right">{t("tenants.balance")}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((x) => (
                <tr key={x.id} className="row-link" onClick={() => router.push(`/tenants/view?id=${x.id}`)}>
                  <td>
                    <Link href={`/tenants/view?id=${x.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {x.fullName}
                    </Link>
                  </td>
                  <td className="tnum">{formatPhone(x.phone) || "—"}</td>
                  <td>{x.email || "—"}</td>
                  <td>{t("tenants.current", { n: x.currentTenancies })}</td>
                  <td className="tnum text-right">
                    {x.balanceSen > 0 ? <OverdueFlag>{t("tenants.owes", { amount: formatRM(x.balanceSen) })}</OverdueFlag> : x.balanceSen < 0 ? t("tenants.inCredit", { amount: formatRM(-x.balanceSen) }) : t("tenants.settled")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TenantsInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"tenancies" | "directory">(params.get("tab") === "directory" ? "directory" : "tenancies");
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  return (
    <>
      <PageHeader
        title={t("tenants.title")}
        subtitle={t("tenants.subtitle")}
        actions={
          <>
            <Button onClick={() => setAdding(true)} icon={<Icon name="people" size={15} />}>
              {t("tenants.addTenant")}
            </Button>
            <LinkButton href="/tenancies/new" variant="primary" icon={<Icon name="key" size={15} />}>
              {t("tenants.newTenancy")}
            </LinkButton>
          </>
        }
      />
      <Tabs
        label={t("tenants.title")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "tenancies", label: t("tenants.tabs.tenancies") },
          { value: "directory", label: t("tenants.tabs.directory") },
        ]}
      />
      <div role="tabpanel" className="pt-5">
        {tab === "tenancies" ? <TenancyList /> : <Directory onAdd={() => setAdding(true)} />}
      </div>
      <TenantDialog open={adding} tenant={null} onClose={() => setAdding(false)} onSaved={(x) => router.push(`/tenants/view?id=${x.id}`)} />
    </>
  );
}

export default function TenantsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TenantsInner />
    </Suspense>
  );
}
