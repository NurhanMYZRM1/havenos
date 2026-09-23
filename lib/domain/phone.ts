/**
 * Phone numbers are stored in E.164 ("+60123456789") and displayed in the
 * familiar Malaysian grouping ("+60 12-345 6789").
 *
 * Accepted input: "012-345 6789", "+60 12 345 6789", "60123456789",
 * "03-1234 5678", and international numbers written with a leading "+".
 */

export type PhoneResult = { ok: true; e164: string } | { ok: false };

const MY_MOBILE = /^1\d{8,9}$/; // 01X-XXX XXXX / 011-XXXX XXXX
const MY_FIXED = /^[3-9]\d{7,8}$/; // 03-XXXX XXXX, 04-XXX XXXX, 082-XXX XXX …

function malaysian(national: string): PhoneResult {
  return MY_MOBILE.test(national) || MY_FIXED.test(national)
    ? { ok: true, e164: `+60${national}` }
    : { ok: false };
}

export function normalizePhone(input: string): PhoneResult {
  const raw = input.trim();
  if (!raw) return { ok: false };
  if (!/^[+\d\s\-().]+$/.test(raw)) return { ok: false };
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    if (digits.startsWith("60")) return malaysian(digits.slice(2).replace(/^0/, ""));
    return /^[1-9]\d{7,14}$/.test(digits) ? { ok: true, e164: `+${digits}` } : { ok: false };
  }
  if (digits.startsWith("0")) return malaysian(digits.slice(1));
  if (digits.startsWith("60") && digits.length >= 10) return malaysian(digits.slice(2));
  return { ok: false };
}

/** Friendly display: "+60 12-345 6789", "+60 3-1234 5678"; others unchanged. */
export function formatPhone(e164: string): string {
  if (!e164) return "";
  if (!e164.startsWith("+60")) return e164;
  const n = e164.slice(3);
  if (n.startsWith("1")) {
    const prefix = n.slice(0, 2);
    const rest = n.slice(2);
    return rest.length === 8
      ? `+60 ${prefix}-${rest.slice(0, 4)} ${rest.slice(4)}`
      : `+60 ${prefix}-${rest.slice(0, 3)} ${rest.slice(3)}`;
  }
  if (n.startsWith("3")) return `+60 3-${n.slice(1, 5)} ${n.slice(5)}`;
  const area = n.slice(0, n.length === 8 ? 1 : 2);
  const rest = n.slice(area.length);
  return `+60 ${area}-${rest.slice(0, 3)} ${rest.slice(3)}`;
}

/** Digits only, for wa.me / tel: links. */
export function phoneDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}
