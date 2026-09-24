/**
 * Local database schema, applied in order and recorded in PRAGMA user_version.
 * Migrations are append-only: never edit a released migration, add a new one.
 *
 * Integrity lives in the database, not just the UI:
 *  - STRICT tables, CHECK constraints for every enum, date and amount;
 *  - foreign keys everywhere (PRAGMA foreign_keys is on for every connection);
 *  - triggers keep the unit → room → bed tree consistent and reject any
 *    tenancy or reservation that overlaps another on the same space, a space
 *    that contains it, or a space it contains.
 */

const STATES = "'JHR','KDH','KTN','MLK','NSN','PHG','PRK','PLS','PNG','SBH','SWK','SGR','TRG','KUL','LBN','PJY'";
const PAYMENT_METHODS = "'bank_transfer','duitnow','cash','cheque','card','ewallet','other'";

const isDate = (col: string) => `(date(${col}) IS ${col})`;
const isMonth = (col: string) => `(${col} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(${col}, 6, 2) BETWEEN '01' AND '12')`;

/**
 * SQL predicate: spaces `a` and `b` overlap (same, ancestor, or descendant).
 * Mirrors spacesOverlap() in lib/domain/inventory.ts.
 */
export const SPACES_OVERLAP =`(a.unit_id = b.unit_id AND (a.kind = 'unit' OR b.kind = 'unit' OR (a.room_id = b.room_id AND (a.kind = 'room' OR b.kind = 'room' OR a.id = b.id))))`;

function tenancyOverlapCheck(when: string) {
  const end = "COALESCE(NEW.moved_out_on, NEW.end_date, '9999-12-31')";
  return `
  SELECT RAISE(ABORT, 'HAVENOS:OVERLAP:TENANCY') WHERE ${when} AND EXISTS (
    SELECT 1 FROM tenancies t
    JOIN spaces a ON a.id = t.space_id
    JOIN spaces b ON b.id = NEW.space_id
    WHERE t.id <> NEW.id AND t.cancelled_at IS NULL AND ${SPACES_OVERLAP}
      AND t.start_date <= ${end}
      AND NEW.start_date <= COALESCE(t.moved_out_on, t.end_date, '9999-12-31')
  );
  SELECT RAISE(ABORT, 'HAVENOS:OVERLAP:RESERVATION') WHERE ${when} AND EXISTS (
    SELECT 1 FROM reservations r
    JOIN spaces a ON a.id = r.space_id
    JOIN spaces b ON b.id = NEW.space_id
    WHERE r.status <> 'cancelled' AND ${SPACES_OVERLAP}
      AND r.check_in <= ${end}
      AND NEW.start_date < r.check_out
  );`;
}

function reservationOverlapCheck(when: string) {
  return `
  SELECT RAISE(ABORT, 'HAVENOS:OVERLAP:TENANCY') WHERE ${when} AND EXISTS (
    SELECT 1 FROM tenancies t
    JOIN spaces a ON a.id = t.space_id
    JOIN spaces b ON b.id = NEW.space_id
    WHERE t.cancelled_at IS NULL AND ${SPACES_OVERLAP}
      AND t.start_date < NEW.check_out
      AND NEW.check_in <= COALESCE(t.moved_out_on, t.end_date, '9999-12-31')
  );
  SELECT RAISE(ABORT, 'HAVENOS:OVERLAP:RESERVATION') WHERE ${when} AND EXISTS (
    SELECT 1 FROM reservations r
    JOIN spaces a ON a.id = r.space_id
    JOIN spaces b ON b.id = NEW.space_id
    WHERE r.id <> NEW.id AND r.status <> 'cancelled' AND ${SPACES_OVERLAP}
      AND r.check_in < NEW.check_out AND NEW.check_in < r.check_out
  );`;
}

const MIGRATION_1 = `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL CHECK (value >= 0)
) STRICT;
INSERT INTO counters (name, value) VALUES ('tenancy', 0), ('receipt', 0), ('maintenance', 0);

-- ── Inventory ───────────────────────────────────────────────────────────────
CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  property_type TEXT NOT NULL CHECK (property_type IN ('condominium','apartment','terrace','semi_d','bungalow','townhouse','shophouse','other')),
  address_line1 TEXT NOT NULL CHECK (length(trim(address_line1)) > 0),
  address_line2 TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL CHECK (length(postcode) = 5 AND postcode NOT GLOB '*[^0-9]*'),
  city TEXT NOT NULL CHECK (length(trim(city)) > 0),
  state TEXT NOT NULL CHECK (state IN (${STATES})),
  notes TEXT NOT NULL DEFAULT '',
  rent_due_day INTEGER NOT NULL DEFAULT 1 CHECK (rent_due_day BETWEEN 1 AND 31),
  security_deposit_tenths INTEGER NOT NULL DEFAULT 20 CHECK (security_deposit_tenths BETWEEN 0 AND 120),
  utility_deposit_tenths INTEGER NOT NULL DEFAULT 5 CHECK (utility_deposit_tenths BETWEEN 0 AND 120),
  default_tenancy_months INTEGER NOT NULL DEFAULT 12 CHECK (default_tenancy_months BETWEEN 1 AND 120),
  default_terms TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
) STRICT;

-- A unit, a room inside a unit, or a bed inside a room. unit_id/room_id are
-- denormalised ancestors so overlap checks are flat comparisons.
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('unit','room','bed')),
  parent_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
  rental_mode TEXT CHECK (rental_mode IN ('whole_unit','by_room','by_bed')),
  floor TEXT NOT NULL DEFAULT '',
  size_sqft INTEGER CHECK (size_sqft IS NULL OR size_sqft BETWEEN 1 AND 100000),
  bedrooms INTEGER CHECK (bedrooms IS NULL OR bedrooms BETWEEN 0 AND 50),
  bathrooms INTEGER CHECK (bathrooms IS NULL OR bathrooms BETWEEN 0 AND 50),
  room_type TEXT CHECK (room_type IS NULL OR room_type IN ('master','medium','small','studio','other')),
  default_rent_sen INTEGER NOT NULL DEFAULT 0 CHECK (default_rent_sen >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK (
    (kind = 'unit' AND parent_id IS NULL AND unit_id = id AND room_id IS NULL AND rental_mode IS NOT NULL) OR
    (kind = 'room' AND parent_id IS NOT NULL AND parent_id = unit_id AND room_id = id AND rental_mode IS NULL) OR
    (kind = 'bed'  AND parent_id IS NOT NULL AND parent_id = room_id AND rental_mode IS NULL)
  )
) STRICT;
CREATE INDEX spaces_property ON spaces (property_id, sort_order);
CREATE INDEX spaces_unit ON spaces (unit_id);
CREATE UNIQUE INDEX spaces_unique_label ON spaces (property_id, ifnull(parent_id, ''), lower(trim(label))) WHERE archived_at IS NULL;

CREATE TRIGGER spaces_parent_check BEFORE INSERT ON spaces WHEN NEW.kind <> 'unit'
BEGIN
  SELECT RAISE(ABORT, 'HAVENOS:WRONG_PARENT') WHERE NOT EXISTS (
    SELECT 1 FROM spaces p
    WHERE p.id = NEW.parent_id AND p.property_id = NEW.property_id AND p.unit_id = NEW.unit_id
      AND p.kind = CASE NEW.kind WHEN 'room' THEN 'unit' ELSE 'room' END
  );
END;

CREATE TRIGGER spaces_tree_fixed BEFORE UPDATE OF property_id, kind, parent_id, unit_id, room_id ON spaces
WHEN NEW.property_id IS NOT OLD.property_id OR NEW.kind IS NOT OLD.kind OR NEW.parent_id IS NOT OLD.parent_id
  OR NEW.unit_id IS NOT OLD.unit_id OR NEW.room_id IS NOT OLD.room_id
BEGIN
  SELECT RAISE(ABORT, 'HAVENOS:WRONG_PARENT');
END;

-- ── People ──────────────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 120),
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  emergency_name TEXT NOT NULL DEFAULT '',
  emergency_phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- ── Long-term tenancies ─────────────────────────────────────────────────────
CREATE TABLE tenancies (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  start_date TEXT NOT NULL CHECK ${isDate("start_date")},
  end_date TEXT CHECK (end_date IS NULL OR (${isDate("end_date")} AND end_date >= start_date)),
  rent_start_month TEXT NOT NULL CHECK ${isMonth("rent_start_month")},
  security_deposit_sen INTEGER NOT NULL DEFAULT 0 CHECK (security_deposit_sen >= 0),
  utility_deposit_sen INTEGER NOT NULL DEFAULT 0 CHECK (utility_deposit_sen >= 0),
  terms TEXT NOT NULL DEFAULT '',
  moved_in_on TEXT CHECK (moved_in_on IS NULL OR ${isDate("moved_in_on")}),
  move_in_notes TEXT NOT NULL DEFAULT '',
  moved_out_on TEXT CHECK (moved_out_on IS NULL OR (${isDate("moved_out_on")} AND moved_out_on >= start_date)),
  move_out_notes TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT,
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX tenancies_space ON tenancies (space_id, start_date);
CREATE INDEX tenancies_property ON tenancies (property_id);
CREATE INDEX tenancies_tenant ON tenancies (tenant_id);

CREATE TRIGGER tenancies_property_matches_space BEFORE INSERT ON tenancies
BEGIN
  SELECT RAISE(ABORT, 'HAVENOS:WRONG_PARENT')
  WHERE (SELECT property_id FROM spaces WHERE id = NEW.space_id) IS NOT NEW.property_id;
END;

CREATE TRIGGER tenancies_space_fixed BEFORE UPDATE OF space_id, property_id ON tenancies
WHEN NEW.space_id IS NOT OLD.space_id OR NEW.property_id IS NOT OLD.property_id
BEGIN
  SELECT RAISE(ABORT, 'HAVENOS:WRONG_PARENT');
END;

-- Short stays (future Airbnb and similar). Distinct from tenancies but
-- booked against the same inventory, so availability is shared.
CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  guest_name TEXT NOT NULL CHECK (length(trim(guest_name)) > 0),
  check_in TEXT NOT NULL CHECK ${isDate("check_in")},
  check_out TEXT NOT NULL CHECK (${isDate("check_out")} AND check_out > check_in),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('tentative','confirmed','cancelled')),
  channel TEXT NOT NULL DEFAULT 'direct' CHECK (channel IN ('direct','airbnb','booking_com','other')),
  channel_reservation_id TEXT,
  total_sen INTEGER CHECK (total_sen IS NULL OR total_sen >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (channel, channel_reservation_id)
) STRICT;
CREATE INDEX reservations_space ON reservations (space_id, check_in);

-- Where a future channel adapter records which external listing maps to
-- which lettable space. Nothing writes here until an adapter exists.
CREATE TABLE channel_listings (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('airbnb','booking_com','other')),
  external_listing_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','linked','paused')),
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (channel, external_listing_id)
) STRICT;

CREATE TRIGGER tenancies_no_overlap_insert BEFORE INSERT ON tenancies
BEGIN ${tenancyOverlapCheck("NEW.cancelled_at IS NULL")}
END;

CREATE TRIGGER tenancies_no_overlap_update BEFORE UPDATE OF start_date, end_date, moved_out_on, cancelled_at ON tenancies
BEGIN ${tenancyOverlapCheck("NEW.cancelled_at IS NULL")}
END;

CREATE TRIGGER reservations_no_overlap_insert BEFORE INSERT ON reservations
BEGIN ${reservationOverlapCheck("NEW.status <> 'cancelled'")}
END;

CREATE TRIGGER reservations_no_overlap_update BEFORE UPDATE OF space_id, check_in, check_out, status ON reservations
BEGIN ${reservationOverlapCheck("NEW.status <> 'cancelled'")}
END;

-- ── Rent ────────────────────────────────────────────────────────────────────
CREATE TABLE rent_schedule (
  id TEXT PRIMARY KEY,
  tenancy_id TEXT NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
  effective_month TEXT NOT NULL CHECK ${isMonth("effective_month")},
  amount_sen INTEGER NOT NULL CHECK (amount_sen > 0),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  created_at TEXT NOT NULL,
  UNIQUE (tenancy_id, effective_month)
) STRICT;

CREATE TABLE charges (
  id TEXT PRIMARY KEY,
  tenancy_id TEXT NOT NULL REFERENCES tenancies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('rent','utilities','late_fee','repair','other')),
  period TEXT CHECK (period IS NULL OR ${isMonth("period")}),
  description TEXT NOT NULL,
  amount_sen INTEGER NOT NULL CHECK (amount_sen > 0),
  due_date TEXT NOT NULL CHECK ${isDate("due_date")},
  voided_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind <> 'rent' OR period IS NOT NULL)
) STRICT;
-- One rent charge per tenancy per month, ever — the guarantee that makes
-- recurring generation safe to run any number of times.
CREATE UNIQUE INDEX charges_one_rent_per_month ON charges (tenancy_id, period) WHERE kind = 'rent';
CREATE INDEX charges_due ON charges (due_date);
CREATE INDEX charges_tenancy ON charges (tenancy_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  tenancy_id TEXT NOT NULL REFERENCES tenancies(id) ON DELETE RESTRICT,
  receipt_no TEXT NOT NULL UNIQUE,
  received_on TEXT NOT NULL CHECK ${isDate("received_on")},
  amount_sen INTEGER NOT NULL CHECK (amount_sen > 0),
  method TEXT NOT NULL CHECK (method IN (${PAYMENT_METHODS})),
  reference TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  voided_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX payments_tenancy ON payments (tenancy_id);
CREATE INDEX payments_received ON payments (received_on);

-- Deposits are held money, not income: kept apart from charges/payments.
CREATE TABLE deposit_entries (
  id TEXT PRIMARY KEY,
  tenancy_id TEXT NOT NULL REFERENCES tenancies(id) ON DELETE RESTRICT,
  deposit_type TEXT NOT NULL CHECK (deposit_type IN ('security','utility','other')),
  kind TEXT NOT NULL CHECK (kind IN ('received','refunded','deducted')),
  amount_sen INTEGER NOT NULL CHECK (amount_sen > 0),
  occurred_on TEXT NOT NULL CHECK ${isDate("occurred_on")},
  method TEXT CHECK (method IS NULL OR method IN (${PAYMENT_METHODS})),
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  voided_at TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX deposit_entries_tenancy ON deposit_entries (tenancy_id);

-- ── Maintenance ─────────────────────────────────────────────────────────────
CREATE TABLE maintenance_requests (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('plumbing','electrical','aircond','appliance','structural','pest','cleaning','internet','security','general')),
  priority TEXT NOT NULL CHECK (priority IN ('low','standard','high','critical')),
  status TEXT NOT NULL CHECK (status IN ('triage','scheduled','in_progress','blocked','done','cancelled')),
  due_date TEXT CHECK (due_date IS NULL OR ${isDate("due_date")}),
  assignee_name TEXT NOT NULL DEFAULT '',
  assignee_phone TEXT NOT NULL DEFAULT '',
  estimated_cost_sen INTEGER CHECK (estimated_cost_sen IS NULL OR estimated_cost_sen >= 0),
  actual_cost_sen INTEGER CHECK (actual_cost_sen IS NULL OR actual_cost_sen >= 0),
  reported_on TEXT NOT NULL CHECK ${isDate("reported_on")},
  completed_on TEXT CHECK (completed_on IS NULL OR ${isDate("completed_on")}),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX maintenance_property ON maintenance_requests (property_id, status);
CREATE INDEX maintenance_status ON maintenance_requests (status, due_date);

CREATE TRIGGER maintenance_space_in_property BEFORE INSERT ON maintenance_requests WHEN NEW.space_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'HAVENOS:WRONG_PARENT')
  WHERE (SELECT property_id FROM spaces WHERE id = NEW.space_id) IS NOT NEW.property_id;
END;
CREATE TRIGGER maintenance_space_in_property_update BEFORE UPDATE OF space_id, property_id ON maintenance_requests WHEN NEW.space_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'HAVENOS:WRONG_PARENT')
  WHERE (SELECT property_id FROM spaces WHERE id = NEW.space_id) IS NOT NEW.property_id;
END;

-- Change history: one row per create / edit / note / attachment change.
CREATE TABLE maintenance_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('created','updated','note','attachment_added','attachment_removed')),
  changes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(changes)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX maintenance_events_request ON maintenance_events (request_id, created_at);

-- ── Onboarding drafts ───────────────────────────────────────────────────────
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('property_onboarding')),
  step INTEGER NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 10),
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- ── Attachments ─────────────────────────────────────────────────────────────
-- Files live in <data>/attachments/<stored_name>; rows record ownership.
-- Exactly one owner column is set. staging_key holds uploads made in a form
-- before its record exists; they are claimed on save or swept after a day.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  maintenance_id TEXT REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  tenancy_id TEXT REFERENCES tenancies(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id TEXT REFERENCES payments(id) ON DELETE CASCADE,
  draft_id TEXT REFERENCES drafts(id) ON DELETE CASCADE,
  staging_key TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('photo','document','receipt')),
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  thumb_name TEXT UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK ((property_id IS NOT NULL) + (maintenance_id IS NOT NULL) + (tenancy_id IS NOT NULL) + (tenant_id IS NOT NULL)
       + (payment_id IS NOT NULL) + (draft_id IS NOT NULL) + (staging_key IS NOT NULL) = 1)
) STRICT;
CREATE INDEX attachments_property ON attachments (property_id, sort_order);
CREATE INDEX attachments_maintenance ON attachments (maintenance_id, sort_order);
CREATE INDEX attachments_tenancy ON attachments (tenancy_id);
CREATE INDEX attachments_tenant ON attachments (tenant_id);
CREATE INDEX attachments_payment ON attachments (payment_id);
CREATE INDEX attachments_draft ON attachments (draft_id, sort_order);
CREATE INDEX attachments_staging ON attachments (staging_key);
`;

// ── Migration 2: short stays ────────────────────────────────────────────────
// The checks above are frozen with migration 1. From migration 2 on, manual
// availability blocks join tenancies and reservations in one overlap rule.
// Dates: tenancies and blocks use inclusive last days; reservations use an
// exclusive check-out (the check-out day is free for the next arrival).

const isTime = (col: string) => `(${col} GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(${col}, 1, 2) <= '23')`;

/** `datesOverlap` compares block `k` with the NEW row. */
function blockClash(when: string, datesOverlap: string) {
  return `
  SELECT RAISE(ABORT, 'HAVENOS:OVERLAP:BLOCK') WHERE ${when} AND EXISTS (
    SELECT 1 FROM availability_blocks k
    JOIN spaces a ON a.id = k.space_id
    JOIN spaces b ON b.id = NEW.space_id
    WHERE k.cancelled_at IS NULL AND ${SPACES_OVERLAP} AND ${datesOverlap}
  );`;
}

function tenancyOverlapCheckV2(when: string) {
  const end = "COALESCE(NEW.moved_out_on, NEW.end_date, '9999-12-31')";
  return tenancyOverlapCheck(when) + blockClash(when, `k.start_date <= ${end} AND NEW.start_date <= k.end_date`);
}

function reservationOverlapCheckV2(when: string) {
  return reservationOverlapCheck(when) + blockClash(when, "k.start_date < NEW.check_out AND NEW.check_in <= k.end_date");
}

function blockOverlapCheck(when: string) {
  return `
  SELECT RAISE(ABORT, 'HAVENOS:OVERLAP:TENANCY') WHERE ${when} AND EXISTS (
    SELECT 1 FROM tenancies t
    JOIN spaces a ON a.id = t.space_id
    JOIN spaces b ON b.id = NEW.space_id
    WHERE t.cancelled_at IS NULL AND ${SPACES_OVERLAP}
      AND t.start_date <= NEW.end_date
      AND NEW.start_date <= COALESCE(t.moved_out_on, t.end_date, '9999-12-31')
  );
  SELECT RAISE(ABORT, 'HAVENOS:OVERLAP:RESERVATION') WHERE ${when} AND EXISTS (
    SELECT 1 FROM reservations r
    JOIN spaces a ON a.id = r.space_id
    JOIN spaces b ON b.id = NEW.space_id
    WHERE r.status <> 'cancelled' AND ${SPACES_OVERLAP}
      AND r.check_in <= NEW.end_date AND NEW.start_date < r.check_out
  );`;
}

const propertyMatchesSpace = (table: string) => `
CREATE TRIGGER ${table}_property_matches_space BEFORE INSERT ON ${table}
BEGIN
  SELECT RAISE(ABORT, 'HAVENOS:WRONG_PARENT')
  WHERE (SELECT property_id FROM spaces WHERE id = NEW.space_id) IS NOT NEW.property_id;
END;
CREATE TRIGGER ${table}_property_matches_space_update BEFORE UPDATE OF space_id, property_id ON ${table}
BEGIN
  SELECT RAISE(ABORT, 'HAVENOS:WRONG_PARENT')
  WHERE (SELECT property_id FROM spaces WHERE id = NEW.space_id) IS NOT NEW.property_id;
END;`;

const MIGRATION_2 = `
-- Recreated below with blocks included, and because they reference the
-- reservations table being rebuilt.
DROP TRIGGER tenancies_no_overlap_insert;
DROP TRIGGER tenancies_no_overlap_update;

-- Never written by earlier versions (no adapter existed). Replaced by
-- channel_connections, which records how each listing is synced.
DROP TABLE channel_listings;

-- One external listing (e.g. an Airbnb listing) mapped to ONE lettable space.
-- The feed link itself is a secret: it is kept in the OS credential store,
-- never in this database, backups or logs. feed_fingerprint (SHA-256 of the
-- link) only detects the same link being added twice.
CREATE TABLE channel_connections (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('airbnb','booking_com','other')),
  method TEXT NOT NULL CHECK (method IN ('ical')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  external_listing_id TEXT CHECK (external_listing_id IS NULL OR length(external_listing_id) BETWEEN 1 AND 64),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  feed_fingerprint TEXT CHECK (feed_fingerprint IS NULL OR length(feed_fingerprint) = 64),
  check_in_time TEXT NOT NULL DEFAULT '15:00' CHECK ${isTime("check_in_time")},
  check_out_time TEXT NOT NULL DEFAULT '11:00' CHECK ${isTime("check_out_time")},
  turnover_checklist TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(turnover_checklist) AND json_type(turnover_checklist) = 'array'),
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  -- Safe detail only (e.g. an HTTP status). Never the feed link.
  last_error_detail TEXT NOT NULL DEFAULT '',
  last_error_at TEXT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX channel_connections_space ON channel_connections (channel, space_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX channel_connections_listing ON channel_connections (channel, external_listing_id) WHERE removed_at IS NULL AND external_listing_id IS NOT NULL;
CREATE UNIQUE INDEX channel_connections_feed ON channel_connections (feed_fingerprint) WHERE removed_at IS NULL AND feed_fingerprint IS NOT NULL;
${propertyMatchesSpace("channel_connections")}

-- Reservations, rebuilt: guest name is optional (calendar feeds don't carry
-- it), plus sync metadata and cancellation history. Money moves to
-- stay_ledger so imported and entered figures stay distinguishable.
CREATE TEMP TABLE legacy_reservation_totals AS
  SELECT id, property_id, space_id, channel, check_in, total_sen, created_at FROM reservations WHERE total_sen IS NOT NULL;

CREATE TABLE reservations_v2 (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  connection_id TEXT REFERENCES channel_connections(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'direct' CHECK (channel IN ('direct','airbnb','booking_com','other')),
  -- The channel's own id: Airbnb confirmation code (HM…) or the feed UID.
  channel_reservation_id TEXT CHECK (channel_reservation_id IS NULL OR length(channel_reservation_id) BETWEEN 1 AND 255),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','feed','csv')),
  guest_name TEXT NOT NULL DEFAULT '' CHECK (length(guest_name) <= 120),
  guest_count INTEGER CHECK (guest_count IS NULL OR guest_count BETWEEN 1 AND 50),
  check_in TEXT NOT NULL CHECK ${isDate("check_in")},
  check_out TEXT NOT NULL CHECK (${isDate("check_out")} AND check_out > check_in),
  check_in_time TEXT CHECK (check_in_time IS NULL OR ${isTime("check_in_time")}),
  check_out_time TEXT CHECK (check_out_time IS NULL OR ${isTime("check_out_time")}),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('tentative','confirmed','cancelled')),
  cancelled_at TEXT,
  cancel_reason TEXT NOT NULL DEFAULT '',
  -- A synced booking its channel feed no longer lists. It keeps blocking the
  -- dates until the landlord confirms the cancellation.
  missing_since TEXT,
  last_seen_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  UNIQUE (channel, channel_reservation_id)
) STRICT;
INSERT INTO reservations_v2 (id, space_id, property_id, channel, channel_reservation_id, source, guest_name, check_in, check_out, status, cancelled_at, notes, created_at, updated_at)
  SELECT id, space_id, property_id, channel, channel_reservation_id, 'manual', guest_name, check_in, check_out, status,
         CASE WHEN status = 'cancelled' THEN updated_at END, notes, created_at, updated_at
  FROM reservations;
DROP TABLE reservations;
ALTER TABLE reservations_v2 RENAME TO reservations;
CREATE INDEX reservations_space ON reservations (space_id, check_in);
CREATE INDEX reservations_dates ON reservations (check_in, check_out);
CREATE INDEX reservations_connection ON reservations (connection_id);
${propertyMatchesSpace("reservations")}

-- Dates the landlord takes off the market (maintenance, own use). Inclusive
-- last day. They block tenancies and reservations like any booking.
CREATE TABLE availability_blocks (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL CHECK ${isDate("start_date")},
  end_date TEXT NOT NULL CHECK (${isDate("end_date")} AND end_date >= start_date),
  reason TEXT NOT NULL CHECK (reason IN ('maintenance','personal','owner_stay','other')),
  maintenance_id TEXT REFERENCES maintenance_requests(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX availability_blocks_space ON availability_blocks (space_id, start_date);
${propertyMatchesSpace("availability_blocks")}

CREATE TRIGGER tenancies_no_overlap_insert BEFORE INSERT ON tenancies
BEGIN ${tenancyOverlapCheckV2("NEW.cancelled_at IS NULL")}
END;
CREATE TRIGGER tenancies_no_overlap_update BEFORE UPDATE OF start_date, end_date, moved_out_on, cancelled_at ON tenancies
BEGIN ${tenancyOverlapCheckV2("NEW.cancelled_at IS NULL")}
END;
CREATE TRIGGER reservations_no_overlap_insert BEFORE INSERT ON reservations
BEGIN ${reservationOverlapCheckV2("NEW.status <> 'cancelled'")}
END;
CREATE TRIGGER reservations_no_overlap_update BEFORE UPDATE OF space_id, check_in, check_out, status ON reservations
BEGIN ${reservationOverlapCheckV2("NEW.status <> 'cancelled'")}
END;
CREATE TRIGGER availability_blocks_no_overlap_insert BEFORE INSERT ON availability_blocks
BEGIN ${blockOverlapCheck("NEW.cancelled_at IS NULL")}
END;
CREATE TRIGGER availability_blocks_no_overlap_update BEFORE UPDATE OF space_id, start_date, end_date, cancelled_at ON availability_blocks
BEGIN ${blockOverlapCheck("NEW.cancelled_at IS NULL")}
END;

-- History for every reservation change, including those made by a sync.
CREATE TABLE reservation_events (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('created','updated','dates_changed','cancelled','missing','reappeared','conflict','note')),
  source TEXT NOT NULL CHECK (source IN ('manual','feed','csv')),
  changes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(changes)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX reservation_events_reservation ON reservation_events (reservation_id, created_at);

-- What each connection's feed said last time, one row per feed event.
-- 'conflict' rows could not be applied because the dates clash with another
-- HavenOS record; they wait for the landlord. Blocks are informational.
CREATE TABLE channel_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('reservation','block')),
  external_uid TEXT NOT NULL CHECK (length(external_uid) BETWEEN 1 AND 255),
  confirmation_code TEXT CHECK (confirmation_code IS NULL OR length(confirmation_code) BETWEEN 1 AND 64),
  start_date TEXT NOT NULL CHECK ${isDate("start_date")},
  -- Exclusive, like a check-out.
  end_date TEXT NOT NULL CHECK (${isDate("end_date")} AND end_date > start_date),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 200),
  state TEXT NOT NULL CHECK (state IN ('applied','conflict','dismissed')),
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  conflict TEXT CHECK (conflict IS NULL OR json_valid(conflict)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (connection_id, external_uid)
) STRICT;
CREATE INDEX channel_events_state ON channel_events (state, connection_id);
CREATE INDEX channel_events_reservation ON channel_events (reservation_id);

CREATE TABLE channel_sync_runs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('launch','timer','manual','setup')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('ok','failed','rejected')),
  error_code TEXT,
  events_seen INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX channel_sync_runs_connection ON channel_sync_runs (connection_id, started_at);

-- Dates HavenOS asked the landlord to block on the channel by hand, marked
-- done. The next import confirms them when the channel shows them blocked.
CREATE TABLE channel_push_acks (
  connection_id TEXT NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL CHECK ${isDate("start_date")},
  end_date TEXT NOT NULL CHECK (${isDate("end_date")} AND end_date >= start_date),
  acked_at TEXT NOT NULL,
  PRIMARY KEY (connection_id, start_date, end_date)
) STRICT;

-- Cleaning / inspection between stays: one per reservation, due on its
-- check-out day.
CREATE TABLE turnovers (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL CHECK ${isDate("due_date")},
  checkout_time TEXT NOT NULL DEFAULT '11:00' CHECK ${isTime("checkout_time")},
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scheduled','in_progress','done','skipped')),
  assignee_name TEXT NOT NULL DEFAULT '',
  assignee_phone TEXT NOT NULL DEFAULT '',
  checklist TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checklist) AND json_type(checklist) = 'array'),
  cost_sen INTEGER CHECK (cost_sen IS NULL OR cost_sen >= 0),
  notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
) STRICT;
CREATE INDEX turnovers_due ON turnovers (due_date, status);
CREATE INDEX turnovers_space ON turnovers (space_id, due_date);

-- Short-stay money. 'imported' rows come from a channel's CSV export and are
-- idempotent on external_ref; 'entered' rows were typed by the landlord.
CREATE TABLE stay_imports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('airbnb_transactions','airbnb_reservations')),
  file_name TEXT NOT NULL,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_imported INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE stay_ledger (
  id TEXT PRIMARY KEY,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('direct','airbnb','booking_com','other')),
  kind TEXT NOT NULL CHECK (kind IN ('booking_value','channel_fee','cleaning_fee','tax','payout','expense','adjustment')),
  amount_sen INTEGER NOT NULL CHECK (amount_sen BETWEEN -9999999999 AND 9999999999),
  occurred_on TEXT NOT NULL CHECK ${isDate("occurred_on")},
  source TEXT NOT NULL CHECK (source IN ('imported','entered')),
  import_id TEXT REFERENCES stay_imports(id) ON DELETE SET NULL,
  external_ref TEXT CHECK (external_ref IS NULL OR length(external_ref) BETWEEN 1 AND 200),
  category TEXT NOT NULL DEFAULT '' CHECK (category IN ('','cleaning','laundry','supplies','utilities','repairs','platform','other')),
  description TEXT NOT NULL DEFAULT '',
  voided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (source = 'imported' OR external_ref IS NULL)
) STRICT;
CREATE UNIQUE INDEX stay_ledger_external ON stay_ledger (external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX stay_ledger_reservation ON stay_ledger (reservation_id);
CREATE INDEX stay_ledger_property ON stay_ledger (property_id, occurred_on);

INSERT INTO stay_ledger (id, reservation_id, property_id, space_id, channel, kind, amount_sen, occurred_on, source, description, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), id, property_id, space_id, channel, 'booking_value', total_sen, check_in, 'entered', '', created_at, created_at
  FROM legacy_reservation_totals;
DROP TABLE legacy_reservation_totals;

-- Attachments, rebuilt to allow turnover photos as an owner.
CREATE TABLE attachments_v2 (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
  maintenance_id TEXT REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  tenancy_id TEXT REFERENCES tenancies(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id TEXT REFERENCES payments(id) ON DELETE CASCADE,
  draft_id TEXT REFERENCES drafts(id) ON DELETE CASCADE,
  turnover_id TEXT REFERENCES turnovers(id) ON DELETE CASCADE,
  staging_key TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('photo','document','receipt')),
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  thumb_name TEXT UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK ((property_id IS NOT NULL) + (maintenance_id IS NOT NULL) + (tenancy_id IS NOT NULL) + (tenant_id IS NOT NULL)
       + (payment_id IS NOT NULL) + (draft_id IS NOT NULL) + (turnover_id IS NOT NULL) + (staging_key IS NOT NULL) = 1)
) STRICT;
INSERT INTO attachments_v2 (id, property_id, maintenance_id, tenancy_id, tenant_id, payment_id, draft_id, staging_key, purpose, file_name,
                            stored_name, thumb_name, mime_type, size_bytes, sha256, width, height, caption, sort_order, created_at)
  SELECT id, property_id, maintenance_id, tenancy_id, tenant_id, payment_id, draft_id, staging_key, purpose, file_name,
         stored_name, thumb_name, mime_type, size_bytes, sha256, width, height, caption, sort_order, created_at
  FROM attachments;
DROP TABLE attachments;
ALTER TABLE attachments_v2 RENAME TO attachments;
CREATE INDEX attachments_property ON attachments (property_id, sort_order);
CREATE INDEX attachments_maintenance ON attachments (maintenance_id, sort_order);
CREATE INDEX attachments_tenancy ON attachments (tenancy_id);
CREATE INDEX attachments_tenant ON attachments (tenant_id);
CREATE INDEX attachments_payment ON attachments (payment_id);
CREATE INDEX attachments_draft ON attachments (draft_id, sort_order);
CREATE INDEX attachments_turnover ON attachments (turnover_id, sort_order);
CREATE INDEX attachments_staging ON attachments (staging_key);
`;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "initial local schema", sql: MIGRATION_1 },
  { version: 2, name: "short stays: channel connections, reservations history, blocks, turnovers, ledger", sql: MIGRATION_2 },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
