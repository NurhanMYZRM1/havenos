"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DesktopRequired } from "@/components/shell/desktop-required";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage, getBridge } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import { formatDate, formatTimestamp } from "@/lib/domain/format";
import { formatRM } from "@/lib/domain/money";
import { formatPhone } from "@/lib/domain/phone";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * A printable receipt. Printed from here (system print dialog) or rendered
 * off-screen by the desktop app to save as PDF.
 */
function Receipt() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const printMode = params.get("print") === "1";
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const receipt = useApi("rent.receipt", { paymentId: id }, { enabled: !!id });

  useEffect(() => {
    if (receipt.data) document.documentElement.dataset.receiptReady = "1";
  }, [receipt.data]);

  if (receipt.error) return <p className="p-10 text-[14px]">{receipt.error}</p>;
  if (!receipt.data) return <p className="p-10 text-[14px] text-ink-3">{t("common.loading")}</p>;
  const r = receipt.data;
  const p = r.payment;
  const landlord = r.landlord;

  const savePdf = async () => {
    setSaving(true);
    try {
      const saved = await api("rent.saveReceiptPdf", { paymentId: p.id });
      if (saved) toast({ tone: "success", message: t("receipt.saved", { path: saved.path }) });
    } catch (err) {
      toast({ tone: "error", message: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[170px_1fr] gap-4 border-b border-[#e6e2d8] py-2.5 text-[14px]">
      <dt className="text-[#6b675f]">{label}</dt>
      <dd className="text-[#141414]">{value}</dd>
    </div>
  );

  return (
    <div className={printMode ? "bg-white" : "min-h-dvh bg-bg py-8"}>
      {!printMode && (
        <div className="no-print mx-auto mb-5 flex max-w-[760px] flex-wrap items-center justify-between gap-3 px-4">
          <Button variant="ghost" onClick={() => router.push(`/tenancies/view?id=${p.tenancyId}`)} icon={<Icon name="arrowLeft" size={15} />}>
            {t("receipt.back")}
          </Button>
          <div className="flex gap-2.5">
            <Button onClick={() => window.print()} icon={<Icon name="printer" size={15} />}>
              {t("receipt.print")}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void savePdf()} icon={<Icon name="download" size={15} />}>
              {t("receipt.savePdf")}
            </Button>
          </div>
          {!landlord.landlordName && <p className="w-full text-[12.5px] text-ink-3">{t("receipt.setDetails")}</p>}
        </div>
      )}
      <article className="mx-auto max-w-[760px] bg-white px-10 py-10 text-[#141414] shadow-xl print:shadow-none" style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[#141414] pb-5">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-fraunces), Georgia, serif" }}>
              {t("receipt.title")}
            </h1>
            {landlord.landlordName && <p className="mt-2 text-[14px] font-medium">{landlord.landlordName}</p>}
            {landlord.address && <p className="whitespace-pre-line text-[13px] text-[#4a4740]">{landlord.address}</p>}
            {(landlord.contactPhone || landlord.contactEmail) && (
              <p className="text-[13px] text-[#4a4740]">{[formatPhone(landlord.contactPhone), landlord.contactEmail].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-[12px] uppercase tracking-wider text-[#6b675f]">{t("receipt.receiptNo")}</div>
            <div className="text-[20px] font-semibold tabular-nums">{p.receiptNo}</div>
            <div className="mt-2 text-[12px] uppercase tracking-wider text-[#6b675f]">{t("receipt.date")}</div>
            <div className="text-[15px] tabular-nums">{formatDate(p.receivedOn)}</div>
          </div>
        </header>
        {p.voidedAt && (
          <p className="mt-5 rounded border-2 border-[#b3261e] px-4 py-3 text-[14px] font-semibold text-[#b3261e]">
            {t("receipt.voided", { date: formatTimestamp(p.voidedAt), reason: p.voidReason || "—" })}
          </p>
        )}
        <dl className="mt-6">
          {row(t("receipt.receivedFrom"), <>{r.tenantName}{r.tenantPhone ? ` · ${formatPhone(r.tenantPhone)}` : ""}</>)}
          {row(t("receipt.amount"), <span className="text-[18px] font-semibold tabular-nums">{formatRM(p.amountSen)}</span>)}
          {row(t("receipt.for"), p.description || "—")}
          {row(t("receipt.method"), t(`enums.paymentMethod.${p.method}` as MessageKey))}
          {p.reference && row(t("receipt.reference"), p.reference)}
          {row(t("receipt.property"), <>{r.propertyName}<div className="text-[12.5px] text-[#6b675f]">{r.propertyAddress}</div></>)}
          {row(t("receipt.space"), r.spacePath)}
          {row(t("receipt.tenancy"), r.tenancyRef)}
        </dl>
        {landlord.receiptNote && <p className="mt-6 whitespace-pre-line text-[13px] text-[#4a4740]">{landlord.receiptNote}</p>}
        <footer className="mt-10 flex items-end justify-between gap-6 text-[12px] text-[#6b675f]">
          <p className="text-[14px] text-[#141414]">{t("receipt.thankYou")}</p>
          <p>{t("receipt.generated")}</p>
        </footer>
      </article>
    </div>
  );
}

function ReceiptGate() {
  const [bridge, setBridge] = useState<boolean | null>(null);
  useEffect(() => setBridge(!!getBridge()), []);
  if (bridge === null) return null;
  if (!bridge) return <DesktopRequired />;
  return <Receipt />;
}

export default function ReceiptPage() {
  return (
    <Suspense fallback={null}>
      <ReceiptGate />
    </Suspense>
  );
}
