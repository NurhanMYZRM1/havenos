import { nativeImage } from "electron";
import type { ImageProcessor } from "../core/context";

/** EXIF orientation of a JPEG (1 = upright), or 1 when absent/unreadable. */
export function jpegOrientation(buf: Buffer): number {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) return 1;
    const marker = buf[offset + 1];
    const size = buf.readUInt16BE(offset + 2);
    if (marker === 0xe1 && buf.toString("ascii", offset + 4, offset + 10) === "Exif\0\0") {
      const tiff = offset + 10;
      const little = buf.toString("ascii", tiff, tiff + 2) === "II";
      const u16 = (o: number) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o: number) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > buf.length) return 1;
      const entries = u16(ifd);
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > buf.length) return 1;
        if (u16(e) === 0x0112) return u16(e + 8) || 1;
      }
      return 1;
    }
    if (marker === 0xda) return 1; // start of scan: no more metadata
    offset += 2 + size;
  }
  return 1;
}

const THUMB_WIDTH = 720;

/**
 * Photos are stored exactly as imported (so nothing is lost and EXIF
 * rotation still applies when Chromium displays them). A smaller JPEG
 * thumbnail is added for list views when it can be made faithfully —
 * nativeImage ignores EXIF rotation, so rotated phone photos skip it and
 * the original is shown instead.
 */
export const electronImages: ImageProcessor = {
  process(bytes, mime) {
    const img = nativeImage.createFromBuffer(bytes);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const orientation = mime === "image/jpeg" ? jpegOrientation(bytes) : 1;
    const rotated = orientation >= 5 && orientation <= 8;
    const width = rotated ? size.height : size.width;
    const height = rotated ? size.width : size.height;
    let thumb: Buffer | null = null;
    if (orientation === 1 && size.width > THUMB_WIDTH * 1.5 && mime !== "image/gif") {
      thumb = img.resize({ width: THUMB_WIDTH, quality: "good" }).toJPEG(82);
    }
    return { bytes, mime, width, height, thumb };
  },
};
