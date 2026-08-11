-- ============================================================================
-- Adds snapshots.source so the scheduled sync can tell its own output from a
-- snapshot a person uploaded or edited, and refuse to overwrite the latter.
--
-- ── CHECKLIST ────────────────────────────────────────────────────────────────
--   1. Run THIS file: Supabase Dashboard → SQL Editor → New query → paste → Run.
--   2. No other setup needed.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

-- No CHECK constraint, deliberately. activity_log.action is free text, which is
-- why adding 'sync' to it needed no migration at all; the same tradeoff is worth
-- repeating for a column whose only writers live in this repo.
--
-- The default matters: every existing snapshot predates the scheduled sync and
-- is human work, so 'upload' is the correct value for all of them.
alter table public.snapshots
  add column if not exists source text not null default 'upload';  -- 'upload' | 'sync'
