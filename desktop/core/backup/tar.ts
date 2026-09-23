import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

/**
 * Minimal streaming ustar + gzip, enough for HavenOS backups: regular files
 * only, short names. The result is a normal .tar.gz that macOS Archive
 * Utility, Windows `tar`, or 7-Zip can open, so a landlord is never locked
 * into HavenOS to read their own backup.
 */

export interface TarSource {
  name: string;
  /** Either a file on disk or bytes in memory. */
  path?: string;
  data?: Buffer;
}

export interface WrittenEntry {
  name: string;
  size: number;
  sha256: string;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function header(name: string, size: number, mtime: number): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  if (nameBytes.length > 100) throw new Error(`Archive entry name too long: ${name}`);
  const h = Buffer.alloc(512, 0);
  nameBytes.copy(h, 0);
  h.write(octal(0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(Math.floor(mtime / 1000), 12), 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

/**
 * Write `sources` to a gzipped tarball. `last` is produced *after* every
 * source has been streamed and hashed, so a manifest can list the hashes.
 */
export async function writeTarGz(
  outFile: string,
  sources: readonly TarSource[],
  opts: { last?: (written: WrittenEntry[]) => TarSource; onBytes?: (n: number) => void } = {},
): Promise<WrittenEntry[]> {
  const written: WrittenEntry[] = [];
  const now = Date.now();

  async function* emit(source: TarSource): AsyncGenerator<Buffer> {
    const hash = crypto.createHash("sha256");
    let size: number;
    if (source.data) {
      size = source.data.length;
      yield header(source.name, size, now);
      hash.update(source.data);
      opts.onBytes?.(size);
      yield source.data;
    } else {
      size = fs.statSync(source.path!).size;
      yield header(source.name, size, now);
      let seen = 0;
      for await (const chunk of fs.createReadStream(source.path!, { highWaterMark: 1 << 20 })) {
        const buf = chunk as Buffer;
        seen += buf.length;
        if (seen > size) throw new Error(`${source.name} changed while being backed up. Please try again.`);
        hash.update(buf);
        opts.onBytes?.(buf.length);
        yield buf;
      }
      if (seen !== size) throw new Error(`${source.name} changed while being backed up. Please try again.`);
    }
    const pad = (512 - (size % 512)) % 512;
    if (pad) yield Buffer.alloc(pad);
    written.push({ name: source.name, size, sha256: hash.digest("hex") });
  }

  async function* all(): AsyncGenerator<Buffer> {
    for (const s of sources) yield* emit(s);
    if (opts.last) yield* emit(opts.last([...written]));
    yield Buffer.alloc(1024);
  }

  const partial = `${outFile}.partial`;
  try {
    await pipeline(Readable.from(all()), zlib.createGzip({ level: 6 }), fs.createWriteStream(partial, { flush: true }));
    fs.renameSync(partial, outFile);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }
  return written;
}

export interface ExtractLimits {
  maxEntries: number;
  maxTotalBytes: number;
  /** Only names matching this are accepted; anything else fails the archive. */
  allowedName: RegExp;
}

export interface ExtractedEntry {
  name: string;
  size: number;
  sha256: string;
}

function parseOctal(buf: Buffer): number {
  const text = buf.toString("ascii").replace(/\0.*$/, "").trim();
  if (!/^[0-7]*$/.test(text)) throw new Error("Corrupt archive header");
  return text ? parseInt(text, 8) : 0;
}

/**
 * Extract a .tar.gz into `destDir`, hashing each file. Refuses unexpected
 * names (so nothing can be written outside `destDir`), links, devices, and
 * archives beyond the size limits (decompression bombs).
 */
export async function extractTarGz(file: string, destDir: string, limits: ExtractLimits): Promise<ExtractedEntry[]> {
  fs.mkdirSync(destDir, { recursive: true });
  const entries: ExtractedEntry[] = [];
  const seenNames = new Set<string>();
  let pending: Buffer = Buffer.alloc(0);
  let total = 0;
  let current: { name: string; size: number; remaining: number; pad: number; fd: number; hash: crypto.Hash } | null = null;
  let skipPad = 0;
  let ended = false;

  const closeCurrent = () => {
    if (!current) return;
    fs.closeSync(current.fd);
    entries.push({ name: current.name, size: current.size, sha256: current.hash.digest("hex") });
    skipPad = current.pad;
    current = null;
  };

  const consume = (chunk: Buffer) => {
    total += chunk.length;
    if (total > limits.maxTotalBytes) throw new Error("Backup is larger than allowed.");
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length) {
      if (ended) return;
      if (current) {
        const take = Math.min(current.remaining, pending.length);
        const part = pending.subarray(0, take);
        fs.writeSync(current.fd, part);
        current.hash.update(part);
        current.remaining -= take;
        pending = pending.subarray(take);
        if (current.remaining === 0) closeCurrent();
        continue;
      }
      if (skipPad) {
        const take = Math.min(skipPad, pending.length);
        skipPad -= take;
        pending = pending.subarray(take);
        continue;
      }
      if (pending.length < 512) return;
      const h = pending.subarray(0, 512);
      pending = pending.subarray(512);
      if (h.every((b) => b === 0)) {
        ended = true;
        return;
      }
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
      if (sum !== parseOctal(h.subarray(148, 156))) throw new Error("Corrupt archive header checksum");
      const type = String.fromCharCode(h[156] || 48);
      const prefix = h.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
      const baseName = h.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
      const name = prefix ? `${prefix}/${baseName}` : baseName;
      const size = parseOctal(h.subarray(124, 136));
      if (type === "5" && /\/$/.test(name)) continue; // directory entry
      if (type !== "0") throw new Error(`Unsupported archive entry: ${name}`);
      if (!limits.allowedName.test(name)) throw new Error(`Unexpected file in backup: ${name}`);
      if (entries.length >= limits.maxEntries) throw new Error("Backup has too many files.");
      if (seenNames.has(name)) throw new Error(`Duplicate file in backup: ${name}`);
      seenNames.add(name);
      const target = path.resolve(destDir, name);
      if (!target.startsWith(path.resolve(destDir) + path.sep)) throw new Error(`Unsafe path in backup: ${name}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      current = { name, size, remaining: size, pad: (512 - (size % 512)) % 512, fd: fs.openSync(target, "wx"), hash: crypto.createHash("sha256") };
      if (size === 0) closeCurrent();
    }
  };

  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      try {
        consume(chunk);
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
  });

  try {
    await pipeline(fs.createReadStream(file), zlib.createGunzip(), sink);
    if (current) throw new Error("Backup file is truncated.");
    if (!ended) throw new Error("Backup file is incomplete.");
  } catch (err) {
    const open = current as { fd: number } | null;
    if (open) fs.closeSync(open.fd);
    throw err;
  }
  return entries;
}
