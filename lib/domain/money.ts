/**
 * Money is always an integer number of sen (1 RM = 100 sen). Never do
 * arithmetic on ringgit floats — parse user input straight into sen and
 * format sen straight back out.
 */

export type Sen = number;

/** Largest amount a single field accepts: RM 99,999,999.99. */
export const MAX_SEN = 9_999_999_999;

export function isSen(value: unknown): value is Sen {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export type ParseMoneyError = "empty" | "invalid" | "negative" | "too_precise" | "too_large";

export type ParseMoneyResult = { ok: true; sen: Sen } | { ok: false; error: ParseMoneyError };

/**
 * Parse what a landlord types ("1,250", "RM 1250.50", "0.5") into sen.
 * Thousands separators and a leading "RM" are accepted; more than two decimal
 * places is rejected rather than silently rounded.
 */
export function parseRinggit(input: string): ParseMoneyResult {
  let s = input.trim().replace(/^rm\s*/i, "").replace(/[\s,]/g, "");
  if (s === "") return { ok: false, error: "empty" };
  if (s.startsWith("-")) return { ok: false, error: "negative" };
  if (s.startsWith("+")) s = s.slice(1);
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) return { ok: false, error: "invalid" };
  const whole = m[1] === "" ? "0" : m[1];
  const frac = m[2] ?? "";
  if (frac.length > 2) return { ok: false, error: "too_precise" };
  if (whole.replace(/^0+/, "").length > 8) return { ok: false, error: "too_large" };
  const sen = Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
  if (sen > MAX_SEN) return { ok: false, error: "too_large" };
  return { ok: true, sen };
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "RM 1,234.50". Negative amounts render as "−RM 1,234.50". */
export function formatRM(sen: Sen, opts: { cents?: "always" | "auto" } = {}): string {
  const negative = sen < 0;
  const abs = Math.abs(Math.trunc(sen));
  const ringgit = Math.floor(abs / 100);
  const cents = abs % 100;
  const showCents = opts.cents !== "auto" || cents !== 0;
  const body = `RM ${groupThousands(String(ringgit))}${showCents ? `.${String(cents).padStart(2, "0")}` : ""}`;
  return negative ? `−${body}` : body;
}

/** Plain decimal for form inputs and CSV: 123450 → "1234.50". */
export function senToDecimal(sen: Sen): string {
  const negative = sen < 0;
  const abs = Math.abs(Math.trunc(sen));
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

export function sumSen(values: readonly Sen[]): Sen {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Deposits are usually quoted as "N months of rent". Multipliers are stored
 * in tenths of a month (2 months = 20, half a month = 5) so the product stays
 * in integer arithmetic; the result rounds half up to the nearest sen.
 */
export function monthsOfRent(rentSen: Sen, tenthsOfMonth: number): Sen {
  return Math.floor((rentSen * tenthsOfMonth + 5) / 10);
}
