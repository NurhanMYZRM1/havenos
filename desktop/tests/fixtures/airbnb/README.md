# Airbnb import fixtures (synthetic)

We had no real Airbnb files for these fixtures. Each one is **synthetic**, built from public descriptions and redacted samples, with the sources listed below. Every guest name, phone digit, confirmation code, listing id, UID, payout reference and listing title in this folder is made up. Don't replace them with real data.

Confidence levels: **high** means two or more independent public sources, or an Airbnb Help Center page, agree. **medium** means one good source, or an inference from real redacted samples. **low** means a best guess. The importer must tolerate anything marked low.

## Scenario

| | Listing A | Listing B |
|---|---|---|
| Listing id (fabricated) | `900000000000000001` | `900000000000000002` |
| Title (as the host named it) | `Cozy Studio, KLCC View \| Pool & Netflix` | `Family 3BR Condo, Bukit Bintang \| 6 Pax` |
| Export URL (shape only) | `https://www.airbnb.com/calendar/ical/900000000000000001.ics?s=0123456789abcdef0123456789abcdef` | only appears in the CSVs |

- `listing-a-v1.ics`: feed fetched on **2026-09-24**.
- `listing-a-v2.ics`: the same feed fetched on **2026-09-28**.
- `reservations.csv`: exported on **2026-09-28**. This is the legacy export; see the caveat below.
- `transactions.csv`: Earnings > **Paid** report, downloaded on **2026-11-02**, covering Sep–Oct 2026, both listings, MYR.

The titles contain commas on purpose, so the CSV quoting gets exercised. Listing ids are 18 digits, which is more than `Number.MAX_SAFE_INTEGER`. **Always store the listing id as a string.**

### Reservation and block map (shared across all files)

| Key | Code | Listing | v1 feed | v2 feed | Notes |
|---|---|---|---|---|---|
| R1 | `HMZX4K2P9Q` | A | 2026-09-18 → 09-21 | unchanged (same UID) | Past stay. Phone last 4 digits: 4821 |
| R2 | `HMB7T2QW4N` | A | 2026-10-02 → 10-05 | **2026-10-03 → 10-07, new UID** | Changed by the guest. Same code, same last 4 (0937) |
| R3 | `HMC9V5XK2R` | A | 2026-10-23 → 10-26 | **absent** | Guest cancelled. Last 4: 3316 |
| R4 | `HMD3L8PY6J` | A | — | 2026-10-09 → 10-12 | New booking on the dates freed from B1. Last 4: 7702 |
| B1 | — | A | 2026-10-09 → 10-11 `Airbnb (Not available)` | **absent** | Manual host block, later removed |
| B2 | — | A | 2027-03-24 → 2027-09-24 | **2027-03-28 → 2027-09-28, new UID** | Rolling block for the availability window (6 months) |
| — | `HMF6N4RZ8T`, `HMG2K7WX5P`, `HMH5Q9TC3W` | B | — | — | Appear only in the CSVs |

What a correct v1 → v2 import should produce:
- R1: no change.
- R2: **modified**. Match it by confirmation code, not by UID.
- R3: **cancelled**, or flagged for review.
- R4: **created**.
- B1: **removed**.
- B2: the host blocks are replaced. It must **not** raise "block removed" and "block added" alerts.
- R1 must not be marked cancelled if a later feed drops it. It is in the past.

---

## `listing-a-v1.ics`, `listing-a-v2.ics`, `listing-a-empty.ics`

**Modelled on:** real redacted Airbnb exports from 2022 ([gist `s3_airbnb_test.ics`](https://gist.github.com/sojo-chad/a54e31a35b33a5433a2dae46a4b119c6)) and 2024 ([Drupal date_ical #3432856](https://www.drupal.org/project/date_ical/issues/3432856)). Also [fewohbee #285](https://github.com/developeregrem/fewohbee/issues/285) for 2026–27 `Airbnb (Not available)` rows, [statement-portal PR #1569](https://github.com/ryanfortsch/statement-portal/pull/1569) for the DESCRIPTION and code regex, the [Uplisting](https://www.uplisting.io/blog/how-the-airbnb-icalendar-ical-changes-will-affect-you-and-how-to-avoid-disruption) and [OwnerRez](https://www.ownerrez.com/forums/general-help/airbnb-ical-change) notes on the Dec 2019 privacy change, [Operto](https://help-teams.operto.com/article/367-how-do-ical-feeds-import-bookings-blocks-and-guest-information), and [Airbnb Help: article 99](https://www.airbnb.com/help/article/99).

| Field / trait | Fixture value | Confidence | Notes |
|---|---|---|---|
| URL `https://www.airbnb.com/calendar/ical/<listingId>.ics?s=<32 hex>` | README only | high | The listing id in the path has been reliable in every sample seen. **Regional hosts** (airbnb.co.uk, .com.au, .com.my) are unconfirmed (**low**). Accept any `airbnb.<tld>` host. Parse the id from the path; never from the file. |
| `PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 0.8.8//EN` | yes | high | Same string in 2022, 2024 and 2026 reports. Note the **parameter on PRODID**, which trips some parsers ([ics-py #268](https://github.com/ics-py/ics-py/issues/268)). The version string may change. |
| Header lines: `CALSCALE:GREGORIAN`, `VERSION:2.0` | yes | high | There is **no** `METHOD`, `X-WR-CALNAME` or `VTIMEZONE`, so the listing name is not in the feed. |
| Order inside VEVENT: `DTEND` before `DTSTART`, then `UID`, `DESCRIPTION`, `SUMMARY` | yes | high | Don't depend on property order. |
| `DTSTART;VALUE=DATE` / `DTEND;VALUE=DATE` | yes | high | All-day dates. **DTEND is the checkout day and is exclusive.** Nights = DTEND − DTSTART. Back-to-back stays share a date. |
| No `DTSTAMP` | omitted | medium-high | Missing in every real sample. OwnerRez users' validators flagged a missing DTSTAMP on every VEVENT ([forum](https://www.ownerrez.com/forums/general-help/calendar-importsexports-for-airbnb-not-working)). Never require it. |
| UID `1418fb94e984-<32 hex>@airbnb.com` for reservations, `6fec1092d3fa-<32 hex>@airbnb.com` for blocks | fabricated hex after real prefixes | medium (format), **low** (meaning) | The prefixes are constant across unrelated hosts' feeds. **Whether a reservation's UID survives a date change is unverified.** Operto reports that changed reservations show up as new entries, so v2 gives R2 a new UID (worst case). |
| `SUMMARY:Reserved` | yes | high | Since 1 Dec 2019. Before that it held the guest name and code. |
| `SUMMARY:Airbnb (Not available)` | yes | high | Covers host blocks, prep time, advance notice, the availability-window tail, and (probably) nights imported from other calendars. Some tools also report `Not available` / `Blocked`. Match case-insensitively on "not available". |
| DESCRIPTION `Reservation URL: https://www.airbnb.com/hosting/reservations/details/<CODE>\nPhone Number (Last 4 Digits): NNNN` | yes | high | The **2022 variant** was `https://www.airbnb.com/reservation/itinerary?code=<CODE>`, so support both. Blocks have no DESCRIPTION. Codes seen are `HM` plus 8 uppercase alphanumerics (medium). Use a regex like `/(?:details\/|[?&]code=)([A-Z0-9]{8,12})/i` and don't hard-code the `HM` prefix. |
| Escaping | `\n` only | high | Nothing else has been seen. Still unescape `\\`, `\,`, `\;`, `\n` and `\N` per RFC 5545. |
| Line folding at **73 octets** plus CRLF and a leading space | yes | medium | Both real samples break after 73 characters (`…/reservations/` + ` details/…`). Unfold any fold width. |
| CRLF line endings | yes | medium | RFC 5545 requires CRLF. One OwnerRez report flagged the feed as "not CRLF delimited", so **accept LF too**. |
| Trailing newline after `END:VCALENDAR` | yes | low | Accept a file without one. |
| Empty feed (`listing-a-empty.ics`) | header plus `END:VCALENDAR` | medium | Built from the header structure; no public sample of an empty feed was found. A real feed is rarely empty: any availability window under ~12 months or any advance-notice setting adds a block. |

**Feed behaviour to design for.** Source: [Airbnb Help: article 99](https://www.airbnb.com/help/article/99), [Beds24](https://wiki.beds24.com/index.php/Airbnb_iCal), [BookingAutomation](https://www.bookingautomation.com/wiki/Airbnb_iCal), and the issues above.
- **Cancellations simply disappear.** No `STATUS:CANCELLED` is sent (high).
- **Date changes keep the confirmation code** (medium-high; [Airbnb Help: article 50](https://www.airbnb.com/help/article/50)). UID stability is unknown.
- **Window:** from about today to about today + 365 days (medium; Beds24, plus block end dates in the real samples). Past stays are probably dropped: OwnerRez says "future dates only" (medium-low). A reservation that vanishes after its checkout date is **not** a cancellation.
- **Rolling blocks** for advance notice and the availability window move every day and probably get new UIDs. Naive importers created a new block every day ([fewohbee #285](https://github.com/developeregrem/fewohbee/issues/285), MotoPress forum). Replace the whole block set on every fetch.
- **Polling and latency:** changes can take hours to appear. Tools poll every 15 minutes (Anytime Booking), 30 minutes (Inn Style) or 3 hours (Airbnb's own imports). HTTP **429 "Too Many Requests"** has been reported. The Airbnb Community thread and an unverified "80 requests/min per IP" figure are at low confidence. Also expect **403** and 5xx from unlisted or snoozed listings and from Airbnb incidents. **Poll no more often than every 15–30 minutes per URL**, add jitter and back off. On any non-200 response, a non-`text/calendar` body, or a file without `BEGIN:VCALENDAR`, **keep the last good snapshot and don't apply deletions**.
- The export carries **no guest name, price, guest count or check-in time.** Pair it with the CSVs.

---

## `transactions.csv` (Earnings → Paid → Get report → CSV)

**Modelled on:** the column map from a live Japanese-locale export (2025–26) in [koichiro/airbnb-payouts-importer `schema.rb`](https://github.com/koichiro/airbnb-payouts-importer), with its [number-format issue #74](https://github.com/koichiro/airbnb-payouts-importer/issues/74) and tests. Also [Airbnb Help: article 414](https://www.airbnb.com/help/article/414) (`Type`, `Amount`, `Host Fee`, `Earnings Year`, `Resolution Adjustment`, `Payout`), [Airbnb Help: article 3632](https://www.airbnb.com/help/article/3632) ("configure your data fields"), [CMCDragonkai script](https://github.com/CMCDragonkai/airbnb-transaction-history/blob/master/airbnb-transaction-history) (`Type`, `Date`, `Paid Out`, `Nights`, UTF-8 BOM), [Windsor, CA instructions](https://www.townofwindsor.ca.gov/1477/Airbnb-Gross-Earnings-Report-Instruction), [Contra Costa County](https://www.contracosta.ca.gov/10604/Accessing-Your-Gross-Earnings-Report-fro), and [Tallybreeze](https://support.tallybreeze.com/en/articles/4565366-airbnb-transaction-history-csv-differences).

| Aspect | Fixture | Confidence | Notes |
|---|---|---|---|
| Column **set and order**: `Date, Arriving by date, Type, Confirmation code, Booking date, Start date, End date, Nights, Guest, Listing, Details, Reference code, Currency, Amount, Paid out, Service fee, Fast Pay fee, Cleaning fee, Pet fee, Gross earnings, Occupancy taxes, Airbnb remitted tax, Earnings year` | yes | medium (set), **low** (exact English wording and order) | Mapped back to English from the Japanese headers, and `Airbnb remitted tax` stayed untranslated even there. Hosts can **choose the fields**, and older files use `Host Fee`, `Paid Out` and `Reference`. **Match by normalised header name and alias list, never by position.** Keep unknown columns. Treat every column except Date, Type and an amount as optional. |
| Encoding | UTF-8 **with BOM**, LF | medium | Strip the BOM. Accept CRLF. |
| Headers and `Type` values are **localised** to the account language | English here | high | For example, Japanese `種別` / `予約`. Carry alias tables and don't hard-code English. |
| Dates `MM/DD/YYYY` | yes | medium-high | Holds even in the Japanese locale (koichiro). Hosts outside the US complain of "mixed" dates, which is Excel misreading MM/DD. Parse strictly as MM/DD/YYYY, fall back to ISO, and **reject ambiguous input rather than guess.** |
| Numbers: `465.60`, `-80.00`, and **comma-grouped quoted values since ~June 2026** (`"1,047.60"`) | both | medium | koichiro #74 saw `1234.00` change to `"1,234"`. Strip grouping commas only when they match `^\-?\d{1,3}(,\d{3})+(\.\d+)?$`. No currency symbol appears in amount cells. Currency is in its own `Currency` column (`MYR`). |
| `Type` values: `Payout`, `Reservation`, `Resolution Adjustment` | yes | high | From Help 414 and the scripts. |
| `Type` value `Adjustment` (R2 alteration, +1 night) | yes | **low** | Other values seen or rumoured: `Resolution Payout`, `Co-Host Payout`, pass-through tax rows, cancellation fees. **Store unknown types without failing.** |
| Row layout: a `Payout` row (Date = release date, `Arriving by date`, `Details`, `Reference code`, `Paid out`) followed by the lines it pays (`Amount` filled, `Paid out` empty) | yes | medium | In the fixture each `Paid out` equals the sum of the `Amount` values below it, and a negative resolution is netted into the next payout. Don't depend on row order or grouping: rebuild the links by Date and Reference code where you can. |
| Multi-listing identification: the `Listing` column holds the **listing title**, not an id | yes | medium-high | Renaming a listing breaks matching. Let the user map title to listing once, and match by confirmation code when the code is already known from the iCal. |
| `Guest` holds the full name; `Confirmation code` is present on Reservation, Adjustment and Resolution rows and empty on Payout rows | yes | medium | |
| `Details` text, `Reference code` format, `Airbnb remitted tax` = RM10/night tourism tax for a foreign guest (`HMH5Q9TC3W`) | fabricated | **low** | Treat as free text. |
| Only paid-out stays appear: R3 (cancelled, full refund) is absent; R2/R4 only after check-in | yes | medium | Payouts are released about 24 hours after check-in. A separate **Upcoming** report exists with the same columns. |

Control totals: listing A Amount = 1,600.50 and listing B = 2,442.00, for a total Paid out of **4,042.50** MYR. Gross earnings: A = 1,650.00, B = 2,600.00. Service fee: A = 49.50, B = 78.00.

---

## `reservations.csv` (Hosting → Reservations → Export) — LEGACY

**Caveat:** in 2026, Airbnb Community threads report that the export option was **removed "due to data privacy policies"**. Hosts are pointed to the earnings CSV instead ([thread 2293756](https://community.withairbnb.com/t5/Help-with-your-business/Disappearance-of-the-Operational-Reservation-CSV-Export-A-Major/m-p/2293756)). Build this importer as optional, for files hosts already have.

**Modelled on:** a real Chinese-locale export from 2019 in [jutkko/airbnb-reservation-parser](https://github.com/jutkko/airbnb-reservation-parser), which has 13 columns, with the headers renamed by that author. Also Airbnb Community reports that fields weren't quoted, so commas in titles and earnings split cells ([thread 1340163](https://community.withairbnb.com/t5/Help/Reservation-CSV-export-is-faulty/td-p/1340163)), and [Airbnb Help: article 363](https://www.airbnb.com/help/article/363) for status wording.

| Aspect | Fixture | Confidence | Notes |
|---|---|---|---|
| 13 columns: `Confirmation code, Status, Guest name, Contact, # of adults, # of children, # of infants, Start date, End date, # of nights, Booked, Listing, Earnings` | yes | medium (order and count), **low** (English wording) | Match by header and aliases. Headers are localised. |
| Dates `YYYY-MM-DD` for start, end and booked | yes | medium-low | Only the 2019 zh-CN sample. Also accept MM/DD/YYYY. |
| `Earnings`: symbol prefix without a space (`RM494.70`, `"RM1,047.60"`) | yes | medium-low | The sample had `€2.50`. Strip any currency symbol or ISO code and grouping. The **currency is implicit**. Old files may have **unquoted commas**, giving too many columns: repair them by expecting 13 fields, or reject the row. |
| `Status`: `Confirmed`, `Past guest`, `Canceled by guest` | yes | **low** | Also expect `Canceled by host`, `Canceled by Airbnb`, `Currently hosting`, `Arriving soon`/`today`, `Checking out today`, `Awaiting guest review`, `Pending`, and localised forms (the zh sample used `已确认`). Treat any value containing "cancel" as cancelled. Map everything else to active or past by date. |
| `Contact`: full phone number | fabricated | low | Its last 4 digits match the iCal DESCRIPTION. That is a useful secondary match key. It is **personal data**: see PDPA in the research notes. |
| Cancelled row has `RM0.00` | yes | low | A cancellation fee could be non-zero. |

---

## What the importer must tolerate (summary)

1. Match CSV columns by **normalised header name plus locale aliases**, never by position. Columns can be missing, extra, renamed (`Host Fee` / `Service fee`, `Paid Out` / `Paid out`) or reordered. Keep unknown columns.
2. Strip a UTF-8 BOM. Accept CRLF and LF in both CSV and ICS. Accept a missing final newline.
3. Parse CSV dates as **MM/DD/YYYY** first, then ISO `YYYY-MM-DD`. Never guess DD/MM.
4. Parse amounts with an optional currency prefix (`RM`, `MYR`, `$`, `€`), optional grouping commas and a leading `-`. Keep money as integer sen, not floats.
5. Treat `Type` and `Status` as open vocabularies, including localised values. Unknown values are stored and flagged, never fatal.
6. The ICS has no DTSTAMP, carries a parameter on PRODID, and folds lines (unfold any width). DTEND is exclusive. Reservations are `Reserved`; anything containing "not available" or "blocked" is a block.
7. Take the confirmation code from **either** URL form in DESCRIPTION. Key reservations by **listing id + confirmation code**. Use the UID only as a fallback, because it may change when dates change.
8. **A missing event means cancelled only if its checkout date is still in the future**, and only after a successful, well-formed fetch. Never delete on a failed, empty-after-non-empty, or non-200 fetch. Surface the change for review.
9. Replace **all** `Not available` blocks for a listing on every fetch. They roll daily and get new UIDs.
10. Store listing ids as **strings** (18+ digits). A listing's title in the CSVs is not a stable key.
11. Poll gently: at most every 15–30 minutes per URL, with jitter and exponential backoff on 429 and 5xx. Expect hours of latency.
12. The same stay can show up with different amounts in transactions and reservations (adjustments, resolutions, partial payouts). Reconcile by confirmation code and never overwrite one with the other.

A throwaway script generated these files and it is not committed. If you edit them by hand, keep **CRLF** and the 73-octet folding in the `.ics` files. Keep the BOM in `transactions.csv`. Keep the cross-file totals consistent: each reservation's `Earnings` equals the sum of its transaction `Amount`s, excluding resolutions.
