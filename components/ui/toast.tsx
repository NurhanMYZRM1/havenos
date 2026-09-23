"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { Icon } from "./icons";

interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  message: string;
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => undefined);

/** Confirmation messages — shown only after an operation really succeeded. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.tone === "error" ? 9000 : 5500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(420px,calc(100vw-40px))] flex-col gap-2.5" aria-live="polite" role="status">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="card pointer-events-auto flex items-start gap-3 px-4 py-3 shadow-xl"
            style={{ borderColor: toast.tone === "error" ? "color-mix(in oklab, var(--color-critical) 55%, transparent)" : toast.tone === "success" ? "color-mix(in oklab, var(--color-good) 45%, transparent)" : undefined }}
          >
            <Icon name={toast.tone === "error" ? "alert" : toast.tone === "success" ? "check" : "info"} className={toast.tone === "error" ? "mt-0.5 text-critical" : toast.tone === "success" ? "mt-0.5 text-good" : "mt-0.5 text-info"} />
            <p className="min-w-0 flex-1 text-[13.5px] leading-snug">{toast.message}</p>
            {toast.action && (
              <button
                type="button"
                className="shrink-0 text-[13px] font-semibold text-brass-bright hover:underline"
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button type="button" onClick={() => dismiss(toast.id)} aria-label={t("common.close")} className="shrink-0 text-ink-3 hover:text-ink">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
