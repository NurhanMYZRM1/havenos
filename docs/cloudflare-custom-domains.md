# Cloudflare custom-domain routing

HavenOS serves two host classes from one Vercel deployment:

1. **Operator console** — `app.havenos.co` (and `haven-os.vercel.app`).
2. **Tenant vanity domains** — each org's `custom_domain` (e.g. `stay.havencollective.co`),
   rewritten by [middleware.ts](../middleware.ts) to `/t/<host>` and resolved
   against `orgs.custom_domain` in Supabase.

## DNS records (zone: havenos.co)

| Type  | Name  | Content                 | Proxy      | Notes |
|-------|-------|-------------------------|------------|-------|
| CNAME | `app` | `cname.vercel-dns.com`  | DNS only ☁︎ | Operator console |
| CNAME | `@`   | `cname.vercel-dns.com`  | DNS only ☁︎ | Marketing root (CNAME flattening) |
| CNAME | `www` | `cname.vercel-dns.com`  | DNS only ☁︎ | Redirects to root in Vercel |

**Proxy status:** keep Vercel-bound records **DNS only (grey cloud)**. Vercel
terminates TLS and needs to see the true host. If a record must be proxied
(orange cloud) for Cloudflare features, set **SSL/TLS → Full (Strict)** zone-wide
first — `Flexible` causes redirect loops against Vercel.

## Per-tenant vanity domains

For each org that brings a domain (their zone, our app):

1. Tenant adds `CNAME stay → cname.vercel-dns.com` (DNS only) in their Cloudflare zone.
2. Add the hostname to the Vercel project (`vercel domains add stay.tenant.com`
   or the Domains API) — Vercel issues the certificate automatically.
3. Set `orgs.custom_domain = 'stay.tenant.com'` — middleware + `resolveTenant()`
   do the rest. No redeploy needed.

At scale (hundreds of tenant domains), move issuance to **Cloudflare for SaaS**
(Custom Hostnames on our zone with a fallback origin pointing at Vercel), which
keeps tenants on a single `CNAME stay → ssl.havenos.co` target we control.

## Security headers

Baseline headers ship from [vercel.json](../vercel.json); anything cache-related
for `/media/*` is set in [next.config.ts](../next.config.ts) so Cloudflare's edge
caches immutable tour assets hard.
