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
-- This is an internal tool. The anon key is shared with the team. RLS is
-- enabled but the policies allow anon to read/write so the SPA works without
-- per-user auth. Tighten later if needed.
alter table public.snapshots         enable row level security;
alter table public.ranking_records   enable row level security;

drop policy if exists "anon read snapshots"   on public.snapshots;
drop policy if exists "anon write snapshots"  on public.snapshots;
drop policy if exists "anon update snapshots" on public.snapshots;
drop policy if exists "anon delete snapshots" on public.snapshots;
drop policy if exists "anon read records"     on public.ranking_records;
drop policy if exists "anon write records"    on public.ranking_records;
drop policy if exists "anon update records"   on public.ranking_records;
drop policy if exists "anon delete records"   on public.ranking_records;

create policy "anon read snapshots"   on public.snapshots         for select using (true);
create policy "anon write snapshots"  on public.snapshots         for insert with check (true);
create policy "anon update snapshots" on public.snapshots         for update using (true) with check (true);
create policy "anon delete snapshots" on public.snapshots         for delete using (true);
create policy "anon read records"     on public.ranking_records   for select using (true);
create policy "anon write records"    on public.ranking_records   for insert with check (true);
-- updateRecordFields() in storage.ts issues UPDATEs against ranking_records under the
-- anon key (inline GSV/SV/AFF edits) — without this policy those writes are silently
-- denied by RLS instead of erroring loudly.
create policy "anon update records"   on public.ranking_records   for update using (true) with check (true);
create policy "anon delete records"   on public.ranking_records   for delete using (true);

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
create policy "anon read ftd_records"   on public.ftd_records for select using (true);
create policy "anon write ftd_records"  on public.ftd_records for insert with check (true);
create policy "anon update ftd_records" on public.ftd_records for update using (true) with check (true);
create policy "anon delete ftd_records" on public.ftd_records for delete using (true);

drop policy if exists "anon read ftd_totals"   on public.ftd_totals;
drop policy if exists "anon write ftd_totals"  on public.ftd_totals;
drop policy if exists "anon update ftd_totals" on public.ftd_totals;
drop policy if exists "anon delete ftd_totals" on public.ftd_totals;
create policy "anon read ftd_totals"   on public.ftd_totals for select using (true);
create policy "anon write ftd_totals"  on public.ftd_totals for insert with check (true);
create policy "anon update ftd_totals" on public.ftd_totals for update using (true) with check (true);
create policy "anon delete ftd_totals" on public.ftd_totals for delete using (true);

drop policy if exists "anon read brand_stags"   on public.brand_stags;
drop policy if exists "anon write brand_stags"  on public.brand_stags;
drop policy if exists "anon update brand_stags" on public.brand_stags;
drop policy if exists "anon delete brand_stags" on public.brand_stags;
create policy "anon read brand_stags"   on public.brand_stags for select using (true);
create policy "anon write brand_stags"  on public.brand_stags for insert with check (true);
create policy "anon update brand_stags" on public.brand_stags for update using (true) with check (true);
create policy "anon delete brand_stags" on public.brand_stags for delete using (true);
