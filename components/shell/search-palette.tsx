"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { api } from "@/lib/api/client";
import type { SearchKind, SearchResult } from "@/lib/api/contract";
import { t, type MessageKey } from "@/lib/i18n";

const KIND_ICON: Record<SearchKind, IconName> = {
  property: "building",
  space: "door",
  tenant: "people",
  tenancy: "key",
  maintenance: "wrench",
  payment: "receipt",
};

/** Ctrl/⌘+K search across all local records (combobox pattern). */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setQuery("");
      setResults([]);
      setActive(0);
      input.current?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api("search.query", { query: q })
        .then((r) => {
          if (!cancelled) {
            setResults(r);
            setActive(0);
          }
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  const go = (r: SearchResult) => {
    onClose();
    router.push(r.href);
  };

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.kind] ??= []).push(r);
    return acc;
  }, {});
  let index = -1;

  return (
    <dialog
      ref={dialog}
      className="modal mx-auto mt-[12vh]"
      aria-label={t("search.title")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="card w-[min(640px,calc(100vw-32px))] overflow-hidden shadow-2xl">
        <div className="hairline-b flex items-center gap-3 px-4">
          <Icon name="search" size={18} className="text-ink-3" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.title")}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-results"
            aria-activedescendant={results[active] ? `search-${active}` : undefined}
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && results[active]) {
                e.preventDefault();
                go(results[active]);
              }
            }}
          />
        </div>
        <div id="search-results" role="listbox" className="max-h-[56vh] overflow-y-auto p-2">
          {!query.trim() && <p className="px-3 py-6 text-center text-[13.5px] text-ink-3">{t("search.empty")}</p>}
          {query.trim() && results.length === 0 && <p className="px-3 py-6 text-center text-[13.5px] text-ink-3">{t("search.noResults", { q: query.trim() })}</p>}
          {Object.entries(grouped).map(([kind, items]) => (
            <div key={kind} role="group" aria-label={t(`search.kinds.${kind}` as MessageKey)} className="mb-2">
              <div className="microlabel px-3 pb-1 pt-2">{t(`search.kinds.${kind}` as MessageKey)}</div>
              {items.map((r) => {
                index++;
                const i = index;
                return (
                  <div
                    key={`${r.kind}-${r.id}`}
                    id={`search-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${i === active ? "bg-surface-2" : ""}`}
                  >
                    <Icon name={KIND_ICON[r.kind]} className="text-ink-3" />
                    <div className="min-w-0">
                      <div className="truncate text-[14px]">{r.title}</div>
                      {r.subtitle && <div className="truncate text-[12.5px] text-ink-3">{r.subtitle}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="hairline-t px-4 py-2 text-[12px] text-ink-3">{t("search.hint")}</div>
      </div>
    </dialog>
  );
}
