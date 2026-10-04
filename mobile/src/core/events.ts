// Native-side fan-out of core events and a data version that every mounted
// screen watches, so a change saved in one screen refreshes the others.
import { useSyncExternalStore } from "react";
import type { ApiEventName, ApiEvents } from "@/lib/api/contract";

export interface CoreEvent {
  seq: number;
  name: ApiEventName;
  payload: unknown;
}

let version = 0;
let lastEvent: CoreEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function bumpDataVersion(): number {
  version++;
  notify();
  return version;
}

export function currentDataVersion(): number {
  return version;
}

export function emitCoreEvent<E extends ApiEventName>(name: E, payload: ApiEvents[E]) {
  lastEvent = { seq: (lastEvent?.seq ?? 0) + 1, name, payload };
  if (name === "data-changed") version++;
  notify();
}

export function useDataVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

export function useLastCoreEvent(): CoreEvent | null {
  return useSyncExternalStore(subscribe, () => lastEvent);
}
