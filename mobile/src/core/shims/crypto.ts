// node:crypto as used by ../desktop/core: random ids and one-shot hex digests.
import { sha1 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Buffer } from "buffer";
import * as ExpoCrypto from "expo-crypto";

export function randomUUID(): string {
  return ExpoCrypto.randomUUID();
}

export function randomBytes(size: number): Buffer {
  return Buffer.from(ExpoCrypto.getRandomBytes(size));
}

const ALGORITHMS = { sha256, sha1 } as const;

class Hash {
  private readonly chunks: Uint8Array[] = [];
  constructor(private readonly algorithm: keyof typeof ALGORITHMS) {}

  update(data: string | Uint8Array): this {
    this.chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
    return this;
  }

  digest(encoding?: "hex"): string | Buffer {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    const out = ALGORITHMS[this.algorithm](all);
    return encoding === "hex" ? bytesToHex(out) : Buffer.from(out);
  }
}

export function createHash(algorithm: string): Hash {
  if (algorithm !== "sha256" && algorithm !== "sha1") throw new Error(`Hash ${algorithm} is not available in the mobile app.`);
  return new Hash(algorithm);
}

export default { randomUUID, randomBytes, createHash };
