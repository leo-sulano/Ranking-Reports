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
  created_at    timestamptz not null default now()
);

create index if not exists snapshots_created_at_idx
  on public.snapshots (created_at desc);

-- Ranking records ------------------------------------------------------------
create table if not exists public.ranking_records (
  id           bigserial primary key,
  snapshot_id  text not null references public.snapshots(id) on delete cascade,
  domain       text not null,
  keyword      text not null,
  country      text not null,
  position     text not null,                 -- text so "NR" / "Not in top 100" fit
  previous     text not null default '',
  change       text not null default '',
  date         text not null default ''
);

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
drop policy if exists "anon delete snapshots" on public.snapshots;
drop policy if exists "anon read records"     on public.ranking_records;
drop policy if exists "anon write records"    on public.ranking_records;
drop policy if exists "anon delete records"   on public.ranking_records;

create policy "anon read snapshots"   on public.snapshots         for select using (true);
create policy "anon write snapshots"  on public.snapshots         for insert with check (true);
create policy "anon delete snapshots" on public.snapshots         for delete using (true);
create policy "anon read records"     on public.ranking_records   for select using (true);
create policy "anon write records"    on public.ranking_records   for insert with check (true);
create policy "anon delete records"   on public.ranking_records   for delete using (true);
