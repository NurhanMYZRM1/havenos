"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { Button, Spinner } from "./button";
import { Icon } from "./icons";

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:mb-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
            <Icon name="arrowLeft" size={14} />
            {back.label}
          </Link>
        )}
        {eyebrow && <div className="microlabel mb-1.5">{eyebrow}</div>}
        <h1 className="font-display text-[28px] font-light leading-tight tracking-tight md:text-[32px]">{title}</h1>
        {subtitle && <div className="mt-1.5 max-w-2xl text-[14px] text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

export function Card({ title, actions, children, className = "", padded = true, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; id?: string }) {
  return (
    <section className={`card ${className}`} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {(title || actions) && (
        <div className="hairline-b flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          {title && (
            <h2 id={id ? `${id}-title` : undefined} className="text-[15px] font-semibold">
              {title}
            </h2>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function EmptyState({ illustration, title, body, actions }: { illustration?: ReactNode; title: ReactNode; body?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {illustration && <div className="mb-5 w-full max-w-[260px] opacity-95">{illustration}</div>}
      <h3 className="font-display text-[20px] font-light">{title}</h3>
      {body && <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-2">{body}</p>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-10 text-[14px] text-ink-2" role="status">
      <Spinner />
      {label ?? t("common.loading")}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-start gap-3 border-critical/40 p-5">
      <div className="flex items-start gap-2.5 text-[14px] text-[#ffc2bd]">
        <Icon name="alert" className="mt-0.5 text-critical" />
        {message}
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children, action }: { tone?: "info" | "warn" | "critical" | "good"; children: ReactNode; action?: ReactNode }) {
  const color = { info: "var(--color-info)", warn: "var(--color-warn)", critical: "var(--color-critical)", good: "var(--color-good)" }[tone];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-[13.5px]" style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, background: `color-mix(in oklab, ${color} 9%, transparent)` }}>
      <span style={{ color }} className="shrink-0">
        <Icon name={tone === "good" ? "check" : tone === "info" ? "info" : "alert"} />
      </span>
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
      {action}
    </div>
  );
}

/** Tabs with arrow-key navigation (WAI-ARIA tabs pattern). */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(tabs[next].value);
      refs.current[next]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} className="hairline-b flex gap-1 overflow-x-auto">
      {tabs.map((tab, i) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`relative -mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors ${active ? "border-brass text-ink" : "border-transparent text-ink-3 hover:text-ink-2"}`}
          >
            {tab.label}
            {tab.count !== undefined && <span className="tnum ml-1.5 text-[12px] text-ink-3">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Label/value rows for detail panels. */
export function DetailList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3.5 sm:grid-cols-[minmax(140px,auto)_1fr]">
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-[13px] text-ink-3">{item.label}</dt>
          <dd className="text-[14px]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
