# Short stays and Airbnb

HavenOS manages short stays (Airbnb and direct bookings) next to long-term
tenancies, on the same unit → room → bed inventory, so one space can never be
let twice for the same night.

This page covers what the Airbnb link can and can't do, how to set it up, how
syncing and conflicts work, and the path to a full API integration if HavenOS
is ever approved as an Airbnb partner.

## Which Airbnb integration HavenOS uses (checked September 2026)

| Option | Status for HavenOS | Used? |
|---|---|---|
| **Airbnb API** (listings, availability, pricing, reservations, messaging for approved *software partners*) | Invitation-only. Airbnb says it is "not accepting new access requests" and that partner managers approach prospective partners themselves. HavenOS has **no** partner approval or credentials. | No |
| **Calendar sync (iCal)**: a listing's *Export calendar* link | Available to every host, documented in [Airbnb Help: Sync your calendar with other websites](https://www.airbnb.com/help/article/99). | **Yes** |
| **Earnings CSV**: *Transaction history → Export CSV* | Available to every host ([Airbnb Help: Download your earnings](https://www.airbnb.com/help/article/3632)). The host downloads the file and imports it. Columns can be chosen by the host and are translated by locale, so HavenOS matches them by name. | **Yes**, as the source of money figures |
| **Reservations CSV** (*Reservations → Export*) | Reportedly removed by Airbnb in 2026. HavenOS still reads older files if you have them. It never stores their contact (phone) column. | Best effort |
| Scraping Airbnb pages, automating the website, undocumented endpoints, asking for the host's Airbnb password | Against Airbnb's terms and unsafe | **Never** |

So HavenOS says **"Airbnb calendar linked · dates only"**, never "connected to
Airbnb".

## What syncs and what doesn't

| | Calendar link (iCal) | Earnings CSV import | Typed in HavenOS |
|---|---|---|---|
| Booked dates (check-in, check-out) | ✅ every 20 min while HavenOS is open | ✅ | ✅ |
| Airbnb confirmation code (HM…) | ✅ (read from the event's reservation link) | ✅ | optional |
| Dates blocked on Airbnb for other reasons | ✅ shown as "Blocked on Airbnb" | — | — |
| Cancellations | ⚠️ inferred: the booking disappears from the feed. HavenOS flags it and asks you to confirm. | ✅ status in the reservations export | ✅ |
| Date changes | ✅ applied, with history | — | ✅ |
| Guest name | ❌ | ✅ | ✅ |
| Guest phone / email | ❌ (the feed's last-4 phone digits are discarded) | ❌ never stored | — |
| Nightly price, fees, payouts, taxes | ❌ | ✅ | ✅ |
| Messages, reviews, listing content, prices on Airbnb | ❌ | ❌ | ❌ |
| Blocking dates **on Airbnb** | ❌ HavenOS can't write to Airbnb: it lists the dates for you to block by hand | — | — |

### Timing, and the double-booking window

- HavenOS reads each linked calendar **when it opens** and **every 20 minutes
  while it's open**. It backs off briefly if Airbnb answers "too many
  requests". When the app is closed, nothing syncs. A calendar not read
  successfully for 60 minutes is marked **stale**.
- Airbnb refreshes calendars *it* imports roughly **every 3 hours**
  ([help article 99](https://www.airbnb.com/help/article/99)). This matters
  only if you also link other calendars into Airbnb.
- A new Airbnb booking reaches HavenOS at most ~20 minutes later, but only
  while HavenOS is running. Until then HavenOS could accept a direct booking or
  tenancy for the same nights. The day view and Settings warn whenever a link
  is stale or has failed.
- Dates HavenOS knows are taken (a tenancy, a maintenance block, a direct
  booking) are **not** sent to Airbnb. They appear under **Settings → Channel
  connections → Dates to block on Airbnb** until Airbnb's calendar shows them
  blocked. Until you block them on Airbnb, Airbnb can still sell those nights.

## Setting up an Airbnb listing

1. In HavenOS, set up the property so the listing matches **one lettable
   space**: a whole unit, a room, or a bed, following the unit's arrangement.
2. In Airbnb (web or app), open **Calendar**, pick the listing, open
   **Availability** settings, and choose **Connect calendars** (or **Sync
   calendars**). Choose **Connect to another website**, then copy the link
   Airbnb shows. It looks like `https://www.airbnb.com/calendar/ical/<number>.ics?s=…`.
   Airbnb renames these menus now and then; the link always ends in `.ics`.
3. In HavenOS, open **Settings → Channel connections → Add connection**, choose
   Airbnb, pick the space, paste the link, and set your usual check-in and
   check-out times (used for turnovers, since the calendar has no times).
4. HavenOS reads the calendar straight away. Check the calendar under **Short
   stays** and resolve any conflicts it shows.
5. Optional, for money figures: in Airbnb go to **Earnings → Transaction
   history**, choose **Export CSV**, then in HavenOS use **Short stays →
   Performance → Import Airbnb CSV**. Match each Airbnb listing name to its
   space once; HavenOS remembers the match.

**Keep the calendar link private.** Anyone with it can see your booked dates.
HavenOS stores it in your computer's secure credential store (macOS Keychain /
Windows DPAPI). It is never written to the database, backups, logs or error
messages. If you restore a backup onto another computer, paste each link again.
Airbnb lets you reset the link if it leaks.

## How HavenOS applies a calendar

Each sync reads the whole calendar (iCal has no change log) and compares it with
what HavenOS already holds:

- **New booking.** Checked against tenancies, other reservations and
  availability blocks on the same space *and* on any space containing it or
  contained by it. The rule is the same one tenancies use
  (`services/availability.ts` plus database triggers). If the dates are free, the
  booking becomes a reservation (source *Synced*). If they clash, it is **held
  as a conflict**: nothing is overwritten, and the conflict names the clashing
  records.
- **Same booking, new dates.** The dates are updated and the change is kept in
  the reservation's history. If the new dates clash, the old dates stay and the
  change waits as a conflict.
- **Booking gone from the feed.** It may have been cancelled, but iCal can't say
  so. HavenOS marks it **Missing from Airbnb**, keeps it (and its nights
  blocked), and asks you to confirm the cancellation. Stays that have already
  ended are left alone.
- **Feed suddenly lost most of its bookings.** For example, HavenOS got an
  empty or cut-off response. The whole sync is rejected, nothing changes, and
  Settings offers **Apply anyway**.
- **Blocked on Airbnb.** Shown on the calendar for information only. HavenOS
  can't tell why Airbnb blocked the dates (your own block, preparation time,
  advance notice, another calendar), so they don't stop tenancies.
- Every sync runs in **one database transaction**: it either applies completely
  or not at all. Repeating a sync with the same calendar changes nothing
  (bookings are keyed by channel and confirmation code).

**Resolving a conflict** (Settings → Channel connections → the connection):

- **Retry**: after you change the HavenOS side yourself.
- **Keep HavenOS record**: you'll cancel or move the Airbnb booking on Airbnb.
  The conflict stays quiet until Airbnb's dates change.
- **Replace**: offered only when every clash is a manual block or a direct
  booking. HavenOS cancels those (keeping their history) and applies the Airbnb
  booking. Tenancies are never changed for you.

## Operations

- **Turnovers.** Every stay gets a cleaning/inspection task due on its check-out
  day, at its check-out time. It shows the next check-in and the hours between
  the two, a checklist (per connection, with a default), an assignee with a
  WhatsApp link, status, cost, photos and completion time. It moves when the
  stay's dates change, and is marked *skipped* (not deleted) if the stay is
  cancelled.
- **Availability blocks.** Maintenance, personal use or owner stays. They block
  tenancies and reservations like any booking and appear in *Dates to block on
  Airbnb* until Airbnb shows them blocked.
- **Today view.** Arrivals, departures, in-house guests, turnovers (including
  overdue ones), open maintenance on short-stay spaces, and alerts.
- **Alerts.** Conflicts, bookings missing from a feed, unassigned turnovers due
  within 3 days, late turnovers, stale or failing calendar links, arrivals in
  the next 2 days on a space with open *critical* maintenance, and dates not yet
  blocked on Airbnb.
- **Performance.** Booking value, cleaning fees, channel fees, taxes, payouts,
  expenses and estimated net, by property, space, channel or month. Each
  figure keeps **Imported** (from an Airbnb CSV) and **Entered** (typed by you)
  apart. Expenses include turnover costs and completed maintenance on
  short-stay spaces. The net figure is an estimate, not accounting. There is no
  pricing advice: HavenOS has no market data.

## Approved API path (if Airbnb invites HavenOS)

Nothing below is built. There are no credentials, and code for an API we can't
call would only go stale. The seams are in place:

1. **Owner steps:** be invited by Airbnb as a software partner, sign the partner
   agreement, pass Airbnb's technical review, and receive API credentials and
   documentation. None of this can be self-served today.
2. **Credentials:** keep the client secret server-side (a HavenOS cloud
   function, like the Stripe keys in [cloud-backup.md](cloud-backup.md)). Keep
   per-host OAuth tokens in the OS credential store, like the calendar links
   (`desktop/main/channel-secrets.ts`).
3. **Code:** implement `PartnerApiAdapter` in
   `desktop/core/integrations/channels.ts`. Its events feed the same
   reconciliation (`desktop/core/channels/sync.ts`), so conflicts, history and
   turnovers work unchanged. Set `capabilities` truthfully (`incremental`,
   `pushAvailability`, `guestDetails`, `money`); the UI reads these instead of
   assuming. `pushUnavailable` would replace the manual *Dates to block* list.
4. **Rate changes:** only if the API supports them *and* the landlord turns the
   option on explicitly. Nothing is published automatically.

## Data kept about guests

Only what the features need: the guest name (from the CSV or typed), guest
count, stay dates and times, the confirmation code, and your notes. HavenOS
doesn't store phone numbers, emails or messages from Airbnb, and discards the
last-4 phone digits in the calendar feed. Under Malaysia's Personal Data
Protection Act 2010 (amended 2024, with breach-notification duties), you remain
responsible for the guest data you keep. Delete notes you no longer need.

HavenOS is **not** a guest register. The Registration of Guests Act 1965 may
require you to keep one ([Airbnb Help 2912](https://www.airbnb.com/help/article/2912)),
and some councils and building management bodies (e.g. Penang's short-stay
guidelines) add their own rules. Check what applies to each building.

## Where the code lives

| Area | Files |
|---|---|
| Schema (migration 2) | `desktop/core/schema.ts` |
| Availability rule (tenancies, reservations, blocks) | `desktop/core/services/availability.ts` + triggers |
| Reservation writes and history | `desktop/core/services/reservations.ts` |
| Calendar adapters and parser | `desktop/core/integrations/` |
| Sync engine, scheduler, connections, pending blocks | `desktop/core/channels/` |
| Feed-link storage (OS credential store) | `desktop/main/channel-secrets.ts` |
| Turnovers, blocks, day view, calendar, alerts | `desktop/core/services/turnovers.ts`, `blocks.ts`, `stays.ts` |
| Ledger, CSV import, performance | `desktop/core/services/ledger.ts`, `performance.ts`, `desktop/core/imports/` |
| IPC handlers | `desktop/core/handlers-channels.ts`, `handlers-stays.ts`, `handlers-money.ts` |
| UI | `app/(workspace)/stays/`, `app/(workspace)/settings/channels/`, `components/stays/`, `components/settings/channels/` |
