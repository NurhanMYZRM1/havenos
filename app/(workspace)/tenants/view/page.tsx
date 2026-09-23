"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AttachmentList } from "@/components/files";
import { ContactLinks } from "@/components/tenancies/contact-links";
import { TenantDialog } from "@/components/tenancies/tenant-dialog";
import { TenancyTable } from "@/components/tenancies/tenancy-table";
import { Button, LinkButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Card, DetailList, LoadError, Loading, PageHeader } from "@/components/ui/layout";
import { OverdueFlag } from "@/components/ui/status";
import { useApi } from "@/lib/api/hooks";
import { formatRM } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";
import { t } from "@/lib/i18n";

function TenantView() {
  const id = useSearchParams().get("id") ?? "";
  const tenant = useApi("tenants.get", { id }, { enabled: !!id });
  const [editing, setEditing] = useState(false);
  if (tenant.error) return <LoadError message={tenant.error} onRetry={tenant.reload} />;
  if (!tenant.data) return <Loading />;
  const x = tenant.data;
  return (
    <>
      <PageHeader
        back={{ href: "/tenants?tab=directory", label: t("tenants.title") }}
        title={x.fullName}
        subtitle={x.balanceSen > 0 ? <OverdueFlag>{t("tenants.owes", { amount: formatRM(x.balanceSen) })}</OverdueFlag> : x.balanceSen < 0 ? t("tenants.inCredit", { amount: formatRM(-x.balanceSen) }) : t("tenants.settled")}
        actions={
          <>
            <Button onClick={() => setEditing(true)}>{t("tenants.edit")}</Button>
            <LinkButton href={`/tenancies/new?tenantId=${x.id}`} variant="primary" icon={<Icon name="key" size={15} />}>
              {t("tenants.newTenancy")}
            </LinkButton>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card title={t("common.details")}>
          <DetailList
            items={[
              { label: t("tenants.phone"), value: x.phone ? <ContactLinks phone={x.phone} label={formatPhone(x.phone)} /> : "—" },
              { label: t("tenants.email"), value: x.email ? <ContactLinks email={x.email} label={x.email} /> : "—" },
              { label: t("tenants.emergencyName"), value: x.emergencyName || "—" },
              { label: t("tenants.emergencyPhone"), value: x.emergencyPhone ? formatPhone(x.emergencyPhone) : "—" },
              { label: t("tenants.notes"), value: x.notes ? <span className="whitespace-pre-wrap">{x.notes}</span> : "—" },
            ]}
          />
        </Card>
        <Card title={t("tenants.documents")}>
          <AttachmentList owner={{ kind: "tenant", id: x.id }} files={x.documents} help={t("tenants.documentsHelp")} />
        </Card>
      </div>
      <h2 className="mb-3 mt-8 text-[16px] font-semibold">{t("tenants.tenancies")}</h2>
      <TenancyTable rows={x.tenancies} emptyAction={<LinkButton href={`/tenancies/new?tenantId=${x.id}`} variant="primary">{t("tenants.newTenancy")}</LinkButton>} />
      <TenantDialog open={editing} tenant={x} onClose={() => setEditing(false)} />
    </>
  );
}

export default function TenantViewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TenantView />
    </Suspense>
  );
}
