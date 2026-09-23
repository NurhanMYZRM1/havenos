"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { isIsoDate } from "@/lib/domain/dates";
import { formatDateLong } from "@/lib/domain/format";
import { isMessageKey, t, type MessageKey } from "@/lib/i18n";

/**
 * A labelled form field. The control is linked to its label, hint and error
 * (aria-describedby / aria-invalid), so screen readers announce all three.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: MessageKey | string | null;
  optional?: boolean;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const described = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, "aria-describedby": described, "aria-invalid": error ? true : undefined })
    : children;
  const message = error ? (isMessageKey(error) ? t(error) : error) : null;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
        {optional && <span className="ml-1.5 font-normal text-ink-3">({t("common.optional")})</span>}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="text-[12.5px] leading-snug text-ink-3">
          {hint}
        </p>
      )}
      {message && (
        <p id={errorId} className="flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-[#ff9d95]" role="alert">
          <span aria-hidden>▲</span>
          {message}
        </p>
      )}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={`control ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`control ${props.className ?? ""}`} />;
}

export function Select({
  options,
  placeholder,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string; disabled?: boolean }[]; placeholder?: string }) {
  return (
    <select {...props} className={`control ${props.className ?? ""}`}>
      {placeholder !== undefined && (
        <option value="" disabled={props.required}>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Ringgit amount typed as text ("1,250.50"); the form parses it to sen. */
export function MoneyInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-ink-3" aria-hidden>
        RM
      </span>
      <input type="text" inputMode="decimal" autoComplete="off" {...props} className={`control tnum pl-11 ${props.className ?? ""}`} />
    </div>
  );
}

/**
 * Native date picker (shown day/month/year by the desktop app) with the
 * chosen date echoed in words underneath, so it can never be misread.
 */
export function DateInput({ value, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value"> & { value: string }) {
  return (
    <div>
      <input type="date" value={value} min="1990-01-01" max="2200-12-31" {...props} className={`control tnum ${props.className ?? ""}`} />
      <p className="mt-1 text-[12px] text-ink-3" aria-live="polite">
        {isIsoDate(value) ? formatDateLong(value) : t("common.dateHint")}
      </p>
    </div>
  );
}

export function Checkbox({ label, hint, checked, onChange, id: givenId, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; id?: string; disabled?: boolean }) {
  const autoId = useId();
  const id = givenId ?? autoId;
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="check mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <label htmlFor={id} className="text-[13.5px] leading-snug text-ink">
        {label}
        {hint && (
          <span id={`${id}-hint`} className="mt-0.5 block text-[12.5px] text-ink-3">
            {hint}
          </span>
        )}
      </label>
    </div>
  );
}

/** Top-of-form summary so keyboard and screen-reader users hear there are errors. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-critical/40 bg-critical/10 px-3.5 py-3 text-[13.5px] text-[#ffc2bd]">
      <span aria-hidden className="mt-px">▲</span>
      <span>{message}</span>
    </div>
  );
}

/** Controlled text state for forms: values plus a setter per key. */
export function useFormState<T extends Record<string, string | boolean>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set = <K extends keyof T>(key: K) => (value: T[K]) => setValues((v) => ({ ...v, [key]: value }));
  const bind = <K extends keyof T>(key: K) => ({
    value: values[key] as string,
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value as T[K] })),
  });
  return { values, setValues, set, bind };
}
