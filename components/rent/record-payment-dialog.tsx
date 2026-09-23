"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AttachmentList } from "@/components/files";
import { moneyField, newStagingKey, senText, useToday } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { DateInput, Field, FormError, MoneyInput, Select, TextArea, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useApi, useMutation } from "@/lib/api/hooks";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/domain/enums";
import { formatRM } from "@/lib/domain/money";
import { t, type MessageKey } from "@/lib/i18n";

/** Record money received from a tenant. Issues a numbered receipt. */
export function RecordPaymentDialog({ open, tenancyId, onClose }: { open: boolean; tenancyId: string | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const today = useToday();
  const tenancies = useApi("tenancies.list", { filter: "all", propertyId: null, tenantId: null }, { enabled: open });
  const [chosen, setChosen] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [stagingKey, setStagingKey] = useState(newStagingKey);
  const [localErrors, setLocalErrors] = useState<Record<string, MessageKey>>({});
  const save = useMutation("rent.recordPayment");
  const staged = useApi("attachments.list", { owner: { kind: "staging", id: stagingKey } }, { enabled: open });

  const options = useMemo(
    () => (tenancies.data ?? []).filter((x) => x.status !== "cancelled" && (x.status !== "ended" || x.balanceSen > 0) || x.id === tenancyId),
    [tenancies.data, tenancyId],
  );
  const selected = options.find((o) => o.id === (tenancyId ?? chosen));

  useEffect(() => {
    if (!open) return;
    setChosen(tenancyId ?? "");
    setAmount("");
    setReceivedOn(today);
    setMethod("bank_transfer");
    setReference("");
    setDescription("");
    setNotes("");
    setStagingKey(newStagingKey());
    setLocalErrors({});
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tenancyId]);

  useEffect(() => {
    if (open && selected && !amount && selected.balanceSen > 0) setAmount(senText(selected.balanceSen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected?.id]);

  const submit = async () => {
    const errors: Record<string, MessageKey> = {};
    const id = tenancyId ?? chosen;
    if (!id) errors.tenancyId = "validation.chooseOne";
    const money = moneyField(amount, { required: true, positive: true });
    if (money.error) errors.amountSen = money.error;
    setLocalErrors(errors);
    if (Object.keys(errors).length) return;
    const payment = await save.run({ tenancyId: id, receivedOn, amountSen: money.sen!, method, reference, description, notes, stagingKey });
    if (payment) {
      toast({
        tone: "success",
        message: t("rent.recorded", { no: payment.receiptNo }),
        action: { label: t("rent.viewReceipt"), onClick: () => router.push(`/receipt?id=${payment.id}`) },
      });
      onClose();
    }
  };

  const err = (k: string) => localErrors[k] ?? save.fields[k] ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("rent.paymentTitle")}
      width={620}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={save.pending}>
            {save.pending ? t("rent.saving") : t("rent.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {tenancyId && selected ? (
          <div className="sm:col-span-2 rounded-lg bg-surface-2 px-3.5 py-3 text-[13.5px]">
            <div className="font-medium">{selected.tenantName}</div>
            <div className="text-ink-3">
              {selected.spacePath} · {selected.propertyName}
            </div>
          </div>
        ) : (
          <Field label={t("rent.tenancy")} error={err("tenancyId")} className="sm:col-span-2">
            <Select
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              placeholder={tenancies.loading ? t("common.loading") : t("rent.chooseTenancy")}
              options={options.map((o) => ({ value: o.id, label: `${o.tenantName} — ${o.spacePath}, ${o.propertyName}${o.balanceSen > 0 ? ` (${formatRM(o.balanceSen)})` : ""}` }))}
            />
          </Field>
        )}
        <Field label={t("rent.amount")} error={err("amountSen")} hint={selected ? t("rent.amountHint", { amount: formatRM(Math.max(0, selected.balanceSen)) }) : undefined}>
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label={t("rent.receivedOn")} error={err("receivedOn")}>
          <DateInput value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        </Field>
        <Field label={t("rent.method")} error={err("method")}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`enums.paymentMethod.${m}` as MessageKey) }))} />
        </Field>
        <Field label={t("rent.reference")} hint={t("rent.referenceHint")} optional error={err("reference")}>
          <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label={t("rent.description")} hint={t("rent.descriptionHint")} optional className="sm:col-span-2" error={err("description")}>
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t("rent.notes")} optional className="sm:col-span-2">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-2 text-[13px] font-medium">{t("rent.attachProof")}</div>
          <AttachmentList owner={{ kind: "staging", id: stagingKey }} files={staged.data ?? []} purpose="receipt" />
        </div>
        <div className="sm:col-span-2">
          <FormError message={save.error} />
        </div>
      </div>
    </Modal>
  );
}
