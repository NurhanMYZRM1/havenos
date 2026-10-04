// The synchronous node:fs calls made by ../desktop/core, on expo-file-system.
// The core works with plain absolute paths; expo-file-system wants file:// URIs.
import { Buffer } from "buffer";
import { Directory, File, Paths } from "expo-file-system";

const uri = (p: string) => (p.startsWith("file://") ? p : `file://${encodeURI(p)}`);

function enoent(syscall: string, p: string): Error {
  const err = new Error(`ENOENT: no such file or directory, ${syscall} '${p}'`) as Error & { code: string };
  err.code = "ENOENT";
  return err;
}

function kind(p: string): "file" | "dir" | null {
  const info = Paths.info(uri(p));
  if (!info.exists) return null;
  return info.isDirectory ? "dir" : "file";
}

export function existsSync(p: string): boolean {
  return kind(p) !== null;
}

export function mkdirSync(p: string, _opts?: { recursive?: boolean }) {
  if (kind(p) === "dir") return;
  new Directory(uri(p)).create({ intermediates: true, idempotent: true });
}

export function rmSync(p: string, opts?: { recursive?: boolean; force?: boolean }) {
  const k = kind(p);
  if (k === null) {
    if (opts?.force) return;
    throw enoent("rm", p);
  }
  if (k === "dir") new Directory(uri(p)).delete();
  else new File(uri(p)).delete();
}

export function unlinkSync(p: string) {
  rmSync(p);
}

export function readdirSync(p: string): string[] {
  if (kind(p) !== "dir") throw enoent("scandir", p);
  return new Directory(uri(p)).list().map((entry) => entry.name);
}

export interface Stats {
  size: number;
  mtimeMs: number;
  mtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
}

export function statSync(p: string): Stats {
  const k = kind(p);
  if (k === null) throw enoent("stat", p);
  const mtimeMs = k === "file" ? (new File(uri(p)).modificationTime ?? Date.now()) : (new Directory(uri(p)).info().modificationTime ?? Date.now());
  const size = k === "file" ? new File(uri(p)).size : (new Directory(uri(p)).size ?? 0);
  return {
    size,
    mtimeMs,
    mtime: new Date(mtimeMs),
    isFile: () => k === "file",
    isDirectory: () => k === "dir",
  };
}

export function readFileSync(p: string, encoding?: BufferEncoding | { encoding?: BufferEncoding }): Buffer | string {
  if (kind(p) !== "file") throw enoent("open", p);
  const enc = typeof encoding === "string" ? encoding : encoding?.encoding;
  const file = new File(uri(p));
  if (enc === "utf8" || enc === "utf-8") return file.textSync();
  const bytes = Buffer.from(file.bytesSync());
  return enc ? bytes.toString(enc) : bytes;
}

export function writeFileSync(p: string, data: string | Uint8Array, _opts?: unknown) {
  const file = new File(uri(p));
  if (!file.exists) file.create({ intermediates: true });
  file.write(typeof data === "string" ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

export function renameSync(from: string, to: string) {
  const k = kind(from);
  if (k === null) throw enoent("rename", from);
  if (k === "dir") new Directory(uri(from)).moveSync(new Directory(uri(to)));
  else new File(uri(from)).moveSync(new File(uri(to)), { overwrite: true });
}

export function copyFileSync(from: string, to: string) {
  if (kind(from) !== "file") throw enoent("copyfile", from);
  new File(uri(from)).copySync(new File(uri(to)), { overwrite: true });
}

function unsupported(name: string): never {
  throw new Error(`fs.${name} is not available in the mobile app.`);
}

export const createReadStream = () => unsupported("createReadStream");
export const createWriteStream = () => unsupported("createWriteStream");
export const openSync = () => unsupported("openSync");
export const writeSync = () => unsupported("writeSync");
export const closeSync = () => unsupported("closeSync");

export default {
  existsSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  openSync,
  writeSync,
  closeSync,
};
