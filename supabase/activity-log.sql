-- ============================================================================
-- Ranking Reports — ACTIVITY LOG (audit trail for uploads/edits/deletes)
-- ============================================================================
-- Adds an append-only activity_log table: every upload, inline edit, and
-- snapshot delete across the dashboard writes one row here, so any approved
-- user can see who changed what and when on the /log page.
--
-- ── CHECKLIST ────────────────────────────────────────────────────────────────
--   1. Run THIS file: Supabase Dashboard → SQL Editor → New query → paste → Run.
--   2. No other setup needed — reads/writes go through the anon key + RLS,
--      same as every other table in this app. Requires user-approval.sql to
--      have already been run (this policy depends on public.user_access).
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create table if not exists public.activity_log (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  email       text not null,
  action      text not null,   -- 'upload' | 'edit' | 'delete'
  section     text not null,   -- 'bp-sites' | 'lp-sites' | 'ftds'
  summary     text not null
);

create index if not exists activity_log_created_at_idx
  on public.activity_log (created_at desc);

-- Row Level Security ---------------------------------------------------------
-- Append-only: any approved user can read the full log; a user can only
-- insert rows attributed to themselves; no update/delete policy exists for
-- any role, so RLS denies those commands outright — nobody (including
-- admins) can edit or erase a log entry once written.
alter table public.activity_log enable row level security;

drop policy if exists "approved read activity_log" on public.activity_log;
drop policy if exists "approved insert activity_log" on public.activity_log;

create policy "approved read activity_log" on public.activity_log
  for select
  using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

create policy "approved insert activity_log" on public.activity_log
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')
  );
