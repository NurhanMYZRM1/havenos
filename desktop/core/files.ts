import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AttachmentPurpose } from "../../lib/domain/enums";
import type { Core } from "./context";
import { AppError } from "./errors";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface SniffedType {
  mime: string;
  ext: string;
  /** Chromium can display it inline. */
  displayable: boolean;
}

function startsWith(b: Buffer, sig: number[], offset = 0): boolean {
  if (b.length < offset + sig.length) return false;
  return sig.every((v, i) => b[offset + i] === v);
}

/**
 * Identify a file by its content, not its name. Only formats a landlord
 * plausibly needs are accepted: photos, PDFs, Office documents, plain text.
 */
export function sniffType(bytes: Buffer, fileName: string): SniffedType | null {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", displayable: true };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png", displayable: true };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { mime: "image/gif", ext: "gif", displayable: true };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: "image/webp", ext: "webp", displayable: true };
  }
  if (bytes.length > 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) return { mime: "image/heic", ext: "heic", displayable: false };
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf", displayable: false };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const office: Record<string, string> = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    return office[ext] ? { mime: office[ext], ext, displayable: false } : null;
  }
  if ((ext === "txt" || ext === "csv") && !bytes.subarray(0, 4096).includes(0)) {
    return { mime: ext === "csv" ? "text/csv" : "text/plain", ext, displayable: false };
  }
  return null;
}

export interface StoredFile {
  storedName: string;
  thumbName: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  fileName: string;
}

function writeDurably(file: string, data: Buffer) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, { flush: true });
  fs.renameSync(tmp, file);
}

export function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").trim();
  return (base || "file").slice(0, 150);
}

/**
 * Validate and copy a file into the attachments folder. Photos are re-encoded
 * (bounded size, orientation baked in) and thumbnailed when an image
 * processor is available.
 */
export function storeFile(core: Core, input: { name: string; bytes: Buffer; purpose: AttachmentPurpose }): StoredFile {
  const fileName = safeFileName(input.name);
  if (input.bytes.length === 0) throw new AppError("VALIDATION", "validation.fileType", { params: { name: fileName } });
  if (input.bytes.length > MAX_FILE_BYTES) {
    throw new AppError("VALIDATION", "validation.fileTooLarge", { params: { name: fileName, max: MAX_FILE_BYTES / (1024 * 1024) } });
  }
  const type = sniffType(input.bytes, fileName);
  if (!type || (input.purpose === "photo" && !type.displayable)) {
    throw new AppError("VALIDATION", "validation.fileType", { params: { name: fileName } });
  }
  let bytes = input.bytes;
  let mime = type.mime;
  let ext = type.ext;
  let width: number | null = null;
  let height: number | null = null;
  let thumb: Buffer | null = null;
  if (type.displayable) {
    const processed = core.images.process(input.bytes, type.mime);
    if (processed) {
      bytes = processed.bytes;
      mime = processed.mime;
      ext = processed.mime === "image/png" ? "png" : processed.mime === "image/jpeg" ? "jpg" : ext;
      width = processed.width;
      height = processed.height;
      thumb = processed.thumb;
    }
  }
  const id = crypto.randomUUID();
  const storedName = `${id}.${ext}`;
  writeDurably(path.join(core.attachmentsDir, storedName), bytes);
  let thumbName: string | null = null;
  if (thumb) {
    thumbName = `${id}.thumb.jpg`;
    writeDurably(path.join(core.attachmentsDir, thumbName), thumb);
  }
  return {
    storedName,
    thumbName,
    mimeType: mime,
    sizeBytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    width,
    height,
    fileName,
  };
}

/** Resolve a stored name to an absolute path, refusing anything outside the folder. */
export function attachmentPath(core: Core, storedName: string): string {
  if (!/^[0-9a-f-]{36}(\.thumb)?\.[a-z0-9]{2,5}$/.test(storedName)) throw new AppError("NOT_FOUND", "errors.notFound");
  return path.join(core.attachmentsDir, storedName);
}

/**
 * Delete files no row references (left by deletes, cascades, or an
 * interrupted import) and expire form uploads that were never saved.
 */
export function sweepAttachments(core: Core, opts: { stagingMaxAgeMs?: number; minFileAgeMs?: number } = {}) {
  const cutoff = new Date(core.now().getTime() - (opts.stagingMaxAgeMs ?? 24 * 3600_000)).toISOString();
  core.db.run("DELETE FROM attachments WHERE staging_key IS NOT NULL AND created_at < ?", [cutoff]);
  const referenced = new Set<string>();
  for (const row of core.db.all<{ stored_name: string; thumb_name: string | null }>("SELECT stored_name, thumb_name FROM attachments")) {
    referenced.add(row.stored_name);
    if (row.thumb_name) referenced.add(row.thumb_name);
  }
  const minAge = opts.minFileAgeMs ?? 60_000;
  let removed = 0;
  for (const name of fs.readdirSync(core.attachmentsDir)) {
    if (referenced.has(name)) continue;
    const full = path.join(core.attachmentsDir, name);
    const stat = fs.statSync(full);
    if (!stat.isFile() || Date.now() - stat.mtimeMs < minAge) continue;
    fs.rmSync(full, { force: true });
    removed++;
  }
  return removed;
}

export function folderStats(dir: string): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  if (!fs.existsSync(dir)) return { count, bytes };
  for (const name of fs.readdirSync(dir)) {
    const stat = fs.statSync(path.join(dir, name));
    if (stat.isFile()) {
      count++;
      bytes += stat.size;
    }
  }
  return { count, bytes };
}
