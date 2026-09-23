/**
 * Server-side entitlement rules for the paid cloud-backup add-on. This is the
 * security boundary: the desktop app only ever displays what this returns.
 *
 * - active   paid period running            → upload and download
 * - grace    up to GRACE_DAYS after the period ends, or payment failing
 *                                             → download only (restore, no new uploads)
 * - expired  after that                      → no cloud operations
 *
 * Local use of the desktop app never depends on any of this.
 */
import type { EntitlementWire } from "./protocol.ts";

export const GRACE_DAYS = 7;

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "none";

export interface EntitlementRow {
  status: SubscriptionStatus;
  plan: string | null;
  current_period_end: string | null;
}

export function evaluateEntitlement(row: EntitlementRow | null, now: Date): EntitlementWire {
  if (!row || !row.current_period_end || row.status === "none" || row.status === "incomplete") {
    return { status: "none", plan: row?.plan ?? null, currentPeriodEnd: null, canUpload: false, canDownload: false };
  }
  const end = new Date(row.current_period_end).getTime();
  const t = now.getTime();
  const base = { plan: row.plan, currentPeriodEnd: row.current_period_end };
  // A failing payment (past_due) never gets uploads, only the grace window.
  if ((row.status === "active" || row.status === "trialing" || row.status === "canceled") && t < end) {
    return { ...base, status: "active", canUpload: true, canDownload: true };
  }
  if (t < end + GRACE_DAYS * 86_400_000) return { ...base, status: "grace", canUpload: false, canDownload: true };
  return { ...base, status: "expired", canUpload: false, canDownload: false };
}
