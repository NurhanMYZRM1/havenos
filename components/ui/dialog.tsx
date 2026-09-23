"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { Button } from "./button";
import { FormError } from "./field";
import { Icon } from "./icons";

/**
 * Modal dialog built on the native <dialog> element: focus is trapped and
 * restored by the browser, Escape closes it, and the rest of the page is
 * inert while it is open.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 560,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** When set, the body is a <form> and Enter submits it. */
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // Focus the first field rather than the close button.
      const first = el.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea");
      first?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const body = (
    <>
      <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
        <div className="min-w-0">
          <h2 className="font-display text-[22px] font-light leading-tight tracking-tight">{title}</h2>
          {description && <div className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{description}</div>}
        </div>
        <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={t("common.close")}>
          <Icon name="close" />
        </button>
      </div>
      <div className="max-h-[68vh] overflow-y-auto px-6 py-4">{children}</div>
      {footer && <div className="hairline-t flex flex-wrap items-center justify-end gap-2.5 px-6 py-4">{footer}</div>}
    </>
  );

  return (
    <dialog
      ref={ref}
      className="modal m-auto"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="card overflow-hidden shadow-2xl" style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
        {onSubmit ? (
          <form
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  pending = false,
  error = null,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={480}
      onSubmit={onConfirm}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={pending} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-[14px] leading-relaxed text-ink-2">{body}</div>
        {children}
        <FormError message={error} />
      </div>
    </Modal>
  );
}
