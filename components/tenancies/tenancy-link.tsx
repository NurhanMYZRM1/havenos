"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { TenancyStatusPill } from "@/components/ui/status";
import type { TenancySummary } from "@/lib/api/contract";

/** One tenancy in a compact list: who, where, and a date-context line. */
export function TenancyLink({ tenancy, detail, showStatus = true }: { tenancy: TenancySummary; detail: ReactNode; showStatus?: boolean }) {
  return (
    <li>
      <Link href={`/tenancies/view?id=${tenancy.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{tenancy.tenantName}</div>
          <div className="truncate text-[12.5px] text-ink-3">
            {tenancy.spacePath} · {tenancy.propertyName}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[13px] text-ink-2">{detail}</div>
          {showStatus && (
            <div className="mt-1">
              <TenancyStatusPill status={tenancy.status} />
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
