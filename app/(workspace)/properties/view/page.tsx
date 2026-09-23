"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PhotoManager, PropertyCover } from "@/components/files";
import { MaintenanceTable } from "@/components/maintenance/maintenance-table";
import { PropertyEditDialog, SpaceDialog, type SpaceDialogTarget } from "@/components/properties/property-forms";
import { useActions } from "@/components/shell/app-shell";
import { TenancyTable } from "@/components/tenancies/tenancy-table";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Card, DetailList, LoadError, Loading, Notice, PageHeader, Tabs } from "@/components/ui/layout";
import { OccupancyPill } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import type { PropertyDetail, SpaceNode } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { formatDate, formatTenths } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { t, type MessageKey } from "@/lib/i18n";

type Tab = "overview" | "inventory" | "photos" | "tenancies" | "maintenance";

function SpaceRow({ node, depth, onEdit, onAdd, onArchive }: { node: SpaceNode; depth: number; onEdit: (n: SpaceNode) => void; onAdd: (kind: "room" | "bed", parent: SpaceNode) => void; onArchive: (n: SpaceNode) => void }) {
  const o = node.occupancy;
  const canLet = !node.archived && o.state !== "covered";
  return (
    <>
      <li id={`space-${node.id}`} className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 ${node.archived ? "opacity-55" : ""}`} style={{ paddingLeft: depth * 28 }}>
        <Icon name={node.kind === "unit" ? "door" : node.kind === "room" ? "key" : "bed"} className="text-ink-3" />
        <div className="min-w-[180px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14.5px] font-medium">{node.label}</span>
            {node.kind === "unit" && node.rentalMode && <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] text-ink-2">{t(`enums.rentalMode.${node.rentalMode}` as MessageKey)}</span>}
            {node.archived && <span className="text-[12px] text-ink-3">{t("common.archived")}</span>}
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">
            {node.lettable ? (node.defaultRentSen ? `${formatRM(node.defaultRentSen)} ${t("common.perMonth")}` : t("onboarding.review.noRent")) : t("properties.notLettableHint")}
            {o.tenantName && ` · ${o.tenantName}${o.until ? ` ${t("properties.until", { date: formatDate(o.until) })}` : ""}`}
          </div>
        </div>
        {!node.archived && <OccupancyPill state={o.state} date={o.nextStart} />}
        <div className="flex flex-wrap gap-1.5">
          {o.tenancyId && (
            <LinkButton size="sm" variant="ghost" href={`/tenancies/view?id=${o.tenancyId}`}>
              {t("properties.viewTenancy")}
            </LinkButton>
          )}
          {canLet && (node.lettable || o.state === "vacant") && (
            <LinkButton size="sm" href={`/tenancies/new?spaceId=${node.id}`} variant={node.lettable && o.state === "vacant" ? "primary" : "secondary"}>
              {t("properties.letThis")}
            </LinkButton>
          )}
          {!node.archived && node.kind !== "bed" && (
            <Button size="sm" variant="ghost" onClick={() => onAdd(node.kind === "unit" ? "room" : "bed", node)} icon={<Icon name="plus" size={13} />}>
              {node.kind === "unit" ? t("properties.addRoom") : t("properties.addBed")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onEdit(node)}>
            {t("common.edit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onArchive(node)}>
            {node.archived ? t("properties.restoreSpace") : t("properties.archiveSpace")}
          </Button>
        </div>
      </li>
      {node.children.map((c) => (
        <SpaceRow key={c.id} node={c} depth={depth + 1} onEdit={onEdit} onAdd={onAdd} onArchive={onArchive} />
      ))}
    </>
  );
}

function Inventory({ property }: { property: PropertyDetail }) {
  const [dialog, setDialog] = useState<SpaceDialogTarget | null>(null);
  const archive = useMutation("spaces.setArchived");
  const onArchive = (n: SpaceNode) => archive.run({ id: n.id, archived: !n.archived });
  return (
    <Card
      title={t("properties.tabs.inventory")}
      actions={
        <Button size="sm" variant="primary" onClick={() => setDialog({ mode: "create", kind: "unit", parentId: null })} icon={<Icon name="plus" size={14} />}>
          {t("properties.addUnit")}
        </Button>
      }
    >
      {archive.error && (
        <div className="mb-3">
          <Notice tone="critical">{archive.error}</Notice>
        </div>
      )}
      {property.units.length === 0 ? (
        <p className="text-[14px] text-ink-3">{t("properties.unitsEmpty")}</p>
      ) : (
        <ul className="divide-y divide-[var(--hairline)]">
          {property.units.map((u) => (
            <SpaceRow
              key={u.id}
              node={u}
              depth={0}
              onEdit={(node) => setDialog({ mode: "edit", node })}
              onAdd={(kind, parent) => setDialog({ mode: "create", kind, parentId: parent.id })}
              onArchive={(n) => void onArchive(n)}
            />
          ))}
        </ul>
      )}
      <SpaceDialog propertyId={property.id} target={dialog} onClose={() => setDialog(null)} />
    </Card>
  );
}

function Overview({ property, onEdit }: { property: PropertyDetail; onEdit: () => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("properties.address")} actions={<Button size="sm" onClick={onEdit}>{t("properties.editDetails")}</Button>}>
        <DetailList
          items={[
            { label: t("properties.type"), value: t(`enums.propertyType.${property.propertyType}` as MessageKey) },
            {
              label: t("properties.address"),
              value: (
                <>
                  {property.addressLine1}
                  {property.addressLine2 && <br />}
                  {property.addressLine2}
                  <br />
                  {property.postcode} {property.city}
                  <br />
                  {t(`enums.state.${property.state}` as MessageKey)}
                </>
              ),
            },
            { label: t("properties.notes"), value: property.notes || <span className="text-ink-3">—</span> },
          ]}
        />
      </Card>
      <Card title={t("properties.defaults")}>
        <p className="mb-4 text-[13px] text-ink-3">{t("properties.defaultsHelp")}</p>
        <DetailList
          items={[
            { label: t("properties.rentDueDay"), value: t("properties.rentDueDayValue", { n: property.rentDueDay }) },
            { label: t("properties.securityDeposit"), value: t("properties.depositMonths", { n: formatTenths(property.securityDepositTenths) }) },
            { label: t("properties.utilityDeposit"), value: t("properties.depositMonths", { n: formatTenths(property.utilityDepositTenths) }) },
            { label: t("properties.tenancyLength"), value: t("common.monthMany", { n: property.defaultTenancyMonths }) },
            { label: t("properties.defaultTerms"), value: property.defaultTerms ? <span className="whitespace-pre-wrap">{property.defaultTerms}</span> : <span className="text-ink-3">{t("properties.noTerms")}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

function PropertyView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const router = useRouter();
  const toast = useToast();
  const actions = useActions();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "inventory");
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const property = useApi("properties.get", { id }, { enabled: !!id });
  const tenancies = useApi("tenancies.list", { filter: "all", propertyId: id, tenantId: null }, { enabled: !!id && tab === "tenancies" });
  const maintenance = useApi("maintenance.list", { propertyId: id, status: "all", priority: null, overdueOnly: false, query: "" }, { enabled: !!id && tab === "maintenance" });
  const archive = useMutation("properties.setArchived");
  const remove = useMutation("properties.delete");

  if (property.error) return <LoadError message={property.error} onRetry={property.reload} />;
  if (!property.data) return <Loading />;
  const p = property.data;

  return (
    <>
      <PageHeader
        back={{ href: "/properties", label: t("properties.title") }}
        title={p.name}
        subtitle={
          <>
            {p.addressLine1}, {p.postcode} {p.city} · {t(`enums.state.${p.state}` as MessageKey)}
          </>
        }
        actions={
          <>
            <LinkButton href={`/tenancies/new?propertyId=${p.id}`} variant="primary" icon={<Icon name="key" size={15} />}>
              {t("tenants.newTenancy")}
            </LinkButton>
            <Button onClick={() => actions.newMaintenance({ propertyId: p.id })} icon={<Icon name="wrench" size={15} />}>
              {t("maintenance.new")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm("archive")}>
              {p.archivedAt ? t("properties.restoreProperty") : t("properties.archiveProperty")}
            </Button>
          </>
        }
      />
      {p.archivedAt && (
        <div className="mb-5">
          <Notice tone="warn">{t("properties.archivedBanner")}</Notice>
        </div>
      )}
      <div className="mb-6 grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="card aspect-[16/8] overflow-hidden">
          <PropertyCover cover={p.photos[0] ?? null} type={p.propertyType} name={p.name} />
        </div>
        <div className="card flex flex-col justify-between gap-4 p-5">
          <div>
            <div className="microlabel">{t("dashboard.occupancy")}</div>
            <div className="tnum mt-2 font-display text-[32px] font-light">{p.lettable ? t("properties.occupancy", { occupied: p.occupied, total: p.lettable }) : t("properties.noLettable")}</div>
            <p className="mt-2 text-[13px] text-ink-3">{t("dashboard.occupancyHelp")}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[13px] text-ink-2">
            <span>{t("common.unitMany", { n: p.units.filter((u) => !u.archived).length })}</span>·
            <span>{t(`enums.propertyType.${p.propertyType}` as MessageKey)}</span>
          </div>
        </div>
      </div>

      <Tabs<Tab>
        label={p.name}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "inventory", label: t("properties.tabs.inventory") },
          { value: "overview", label: t("properties.tabs.overview") },
          { value: "photos", label: t("properties.tabs.photos"), count: p.photos.length },
          { value: "tenancies", label: t("properties.tabs.tenancies") },
          { value: "maintenance", label: t("properties.tabs.maintenance") },
        ]}
      />
      <div role="tabpanel" className="pt-5">
        {tab === "overview" && <Overview property={p} onEdit={() => setEditing(true)} />}
        {tab === "inventory" && <Inventory property={p} />}
        {tab === "photos" && (
          <Card title={t("properties.tabs.photos")}>
            <p className="mb-4 text-[13px] text-ink-3">{t("properties.photosHelp")}</p>
            <PhotoManager owner={{ kind: "property", id: p.id }} photos={p.photos} />
          </Card>
        )}
        {tab === "tenancies" && (tenancies.data ? <TenancyTable rows={tenancies.data} /> : <Loading />)}
        {tab === "maintenance" && (maintenance.data ? <MaintenanceTable rows={maintenance.data} /> : <Loading />)}
      </div>

      <PropertyEditDialog open={editing} property={p} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirm === "archive"}
        title={p.archivedAt ? t("properties.restoreProperty") : t("properties.archiveProperty")}
        body={p.archivedAt ? p.name : t("properties.archiveConfirm", { name: p.name })}
        confirmLabel={p.archivedAt ? t("properties.restoreProperty") : t("properties.archiveProperty")}
        pending={archive.pending}
        error={archive.error}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (await archive.run({ id: p.id, archived: !p.archivedAt })) setConfirm(null);
        }}
      >
        {!p.archivedAt && (
          <button type="button" className="text-[13px] font-medium text-[#ff9d95] underline-offset-4 hover:underline" onClick={() => setConfirm("delete")}>
            {t("properties.deleteProperty")}…
          </button>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "delete"}
        title={t("properties.deleteProperty")}
        body={t("properties.deleteConfirm", { name: p.name })}
        confirmLabel={t("common.delete")}
        danger
        pending={remove.pending}
        error={remove.error}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if ((await remove.run({ id: p.id })) !== undefined) {
            toast({ tone: "success", message: t("common.saved") });
            router.push("/properties");
          }
        }}
      />
    </>
  );
}

export default function PropertyViewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PropertyView />
    </Suspense>
  );
}
