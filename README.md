# HavenOS

Property management for Malaysian landlords, as a desktop app for **Windows
and macOS**. Records live on the landlord's own computer and work offline, with
no account needed. **Cloud backup** is an optional paid add-on.

- **Properties:** Malaysian addresses (postcode, city, state or federal
  territory), each unit let as a **whole unit, by room, or by bed**, and
  photos with a chosen cover.
- **Tenants & tenancies:**
  - Contact details (+60 numbers) and assignment to a unit, room or bed.
  - Overlap protection: a whole-unit tenancy can't overlap a tenancy on its
    rooms or beds.
  - Active / upcoming / ending-soon / ended views.
  - Move-in and move-out, with deposit refunds and deductions.
  - Documents.
- **Rent:**
  - Monthly charges from an editable rent schedule; they're never duplicated.
  - Manual payments (bank transfer, DuitNow, cash…), partial payments,
    balances and overdue amounts.
  - Numbered receipts: print or save as PDF.
  - Deposits kept apart from income; CSV export. Amounts are integer sen,
    shown as RM.
- **Maintenance** (formerly Work Orders):
  - Requests tied to a property and optionally a unit, room or bed; priority,
    status, due date and contractor.
  - Estimated and actual costs, photos and files, notes, and a full change
    history.
  - List and board views with filters.
- **Short stays (Airbnb):**
  - Link each Airbnb listing to a unit, room or bed through Airbnb's calendar
    export (iCal). This syncs **dates only**, at launch and every 20 minutes
    while the app is open. No guest details, prices or payouts come through
    the calendar, and HavenOS can't change anything on Airbnb.
  - Short stays, tenancies and availability blocks share one overlap rule.
    Clashing bookings are held for review; bookings that vanish from a feed are
    flagged, never silently removed.
  - Turnovers (cleaning between stays) with checklist, cleaner, photos and a
    late warning. A today view with arrivals, departures and alerts.
  - Money from the landlord's own Airbnb earnings CSV or typed in, with
    imported and entered figures kept apart.
- **Dashboard:** occupancy measured by each unit's arrangement; rent due,
  collected and overdue; tenancies ending; move-ins and move-outs; maintenance
  summary — all calculated from stored records.
- **Backup & restore:** one checked file containing the database and all
  attachments, with a safety copy made before every restore. Plus a separate
  **sample workspace** for trying the app.

## Quick start

```bash
npm install
npm run desktop:dev
```

Other commands (tests, packaging, signing) are in
[docs/desktop-release.md](docs/desktop-release.md).

## Documentation

- [docs/desktop-architecture.md](docs/desktop-architecture.md) — why Electron,
  process model and security, local storage and integrity, backup format,
  domain rules, the short-stay/Airbnb path, i18n.
- [docs/short-stays.md](docs/short-stays.md) — Airbnb calendar sync: what it
  can and can't do, setup, conflicts, turnovers, CSV import, the approved-API
  path.
- [docs/desktop-release.md](docs/desktop-release.md) — dev, test, package,
  sign, notarise, install.
- [docs/cloud-backup.md](docs/cloud-backup.md) — the optional paid cloud
  backup: design, billing provider choice, owner setup checklist, what is
  verified.

## Layout

| Path | What |
|---|---|
| `app/`, `components/` | Next.js UI (static export in the desktop app) |
| `lib/domain/` | Shared rules: money (sen), KL dates, phones, rent, overlaps, validation |
| `lib/api/contract.ts` | Typed contract between the UI and the desktop process |
| `lib/i18n/` | UI text catalogue (English; Bahasa Malaysia can be added) |
| `desktop/main`, `desktop/preload` | Electron main process and the narrow bridge |
| `desktop/core/` | SQLite schema & migrations, services, attachments, backup, cloud client |
| `desktop/tests/`, `desktop/e2e/` | Node test-runner suites and Playwright-driven app tests |
| `supabase/functions/`, `supabase/migrations/0002_*` | Optional cloud-backup service |

The earlier web and Capacitor targets still build (`npm run build`,
`npm run build:mobile`). The web build shows that records are kept in the
desktop app, and mobile work is deferred
([docs/mobile-deployment.md](docs/mobile-deployment.md)).
