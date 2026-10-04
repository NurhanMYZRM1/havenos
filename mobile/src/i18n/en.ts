// The desktop catalogue with "computer" wording adapted for a phone or tablet.
// metro.config.js points lib/i18n/index.ts's `./en` here.
import { en as desktop } from "@/lib/i18n/en";

const REPLACEMENTS: [RegExp, string][] = [
  [/\bthis computer's\b/g, "this device's"],
  [/\bThis computer's\b/g, "This device's"],
  [/\bthis computer\b/g, "this device"],
  [/\bThis computer\b/g, "This device"],
  [/\byour own computer\b/g, "your own device"],
  [/\ba new computer\b/g, "a new device"],
  [/\bseveral computers\b/g, "several devices"],
];

function adapt<T>(node: T): T {
  if (typeof node === "string") return REPLACEMENTS.reduce((s, [re, to]) => s.replace(re, to), node as string) as T;
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, adapt(v)])) as T;
  }
  return node;
}

const adapted = adapt(desktop);

export const en = {
  ...adapted,
  // The phone's photo picker hands HavenOS JPEGs, iPhone HEIC photos included.
  photos: { ...adapted.photos, heicHint: "Photos from your camera or library are resized and saved as JPEG." },
};
