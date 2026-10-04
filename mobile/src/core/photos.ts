// The desktop core resizes photos synchronously through an ImageProcessor
// (Electron's nativeImage). Expo's image tools are async, so photos are
// prepared before they reach the core, and the processor hands back the
// prepared result, matched by content hash.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Buffer } from "buffer";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ImageProcessor } from "@/desktop/core/context";

const MAX_SIDE = 2000;
const THUMB_SIDE = 400;

interface Prepared {
  width: number;
  height: number;
  thumb: Buffer;
}

const prepared = new Map<string, Prepared>();

async function render(uri: string, maxSide: number, compress: number) {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const scale = Math.min(1, maxSide / Math.max(original.width, original.height));
  const ctx = ImageManipulator.manipulate(uri);
  if (scale < 1) ctx.resize({ width: Math.round(original.width * scale), height: Math.round(original.height * scale) });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/** Resize a picked photo to a bounded JPEG; returns its file URI. */
export async function preparePhoto(uri: string): Promise<string> {
  const full = await render(uri, MAX_SIDE, 0.8);
  const thumb = await render(full.uri, THUMB_SIDE, 0.7);
  const fullBytes = new File(full.uri).bytesSync();
  prepared.set(bytesToHex(sha256(fullBytes)), {
    width: full.width,
    height: full.height,
    thumb: Buffer.from(new File(thumb.uri).bytesSync()),
  });
  new File(thumb.uri).delete();
  return full.uri;
}

export const mobileImages: ImageProcessor = {
  process(bytes, mime) {
    const key = bytesToHex(sha256(bytes));
    const hit = prepared.get(key);
    if (!hit) return null;
    prepared.delete(key);
    return { bytes, mime, width: hit.width, height: hit.height, thumb: hit.thumb };
  },
};
