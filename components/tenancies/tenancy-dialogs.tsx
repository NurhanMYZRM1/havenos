"use client";

import { useEffect, useState, type ReactNode } from "react";
import { moneyField, senText, useToday } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Checkbox, DateInput, Field, FormError, MoneyInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import type { Charge, TenancyDetail } from "@/lib/api/contract";
import { useMutation } from "@/lib/api/hooks";
import { addMonthsToMonth, isYearMonth, monthOf } from "@/lib/domain/dates";
import { formatMonth } from "@/lib/domain/format";
import { CHARGE_KINDS, DEPOSIT_ENTRY_KINDS, DEPOSIT_TYPES, PAYMENT_METHODS, type ChargeKind, type DepositEntryKind, type DepositType, type PaymentMethod } from "@/lib/domain/enums";
import { formatRM } from "@/lib/domain/money";
import { t, type MessageKey } from "@/lib/i18n";

type Errors = Record<string, MessageKey>;

const methodOptions = () => PAYMENT_METHODS.map((m) => ({ value: m, label: t(`enums.paymentMethod.${m}` as MessageKey) }));

function Shell({ open, onClose, title, description, pending, error, submitLabel, onSubmit, children, width, danger }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; pending: boolean; error: string | null; submitLabel: string; onSubmit: () => void; children: ReactNode; width?: number; danger?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={width}
      onSubmit={onSubmit}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        <FormError message={error} />
      </div>
    </Modal>
  );
}

export function EditTenancyDialog({ open, tenancy, onClose }: { open: boolean; tenancy: TenancyDetail; onClose: () => void }) {
  const toast = useToast();
  const save = useMutation("tenancies.update");
  const [f, setF] = useState({ startDate: "", endDate: "", security: "", utility: "", terms: "" });
  const [local, setLocal] = useState<Errors>({});
  useEffect(() => {
    if (!open) return;
    save.reset();
    setLocal({});
    setF({ startDate: tenancy.startDate, endDate: tenancy.endDate ?? "", security: senText(tenancy.securityDepositSen), utility: senText(tenancy.utilityDepositSen), terms: tenancy.terms });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = async () => {
    const s = moneyField(f.security, { required: true });
    const u = moneyField(f.utility, { required: true });
    const e: Errors = {};
    if (s.error) e.securityDepositSen = s.error;
    if (u.error) e.utilityDepositSen = u.error;
    setLocal(e);
    if (Object.keys(e).length) return;
    if (await save.run({ id: tenancy.id, startDate: f.startDate, endDate: f.endDate || null, securityDepositSen: s.sen!, utilityDepositSen: u.sen!, terms: f.terms })) {
      toast({ tone: "success", message: t("tenancies.saved") });
      onClose();
    }
  };
  const err = (k: string) => local[k] ?? save.fields[k] ?? null;
  return (
    <Shell open={open} onClose={onClose} title={t("tenancies.actions.edit")} pending={save.pending} error={save.error} submitLabel={t("common.saveChanges")} onSubmit={() => void submit()} width={640}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("tenancies.startDate")} error={err("startDate")}>
          <DateInput value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </Field>
        <Field label={t("tenancies.endDate")} hint={t("tenancies.endDateHint")} optional error={err("endDate")}>
          <DateInput value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        </Field>
        <Field label={t("tenancies.securityDeposit")} error={err("securityDepositSen")}>
          <MoneyInput value={f.security} onChange={(e) => setF({ ...f, security: e.target.value })} />
        </Field>
        <Field label={t("tenancies.utilityDeposit")} error={err("utilityDepositSen")}>
          <MoneyInput value={f.utility} onChange={(e) => setF({ ...f, utility: e.target.value })} />
        </Field>
        <Field label={t("tenancies.terms")} hint={t("tenancies.termsHint")} optional className="sm:col-span-2">
          <TextArea value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} rows={5} />
        </Field>
      </div>
    </Shell>
  );
}

export function MoveInDialog({ open, tenancy, onClose }: { open: boolean; tenancy: TenancyDetail; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const save = useMutation("tenancies.moveIn");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [sec, setSec] = useState("");
  const [util, setUtil] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [local, setLocal] = useState<Errors>({});
  useEffect(() => {
    if (!open) return;
    save.reset();
    setLocal({});
    setDate(tenancy.startDate > today ? tenancy.startDate : today);
    setNotes("");
    const received = (type: DepositType) =>
      tenancy.deposits.entries.filter((e) => !e.voidedAt && e.depositType === type).reduce((s, e) => s + (e.kind === "received" ? e.amountSen : -e.amountSen), 0);
    setSec(senText(Math.max(0, tenancy.securityDepositSen - received("security")) || null));
    setUtil(senText(Math.max(0, tenancy.utilityDepositSen - received("utility")) || null));
    setMethod("bank_transfer");
    setReference("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = async () => {
    const s = moneyField(sec);
    const u = moneyField(util);
    const e: Errors = {};
    if (s.error) e.sec = s.error;
    if (u.error) e.util = u.error;
    setLocal(e);
    if (Object.keys(e).length) return;
    const deposits = [
      ...(s.sen ? [{ depositType: "security" as const, amountSen: s.sen, method, reference }] : []),
      ...(u.sen ? [{ depositType: "utility" as const, amountSen: u.sen, method, reference }] : []),
    ];
    if (await save.run({ id: tenancy.id, movedInOn: date, notes, depositReceived: deposits })) {
      toast({ tone: "success", message: t("tenancies.saved") });
      onClose();
    }
  };
  return (
    <Shell open={open} onClose={onClose} title={t("tenancies.moveInTitle")} pending={save.pending} error={save.error} submitLabel={t("tenancies.actions.moveIn")} onSubmit={() => void submit()} width={620}>
      <Field label={t("tenancies.moveInDate")} error={save.fields.movedInOn}>
        <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label={t("tenancies.moveInNotes")} hint={t("tenancies.moveInNotesHint")} optional>
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </Field>
      <fieldset className="rounded-xl border border-[var(--hairline)] p-4">
        <legend className="px-1.5 text-[13px] font-semibold">{t("tenancies.moveInDeposits")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("enums.depositType.security")} optional error={local.sec}>
            <MoneyInput value={sec} onChange={(e) => setSec(e.target.value)} />
          </Field>
          <Field label={t("enums.depositType.utility")} optional error={local.util}>
            <MoneyInput value={util} onChange={(e) => setUtil(e.target.value)} />
          </Field>
          <Field label={t("rent.method")}>
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={methodOptions()} />
          </Field>
          <Field label={t("rent.reference")} optional>
            <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        <p className="mt-3 text-[12.5px] text-ink-3">{t("tenancies.depositsHelp")}</p>
      </fieldset>
    </Shell>
  );
}

export function MoveOutDialog({ open, tenancy, onClose }: { open: boolean; tenancy: TenancyDetail; onClose: () => void }) {
  const toast = useToast();
  const today = useToday();
  const save = useMutation("tenancies.moveOut");
  const held = tenancy.deposits.heldSen;
  const [f, setF] = useState({ date: "", notes: "", voidLater: true, refund: "", deduct: "", reason: "", method: "bank_transfer" as PaymentMethod, reference: "" });
  const [local, setLocal] = useState<Errors>({});
  useEffect(() => {
    if (!open) return;
    save.reset();
    setLocal({});
    setF({ date: tenancy.endDate && tenancy.endDate < today ? tenancy.endDate : today, notes: "", voidLater: true, refund: senText(held || null), deduct: "", reason: "", method: "bank_transfer", reference: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = async () => {
    const r = moneyField(f.refund);
    const d = moneyField(f.deduct);
    const e: Errors = {};
    if (r.error) e.refund = r.error;
    if (d.error) e.deduct = d.error;
    if ((d.sen ?? 0) > 0 && !f.reason.trim()) e.reason = "validation.deductReason";
    setLocal(e);
    if (Object.keys(e).length) return;
    const deposit = held > 0 && ((r.sen ?? 0) > 0 || (d.sen ?? 0) > 0) ? { refundSen: r.sen ?? 0, deductSen: d.sen ?? 0, deductReason: f.reason, method: f.method, reference: f.reference } : null;
    if (await save.run({ id: tenancy.id, movedOutOn: f.date, notes: f.notes, voidChargesAfterMoveOut: f.voidLater, deposit })) {
      toast({ tone: "success", message: t("tenancies.saved") });
      onClose();
    }
  };
  return (
    <Shell open={open} onClose={onClose} title={t("tenancies.moveOutTitle")} pending={save.pending} error={save.error} submitLabel={t("tenancies.actions.moveOut")} onSubmit={() => void submit()} width={640}>
      <Field label={t("tenancies.moveOutDate")} hint={t("tenancies.moveOutDateHint")} error={save.fields.movedOutOn}>
        <DateInput value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </Field>
      <Field label={t("tenancies.moveOutNotes")} hint={t("tenancies.moveOutNotesHint")} optional>
        <TextArea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} />
      </Field>
      <Checkbox label={t("tenancies.voidLater")} checked={f.voidLater} onChange={(v) => setF({ ...f, voidLater: v })} />
      {held > 0 && (
        <fieldset className="rounded-xl border border-[var(--hairline)] p-4">
          <legend className="px-1.5 text-[13px] font-semibold">{t("tenancies.depositReturn")}</legend>
          <p className="mb-3 text-[13px] text-ink-2">{t("tenancies.heldAmount", { amount: formatRM(held) })}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("tenancies.refund")} error={local.refund ?? save.fields["deposit.refundSen"]}>
              <MoneyInput value={f.refund} onChange={(e) => setF({ ...f, refund: e.target.value })} />
            </Field>
            <Field label={t("tenancies.deduct")} optional error={local.deduct}>
              <MoneyInput value={f.deduct} onChange={(e) => setF({ ...f, deduct: e.target.value })} />
            </Field>
            <Field label={t("tenancies.deductReason")} optional error={local.reason ?? save.fields["deposit.deductReason"]} className="sm:col-span-2">
              <TextInput value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </Field>
            <Field label={t("rent.method")}>
              <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })} options={methodOptions()} />
            </Field>
            <Field label={t("rent.reference")} optional>
              <TextInput value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
            </Field>
          </div>
        </fieldset>
      )}
    </Shell>
  );
}

export function CancelTenancyDialog({ open, tenancy, onClose }: { open: boolean; tenancy: TenancyDetail; onClose: () => void }) {
  const save = useMutation("tenancies.cancel");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) {
      setReason("");
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Shell open={open} onClose={onClose} title={t("tenancies.cancelTitle")} description={t("tenancies.cancelBody")} pending={save.pending} error={save.error} submitLabel={t("tenancies.actions.cancel")} danger onSubmit={async () => { if (await save.run({ id: tenancy.id, reason })) onClose(); }}>
      <Field label={t("tenancies.cancelReason")} optional>
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Shell>
  );
}

export function ChargeDialog({ open, tenancyId, charge, onClose }: { open: boolean; tenancyId: string; charge: Charge | null; onClose: () => void }) {
  const today = useToday();
  const add = useMutation("rent.addCharge");
  const edit = useMutation("rent.updateCharge");
  const m = charge ? edit : add;
  const [f, setF] = useState({ kind: "utilities" as Exclude<ChargeKind, "rent">, description: "", amount: "", dueDate: today });
  const [local, setLocal] = useState<Errors>({});
  useEffect(() => {
    if (!open) return;
    add.reset();
    edit.reset();
    setLocal({});
    setF(charge ? { kind: charge.kind === "rent" ? "other" : charge.kind, description: charge.description, amount: senText(charge.amountSen), dueDate: charge.dueDate } : { kind: "utilities", description: "", amount: "", dueDate: today });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = async () => {
    const a = moneyField(f.amount, { required: true, positive: true });
    setLocal(a.error ? { amountSen: a.error } : {});
    if (a.error) return;
    const ok = charge
      ? await edit.run({ id: charge.id, description: f.description, amountSen: a.sen!, dueDate: f.dueDate })
      : await add.run({ tenancyId, kind: f.kind, description: f.description, amountSen: a.sen!, dueDate: f.dueDate });
    if (ok) onClose();
  };
  const err = (k: string) => local[k] ?? m.fields[k] ?? null;
  return (
    <Shell open={open} onClose={onClose} title={charge ? t("rent.editCharge") : t("rent.addCharge")} pending={m.pending} error={m.error} submitLabel={t("common.save")} onSubmit={() => void submit()}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!charge && (
          <Field label={t("rent.chargeKind")}>
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Exclude<ChargeKind, "rent"> })} options={CHARGE_KINDS.filter((k) => k !== "rent").map((k) => ({ value: k, label: t(`enums.chargeKind.${k}` as MessageKey) }))} />
          </Field>
        )}
        <Field label={t("rent.chargeAmount")} error={err("amountSen")}>
          <MoneyInput value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label={t("rent.chargeDescription")} error={err("description")} className="sm:col-span-2">
          <TextInput value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label={t("rent.chargeDueDate")} error={err("dueDate")}>
          <DateInput value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </Field>
      </div>
    </Shell>
  );
}

export function VoidDialog({ open, kind, id, onClose }: { open: boolean; kind: "charge" | "payment"; id: string | null; onClose: () => void }) {
  const voidCharge = useMutation("rent.voidCharge");
  const voidPayment = useMutation("rent.voidPayment");
  const m = kind === "charge" ? voidCharge : voidPayment;
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) {
      setReason("");
      voidCharge.reset();
      voidPayment.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={kind === "charge" ? t("rent.voidCharge") : t("rent.voidPayment")}
      description={kind === "charge" ? t("rent.voidChargeBody") : t("rent.voidPaymentBody")}
      pending={m.pending}
      error={m.error}
      danger
      submitLabel={kind === "charge" ? t("rent.voidCharge") : t("rent.voidPayment")}
      onSubmit={async () => {
        if (!id) return;
        if (await m.run({ id, reason })) onClose();
      }}
    >
      <Field label={t("rent.voidReason")} optional>
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Shell>
  );
}

export function ChangeRentDialog({ open, tenancy, onClose }: { open: boolean; tenancy: TenancyDetail; onClose: () => void }) {
  const today = useToday();
  const save = useMutation("rent.setSchedule");
  const [f, setF] = useState({ month: "", amount: "", dueDay: "", apply: false });
  const [local, setLocal] = useState<Errors>({});
  useEffect(() => {
    if (!open) return;
    save.reset();
    setLocal({});
    const next = addMonthsToMonth(monthOf(today), 1);
    setF({ month: next < tenancy.rentStartMonth ? tenancy.rentStartMonth : next, amount: senText(tenancy.monthlyRentSen), dueDay: String(tenancy.rentDueDay), apply: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = async () => {
    const a = moneyField(f.amount, { required: true, positive: true });
    setLocal(a.error ? { amountSen: a.error } : {});
    if (a.error) return;
    if (await save.run({ tenancyId: tenancy.id, effectiveMonth: f.month, amountSen: a.sen!, dueDay: Number(f.dueDay), applyToUnpaid: f.apply })) onClose();
  };
  return (
    <Shell open={open} onClose={onClose} title={t("rent.changeRentTitle")} description={t("tenancies.scheduleHelp")} pending={save.pending} error={save.error} submitLabel={t("common.save")} onSubmit={() => void submit()}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("rent.changeRentFrom")} error={save.fields.effectiveMonth} hint={isYearMonth(f.month) ? formatMonth(f.month) : undefined}>
          <input type="month" className="control tnum" value={f.month} min={tenancy.rentStartMonth} onChange={(e) => setF({ ...f, month: e.target.value })} />
        </Field>
        <Field label={t("rent.changeRentAmount")} error={local.amountSen ?? save.fields.amountSen}>
          <MoneyInput value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label={t("rent.changeRentDueDay")} error={save.fields.dueDay}>
          <TextInput value={f.dueDay} onChange={(e) => setF({ ...f, dueDay: e.target.value })} inputMode="numeric" />
        </Field>
      </div>
      <Checkbox label={t("rent.applyToUnpaid")} checked={f.apply} onChange={(v) => setF({ ...f, apply: v })} />
    </Shell>
  );
}

export function DepositDialog({ open, tenancy, onClose }: { open: boolean; tenancy: TenancyDetail; onClose: () => void }) {
  const today = useToday();
  const save = useMutation("deposits.record");
  const [f, setF] = useState({ type: "security" as DepositType, kind: "received" as DepositEntryKind, amount: "", date: today, method: "bank_transfer" as PaymentMethod | "", reference: "", notes: "" });
  const [local, setLocal] = useState<Errors>({});
  useEffect(() => {
    if (!open) return;
    save.reset();
    setLocal({});
    setF({ type: "security", kind: "received", amount: "", date: today, method: "bank_transfer", reference: "", notes: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = async () => {
    const a = moneyField(f.amount, { required: true, positive: true });
    setLocal(a.error ? { amountSen: a.error } : {});
    if (a.error) return;
    if (
      await save.run({ tenancyId: tenancy.id, depositType: f.type, kind: f.kind, amountSen: a.sen!, occurredOn: f.date, method: f.kind === "deducted" || !f.method ? null : f.method, reference: f.reference, notes: f.notes })
    )
      onClose();
  };
  const err = (k: string) => local[k] ?? save.fields[k] ?? null;
  return (
    <Shell open={open} onClose={onClose} title={t("deposits.title")} description={t("tenancies.depositsHelp")} pending={save.pending} error={save.error} submitLabel={t("common.save")} onSubmit={() => void submit()}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("deposits.type")}>
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as DepositType })} options={DEPOSIT_TYPES.map((d) => ({ value: d, label: t(`enums.depositType.${d}` as MessageKey) }))} />
        </Field>
        <Field label={t("deposits.kind")}>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as DepositEntryKind })} options={DEPOSIT_ENTRY_KINDS.map((d) => ({ value: d, label: t(`enums.depositKind.${d}` as MessageKey) }))} />
        </Field>
        <Field label={t("deposits.amount")} error={err("amountSen")} hint={f.kind !== "received" ? t("tenancies.heldAmount", { amount: formatRM(tenancy.deposits.heldSen) }) : undefined}>
          <MoneyInput value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label={t("deposits.date")} error={err("occurredOn")}>
          <DateInput value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        {f.kind !== "deducted" && (
          <Field label={t("deposits.method")}>
            <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })} options={methodOptions()} />
          </Field>
        )}
        <Field label={t("deposits.reference")} optional>
          <TextInput value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
        <Field label={t("deposits.notes")} hint={f.kind === "deducted" ? t("deposits.notesDeductHint") : undefined} optional={f.kind !== "deducted"} error={err("notes")} className="sm:col-span-2">
          <TextArea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} />
        </Field>
      </div>
    </Shell>
  );
}
