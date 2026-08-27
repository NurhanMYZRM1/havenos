# HavenOS

Premium operations console for high-end sub-leasing and co-living portfolios.
Inventory is hierarchical — **Property → Unit → Bed** — and leasing happens at
bed granularity (the co-living primitive).

Ships as **one codebase, two targets**: a Vercel web app and a native
iOS/Android app via Capacitor.

## Stack

- **Next.js 15** (App Router, TypeScript, Tailwind v4) → Vercel (`sin1`)
- **Capacitor 8** native shell → App Store / Play Store
- **Supabase** Postgres with RLS — [supabase/migrations/0001_core.sql](supabase/migrations/0001_core.sql)
- **Cloudflare** DNS for the app + per-tenant vanity domains — [docs/cloudflare-custom-domains.md](docs/cloudflare-custom-domains.md)
- **framer-motion** micro-interactions; brand tokens in [app/globals.css](app/globals.css)
- **Higgsfield Cinema Studio** renders for onboarding — [public/media/manifest.json](public/media/manifest.json)

## Quick start

```bash
npm install
cp .env.example .env.local   # Supabase keys (demo data renders without them)
npm run dev
```

Routes: `/dashboard` (property hub), `/dashboard/work-orders`, `/onboarding`,
`/t/<host>` (tenant custom domains, reached via `middleware.ts` rewrites).

## Build targets

| Target | Command | Output | Notes |
|---|---|---|---|
| Web | `npm run build` | `.next/` | SSR, middleware, tenant custom domains |
| Mobile | `npm run build:mobile` | `out/` | Static export for the Capacitor shell |

Routes named `page.web.tsx` are registered **only** in the web build — that
keeps the dynamic tenant route out of the static export without forcing
`dynamicParams: false` onto the web build.

## Mobile

```bash
npm run cap:ios       # build + sync + open Xcode
```

```bash
npm run cap:android   # build + sync + open Android Studio
```

Full submission guide — including the **App Store Guideline 4.2** risk and how
this app mitigates it — is in
[docs/mobile-deployment.md](docs/mobile-deployment.md).

Native capabilities live in [lib/native.ts](lib/native.ts) and all degrade
gracefully on web: camera capture, push notifications, haptics, offline cache,
network awareness.

Icons and splash screens regenerate from [assets/](assets):

```bash
npm i -D sharp && node scripts/gen-icons.mjs
```

## Database

```bash
supabase link --project-ref <ref>
supabase db push
psql $DB_URL -f supabase/seed.sql
npm run db:types
```

## Deploy (web)

```bash
vercel link && vercel --prod
```

Then point Cloudflare DNS at `cname.vercel-dns.com` per the routing doc.
