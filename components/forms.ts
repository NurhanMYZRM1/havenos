"use client";

import { useApi } from "@/lib/api/hooks";
import { todayInMalaysia } from "@/lib/domain/dates";
import { parseRinggit, senToDecimal, type Sen } from "@/lib/domain/money";
import { moneyErrorKey } from "@/lib/domain/validate";
import type { MessageKey } from "@/lib/i18n";

/** Parse a ringgit text field into sen, or an error key for the form. */
export function moneyField(
  value: string,
  opts: { required?: boolean; positive?: boolean } = {},
): { sen: Sen | null; error: MessageKey | null } {
  if (!value.trim()) return { sen: null, error: opts.required ? "validation.required" : null };
  const parsed = parseRinggit(value);
  if (!parsed.ok) return { sen: null, error: moneyErrorKey(parsed.error) };
  if (opts.positive && parsed.sen === 0) return { sen: null, error: "validation.amountPositive" };
  return { sen: parsed.sen, error: null };
}

/** Sen → editable text ("1250.00"), blank for null. */
export function senText(sen: Sen | null | undefined): string {
  return sen === null || sen === undefined ? "" : senToDecimal(sen);
}

/** Today in Malaysia as the desktop app sees it. */
export function useToday(): string {
  const info = useApi("app.info", undefined);
  return info.data?.today ?? todayInMalaysia();
}

export function newStagingKey(): string {
  return `stage-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
