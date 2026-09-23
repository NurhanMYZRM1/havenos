-- Optional paid cloud backup for the HavenOS desktop app.
--
-- The desktop app keeps all records locally (SQLite). This schema only
-- supports storing encrypted-in-transit copies of a landlord's backup file
-- and deciding, on the server, whether their subscription allows it.
-- Only the edge functions (service role) write here; landlords can read
-- their own rows.

create table if not exists cloud_entitlements (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  status                 text not null default 'none'
                         check (status in ('none','active','trialing','past_due','canceled','incomplete')),
  plan                   text check (plan in ('monthly','annual')),
  current_period_end     timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text,
  updated_at             timestamptz not null default now()
);

create table if not exists billing_customers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

-- Stripe webhook idempotency.
create table if not exists billing_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

create table if not exists cloud_backups (
  id             uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  object_path    text not null unique,
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 2147483648),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  app_version    text not null default '',
  schema_version int not null default 0,
  counts         jsonb not null default '{}'::jsonb,
  status         text not null default 'pending' check (status in ('pending','available')),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  check (object_path like user_id::text || '/%')
);
create index if not exists cloud_backups_user on cloud_backups (user_id, created_at desc);

alter table cloud_entitlements enable row level security;
alter table billing_customers  enable row level security;
alter table billing_events     enable row level security;
alter table cloud_backups      enable row level security;

create policy cloud_entitlements_own on cloud_entitlements for select using (user_id = auth.uid());
create policy cloud_backups_own      on cloud_backups      for select using (user_id = auth.uid());
-- No insert/update/delete policies: only the service role (edge functions) writes.

-- Private bucket. No storage policies are granted to users: uploads and
-- downloads happen only through short-lived signed URLs that the `cloud`
-- function issues after checking the entitlement.
insert into storage.buckets (id, name, public, file_size_limit)
values ('cloud-backups', 'cloud-backups', false, 2147483648)
on conflict (id) do nothing;
