import type { Settings, SettingsInput } from "../../../lib/api/contract";
import type { Core } from "../context";

const DEFAULTS: Settings = {
  landlordName: "",
  contactPhone: "",
  contactEmail: "",
  address: "",
  receiptNote: "",
  lastLocalBackupAt: null,
};

export function getSettings(core: Core): Settings {
  const out: Settings = { ...DEFAULTS };
  for (const row of core.db.all<{ key: string; value: string }>("SELECT key, value FROM settings")) {
    if (row.key in DEFAULTS) {
      try {
        (out as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      } catch {
        /* ignore a corrupt value; the default stands */
      }
    }
  }
  return out;
}

export function setSetting<K extends keyof Settings>(core: Core, key: K, value: Settings[K]) {
  core.db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
    key,
    JSON.stringify(value),
  ]);
}

export function updateSettings(core: Core, input: SettingsInput): Settings {
  core.db.tx(() => {
    for (const key of Object.keys(input) as (keyof SettingsInput)[]) setSetting(core, key, input[key]);
  });
  return getSettings(core);
}
