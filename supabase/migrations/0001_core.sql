-- HavenOS core schema: multi-tenant sub-leasing / co-living operations.
-- Hierarchy: org → property → unit → bed. Leasing happens at BED granularity
-- (the co-living primitive); a whole-unit lease is simply every bed in the unit.

create extension if not exists pgcrypto;
create extension if not exists btree_gist; -- bed-level lease overlap exclusion

-- ── Enums ────────────────────────────────────────────────────────────────────
create type unit_type   as enum ('studio','one_bed','two_bed','suite','shared_room');
create type bed_status  as enum ('available','occupied','hold','turnover','maintenance');
create type lease_status as enum ('draft','active','notice','ended','void');
create type wo_priority as enum ('low','standard','high','critical');
create type wo_status   as enum ('triage','scheduled','in_progress','blocked','done','cancelled');

-- ── Tenancy ──────────────────────────────────────────────────────────────────
create table orgs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  custom_domain text unique,          -- Cloudflare-managed vanity domain, host only
  brand         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table org_members (
  org_id   uuid not null references orgs(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role     text not null default 'operator'
           check (role in ('owner','operator','maintenance','viewer')),
  primary key (org_id, user_id)
);

-- ── Inventory hierarchy ──────────────────────────────────────────────────────
create table properties (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  name          text not null,
  address_line1 text not null,
  city          text not null,
  country       char(2) not null default 'MY',
  timezone      text not null default 'Asia/Kuala_Lumpur',
  cover_media   jsonb not null default '{}'::jsonb,  -- {hero_video, tour_video, poster}
  amenities     text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table units (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references properties(id) on delete cascade,
  label           text not null,
  floor           int  not null default 1,
  type            unit_type not null default 'shared_room',
  sqm             numeric(6,1),
  base_rent_cents bigint not null default 0 check (base_rent_cents >= 0),
  currency        char(3) not null default 'MYR',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (property_id, label)
);

create table beds (
  id         uuid primary key default gen_random_uuid(),
  unit_id    uuid not null references units(id) on delete cascade,
  label      text not null,
  rent_cents bigint not null default 0 check (rent_cents >= 0),
  status     bed_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, label)
);

-- ── People & leases ──────────────────────────────────────────────────────────
create table residents (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  full_name  text not null,
  email      text,
  phone      text,
  created_at timestamptz not null default now()
);

create table leases (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  bed_id        uuid not null references beds(id) on delete restrict,
  resident_id   uuid not null references residents(id) on delete restrict,
  status        lease_status not null default 'draft',
  rent_cents    bigint not null check (rent_cents >= 0),
  deposit_cents bigint not null default 0 check (deposit_cents >= 0),
  starts_on     date not null,
  ends_on       date,                     -- null = month-to-month
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_on is null or ends_on > starts_on),
  -- One live lease per bed per night. daterange upper bound: open-ended when null.
  constraint leases_no_overlap exclude using gist (
    bed_id with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]') with &&
  ) where (status in ('active','notice'))
);

-- ── Maintenance ──────────────────────────────────────────────────────────────
create table work_orders (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  unit_id     uuid references units(id) on delete set null,
  bed_id      uuid references beds(id) on delete set null,
  ref         text generated always as ('WO-' || substr(id::text, 1, 4)) stored,
  title       text not null,
  detail      text,
  category    text not null default 'general',
  priority    wo_priority not null default 'standard',
  status      wo_status  not null default 'triage',
  assigned_to uuid references auth.users(id) on delete set null,
  opened_at   timestamptz not null default now(),
  due_at      timestamptz,
  resolved_at timestamptz,
  updated_at  timestamptz not null default now()
);

create table work_order_events (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  actor         uuid references auth.users(id) on delete set null,
  from_status   wo_status,
  to_status     wo_status not null,
  note          text,
  created_at    timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index on properties (org_id);
create index on units (property_id);
create index on beds (unit_id);
create index on beds (status);
create index on residents (org_id);
create index on leases (org_id, status);
create index on leases (bed_id);
create index on work_orders (org_id, status);
create index on work_orders (property_id);

-- ── updated_at maintenance ───────────────────────────────────────────────────
create function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['properties','units','beds','leases','work_orders'] loop
    execute format(
      'create trigger %I before update on %I for each row execute function touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end $$;

-- ── Occupancy rollup (dashboard read model) ──────────────────────────────────
create view occupancy_rollup with (security_invoker = true) as
select
  p.org_id,
  p.id as property_id,
  p.name,
  count(b.id)                                   as beds_total,
  count(b.id) filter (where b.status = 'occupied')  as beds_occupied,
  count(b.id) filter (where b.status = 'available') as beds_available,
  count(b.id) filter (where b.status = 'hold')      as beds_hold,
  count(b.id) filter (where b.status in ('turnover','maintenance')) as beds_down,
  round(100.0 * count(b.id) filter (where b.status = 'occupied')
        / nullif(count(b.id), 0), 1)            as occupancy_pct
from properties p
left join units u on u.property_id = p.id
left join beds  b on b.unit_id = u.id
group by p.org_id, p.id, p.name;

-- ── Row-level security ───────────────────────────────────────────────────────
create function is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members m
    where m.org_id = org and m.user_id = auth.uid()
  )
$$;

create function is_org_editor(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members m
    where m.org_id = org and m.user_id = auth.uid()
      and m.role in ('owner','operator','maintenance')
  )
$$;

alter table orgs              enable row level security;
alter table org_members       enable row level security;
alter table properties        enable row level security;
alter table units             enable row level security;
alter table beds              enable row level security;
alter table residents         enable row level security;
alter table leases            enable row level security;
alter table work_orders       enable row level security;
alter table work_order_events enable row level security;

create policy orgs_read   on orgs for select using (is_org_member(id));
create policy orgs_write  on orgs for update using (is_org_member(id) and is_org_editor(id));
create policy members_read on org_members for select using (is_org_member(org_id));

create policy properties_read  on properties for select using (is_org_member(org_id));
create policy properties_write on properties for all
  using (is_org_editor(org_id)) with check (is_org_editor(org_id));

create policy units_read on units for select
  using (is_org_member((select p.org_id from properties p where p.id = property_id)));
create policy units_write on units for all
  using (is_org_editor((select p.org_id from properties p where p.id = property_id)))
  with check (is_org_editor((select p.org_id from properties p where p.id = property_id)));

create policy beds_read on beds for select
  using (is_org_member((select p.org_id from units u join properties p on p.id = u.property_id where u.id = unit_id)));
create policy beds_write on beds for all
  using (is_org_editor((select p.org_id from units u join properties p on p.id = u.property_id where u.id = unit_id)))
  with check (is_org_editor((select p.org_id from units u join properties p on p.id = u.property_id where u.id = unit_id)));

create policy residents_rw on residents for all
  using (is_org_member(org_id)) with check (is_org_editor(org_id));
create policy leases_rw on leases for all
  using (is_org_member(org_id)) with check (is_org_editor(org_id));
create policy work_orders_rw on work_orders for all
  using (is_org_member(org_id)) with check (is_org_editor(org_id));
create policy wo_events_rw on work_order_events for all
  using (is_org_member((select w.org_id from work_orders w where w.id = work_order_id)))
  with check (is_org_editor((select w.org_id from work_orders w where w.id = work_order_id)));
