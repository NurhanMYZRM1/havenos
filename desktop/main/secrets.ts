import { safeStorage } from "electron";
import fs from "node:fs";
import type { SecretStore } from "../core/cloud/service";

/**
 * Stores the cloud sign-in refresh token encrypted with the operating
 * system's credential protection (macOS Keychain, Windows DPAPI). If the OS
 * store isn't available the token is kept in memory only, never in plain
 * text on disk.
 */
export class SafeStorageSecrets implements SecretStore {
  private memory: string | null = null;

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

  read(): string | null {
    if (!this.available) return this.memory;
    try {
      return safeStorage.decryptString(fs.readFileSync(this.file));
    } catch {
      return null;
    }
  }

  write(value: string) {
    if (!this.available) {
      this.memory = value;
      return;
    }
    fs.writeFileSync(`${this.file}.tmp`, safeStorage.encryptString(value), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  clear() {
    this.memory = null;
    fs.rmSync(this.file, { force: true });
  }
}
