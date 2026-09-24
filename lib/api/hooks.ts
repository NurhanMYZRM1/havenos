"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MessageKey } from "../i18n";
import { api, ApiError, errorMessage, notifyChanged, onChanged, onEvent } from "./client";
import type { ApiMethod, ApiParams, ApiResult, ErrorCode } from "./contract";

export interface Query<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Load data from the desktop app and keep it fresh: it refetches whenever any
 * change is saved anywhere in the app, or after a restore / workspace switch.
 */
export function useApi<M extends ApiMethod>(
  method: M,
  params: ApiParams<M>,
  opts: { enabled?: boolean } = {},
): Query<ApiResult<M>> {
  const enabled = opts.enabled ?? true;
  const key = JSON.stringify(params ?? null);
  const [data, setData] = useState<ApiResult<M> | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    setLoading(true);
    const call = api as unknown as (m: M, p: unknown) => Promise<ApiResult<M>>;
    call(method, JSON.parse(key))
      .then((result) => {
        if (mine !== seq.current) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (mine !== seq.current) return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [method, key, enabled]);

  useEffect(() => {
    load();
    return onChanged(load);
  }, [load]);

  return { data, error, loading, reload: load };
}

export interface Mutation<M extends ApiMethod> {
  run: (params: ApiParams<M>) => Promise<ApiResult<M> | undefined>;
  pending: boolean;
  error: string | null;
  fields: Record<string, MessageKey>;
  /** Error code of the last failure (e.g. "CONFLICT"), null otherwise. */
  code: ErrorCode | null;
  reset: () => void;
}

/**
 * Save something. On success every query refreshes; on failure the
 * plain-English error and any per-field errors are exposed for the form.
 * `run` resolves to undefined when it failed.
 */
export function useMutation<M extends ApiMethod>(method: M): Mutation<M> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, MessageKey>>({});
  const [code, setCode] = useState<ErrorCode | null>(null);

  const run = useCallback(
    async (params: ApiParams<M>) => {
      setPending(true);
      setError(null);
      setFields({});
      setCode(null);
      try {
        const call = api as unknown as (m: M, p: unknown) => Promise<ApiResult<M>>;
        const result = await call(method, params);
        notifyChanged();
        return result;
      } catch (err) {
        setError(errorMessage(err));
        if (err instanceof ApiError && err.fields) setFields(err.fields);
        setCode(err instanceof ApiError ? err.code : "INTERNAL");
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [method],
  );

  const reset = useCallback(() => {
    setError(null);
    setFields({});
    setCode(null);
  }, []);

  return { run, pending, error, fields, code, reset };
}

// ── Calendar sync activity ────────────────────────────────────────────────
// Main pushes "channel-sync" with the connections being read right now. One
// shared subscription keeps the latest value for every component.

const NO_SYNC: string[] = [];
let syncRunning: string[] = NO_SYNC;
let syncSubscribed = false;
const syncListeners = new Set<() => void>();

function subscribeSync(listener: () => void) {
  syncListeners.add(listener);
  if (!syncSubscribed && typeof window !== "undefined") {
    syncSubscribed = true;
    onEvent("channel-sync", (payload) => {
      syncRunning = Array.isArray(payload?.running) && payload.running.length ? [...payload.running] : NO_SYNC;
      syncListeners.forEach((l) => l());
    });
  }
  return () => {
    syncListeners.delete(listener);
  };
}

/** Ids of the calendar connections HavenOS is reading right now (empty when idle). */
export function useChannelSync(): string[] {
  return useSyncExternalStore(subscribeSync, () => syncRunning, () => NO_SYNC);
}
