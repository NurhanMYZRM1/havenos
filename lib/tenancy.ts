// Custom-domain → org resolution for Cloudflare-fronted vanity domains.
// The middleware stamps x-tenant-domain; server components resolve it here.

const APP_HOSTS = new Set(
  (process.env.NEXT_PUBLIC_APP_HOSTS ?? "localhost:3000,haven-os.vercel.app")
    .split(",")
    .map((h) => h.trim().toLowerCase()),
);

export function isAppHost(host: string): boolean {
  const h = host.toLowerCase();
  // Any localhost/127.0.0.1 port is the operator console in dev — `next dev`
  // bumps ports when one is busy, and hard-coding :3000 breaks that.
  if (/^(localhost|127\.0\.0\.1):\d+$/.test(h)) return true;
  return APP_HOSTS.has(h);
}

/** Look up the org that owns a custom domain (orgs.custom_domain, unique). */
export async function resolveTenant(host: string) {
  const { createClient } = await import("./supabase/server");
  const supabase = await createClient();
  const { data } = await supabase
    .from("orgs")
    .select("id, name, slug, brand")
    .eq("custom_domain", host.toLowerCase())
    .maybeSingle();
  return data;
}
