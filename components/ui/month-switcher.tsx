"use client";

import { addMonthsToMonth, type YearMonth } from "@/lib/domain/dates";
import { formatMonth } from "@/lib/domain/format";
import { t } from "@/lib/i18n";
import { Icon } from "./icons";

export function MonthSwitcher({ value, onChange, current, label }: { value: YearMonth; onChange: (m: YearMonth) => void; current: YearMonth; label?: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label ?? t("rent.month")}>
      {label && <span className="microlabel mr-1 hidden sm:inline">{label}</span>}
      <button type="button" onClick={() => onChange(addMonthsToMonth(value, -1))} className="grid size-9 place-items-center rounded-lg border border-[var(--hairline-strong)] text-ink-2 hover:text-ink" aria-label={t("common.previousMonth")}>
        <Icon name="chevronLeft" />
      </button>
      <output className="tnum min-w-[150px] text-center text-[15px] font-semibold" aria-live="polite">
        {formatMonth(value)}
      </output>
      <button type="button" onClick={() => onChange(addMonthsToMonth(value, 1))} className="grid size-9 place-items-center rounded-lg border border-[var(--hairline-strong)] text-ink-2 hover:text-ink" aria-label={t("common.nextMonth")}>
        <Icon name="chevronRight" />
      </button>
      {value !== current && (
        <button type="button" onClick={() => onChange(current)} className="ml-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-brass-bright hover:bg-surface-2">
          {t("common.today")}
        </button>
      )}
    </div>
  );
}
