// JSON across the native <-> DOM-component boundary, with Uint8Array
// carried as base64 (attachments dropped into a form, for example).
const TAG = "__bytes";

function toBase64(bytes: Uint8Array): string {
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(bytes).toString("base64");
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const B = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (B) return new Uint8Array(B.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encode(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value, (_k, v) => (v instanceof Uint8Array ? { [TAG]: toBase64(v) } : v));
}

export function decode<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v) => (v && typeof v === "object" && typeof v[TAG] === "string" && Object.keys(v).length === 1 ? fromBase64(v[TAG]) : v));
}
