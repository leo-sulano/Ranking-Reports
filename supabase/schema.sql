-- ============================================================================
-- Ranking Reports — Supabase schema
-- ============================================================================
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent.
--
-- Tables:
--   snapshots         — one row per uploaded XLSX (rr_snapshots equivalent)
--   ranking_records   — flat ranking rows, FK to snapshots
-- ============================================================================

-- Snapshots ------------------------------------------------------------------
create table if not exists public.snapshots (
  id            text primary key,             -- client-generated id (e.g. "snap-1715600000000")
  raw_date      text not null,                -- from "Last Check" column, e.g. "5/20/2026"
  display_date  text not null,                -- formatted, e.g. "20 May 26"
  category      text,                         -- "bp-sites" | "lp-sites" — null reads as DEFAULT_CATEGORY client-side
  created_at    timestamptz not null default now()
);

-- Backfill ALTER for existing tables (idempotent — Postgres ignores duplicates).
alter table public.snapshots add column if not exists category text;

create index if not exists snapshots_created_at_idx
  on public.snapshots (created_at desc);

-- Ranking records ------------------------------------------------------------
create table if not exists public.ranking_records (
  id             bigserial primary key,
  snapshot_id    text not null references public.snapshots(id) on delete cascade,
  domain         text not null,
  keyword        text not null,
  country        text not null,
  position       text not null,                 -- text so "NR" / "Not in top 100" fit
  previous       text not null default '',
  change         text not null default '',
  date           text not null default '',
  search_volume         text not null default '',  -- per-(domain, country) SV — e.g. "6.3K"
  affiliate_url         text not null default '',
  global_search_volume  text not null default ''   -- per-keyword GSV — denormalized onto every record for the keyword
);

-- Backfill ALTER for existing tables (idempotent — Postgres ignores duplicates).
alter table public.ranking_records add column if not exists search_volume text not null default '';
alter table public.ranking_records add column if not exists affiliate_url text not null default '';
alter table public.ranking_records add column if not exists global_search_volume text not null default '';

create index if not exists ranking_records_snapshot_idx
  on public.ranking_records (snapshot_id);

create index if not exists ranking_records_lookup_idx
  on public.ranking_records (snapshot_id, domain, keyword, country);

-- Row Level Security ---------------------------------------------------------
-- Read is open to everyone (the anon key ships in the browser bundle, and
-- viewing the dashboard requires no login). Writes require an authenticated
-- Supabase session — see auth-write-lockdown.sql for the same policies
-- applied to an existing database, plus the setup checklist (Google OAuth
-- provider, manually-added users, redirect URLs).
alter table public.snapshots         enable row level security;
alter table public.ranking_records   enable row level security;

drop policy if exists "anon read snapshots"   on public.snapshots;
drop policy if exists "anon write snapshots"  on public.snapshots;
drop policy if exists "anon update snapshots" on public.snapshots;
drop policy if exists "anon delete snapshots" on public.snapshots;
drop policy if exists "auth write snapshots"  on public.snapshots;
drop policy if exists "auth update snapshots" on public.snapshots;
drop policy if exists "auth delete snapshots" on public.snapshots;

create policy "anon read snapshots"   on public.snapshots for select using (true);
create policy "auth write snapshots"  on public.snapshots for insert to authenticated with check (true);
create policy "auth update snapshots" on public.snapshots for update to authenticated using (true) with check (true);
create policy "auth delete snapshots" on public.snapshots for delete to authenticated using (true);

drop policy if exists "anon read records"   on public.ranking_records;
drop policy if exists "anon write records"  on public.ranking_records;
drop policy if exists "anon update records" on public.ranking_records;
drop policy if exists "anon delete records" on public.ranking_records;
drop policy if exists "auth write records"  on public.ranking_records;
drop policy if exists "auth update records" on public.ranking_records;
drop policy if exists "auth delete records" on public.ranking_records;

create policy "anon read records"   on public.ranking_records for select using (true);
create policy "auth write records"  on public.ranking_records for insert to authenticated with check (true);
create policy "auth update records" on public.ranking_records for update to authenticated using (true) with check (true);
create policy "auth delete records" on public.ranking_records for delete to authenticated using (true);

-- ============================================================================
-- FTD tracking — REG / FTD / Conversion % per brand per month
-- ============================================================================
-- Deliberately independent of snapshots/ranking_records: FTD data is
-- brand+month shaped, not domain+keyword+country shaped.

create table if not exists public.ftd_records (
  brand           text not null,
  year_month      text not null,               -- 'YYYY-MM', e.g. '2023-08'
  reg             int not null default 0,
  ftd             int not null default 0,
  conversion_pct  numeric,                       -- manually entered, nullable
  primary key (brand, year_month)
);

create table if not exists public.ftd_totals (
  year_month      text primary key,
  conversion_pct  numeric                        -- manually entered; REG/FTD totals are derived client-side
);

create table if not exists public.brand_stags (
  brand  text primary key,
  stags  text not null default ''
);

alter table public.ftd_records enable row level security;
alter table public.ftd_totals  enable row level security;
alter table public.brand_stags enable row level security;

drop policy if exists "anon read ftd_records"   on public.ftd_records;
drop policy if exists "anon write ftd_records"  on public.ftd_records;
drop policy if exists "anon update ftd_records" on public.ftd_records;
drop policy if exists "anon delete ftd_records" on public.ftd_records;
drop policy if exists "auth write ftd_records"  on public.ftd_records;
drop policy if exists "auth update ftd_records" on public.ftd_records;
drop policy if exists "auth delete ftd_records" on public.ftd_records;

create policy "anon read ftd_records"   on public.ftd_records for select using (true);
create policy "auth write ftd_records"  on public.ftd_records for insert to authenticated with check (true);
create policy "auth update ftd_records" on public.ftd_records for update to authenticated using (true) with check (true);
create policy "auth delete ftd_records" on public.ftd_records for delete to authenticated using (true);

drop policy if exists "anon read ftd_totals"   on public.ftd_totals;
drop policy if exists "anon write ftd_totals"  on public.ftd_totals;
drop policy if exists "anon update ftd_totals" on public.ftd_totals;
drop policy if exists "anon delete ftd_totals" on public.ftd_totals;
drop policy if exists "auth write ftd_totals"  on public.ftd_totals;
drop policy if exists "auth update ftd_totals" on public.ftd_totals;
drop policy if exists "auth delete ftd_totals" on public.ftd_totals;

create policy "anon read ftd_totals"   on public.ftd_totals for select using (true);
create policy "auth write ftd_totals"  on public.ftd_totals for insert to authenticated with check (true);
create policy "auth update ftd_totals" on public.ftd_totals for update to authenticated using (true) with check (true);
create policy "auth delete ftd_totals" on public.ftd_totals for delete to authenticated using (true);

drop policy if exists "anon read brand_stags"   on public.brand_stags;
drop policy if exists "anon write brand_stags"  on public.brand_stags;
drop policy if exists "anon update brand_stags" on public.brand_stags;
drop policy if exists "anon delete brand_stags" on public.brand_stags;
drop policy if exists "auth write brand_stags"  on public.brand_stags;
drop policy if exists "auth update brand_stags" on public.brand_stags;
drop policy if exists "auth delete brand_stags" on public.brand_stags;

create policy "anon read brand_stags"   on public.brand_stags for select using (true);
create policy "auth write brand_stags"  on public.brand_stags for insert to authenticated with check (true);
create policy "auth update brand_stags" on public.brand_stags for update to authenticated using (true) with check (true);
create policy "auth delete brand_stags" on public.brand_stags for delete to authenticated using (true);

-- ============================================================================
-- User approval — see user-approval.sql for the full setup checklist
-- (admin seeding, re-enabling signups). Table/trigger/RLS below are identical.
-- ============================================================================

create table if not exists public.user_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  status     text not null default 'pending' check (status in ('pending', 'approved')),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.user_access enable row level security;

-- Auto-provision a pending row for every new auth.users insert -----------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_access (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill existing users (created manually during the previous feature's
-- setup) as already-approved, since an admin already vetted them by hand.
insert into public.user_access (user_id, email, status)
select id, email, 'approved' from auth.users
on conflict (user_id) do nothing;

-- RLS: user_access --------------------------------------------------------------
-- is_admin() is SECURITY DEFINER so it bypasses RLS internally; a plain
-- `exists (select ... from user_access ...)` subquery directly inside a
-- user_access policy re-triggers that same policy for every row it scans,
-- which Postgres reports as "infinite recursion detected in policy" (42P17).
create or replace function public.user_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(is_admin, false) from public.user_access where user_id = auth.uid();
$$;

drop policy if exists "self or admin read user_access" on public.user_access;
drop policy if exists "admin update user_access" on public.user_access;

create policy "self or admin read user_access" on public.user_access
  for select
  using (
    user_id = auth.uid()
    or public.user_is_admin()
  );

create policy "admin update user_access" on public.user_access
  for update
  using (public.user_is_admin())
  with check (public.user_is_admin());

-- RLS: tighten the 5 app tables' write policies to require APPROVAL -----------
-- (not just authentication — replaces the `using (true)` / `with check (true)`
-- policies from auth-write-lockdown.sql with an approval-aware check).

drop policy if exists "auth write snapshots"  on public.snapshots;
drop policy if exists "auth update snapshots" on public.snapshots;
drop policy if exists "auth delete snapshots" on public.snapshots;
create policy "auth write snapshots"  on public.snapshots for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update snapshots" on public.snapshots for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete snapshots" on public.snapshots for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

drop policy if exists "auth write records"  on public.ranking_records;
drop policy if exists "auth update records" on public.ranking_records;
drop policy if exists "auth delete records" on public.ranking_records;
create policy "auth write records"  on public.ranking_records for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update records" on public.ranking_records for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete records" on public.ranking_records for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

drop policy if exists "auth write ftd_records"  on public.ftd_records;
drop policy if exists "auth update ftd_records" on public.ftd_records;
drop policy if exists "auth delete ftd_records" on public.ftd_records;
create policy "auth write ftd_records"  on public.ftd_records for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update ftd_records" on public.ftd_records for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete ftd_records" on public.ftd_records for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

drop policy if exists "auth write ftd_totals"  on public.ftd_totals;
drop policy if exists "auth update ftd_totals" on public.ftd_totals;
drop policy if exists "auth delete ftd_totals" on public.ftd_totals;
create policy "auth write ftd_totals"  on public.ftd_totals for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update ftd_totals" on public.ftd_totals for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete ftd_totals" on public.ftd_totals for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

drop policy if exists "auth write brand_stags"  on public.brand_stags;
drop policy if exists "auth update brand_stags" on public.brand_stags;
drop policy if exists "auth delete brand_stags" on public.brand_stags;
create policy "auth write brand_stags"  on public.brand_stags for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update brand_stags" on public.brand_stags for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete brand_stags" on public.brand_stags for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
