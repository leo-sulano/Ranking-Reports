-- ============================================================================
-- Ranking Reports — WRITE LOCKDOWN (read stays open, writes require login)
-- ============================================================================
-- Run this in the Supabase SQL editor when you're ready to require login for
-- add/edit/upload/delete actions while keeping the dashboard viewable by
-- anyone (no login needed to read data).
--
-- Unlike auth-lockdown.sql (which blocks anon entirely — an all-or-nothing
-- gate for the dormant VITE_REQUIRE_AUTH flag), this keeps `anon` able to
-- SELECT, and only requires an authenticated session for INSERT/UPDATE/DELETE.
--
-- ── CHECKLIST ────────────────────────────────────────────────────────────────
--   1. Supabase Dashboard → Authentication → Providers → Google: enable it,
--      paste the Client ID/Secret from a Google Cloud OAuth client you create.
--   2. Supabase Dashboard → Authentication → Users → "Add user" for each
--      teammate who needs write access (set "Auto Confirm User").
--   3. Supabase Dashboard → Authentication → URL Configuration: add your
--      deployed app URL (and http://localhost:5173 for local dev) as a
--      Redirect URL, so signInWithOAuth's redirectTo is accepted.
--   4. Run THIS file: Supabase Dashboard → SQL Editor → New query → paste → Run.
--
-- Safe to re-run: every statement is idempotent.
-- To ROLL BACK (re-open writes to anon), re-run the policy section of schema.sql.
-- ============================================================================

alter table public.snapshots       enable row level security;
alter table public.ranking_records enable row level security;
alter table public.ftd_records     enable row level security;
alter table public.ftd_totals      enable row level security;
alter table public.brand_stags     enable row level security;

-- snapshots -------------------------------------------------------------------
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

-- ranking_records ---------------------------------------------------------------
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

-- ftd_records -------------------------------------------------------------------
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

-- ftd_totals ----------------------------------------------------------------
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

-- brand_stags -----------------------------------------------------------------
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
