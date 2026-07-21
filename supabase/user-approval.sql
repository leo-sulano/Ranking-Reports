-- ============================================================================
-- Ranking Reports — USER APPROVAL (self-signup + admin approval)
-- ============================================================================
-- Adds a user_access table tracking approval status + admin flag per user,
-- auto-provisioned via a trigger on auth.users (covers both Google OAuth and
-- email/password signUp), and tightens the write policies from
-- auth-write-lockdown.sql to require an APPROVED session, not just an
-- authenticated one.
--
-- ── CHECKLIST ────────────────────────────────────────────────────────────────
--   1. Run THIS file: Supabase Dashboard → SQL Editor → New query → paste → Run.
--   2. Set your own account as admin (replace the email, then run this
--      statement in the SQL editor):
--        update public.user_access set is_admin = true, status = 'approved'
--        where email = 'you@example.com';
--      — run this only after your own account already exists (e.g. from the
--      previous feature's manual setup), and check the editor reports "1 row"
--      affected; 0 rows means your account isn't in auth.users yet.
--   3. Supabase Dashboard → Authentication → Providers → Email: turn "Allow
--      new users to sign up" back ON — this reverses auth-write-lockdown.sql's
--      checklist step 3. Approval, not signup-blocking, is now the gate.
--
-- Safe to re-run: every statement is idempotent. The backfill insert uses
-- `on conflict do nothing`, so re-running never resets anyone's status.
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
drop policy if exists "self or admin read user_access" on public.user_access;
drop policy if exists "admin update user_access" on public.user_access;

create policy "self or admin read user_access" on public.user_access
  for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.is_admin)
  );

create policy "admin update user_access" on public.user_access
  for update
  using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.is_admin))
  with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.is_admin));

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
