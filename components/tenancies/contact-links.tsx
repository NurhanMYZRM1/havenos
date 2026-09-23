"use client";

import { api } from "@/lib/api/client";
import { phoneDigits } from "@/lib/domain/phone";
import { t } from "@/lib/i18n";

/** Call / WhatsApp / email links, opened by the operating system. */
export function ContactLinks({ phone, email, label }: { phone?: string; email?: string; label: string }) {
  const open = (url: string) => void api("app.openExternal", { url }).catch(() => undefined);
  const link = "rounded-md px-2 py-0.5 text-[12.5px] font-medium text-brass-bright hover:bg-surface-2";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tnum">{label}</span>
      {phone && (
        <>
          <button type="button" className={link} onClick={() => open(`tel:${phone}`)}>
            {t("common.call")}
          </button>
          <button type="button" className={link} onClick={() => open(`https://wa.me/${phoneDigits(phone)}`)}>
            {t("common.whatsapp")}
          </button>
        </>
      )}
      {email && (
        <button type="button" className={link} onClick={() => open(`mailto:${email}`)}>
          {t("common.email")}
        </button>
      )}
    </span>
  );
}
