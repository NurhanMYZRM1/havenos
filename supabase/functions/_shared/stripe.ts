/**
 * Stripe helpers with no SDK dependency: webhook signature verification
 * (Web Crypto, works in Deno and Node) and turning Stripe events into
 * entitlement changes.
 *
 * Billing model (see docs/cloud-backup.md):
 *  - monthly: Stripe Billing subscription, card payments, MYR price.
 *  - annual:  one-off Checkout payment (card or FPX — FPX cannot be used for
 *             recurring charges), granting 365 days of cloud backup.
 */
import type { EntitlementRow, SubscriptionStatus } from "./entitlement.ts";

const encoder = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a `Stripe-Signature` header (scheme v1, HMAC-SHA256 of `${t}.${payload}`). */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds: number, toleranceSeconds = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${payload}`)));
  return signatures.some((s) => timingSafeEqual(s, expected));
}

export const ANNUAL_DAYS = 365;

interface StripeObject {
  [key: string]: unknown;
}

export interface EntitlementChange {
  /** Our user id, when the event carries it (metadata / client_reference_id). */
  userId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  row: EntitlementRow;
}

function mapStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "incomplete";
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * Work out the entitlement a Stripe event implies. Returns null for events
 * that don't change entitlement. `current` is the user's existing row, used to
 * extend an annual plan from its current end rather than from today.
 */
export function entitlementFromEvent(event: { type: string; data: { object: StripeObject } }, current: EntitlementRow | null, now: Date): EntitlementChange | null {
  const o = event.data.object;
  const metadata = (o.metadata ?? {}) as Record<string, string>;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (o.mode !== "payment" || metadata.plan !== "annual") return null;
      // FPX completes asynchronously; only grant once the money has arrived.
      if (o.payment_status !== "paid") return null;
      const currentEnd = current?.current_period_end ? new Date(current.current_period_end).getTime() : 0;
      const from = Math.max(now.getTime(), currentEnd);
      return {
        userId: str(o.client_reference_id) ?? str(metadata.user_id),
        customerId: str(o.customer),
        subscriptionId: null,
        row: { status: "active", plan: "annual", current_period_end: new Date(from + ANNUAL_DAYS * 86_400_000).toISOString() },
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const items = (o.items as { data?: { current_period_end?: number }[] } | undefined)?.data ?? [];
      // Newer Stripe API versions put the period on the subscription item.
      const deleted = event.type === "customer.subscription.deleted";
      // A deleted subscription ends when Stripe says it ended — not at the
      // end of a period that may never have been paid for.
      const periodEnd = deleted
        ? ((o.ended_at as number | undefined) ?? Math.floor(now.getTime() / 1000))
        : items[0]?.current_period_end ?? (o.current_period_end as number | undefined);
      const status = deleted ? "canceled" : mapStatus(String(o.status));
      return {
        userId: str(metadata.user_id),
        customerId: str(o.customer),
        subscriptionId: str(o.id),
        row: { status, plan: "monthly", current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : current?.current_period_end ?? null },
      };
    }
    default:
      return null;
  }
}

/** Form-encode nested params the way the Stripe API expects (a[b][0]=c). */
export function formEncode(params: Record<string, unknown>, prefix = ""): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") out.push(formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.filter(Boolean).join("&");
}

export function checkoutParams(opts: { plan: "monthly" | "annual"; userId: string; customerId: string; monthlyPrice: string; annualPrice: string; successUrl: string; cancelUrl: string }): Record<string, unknown> {
  const common = {
    customer: opts.customerId,
    client_reference_id: opts.userId,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: { user_id: opts.userId, plan: opts.plan },
  };
  if (opts.plan === "monthly") {
    return {
      ...common,
      mode: "subscription",
      line_items: { 0: { price: opts.monthlyPrice, quantity: 1 } },
      subscription_data: { metadata: { user_id: opts.userId } },
    };
  }
  return {
    ...common,
    mode: "payment",
    payment_method_types: { 0: "card", 1: "fpx" },
    line_items: { 0: { price: opts.annualPrice, quantity: 1 } },
  };
}
