// Supabase Edge Function: `billing-webhook` — receives Stripe events and
// updates `cloud_entitlements`. This is the only writer of entitlements.
//
// Deploy without JWT verification (Stripe signs requests instead):
//   supabase functions deploy billing-webhook --no-verify-jwt
// Secrets: STRIPE_WEBHOOK_SECRET (+ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
import { createClient } from "npm:@supabase/supabase-js@2";
import type { EntitlementRow } from "../_shared/entitlement.ts";
import { entitlementFromEvent, verifyStripeSignature } from "../_shared/stripe.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const payload = await req.text();
  const valid = await verifyStripeSignature(payload, req.headers.get("stripe-signature"), env("STRIPE_WEBHOOK_SECRET"), Math.floor(Date.now() / 1000));
  if (!valid) return new Response("Invalid signature", { status: 400 });

  const event = JSON.parse(payload) as { id: string; type: string; data: { object: Record<string, unknown> } };
  // Idempotency: Stripe may deliver the same event more than once.
  const { error: seen } = await admin.from("billing_events").insert({ id: event.id, type: event.type });
  if (seen) return new Response("Already processed", { status: 200 });

  const customerId = typeof event.data.object.customer === "string" ? event.data.object.customer : null;
  let userId: string | null = null;
  if (customerId) {
    const { data } = await admin.from("billing_customers").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = data?.user_id ?? null;
  }
  const current = userId
    ? ((await admin.from("cloud_entitlements").select("status, plan, current_period_end").eq("user_id", userId).maybeSingle()).data as EntitlementRow | null)
    : null;
  const change = entitlementFromEvent(event, current, new Date());
  if (!change) return new Response("Ignored", { status: 200 });
  const owner = userId ?? change.userId;
  if (!owner) {
    console.error(`No HavenOS user for Stripe event ${event.id}`);
    return new Response("Unknown customer", { status: 200 });
  }
  const { error } = await admin.from("cloud_entitlements").upsert({
    user_id: owner,
    status: change.row.status,
    plan: change.row.plan,
    current_period_end: change.row.current_period_end,
    stripe_customer_id: change.customerId,
    stripe_subscription_id: change.subscriptionId,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    // Let Stripe retry: remove the idempotency marker.
    await admin.from("billing_events").delete().eq("id", event.id);
    return new Response("Failed", { status: 500 });
  }
  return new Response("OK", { status: 200 });
});
