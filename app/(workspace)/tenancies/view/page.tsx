"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AttachmentList } from "@/components/files";
import { useActions } from "@/components/shell/app-shell";
import { ContactLinks } from "@/components/tenancies/contact-links";
import {
  CancelTenancyDialog,
  ChangeRentDialog,
  ChargeDialog,
  DepositDialog,
  EditTenancyDialog,
  MoveInDialog,
  MoveOutDialog,
  VoidDialog,
} from "@/components/tenancies/tenancy-dialogs";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Card, DetailList, LoadError, Loading, Notice, PageHeader } from "@/components/ui/layout";
import { ChargeStatePill, OverdueFlag, TenancyStatusPill } from "@/components/ui/status";
import type { Charge } from "@/lib/api/contract";
import { useApi, useMutation } from "@/lib/api/hooks";
import { formatDate, formatMonth, formatTimestamp } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";
import { t, type MessageKey } from "@/lib/i18n";

type DialogName = "edit" | "moveIn" | "moveOut" | "cancel" | "charge" | "rent" | "deposit" | "delete" | null;

function TenancyView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const actions = useActions();
  const tenancy = useApi("tenancies.get", { id }, { enabled: !!id });
  const [dialog, setDialog] = useState<DialogName>(null);
  const [editCharge, setEditCharge] = useState<Charge | null>(null);
  const [voiding, setVoiding] = useState<{ kind: "charge" | "payment"; id: string } | null>(null);
  const voidDeposit = useMutation("deposits.void");
  const remove = useMutation("tenancies.delete");

  if (tenancy.error) return <LoadError message={tenancy.error} onRetry={tenancy.reload} />;
  if (!tenancy.data) return <Loading />;
  const x = tenancy.data;
  const live = !x.cancelledAt;
  const close = () => setDialog(null);

  return (
    <>
      <PageHeader
        back={{ href: "/tenants", label: t("tenants.title") }}
        eyebrow={`${t("tenancies.title")} ${x.ref}`}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {x.tenantName}
            <TenancyStatusPill status={x.status} />
          </span>
        }
        subtitle={
          <>
            <Link href={`/properties/view?id=${x.propertyId}`} className="hover:underline">
              {x.spacePath} · {x.propertyName}
            </Link>
          </>
        }
        actions={
          live && (
            <>
              <Button variant="primary" onClick={() => actions.recordPayment(x.id)} icon={<Icon name="wallet" size={15} />}>
                {t("tenancies.actions.recordPayment")}
              </Button>
              {!x.movedInOn && !x.movedOutOn && <Button onClick={() => setDialog("moveIn")}>{t("tenancies.actions.moveIn")}</Button>}
              {!x.movedOutOn && <Button onClick={() => setDialog("moveOut")}>{t("tenancies.actions.moveOut")}</Button>}
              <Button variant="ghost" onClick={() => setDialog("edit")}>
                {t("common.edit")}
              </Button>
            </>
          )
        }
      />

      <div className="mb-5 space-y-3">
        {x.cancelledAt && <Notice tone="warn">{t("tenancies.cancelledBanner")}</Notice>}
        {x.needsMoveOut && <Notice tone="warn" action={<Button size="sm" onClick={() => setDialog("moveOut")}>{t("tenancies.actions.moveOut")}</Button>}>{t("tenancies.needsMoveOut")}</Notice>}
        {x.needsMoveIn && <Notice tone="info" action={<Button size="sm" onClick={() => setDialog("moveIn")}>{t("tenancies.actions.moveIn")}</Button>}>{t("tenancies.needsMoveIn")}</Notice>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <Card title={t("tenancies.summary")}>
          <DetailList
            items={[
              { label: t("tenancies.period"), value: <span className="tnum">{formatDate(x.startDate)} – {x.endDate ? formatDate(x.endDate) : t("tenancies.noEnd")}</span> },
              { label: t("tenancies.movedIn"), value: x.movedInOn ? formatDate(x.movedInOn) : <span className="text-ink-3">{t("tenancies.notMovedIn")}</span> },
              ...(x.movedOutOn ? [{ label: t("tenancies.movedOut"), value: formatDate(x.movedOutOn) }] : []),
              { label: t("tenancies.currentRent"), value: <span className="tnum">{formatRM(x.monthlyRentSen)} · {t("tenancies.dueEvery", { n: x.rentDueDay })}</span> },
              {
                label: t("tenancies.balance"),
                value: x.overdueSen > 0 ? <OverdueFlag>{formatRM(x.balanceSen)} ({t("tenancies.overdue")} {formatRM(x.overdueSen)})</OverdueFlag> : <span className="tnum">{formatRM(Math.max(0, x.balanceSen))}</span>,
              },
              ...(x.creditSen > 0 ? [{ label: t("tenancies.credit"), value: <span className="tnum text-good">{formatRM(x.creditSen)}</span> }] : []),
              { label: t("common.tenant"), value: <Link className="hover:underline" href={`/tenants/view?id=${x.tenantId}`}>{x.tenantName}</Link> },
              ...(x.tenantPhone ? [{ label: t("tenants.phone"), value: <ContactLinks phone={x.tenantPhone} label={formatPhone(x.tenantPhone)} /> }] : []),
              ...(x.moveInNotes ? [{ label: t("tenancies.moveInNotes"), value: <span className="whitespace-pre-wrap">{x.moveInNotes}</span> }] : []),
              ...(x.moveOutNotes ? [{ label: t("tenancies.moveOutNotes"), value: <span className="whitespace-pre-wrap">{x.moveOutNotes}</span> }] : []),
            ]}
          />
        </Card>

        <Card
          title={t("tenancies.deposits")}
          actions={live && <Button size="sm" onClick={() => setDialog("deposit")}>{t("tenancies.recordDeposit")}</Button>}
        >
          <p className="mb-4 text-[13px] text-ink-3">{t("tenancies.depositsHelp")}</p>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [t("tenancies.depositAgreed"), x.deposits.agreedSecuritySen + x.deposits.agreedUtilitySen],
              [t("tenancies.depositReceived"), x.deposits.receivedSen],
              [t("tenancies.depositRefunded"), x.deposits.refundedSen + x.deposits.deductedSen],
              [t("tenancies.depositHeld"), x.deposits.heldSen],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-surface-2 px-3 py-2.5">
                <div className="text-[12px] text-ink-3">{label}</div>
                <div className="tnum mt-0.5 text-[15px] font-semibold">{formatRM(Number(value))}</div>
              </div>
            ))}
          </div>
          {x.deposits.entries.length > 0 && (
            <ul className="divide-y divide-[var(--hairline)] text-[13.5px]">
              {x.deposits.entries.map((e) => (
                <li key={e.id} className={`flex flex-wrap items-center gap-3 py-2 ${e.voidedAt ? "opacity-50 line-through" : ""}`}>
                  <span className="tnum w-24 text-ink-3">{formatDate(e.occurredOn)}</span>
                  <span className="flex-1">
                    {t(`enums.depositType.${e.depositType}` as MessageKey)} — {t(`enums.depositKind.${e.kind}` as MessageKey)}
                    {e.notes && <span className="block text-[12px] text-ink-3">{e.notes}</span>}
                  </span>
                  <span className="tnum">{e.kind === "received" ? "+" : "−"}{formatRM(e.amountSen)}</span>
                  {!e.voidedAt && live && (
                    <button type="button" className="text-[12px] text-ink-3 hover:text-ink" onClick={() => void voidDeposit.run({ id: e.id })}>
                      {t("deposits.void")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {voidDeposit.error && <p className="mt-2 text-[12.5px] text-[#ff9d95]">{voidDeposit.error}</p>}
        </Card>
      </div>

      <Card
        className="mt-4"
        title={t("tenancies.ledger")}
        actions={
          live && (
            <>
              <Button size="sm" onClick={() => setDialog("rent")}>{t("tenancies.actions.changeRent")}</Button>
              <Button size="sm" onClick={() => { setEditCharge(null); setDialog("charge"); }}>{t("tenancies.actions.addCharge")}</Button>
            </>
          )
        }
        padded={false}
      >
        <div className="px-5 pt-4 text-[13px] text-ink-3">
          {t("tenancies.schedule")}:{" "}
          {x.schedule.map((s) => `${t("tenancies.scheduleFrom", { month: formatMonth(s.effectiveMonth) })} — ${t("tenancies.scheduleRow", { amount: formatRM(s.amountSen), day: s.dueDay })}`).join(" · ")}
        </div>
        <h3 className="px-5 pb-2 pt-4 text-[13px] font-semibold">{t("tenancies.charges")}</h3>
        {x.charges.length === 0 ? (
          <p className="px-5 pb-4 text-[13.5px] text-ink-3">{t("tenancies.ledgerEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("common.description")}</th>
                  <th scope="col">{t("rent.due")}</th>
                  <th scope="col" className="text-right">{t("common.amount")}</th>
                  <th scope="col" className="text-right">{t("rent.paid")}</th>
                  <th scope="col" className="text-right">{t("rent.balance")}</th>
                  <th scope="col">{t("common.status")}</th>
                  <th scope="col"><span className="sr-only">{t("common.edit")}</span></th>
                </tr>
              </thead>
              <tbody>
                {x.charges.map((c) => (
                  <tr key={c.id} className={c.voidedAt ? "opacity-55" : ""}>
                    <td>
                      {c.description}
                      {c.voidReason && <div className="text-[12px] text-ink-3">{c.voidReason}</div>}
                    </td>
                    <td className="tnum whitespace-nowrap">{formatDate(c.dueDate)}</td>
                    <td className="tnum text-right">{formatRM(c.amountSen)}</td>
                    <td className="tnum text-right">{formatRM(c.paidSen)}</td>
                    <td className="tnum text-right">{formatRM(c.balanceSen)}</td>
                    <td><ChargeStatePill state={c.state} /></td>
                    <td className="whitespace-nowrap text-right">
                      {!c.voidedAt && live && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => { setEditCharge(c); setDialog("charge"); }}>{t("common.edit")}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setVoiding({ kind: "charge", id: c.id })}>{t("rent.voided")}</Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 className="px-5 pb-2 pt-5 text-[13px] font-semibold">{t("tenancies.payments")}</h3>
        {x.payments.length === 0 ? (
          <p className="px-5 pb-5 text-[13.5px] text-ink-3">{t("rent.paymentsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto pb-2">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t("receipt.receiptNo")}</th>
                  <th scope="col">{t("rent.receivedOn")}</th>
                  <th scope="col">{t("common.description")}</th>
                  <th scope="col">{t("rent.method")}</th>
                  <th scope="col" className="text-right">{t("common.amount")}</th>
                  <th scope="col"><span className="sr-only">{t("rent.receipt")}</span></th>
                </tr>
              </thead>
              <tbody>
                {x.payments.map((p) => (
                  <tr key={p.id} className={p.voidedAt ? "opacity-55" : ""}>
                    <td className="tnum">
                      {p.receiptNo}
                      {p.voidedAt && <div className="text-[12px] text-ink-3">{t("rent.voided")}: {p.voidReason || formatTimestamp(p.voidedAt)}</div>}
                    </td>
                    <td className="tnum whitespace-nowrap">{formatDate(p.receivedOn)}</td>
                    <td>
                      {p.description}
                      {p.reference && <div className="text-[12px] text-ink-3">{t("common.reference")}: {p.reference}</div>}
                      {p.attachments.length > 0 && <div className="text-[12px] text-ink-3"><Icon name="file" size={12} className="mr-1 inline" />{p.attachments.map((a) => a.fileName).join(", ")}</div>}
                    </td>
                    <td>{t(`enums.paymentMethod.${p.method}` as MessageKey)}</td>
                    <td className="tnum text-right">{formatRM(p.amountSen)}</td>
                    <td className="whitespace-nowrap text-right">
                      <LinkButton size="sm" variant="ghost" href={`/receipt?id=${p.id}`}>{t("rent.receipt")}</LinkButton>
                      {!p.voidedAt && <Button size="sm" variant="ghost" onClick={() => setVoiding({ kind: "payment", id: p.id })}>{t("rent.voided")}</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title={t("tenancies.documents")}>
          <AttachmentList owner={{ kind: "tenancy", id: x.id }} files={x.documents} help={t("tenancies.documentsHelp")} />
        </Card>
        <Card title={t("tenancies.termsTitle")}>
          {x.terms ? <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{x.terms}</p> : <p className="text-[13.5px] text-ink-3">{t("tenancies.noTerms")}</p>}
        </Card>
      </div>

      {live && (
        <div className="mt-8 flex flex-wrap gap-2.5">
          <Button variant="ghost" onClick={() => setDialog("cancel")}>{t("tenancies.actions.cancel")}</Button>
          <Button variant="ghost" onClick={() => setDialog("delete")}>{t("tenancies.actions.delete")}</Button>
        </div>
      )}

      <EditTenancyDialog open={dialog === "edit"} tenancy={x} onClose={close} />
      <MoveInDialog open={dialog === "moveIn"} tenancy={x} onClose={close} />
      <MoveOutDialog open={dialog === "moveOut"} tenancy={x} onClose={close} />
      <CancelTenancyDialog open={dialog === "cancel"} tenancy={x} onClose={close} />
      <ChargeDialog open={dialog === "charge"} tenancyId={x.id} charge={editCharge} onClose={close} />
      <ChangeRentDialog open={dialog === "rent"} tenancy={x} onClose={close} />
      <DepositDialog open={dialog === "deposit"} tenancy={x} onClose={close} />
      <VoidDialog open={!!voiding} kind={voiding?.kind ?? "charge"} id={voiding?.id ?? null} onClose={() => setVoiding(null)} />
      <ConfirmDialog
        open={dialog === "delete"}
        title={t("tenancies.actions.delete")}
        body={t("tenancies.deleteConfirm")}
        confirmLabel={t("common.delete")}
        danger
        pending={remove.pending}
        error={remove.error}
        onClose={close}
        onConfirm={async () => {
          if ((await remove.run({ id: x.id })) !== undefined) router.push("/tenants");
        }}
      />
    </>
  );
}

export default function TenancyViewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TenancyView />
    </Suspense>
  );
}
