import type { StayAlert } from "@/lib/api/contract";
import { formatDate } from "@/lib/domain/format";
import { t, type MessageKey } from "@/lib/i18n";

/** Same wording as components/stays/shared.tsx alertMessage(). */
export function alertMessage(a: StayAlert): string {
  const where = a.spacePath ? `${a.spacePath} (${a.propertyName})` : a.propertyName;
  const date = a.date ? formatDate(a.date) : t("shortStays.alerts.noDate");
  return t(`shortStays.alerts.kinds.${a.kind}` as MessageKey, { ...a.params, where, date });
}

/** Desktop links like "/stays/turnover/?id=x#y" → native routes. */
export function stayHref(href: string): string {
  const [path, query] = href.split("#")[0].split("?");
  const clean = path.replace(/\/+$/, "") || "/stays";
  return query ? `${clean}?${query}` : clean;
}
