/**
 * Message catalogs. English is the only catalog today; every UI label goes
 * through `t()` so a Bahasa Malaysia catalog (`ms.ts`, same shape, any subset
 * of keys) can be added later and missing keys fall back to English.
 */

import { en } from "./en";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;
export type Locale = "en";
export type MessageParams = Record<string, string | number>;

const catalogs: Record<Locale, unknown> = { en };
let locale: Locale = "en";

export function setLocale(next: Locale) {
  locale = next;
}

export function getLocale(): Locale {
  return locale;
}

function lookup(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Translate `key`, interpolating `{name}` placeholders from `params`. */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = lookup(catalogs[locale], key) ?? lookup(en, key) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Pick the singular or plural form: `plural(n, "common.unitOne", "common.unitMany")`. */
export function plural(n: number, one: MessageKey, many: MessageKey, params?: MessageParams): string {
  return t(n === 1 ? one : many, { n, ...params });
}

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === "string" && lookup(en, value) !== undefined;
}
