"use client";

import Link from "next/link";
import { useState } from "react";
import { OccupancyMeter } from "@/components/dashboard/occupancy-meter";
import { PropertyCover } from "@/components/files";
import { EmptyIllustration } from "@/components/illustrations";
import { LinkButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { EmptyState, LoadError, Loading, PageHeader } from "@/components/ui/layout";
import { useApi } from "@/lib/api/hooks";
import { t, type MessageKey } from "@/lib/i18n";

export default function PropertiesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const list = useApi("properties.list", { includeArchived: showArchived });

  return (
    <>
      <PageHeader
        title={t("properties.title")}
        subtitle={t("properties.subtitle")}
        actions={
          <LinkButton href="/onboarding" variant="primary" icon={<Icon name="plus" size={15} />}>
            {t("properties.add")}
          </LinkButton>
        }
      />
      <div className="mb-4">
        <Checkbox label={t("common.showArchived")} checked={showArchived} onChange={setShowArchived} />
      </div>
      {list.error && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && list.data.length === 0 && (
        <div className="card">
          <EmptyState
            illustration={<EmptyIllustration kind="home" />}
            title={t("properties.empty")}
            body={t("properties.emptyBody")}
            actions={
              <LinkButton href="/onboarding" variant="primary">
                {t("properties.add")}
              </LinkButton>
            }
          />
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((p) => (
            <li key={p.id}>
              <Link href={`/properties/view?id=${p.id}`} className="card block overflow-hidden">
                <div className="relative aspect-[16/9] bg-surface-2">
                  <PropertyCover cover={p.cover} type={p.propertyType} name={p.name} />
                  {p.archived && <span className="absolute left-3 top-3 rounded-full bg-bg/85 px-2.5 py-0.5 text-[12px] font-semibold text-ink-2">{t("common.archived")}</span>}
                </div>
                <div className="p-4">
                  <h2 className="truncate font-display text-[19px] font-light">{p.name}</h2>
                  <p className="mt-0.5 truncate text-[13px] text-ink-3">
                    {p.addressLine1}, {p.postcode} {p.city} · {t(`enums.state.${p.state}` as MessageKey)}
                  </p>
                  <div className="mt-4 flex items-center justify-between text-[12.5px] text-ink-2">
                    <span>
                      {t(`enums.propertyType.${p.propertyType}` as MessageKey)} ·{" "}
                      {p.rentalModes.length === 1 ? t(`enums.rentalMode.${p.rentalModes[0]}` as MessageKey) : p.rentalModes.length ? t("properties.mixed") : "—"}
                    </span>
                    {p.openMaintenance > 0 && (
                      <span className="inline-flex items-center gap-1 text-warn">
                        <Icon name="wrench" size={13} />
                        {t("properties.openRequests", { n: p.openMaintenance })}
                      </span>
                    )}
                  </div>
                  <div className="mt-3">
                    <div className="mb-1.5 text-[12.5px] text-ink-3">{p.lettable ? t("properties.occupancy", { occupied: p.occupied, total: p.lettable }) : t("properties.noLettable")}</div>
                    <OccupancyMeter value={p.occupied} total={p.lettable} label={`${t("dashboard.occupancy")} — ${p.name}`} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
