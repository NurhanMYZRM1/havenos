# Optional paid cloud backup

Local storage, local backup files and CSV export are always included and never
need an account. **Cloud backup** is a paid add-on. It keeps copies of the
landlord's HavenOS backup file in private storage linked to their account, so
they can restore onto a new computer.

**Scope of this release:** backup and restore only. Multi-device sync is
**not** implemented, and the app says so.

## How it works

```
Desktop app (main process)                Supabase
──────────────────────────                ─────────────────────────────────────
Sign in: email one-time code  ─────────▶  Auth (OTP)
Refresh token → OS credential store
  (Keychain / DPAPI via Electron safeStorage)

Explicit opt-in + consent (recorded locally; nothing uploads without it)

"Back up to cloud now":
  build local .havenos-backup
  POST /functions/v1/cloud {start-upload} ─▶ cloud fn: verify user token,
                                              evaluate entitlement FROM THE DB,
                                              402 if not entitled,
                                              else signed upload URL (single object)
  PUT file (progress shown)        ───────▶  Storage bucket `cloud-backups` (private)
  POST {complete-upload}           ───────▶  size check, mark available,
                                              keep the latest 10
Restore: {list}/{download} (entitlement re-checked) → download → the same
  validation as a local restore → confirm → restore with a safety backup

Stripe Checkout (browser) ─▶ Stripe ─▶ billing-webhook fn (signature verified)
                                       ─▶ cloud_entitlements (only writer)
```

- **Security boundary:** entitlement is decided only in the `cloud` edge
  function from `cloud_entitlements`, which only the signed Stripe webhook
  writes. The desktop app holds no "paid" flag; it only displays what the
  server returns.
- **Lapsed subscription:** uploads stop; restores keep working for a 7-day
  grace period; after that there are no cloud operations. Local records, local
  backup and export are never affected.
- **Secrets never ship in the app.** The desktop bundle contains only the
  Supabase project URL and the publishable (anon) key, which are public by
  design. `scripts/desktop.mjs` refuses a key that looks like a service-role or
  secret key. Service-role and Stripe keys live only in edge-function secrets.

Code: [desktop/core/cloud/](../desktop/core/cloud),
[supabase/functions/](../supabase/functions),
[supabase/migrations/0002_cloud_backup.sql](../supabase/migrations/0002_cloud_backup.sql).

## Billing provider choice (checked September 2026)

| Provider | Findings | Fit |
|---|---|---|
| **Stripe** | Available to Malaysian businesses, MYR pricing, Stripe Billing subscriptions with cards, hosted Checkout and customer portal, signed webhooks. Stripe's FPX docs say FPX has **no recurring payments** and isn't supported in subscription-mode Checkout ([Stripe FPX docs](https://docs.stripe.com/payments/fpx)). | **Chosen** for the first release |
| Razorpay Curlec | Malaysian subscription billing with cards and FPX Direct Debit (e-mandate), hosted subscription links, webhooks for each state change ([Curlec Subscriptions](https://curlec.com/subscriptions/)). | Best alternative if monthly FPX direct debit becomes important |
| Billplz | Low flat FPX fees; weaker recurring-billing support. | One-off payments only |
| Paddle (merchant of record) | Handles tax as reseller; pays out internationally. | Consider if selling beyond Malaysia |

**Approach:** Stripe, with two plans:

- **Monthly:** a subscription paid by card.
- **Annual:** a one-off Checkout payment by card **or FPX**, granting 365 days.
  FPX completes asynchronously, so access is granted only on
  `checkout.session.completed` / `async_payment_succeeded` with
  `payment_status = paid`.

The adapter lives in `supabase/functions/_shared/stripe.ts`. Swapping in Curlec
means writing another adapter that sets the same `cloud_entitlements` rows.

Before charging customers, confirm the pricing, tax registration (SST) and the
refund policy with your accountant. HavenOS makes no tax claims.

## Owner setup checklist (needs your accounts)

1. **Supabase project** (Singapore region recommended).
   - `supabase link --project-ref <ref>` then `supabase db push` (applies
     `0002_cloud_backup.sql`, which also creates the private `cloud-backups`
     bucket).
   - Auth → Email: enable email OTP. Edit the Magic Link template to include the
     code, `{{ .Token }}`, since the desktop app asks for the code rather than
     opening a link.
2. **Deploy functions**
   - `supabase functions deploy cloud`
   - `supabase functions deploy billing-webhook --no-verify-jwt`
3. **Stripe** (Malaysian account, business registration completed).
   - Create a product with a monthly recurring MYR price and a one-off annual
     MYR price. Enable FPX under payment methods, and enable the customer
     portal.
   - Webhook endpoint: `https://<ref>.functions.supabase.co/billing-webhook`,
     with events `checkout.session.completed`,
     `checkout.session.async_payment_succeeded` and
     `customer.subscription.created/updated/deleted`.
   - Set the secrets:
     `supabase secrets set STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… STRIPE_PRICE_MONTHLY=price_… STRIPE_PRICE_ANNUAL=price_… HAVENOS_BILLING_RETURN_URL=https://…`
   - The return URL should be a simple page asking the landlord to go back to
     HavenOS and press "Check again".
4. **Build the desktop app with the public endpoint:**
   `HAVENOS_CLOUD_URL=https://<ref>.supabase.co HAVENOS_CLOUD_ANON_KEY=<publishable key> npm run desktop:package`
   Without these, the app shows "Cloud backup isn't available in this build"
   and never attempts an upload.

## What has and hasn't been verified

- **Verified (automated):**
  - Entitlement rules, the webhook signature check, the Stripe event mapping
    and the cloud-function gating (`npm run test:cloud-functions`).
  - The desktop client against a local stand-in for the same HTTP contract
    (`desktop/tests/cloud.test.ts`): no upload without sign-in, consent or
    entitlement; progress; last success and last error; restore from a cloud
    copy; local use continuing when the entitlement is expired; billing links
    limited to Stripe hosts.
  - The not-configured state in the real app (e2e).
- **Not verified:** a deployed Supabase project, real Stripe Checkout or
  webhooks, or real uploads to Supabase Storage. These need your accounts and
  credentials. No checkout, payment or cloud backup is simulated in the
  product.
