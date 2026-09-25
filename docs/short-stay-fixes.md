# Short-stay fixes — verification report

Implemented against `main` at `fece8c1`. The user handoff supplied the project
context. All tests and development runs used temporary data directories; the
real HavenOS data folder was not opened or modified.

## Requested items

| Item | Status | Result |
|---|---|---|
| 1. Dev redirect loop | Fixed | Reproduced a stale cached 308 redirect in an isolated Electron profile, then verified dev-only cache clearing before navigation. Normal app:// launches retain their HTTP cache. Packaged builds ignore the dev URL. Records, attachment and backup sentinels survive. |
| 2. Archive connected spaces | Fixed | Non-removed connections, including paused ones, block archiving their space or its ancestors/descendants. The error links to Channel connections to move/remove it. |
| 3. Sync diagnostics | Fixed | Original error names and bounded sanitized messages appear in Recent syncs and scheduler logs. Raw, encoded and twice-encoded URLs, queries and known secrets are removed, including parser/reconcile failures. |
| 4. Contract gaps | Fixed | Added validated blocks.get; stays.calendar has optional includeCancelled=false and inclusive from/to; PerformanceRow has a separate adjustments figure. |
| 5. Money import | Fixed | Payout date corrections update the existing ledger row and retain old dates in descriptions. Legacy references are upgraded on reimport; repeated lines retain identity across reordered full exports. Warnings use translation keys/params; report and short-stay labels moved; unrecognised headers are listed. |
| 6. Stale conflicts | Fixed | channels.get recomputes conflicts using findConflicts, including ownership conflicts for references belonging to another listing. |
| 7. UI | Fixed | Performance totals fit with expandable Imported/Entered figures. Calendar has 14/30/60 days, roving keyboard focus and Enter quick-add. All short-stay pages and key dialogs were checked at 960×640. |
| 8. Robustness/performance | Fixed | Windowed next-arrival query; 2,000-reservation performance regression; sample resets when opened on a new KL day as requested; app.now keeps relative labels consistent with HAVENOS_FAKE_NOW; ≥3 booking net-drop guard with override; recurrence is explicitly unsupported rather than silently omitted. |
| 9. Housekeeping | Partly fixed | Documentation updated and non-breaking PostCSS fix applied. Audit reduced from five findings (four moderate, one high) to three moderate findings in the mobile tooling chain. An out-of-range tooling change is intentionally deferred. |

## Migration and data preservation

Migration **3** appends one nullable column:

```sql
ALTER TABLE channel_sync_runs ADD COLUMN diagnostic TEXT;
```

Migrations 1 and 2 are unchanged. Regression tests cover direct v1/v2 database
upgrades and actual v1/v2 archive inspection/restoration into schema 3, keeping
records, attachments and v2 history, with pre-upgrade copies and safety backups.
No migration is required for payout identities: old keys are upgraded on import.

## Verification

- `npm run typecheck`: passed.
- Complete unit suite: **174/174 passed**, including the original tests and
  23 added regressions. Final run used the compiled output from desktop:build
  with `node --test --test-concurrency=1 --test-reporter=dot "dist-desktop/desktop/tests/*.test.js"`.
  `npm test` also passed before the final two archive-restore tests were added.
- `npm run desktop:build`: passed, static export and Electron code compiled.
- `node --test --test-concurrency=1 "desktop/e2e/*.test.mjs"`: **9/9 passed**,
  comprising the original seven plus redirect-cache and short-stay UI tests.
- The turnover regression creates 2,000 reservations, verifies every next
  arrival and requires both list/day-view reads to finish within two seconds.
- Minimum-size screenshots reviewed for Today, Calendar, Turnovers,
  Performance and its breakdown, reservation/turnover details, connections
  list/detail/edit, quick-add, block, reservation, ledger and CSV dialogs.
  Screenshots are generated under `desktop/e2e/screenshots/` (git-ignored).
- Actual `npm run desktop:dev` launch with
  `HAVENOS_DATA_DIR=/tmp/havenos-dev-review-20260925` and
  `HAVENOS_FAKE_NOW=2031-01-01T04:00:00Z`: dashboard loaded with HTTP 200;
  Settings → Sample workspace opened with arrivals, a late turnover and the
  next-day maintenance warning relative to 1 January 2031. The dev process
  was stopped afterwards.
- `git diff --check`: passed.

The restricted sandbox initially blocked the unit tests' localhost mock server
and the build's Google Fonts download. Those checks passed after rerunning with
the necessary local networking/download access. No product workaround was added.

## Remaining decisions and limits

- **Mobile dependency chain:** `@capacitor/cli 8.5.0 → xcode 3.0.1 → uuid 7.0.3`
  still produces three moderate audit findings. npm proposes an out-of-range
  Capacitor downgrade to 8.4.3; overriding uuid to the fixed 11.1.1+ would cross
  major versions. Neither was forced. Decide on a supported mobile-tooling
  update and test its iOS project generation separately. The underlying issue
  is documented in the [uuid advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).
- **Applied dependency fix:** a targeted override upgrades Next's PostCSS from
  8.4.31 to 8.5.28 within major 8, eliminating the PostCSS and inherited Next
  audit findings; the full build passes. See [PostCSS releases](https://github.com/postcss/postcss/releases).
- **Anonymous CSV lines:** otherwise identical lines in separate partial
  exports without a confirmation code or transaction reference cannot be
  distinguished reliably. A future manual-matching workflow would need a
  product decision; include those identifiers when available.
- **Recurrence:** the chosen supported behaviour is a visible rejection of
  RRULE/RDATE feeds. Expansion is not implemented and Apply anyway does not
  bypass unsupported recurrence.

## Files changed

- `app/(workspace)/properties/view/page.tsx`
- `components/settings/channels/connections.tsx`
- `components/stays/calendar-tab.tsx`
- `components/stays/money.tsx`
- `components/stays/performance-tab.tsx`
- `components/stays/shared.tsx`
- `desktop/core/channels/connections.ts`
- `desktop/core/channels/diagnostics.ts`
- `desktop/core/channels/fetcher.ts`
- `desktop/core/channels/scheduler.ts`
- `desktop/core/channels/sync.ts`
- `desktop/core/handlers-stays.ts`
- `desktop/core/handlers.ts`
- `desktop/core/imports/airbnb-csv.ts`
- `desktop/core/imports/import-session.ts`
- `desktop/core/integrations/channels.ts`
- `desktop/core/integrations/ical.ts`
- `desktop/core/sample.ts`
- `desktop/core/schema.ts`
- `desktop/core/services/performance.ts`
- `desktop/core/services/properties.ts`
- `desktop/core/services/stay-validate.ts`
- `desktop/core/services/stay-views.ts`
- `desktop/core/services/stays.ts`
- `desktop/core/services/turnovers.ts`
- `desktop/core/workspace.ts`
- `desktop/e2e/dev-cache.test.mjs`
- `desktop/e2e/short-stays.test.mjs`
- `desktop/main/main.ts`
- `desktop/tests/backup.test.ts`
- `desktop/tests/channels-ical.test.ts`
- `desktop/tests/channels-sync.test.ts`
- `desktop/tests/money-csv.test.ts`
- `desktop/tests/money-import.test.ts`
- `desktop/tests/money-performance.test.ts`
- `desktop/tests/records.test.ts`
- `desktop/tests/short-stay-schema.test.ts`
- `desktop/tests/stays-turnovers.test.ts`
- `desktop/tests/stays-views.test.ts`
- `docs/desktop-architecture.md`
- `docs/short-stay-fixes.md`
- `docs/short-stays.md`
- `lib/api/contract.ts`
- `lib/api/hooks.ts`
- `lib/i18n/en-money-errors.ts`
- `lib/i18n/en-short-stays.ts`
- `lib/i18n/en-stay-errors.ts`
- `lib/i18n/en.ts`
- `package-lock.json`
- `package.json`
