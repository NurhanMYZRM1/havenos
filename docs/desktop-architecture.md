# HavenOS desktop architecture

HavenOS is a property-management app for Malaysian landlords that runs on
Windows and macOS and keeps its records on the landlord's own computer.
Cloud backup is an optional paid add-on (see [cloud-backup.md](cloud-backup.md)).

## Why Electron (and not Tauri)

| | Electron | Tauri |
|---|---|---|
| Fit with the existing Next.js + TypeScript code | UI unchanged; main process is TypeScript too | UI unchanged; backend in Rust |
| Local database | Node's built-in SQLite (`node:sqlite`) — no native module to rebuild | `rusqlite`/`sqlx` (Rust) |
| Attachments, dialogs, printing to PDF, OS credential store | Built in (`fs`, `dialog`, `webContents.printToPDF`, `safeStorage`) | Plugins + Rust code |
| Rendering consistency | Same Chromium on Windows and macOS | WebView2 on Windows, WKWebView on macOS |
| Toolchain / maintainers | One language (TypeScript); no Rust toolchain on this machine | Adds Rust to the stack |
| Download size | Larger (~110–130 MB installer) | Smaller |

**Decision: Electron.** One language end to end, the shared domain code runs
unchanged in the UI, the main process and the tests, one rendering engine on
both platforms, and no native modules (Electron 44 ships Node 24 with
`node:sqlite`), so Windows installers can be built from a Mac without
per-platform recompiles. The cost is a larger download.

## Process model

```
┌──────────────── Renderer (sandboxed Chromium) ────────────────┐
│ Next.js static export served from app://havenos/…             │
│ React UI → window.havenos.invoke(method, params)              │
│ No Node, no filesystem, no network (CSP: connect-src 'self')  │
└───────────────┬───────────────────────────────────────────────┘
                │ one IPC channel: havenos:invoke (preload.ts)
┌───────────────▼──────────────── Main process ─────────────────┐
│ desktop/main   window, menu, protocols, dialogs, printToPDF,  │
│                safeStorage, IPC sender checks                 │
│ desktop/core   handlers → validation → services → SQLite      │
│                attachments folder, backup/restore, cloud client│
└───────────────────────────────────────────────────────────────┘
```

- **Narrow interface.** The preload exposes only `invoke(method, params)` and
  three events. Main rejects unknown methods, rejects calls from any frame that
  isn't the app's top-level page, and re-validates every parameter
  (`lib/domain/validate.ts`) before touching data. The page can never name a
  file path: attachments are read through `havenos-file://attachment/<id>`,
  resolved by id in main. Files come in either through a native dialog opened
  by main, or as bytes (drag-and-drop) that main checks by content (JPEG, PNG,
  WebP, GIF, HEIC, PDF, Office, text), with a 25 MB limit.
- **Hardening.** `contextIsolation`, `sandbox`, no `nodeIntegration`, a strict
  CSP, navigation locked to the app origin, `window.open` denied, all
  permission requests denied, single-instance lock.
- **No dev server in installed builds.** `app://havenos` serves `out/` from the
  app bundle (inside `app.asar`). `npm run desktop:dev` is the only mode that
  uses `next dev`.

## Local storage

| What | Where |
|---|---|
| Database | `<data>/havenos.db` (SQLite, WAL, `synchronous=FULL`) |
| Attachments | `<data>/attachments/<uuid>.<ext>` (+ `.thumb.jpg`) |
| Safety copies and pre-upgrade copies | `<data>/backups/` |
| Sample workspace | `<data>/sample/` (separate database and attachments) |
| Cloud sign-in token | `<data>/cloud-session.bin`, encrypted with `safeStorage` |

`<data>` is `~/Library/Application Support/HavenOS` on macOS and
`%APPDATA%\HavenOS` on Windows. It is fixed by name, so it survives app updates
and reinstalls. Uninstalling on Windows does **not** delete it.

**Integrity** lives in the database, not only the UI
([desktop/core/schema.ts](../desktop/core/schema.ts)):

- STRICT tables, CHECK constraints on every enum, date, month and amount;
  foreign keys on every relationship (`PRAGMA foreign_keys=ON`).
- Money is always integer **sen**. Dates are ISO calendar days in
  Asia/Kuala_Lumpur.
- Triggers keep the unit → room → bed tree consistent. They also reject any
  tenancy or reservation that overlaps another on the same space, on a space
  that contains it, or on a space it contains. For example, a whole-unit
  tenancy can't overlap a tenancy on one of its rooms or beds.
- One rent charge per tenancy per month (unique index), so recurring charge
  generation is idempotent. A voided month is never recreated.
- All multi-row changes run in transactions. Migrations are append-only and
  recorded in `PRAGMA user_version`. A full copy of the database is taken
  before any schema upgrade, and a database from a newer app version is refused
  rather than modified.

## Backup and restore

A backup is a standard `.tar.gz` named `*.havenos-backup`, so it can be opened
with ordinary archive tools. It contains a consistent database snapshot
(`VACUUM INTO`), every referenced attachment, and `manifest.json` with SHA-256
hashes and record counts.

Restore works in stages:

1. Extract into a private staging folder. Only expected file names are
   accepted (this blocks path traversal), and size limits apply.
2. Verify every hash, SQLite `integrity_check` and `foreign_key_check`, the
   schema version, and that every referenced attachment is present.
3. Show the landlord what the backup contains and ask for confirmation.
4. Write a **safety backup** of the current records to `<data>/backups/`.
5. Move the current files aside, move the restored ones in, open and migrate
   them.
6. If anything fails, put the originals back. If the app stops mid-restore, the
   originals are put back on the next launch.

## Domain rules worth knowing

- **Rental arrangement per unit:** whole unit, by room, or by bed. Occupancy
  counts the spaces each unit actually lets. A whole-unit condo is one lettable
  space; a room-let house counts each room.
- **Rent:** a schedule (amount and due day from a given month) generates one
  charge per calendar month. A 15 Jan–14 Jan tenancy is 12 charges. A tenancy
  entered mid-way starts charging from a chosen month, so no historical arrears
  are created. Payments are applied oldest charge first, which gives part-paid,
  due and overdue states; anything paid beyond the charges becomes credit.
- **Deposits** are kept apart from rent: separate entries (received, refunded,
  deducted), never counted as rent collected.
- **Maintenance** keeps a history row for every create, field change, note and
  attachment added or removed.
- **Sample workspace** is a separate database, so demo records can never mix
  with real ones. It is never included in backups.

## Short stays (Airbnb)

Full details, including what syncs and what doesn't:
[short-stays.md](short-stays.md).

- **Same inventory, same rule.** Reservations are a separate table from
  tenancies (nights; the check-out day is free; `channel` +
  `channel_reservation_id`). Tenancies, reservations and manual
  **availability blocks** are checked by one rule
  (`services/availability.ts`) and the same database triggers, across the unit
  → room → bed tree.
- **Airbnb link = calendar (iCal) feed, dates only.** Airbnb's API is
  invitation-only and HavenOS has no partner access. `channel_connections` maps
  one listing to one lettable space. Adapters live behind the interfaces in
  [desktop/core/integrations/channels.ts](../desktop/core/integrations/channels.ts).
- **Network access stays in main.** The main process fetches feeds over HTTPS
  (timeout, size cap, https-only redirects). The renderer's CSP is unchanged.
- **Feed links are secrets.** They are stored in the OS credential store
  (`channel-feeds.bin`, encrypted with `safeStorage`), never in the database,
  backups, logs or error text.
- **Sync** runs at launch and every 20 minutes while the app is open, only for
  the real workspace. A fetch runs outside any transaction. Reconciliation runs
  in one transaction, so a failure changes nothing. Imports are idempotent. A
  booking that vanishes is flagged, never auto-cancelled. A clashing booking is
  held as a conflict, never overwritten. A feed that suddenly loses most of its
  bookings is rejected.
- **History.** `reservation_events` records every change, whether made by
  hand, by sync or by CSV import. Turnovers follow their stay.
- **Money.** `stay_ledger` keeps *imported* (Airbnb CSV, idempotent on
  `external_ref`) and *entered* figures apart.
- **Schema 2** rebuilds `reservations` and `attachments` (turnover photos) and
  keeps every existing row. The usual pre-upgrade copy is taken first. Backups
  from schema 1 restore and migrate as before.

## Language

All UI text goes through `t()` with keys in
[lib/i18n/en.ts](../lib/i18n/en.ts). A Bahasa Malaysia catalogue can be added
as `ms.ts` with the same keys; any missing keys fall back to English. CSV
column headers stay in English on purpose, as a stable interchange format.

## Web and mobile builds

- `npm run build` (web) still builds, but records exist only in the desktop
  app. The web build shows a "desktop app required" page instead of pretending
  to hold data. The tenant custom-domain route (`app/t/[domain]`) is
  unchanged.
- The Capacitor mobile shell is kept but deferred. `MOBILE_BUILD=1` still
  produces a static export; no mobile work was done in this release.
