// Data for native screens: same calls as the desktop UI's useApi, refetched
// whenever any screen saves a change.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiMethod, ApiParams, ApiResult } from "@/lib/api/contract";
import { errorMessage } from "@/lib/api/client";
import { useDataVersion } from "~/core/events";
import { call } from "~/core/host";

export interface CoreQuery<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useCore<M extends ApiMethod>(method: M, params: ApiParams<M>, opts: { enabled?: boolean } = {}): CoreQuery<ApiResult<M>> {
  const enabled = opts.enabled ?? true;
  const version = useDataVersion();
  const key = JSON.stringify(params ?? null);
  const [data, setData] = useState<ApiResult<M>>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const run = call as unknown as (m: M, p: unknown) => Promise<ApiResult<M>>;
      const result = await run(method, JSON.parse(key));
      if (mine === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [method, key, enabled]);

  useEffect(() => {
    void load();
  }, [load, version]);

  return { data, error, loading, reload: load };
}
