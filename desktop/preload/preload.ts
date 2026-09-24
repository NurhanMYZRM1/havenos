/**
 * The only bridge between the sandboxed UI and the main process. It exposes
 * a single request channel (main checks the method name and validates every
 * parameter) and a fixed set of events — no Node APIs, no file paths, no
 * ipcRenderer.
 */
import { contextBridge, ipcRenderer } from "electron";

type Listener = (payload: unknown) => void;
const EVENTS = ["data-changed", "cloud-progress", "channel-sync", "menu-command"] as const;

// One IPC subscription per event, fanned out to any number of UI listeners.
const listeners = new Map<string, Set<Listener>>(EVENTS.map((e) => [e, new Set<Listener>()]));
for (const event of EVENTS) {
  ipcRenderer.on(`havenos:event:${event}`, (_e, payload: unknown) => {
    for (const l of listeners.get(event) ?? []) l(payload);
  });
}

contextBridge.exposeInMainWorld("havenos", {
  bridgeVersion: 1,
  platform: process.platform,
  invoke: (method: string, params: unknown) => ipcRenderer.invoke("havenos:invoke", String(method), params),
  on: (event: string, listener: Listener) => {
    const set = listeners.get(event);
    if (!set || typeof listener !== "function") return () => undefined;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  },
});
