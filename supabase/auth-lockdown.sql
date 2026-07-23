-- ============================================================================
-- Ranking Reports — AUTH LOCKDOWN (the "flip the switch" migration)
-- ============================================================================
-- ⚠️  DO NOT RUN THIS UNTIL YOU ARE READY TO REQUIRE LOGIN.
-- ⚠️  SUPERSEDED: use auth-approved-lockdown.sql instead — it additionally
--     requires user_access.status = 'approved', not just any session.
--
-- Today the dashboard is open: schema.sql grants the public `anon` role full
-- read/write/delete on all data (policies use `using (true)`). Because the anon
-- key ships in the browser bundle, anyone with the URL — or the key — can read
-- or wipe the data directly via the Supabase REST API.
--
-- Running THIS file revokes the anon role's access and grants it only to
-- logged-in (`authenticated`) users. After that, the app works ONLY when a user
-- is signed in (supabase-js automatically sends their JWT, which satisfies the
-- new policies).
--
-- ── FLIP-THE-SWITCH CHECKLIST ───────────────────────────────────────────────
--   1. Frontend (Vercel): set env var  VITE_REQUIRE_AUTH = true  and redeploy.
--        → the login screen now gates the app.
--   2. Create at least one user:
--        Supabase Dashboard → Authentication → Users → "Add user"
--        (set "Auto Confirm User" so they can log in immediately).
--   3. (Recommended) Disable public signups so randoms can't register:
--        Authentication → Providers → Email → turn OFF "Allow new users to sign up".
--   4. Run THIS file:  Supabase Dashboard → SQL Editor → New query → paste → Run.
--        → the anon key can no longer read/write data; only logged-in users can.
--
-- Safe to re-run: every statement is idempotent.
-- To ROLL BACK (re-open to anon), re-run the policy section of schema.sql.
-- ============================================================================

-- Make sure RLS is on (schema.sql already does this; harmless to repeat).
alter table public.snapshots         enable row level security;
alter table public.ranking_records   enable row level security;

-- Drop the permissive anon policies created by schema.sql ---------------------
drop policy if exists "anon read snapshots"   on public.snapshots;
drop policy if exists "anon write snapshots"  on public.snapshots;
drop policy if exists "anon delete snapshots" on public.snapshots;
drop policy if exists "anon read records"     on public.ranking_records;
drop policy if exists "anon write records"    on public.ranking_records;
drop policy if exists "anon delete records"   on public.ranking_records;

-- Also drop the locked-down policies if this file was run before (idempotent).
drop policy if exists "auth read snapshots"   on public.snapshots;
drop policy if exists "auth write snapshots"  on public.snapshots;
drop policy if exists "auth update snapshots" on public.snapshots;
drop policy if exists "auth delete snapshots" on public.snapshots;
drop policy if exists "auth read records"     on public.ranking_records;
drop policy if exists "auth write records"    on public.ranking_records;
drop policy if exists "auth update records"   on public.ranking_records;
drop policy if exists "auth delete records"   on public.ranking_records;

-- Grant access to AUTHENTICATED users only ------------------------------------
-- `to authenticated` scopes the policy to logged-in users; the anon role is
-- left with no policy and therefore no access (RLS denies by default).
create policy "auth read snapshots"   on public.snapshots       for select to authenticated using (true);
create policy "auth write snapshots"  on public.snapshots       for insert to authenticated with check (true);
create policy "auth update snapshots" on public.snapshots       for update to authenticated using (true) with check (true);
create policy "auth delete snapshots" on public.snapshots       for delete to authenticated using (true);

create policy "auth read records"     on public.ranking_records for select to authenticated using (true);
create policy "auth write records"    on public.ranking_records for insert to authenticated with check (true);
create policy "auth update records"   on public.ranking_records for update to authenticated using (true) with check (true);
create policy "auth delete records"   on public.ranking_records for delete to authenticated using (true);
