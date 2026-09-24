import { safeStorage } from "electron";
import fs from "node:fs";
import type { ChannelSecretStore } from "../core/integrations/channels";

/**
 * Calendar feed links, keyed by connection id, encrypted with the operating
 * system's credential protection (macOS Keychain, Windows DPAPI) in
 * <userData>/channel-feeds.bin. The links grant read access to a landlord's
 * calendars, so they are never written to the database, backups or logs.
 *
 * If the OS store isn't available the links are kept in memory only (and
 * `available` is false, so the UI can say so) — never in plain text on disk.
 */
export class SafeStorageChannelSecrets implements ChannelSecretStore {
  private map: Map<string, string> | null = null;

  constructor(private readonly file: string) {}

  get available(): boolean {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      // On Linux without a keyring Electron falls back to a hard-coded key; treat that as unavailable.
      return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
    } catch {
      return false;
    }
  }

  private load(): Map<string, string> {
    if (this.map) return this.map;
    this.map = new Map();
    if (!this.available) return this.map;
    try {
      const parsed: unknown = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.file)));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [id, url] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof url === "string") this.map.set(id, url);
        }
      }
    } catch {
      // No file yet, or it can't be decrypted on this machine: the landlord re-pastes the links.
    }
    return this.map;
  }

  private persist() {
    if (!this.available) return;
    const map = this.load();
    if (map.size === 0) {
      fs.rmSync(this.file, { force: true });
      return;
    }
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(Object.fromEntries(map))), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get(connectionId: string): string | null {
    return this.load().get(connectionId) ?? null;
  }

  set(connectionId: string, value: string) {
    const map = this.load();
    const previous = map.get(connectionId);
    map.set(connectionId, value);
    try {
      this.persist();
    } catch (err) {
      if (previous === undefined) map.delete(connectionId);
      else map.set(connectionId, previous);
      throw err;
    }
  }

  delete(connectionId: string) {
    const map = this.load();
    if (!map.delete(connectionId)) return;
    this.persist();
  }
}
