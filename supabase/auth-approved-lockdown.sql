-- ============================================================================
-- Ranking Reports — APPROVED-ONLY LOCKDOWN (supersedes auth-lockdown.sql)
-- ============================================================================
-- Requires sign-in AND user_access.status = 'approved' to read OR write any
-- data. Pending self-signups get nothing until an admin approves them at
-- /admin/users. Portal SSO users are auto-approved at provisioning
-- (api/portal-callback.ts), so they pass.
--
-- ── FLIP-THE-SWITCH CHECKLIST ───────────────────────────────────────────────
--   1. Merge + deploy the frontend PR that gates on approval (AuthGate).
--   2. Run THIS file: Supabase Dashboard → SQL Editor → paste → Run.
--   3. Vercel → Project → Settings → Environment Variables:
--        VITE_REQUIRE_AUTH = true   (Production) → redeploy.
--   4. Verify (see checklist in the PR / plan).
--
-- Safe to re-run: every statement is idempotent.
-- To ROLL BACK (reads open to anon, writes to any authenticated user):
--   re-run supabase/auth-write-lockdown.sql, then remove the env var.
--   (Note: that file predates the "approved *" policy names, so they linger
--   harmlessly after rollback — drop them by re-running this file's drop
--   section if you want a clean policy list.)
-- ============================================================================

-- Approval check used by every data policy. SECURITY DEFINER so the check
-- can read user_access regardless of that table's own RLS.
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access
    where user_id = auth.uid() and status = 'approved'
  );
$$;

revoke all on function public.is_approved() from public;
grant execute on function public.is_approved() to authenticated;

alter table public.snapshots       enable row level security;
alter table public.ranking_records enable row level security;
alter table public.ftd_records     enable row level security;
alter table public.ftd_totals      enable row level security;
alter table public.brand_stags     enable row level security;

-- snapshots -------------------------------------------------------------------
drop policy if exists "anon read snapshots"       on public.snapshots;
drop policy if exists "anon write snapshots"      on public.snapshots;
drop policy if exists "anon update snapshots"     on public.snapshots;
drop policy if exists "anon delete snapshots"     on public.snapshots;
drop policy if exists "auth read snapshots"       on public.snapshots;
drop policy if exists "auth write snapshots"      on public.snapshots;
drop policy if exists "auth update snapshots"     on public.snapshots;
drop policy if exists "auth delete snapshots"     on public.snapshots;
drop policy if exists "approved read snapshots"   on public.snapshots;
drop policy if exists "approved write snapshots"  on public.snapshots;
drop policy if exists "approved update snapshots" on public.snapshots;
drop policy if exists "approved delete snapshots" on public.snapshots;

create policy "approved read snapshots"   on public.snapshots for select to authenticated using ((select public.is_approved()));
create policy "approved write snapshots"  on public.snapshots for insert to authenticated with check ((select public.is_approved()));
create policy "approved update snapshots" on public.snapshots for update to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));
create policy "approved delete snapshots" on public.snapshots for delete to authenticated using ((select public.is_approved()));

-- ranking_records -------------------------------------------------------------
drop policy if exists "anon read records"       on public.ranking_records;
drop policy if exists "anon write records"      on public.ranking_records;
drop policy if exists "anon update records"     on public.ranking_records;
drop policy if exists "anon delete records"     on public.ranking_records;
drop policy if exists "auth read records"       on public.ranking_records;
drop policy if exists "auth write records"      on public.ranking_records;
drop policy if exists "auth update records"     on public.ranking_records;
drop policy if exists "auth delete records"     on public.ranking_records;
drop policy if exists "approved read records"   on public.ranking_records;
drop policy if exists "approved write records"  on public.ranking_records;
drop policy if exists "approved update records" on public.ranking_records;
drop policy if exists "approved delete records" on public.ranking_records;

create policy "approved read records"   on public.ranking_records for select to authenticated using ((select public.is_approved()));
create policy "approved write records"  on public.ranking_records for insert to authenticated with check ((select public.is_approved()));
create policy "approved update records" on public.ranking_records for update to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));
create policy "approved delete records" on public.ranking_records for delete to authenticated using ((select public.is_approved()));

-- ftd_records -----------------------------------------------------------------
drop policy if exists "anon read ftd_records"       on public.ftd_records;
drop policy if exists "anon write ftd_records"      on public.ftd_records;
drop policy if exists "anon update ftd_records"     on public.ftd_records;
drop policy if exists "anon delete ftd_records"     on public.ftd_records;
drop policy if exists "auth read ftd_records"       on public.ftd_records;
drop policy if exists "auth write ftd_records"      on public.ftd_records;
drop policy if exists "auth update ftd_records"     on public.ftd_records;
drop policy if exists "auth delete ftd_records"     on public.ftd_records;
drop policy if exists "approved read ftd_records"   on public.ftd_records;
drop policy if exists "approved write ftd_records"  on public.ftd_records;
drop policy if exists "approved update ftd_records" on public.ftd_records;
drop policy if exists "approved delete ftd_records" on public.ftd_records;

create policy "approved read ftd_records"   on public.ftd_records for select to authenticated using ((select public.is_approved()));
create policy "approved write ftd_records"  on public.ftd_records for insert to authenticated with check ((select public.is_approved()));
create policy "approved update ftd_records" on public.ftd_records for update to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));
create policy "approved delete ftd_records" on public.ftd_records for delete to authenticated using ((select public.is_approved()));

-- ftd_totals ------------------------------------------------------------------
drop policy if exists "anon read ftd_totals"       on public.ftd_totals;
drop policy if exists "anon write ftd_totals"      on public.ftd_totals;
drop policy if exists "anon update ftd_totals"     on public.ftd_totals;
drop policy if exists "anon delete ftd_totals"     on public.ftd_totals;
drop policy if exists "auth read ftd_totals"       on public.ftd_totals;
drop policy if exists "auth write ftd_totals"      on public.ftd_totals;
drop policy if exists "auth update ftd_totals"     on public.ftd_totals;
drop policy if exists "auth delete ftd_totals"     on public.ftd_totals;
drop policy if exists "approved read ftd_totals"   on public.ftd_totals;
drop policy if exists "approved write ftd_totals"  on public.ftd_totals;
drop policy if exists "approved update ftd_totals" on public.ftd_totals;
drop policy if exists "approved delete ftd_totals" on public.ftd_totals;

create policy "approved read ftd_totals"   on public.ftd_totals for select to authenticated using ((select public.is_approved()));
create policy "approved write ftd_totals"  on public.ftd_totals for insert to authenticated with check ((select public.is_approved()));
create policy "approved update ftd_totals" on public.ftd_totals for update to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));
create policy "approved delete ftd_totals" on public.ftd_totals for delete to authenticated using ((select public.is_approved()));

-- brand_stags -----------------------------------------------------------------
drop policy if exists "anon read brand_stags"       on public.brand_stags;
drop policy if exists "anon write brand_stags"      on public.brand_stags;
drop policy if exists "anon update brand_stags"     on public.brand_stags;
drop policy if exists "anon delete brand_stags"     on public.brand_stags;
drop policy if exists "auth read brand_stags"       on public.brand_stags;
drop policy if exists "auth write brand_stags"      on public.brand_stags;
drop policy if exists "auth update brand_stags"     on public.brand_stags;
drop policy if exists "auth delete brand_stags"     on public.brand_stags;
drop policy if exists "approved read brand_stags"   on public.brand_stags;
drop policy if exists "approved write brand_stags"  on public.brand_stags;
drop policy if exists "approved update brand_stags" on public.brand_stags;
drop policy if exists "approved delete brand_stags" on public.brand_stags;

create policy "approved read brand_stags"   on public.brand_stags for select to authenticated using ((select public.is_approved()));
create policy "approved write brand_stags"  on public.brand_stags for insert to authenticated with check ((select public.is_approved()));
create policy "approved update brand_stags" on public.brand_stags for update to authenticated using ((select public.is_approved())) with check ((select public.is_approved()));
create policy "approved delete brand_stags" on public.brand_stags for delete to authenticated using ((select public.is_approved()));
