"use client";

import { t, isMessageKey, type MessageKey } from "../i18n";
import type {
  ApiErrorShape,
  ApiEventName,
  ApiEvents,
  ApiMethod,
  ApiParams,
  ApiResult,
  DesktopBridge,
  ErrorCode,
} from "./contract";

/**
 * Renderer-side access to local data. Every call goes through the desktop
 * bridge to the main process; there is no browser-storage fallback.
 */

declare global {
  interface Window {
    havenos?: DesktopBridge;
  }
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly messageKey?: MessageKey;
  readonly params?: Record<string, string | number>;
  readonly fields?: Record<string, MessageKey>;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.code = shape.code;
    this.messageKey = shape.messageKey;
    this.params = shape.params;
    this.fields = shape.fields;
  }
}

export function getBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.havenos && window.havenos.bridgeVersion === 1 ? window.havenos : null;
}

export async function api<M extends ApiMethod>(method: M, ...args: ApiParams<M> extends void ? [] : [ApiParams<M>]): Promise<ApiResult<M>> {
  const bridge = getBridge();
  if (!bridge) throw new ApiError({ code: "UNSUPPORTED", message: t("errors.desktopOnly"), messageKey: "errors.desktopOnly" });
  const response = await bridge.invoke(method, args[0] ?? null);
  if (!response.ok) throw new ApiError(response.error);
  return response.data as ApiResult<M>;
}

export function onEvent<E extends ApiEventName>(event: E, listener: (payload: ApiEvents[E]) => void): () => void {
  const bridge = getBridge();
  if (!bridge) return () => undefined;
  return bridge.on(event, (payload) => listener(payload as ApiEvents[E]));
}

const CHANGED = "havenos:changed";

/** Tell every mounted query to refetch (after any successful change). */
export function notifyChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

export function onChanged(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  const offMain = onEvent("data-changed", listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    offMain();
  };
}

/** Plain-English message for any error thrown by `api()`. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.messageKey && isMessageKey(err.messageKey)) return t(err.messageKey, err.params);
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return t("common.unknownError");
}
