// Supabase Edge Function: `cloud` — the paid cloud-backup API used by the
// HavenOS desktop app. Deploy with:  supabase functions deploy cloud
//
// Required secrets (supabase secrets set …) — never shipped in the desktop app:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided by Supabase)
// Optional, for paid checkout (without them checkout reports "not configured"):
//   STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL,
//   HAVENOS_BILLING_RETURN_URL  (a page telling the landlord to return to the app)
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCloud, type BackupRecord, type CloudPorts } from "../_shared/cloud-handler.ts";
import type { EntitlementRow } from "../_shared/entitlement.ts";
import { checkoutParams, formEncode } from "../_shared/stripe.ts";

const BUCKET = "cloud-backups";
const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function stripe(path: string, params: Record<string, unknown> | null, method = "POST") {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`, "content-type": "application/x-www-form-urlencoded" },
    body: params ? formEncode(params) : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Stripe error ${res.status}`);
  return body;
}

async function customerFor(user: { id: string; email: string | null }): Promise<string> {
  const { data } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (data?.stripe_customer_id) return data.stripe_customer_id;
  const customer = await stripe("customers", { email: user.email ?? undefined, metadata: { user_id: user.id } });
  await admin.from("billing_customers").insert({ user_id: user.id, stripe_customer_id: customer.id });
  return customer.id;
}

const ports: CloudPorts = {
  now: () => new Date(),
  async userFromToken(token) {
    const { data } = await admin.auth.getUser(token);
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  },
  async getEntitlement(userId) {
    const { data } = await admin.from("cloud_entitlements").select("status, plan, current_period_end").eq("user_id", userId).maybeSingle();
    return (data as EntitlementRow | null) ?? null;
  },
  async insertBackup(row) {
    const { error } = await admin.from("cloud_backups").insert(row);
    if (error) throw error;
  },
  async getBackup(userId, id) {
    const { data } = await admin.from("cloud_backups").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
    return (data as BackupRecord | null) ?? null;
  },
  async listBackups(userId) {
    const { data } = await admin.from("cloud_backups").select("*").eq("user_id", userId);
    return (data as BackupRecord[] | null) ?? [];
  },
  async markAvailable(id) {
    await admin.from("cloud_backups").update({ status: "available", completed_at: new Date().toISOString() }).eq("id", id);
  },
  async deleteBackup(row) {
    await admin.storage.from(BUCKET).remove([row.object_path]);
    await admin.from("cloud_backups").delete().eq("id", row.id);
  },
  async signedUploadUrl(path) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("Could not create upload URL");
    return { url: data.signedUrl, headers: {} };
  },
  async signedDownloadUrl(path) {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
    if (error || !data) throw error ?? new Error("Could not create download URL");
    return data.signedUrl;
  },
  async objectSize(path) {
    const [folder, name] = path.split("/");
    const { data } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 1 });
    const size = data?.[0]?.metadata?.size;
    return typeof size === "number" ? size : null;
  },
  billing: {
    configured: () => !!(env("STRIPE_SECRET_KEY") && env("STRIPE_PRICE_MONTHLY") && env("STRIPE_PRICE_ANNUAL") && env("HAVENOS_BILLING_RETURN_URL")),
    async checkoutUrl(user, plan) {
      const session = await stripe(
        "checkout/sessions",
        checkoutParams({
          plan,
          userId: user.id,
          customerId: await customerFor(user),
          monthlyPrice: env("STRIPE_PRICE_MONTHLY"),
          annualPrice: env("STRIPE_PRICE_ANNUAL"),
          successUrl: `${env("HAVENOS_BILLING_RETURN_URL")}?result=success`,
          cancelUrl: `${env("HAVENOS_BILLING_RETURN_URL")}?result=cancelled`,
        }),
      );
      return session.url;
    },
    async portalUrl(userId) {
      const { data } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
      if (!data?.stripe_customer_id) return null;
      const portal = await stripe("billing_portal/sessions", { customer: data.stripe_customer_id, return_url: env("HAVENOS_BILLING_RETURN_URL") });
      return portal.url;
    },
  },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* handled as invalid request */
  }
  try {
    const result = await handleCloud(req.headers.get("authorization"), body, ports);
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    console.error(err);
    return Response.json({ error: { code: "server_error", message: "The cloud service had a problem. Please try again." } }, { status: 500 });
  }
});
