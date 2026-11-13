-- ============================================================================
-- Ranking Reports — OTHER RANKING KEYWORDS (monthly Ahrefs discovery)
-- ============================================================================
-- Two tables behind the "Other ranking keywords · not tracked" section on each
-- BP Sites brand page. api/cron-discovery.ts fills them once per Ahrefs billing
-- month from Site Explorer's organic-keywords report; the page only reads.
--
--   keyword_discovery_fetches  one row per cycle × domain × country the job has
--                              fetched: how a run knows what is left, and what
--                              each call actually cost in Ahrefs API units
--   keyword_discovery          the keywords themselves, per cycle × domain ×
--                              country
--
-- ── CHECKLIST ────────────────────────────────────────────────────────────────
--   1. Run THIS file: Supabase Dashboard → SQL Editor → New query → paste → Run.
--      Do it BEFORE merging the PR that adds api/cron-discovery.ts, or the
--      job's first run fails (and says why in /log) on the missing tables.
--   2. Requires auth-approved-lockdown.sql to have run already: the read
--      policies call public.is_approved().
--   3. Nothing else. Only the job writes here, with the service-role key, which
--      bypasses RLS.
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create table if not exists public.keyword_discovery_fetches (
  cycle       date        not null,   -- first day of the Ahrefs billing month
  domain      text        not null,
  country     text        not null,   -- 'AU' | 'CA' | 'DE' | 'IT' | 'NZ'
  row_count   integer     not null,
  units       integer     not null,   -- Ahrefs API units the call actually cost
  fetched_at  timestamptz not null default now(),
  primary key (cycle, domain, country)
);

create table if not exists public.keyword_discovery (
  id              bigserial   primary key,
  cycle           date        not null,
  brand           text        not null,
  domain          text        not null,
  country         text        not null,
  keyword         text        not null,
  position        integer     not null,
  position_kind   text,                    -- Ahrefs best_position_kind: 'organic', 'ai_overview', …
  url             text        not null default '',
  volume          integer,
  ahrefs_checked  timestamptz,             -- when Ahrefs last checked this keyword's SERP
  unique (cycle, domain, country, keyword)
);

create index if not exists keyword_discovery_brand_cycle_idx
  on public.keyword_discovery (brand, cycle);

-- Row Level Security ---------------------------------------------------------
-- Approved users can read. There is no insert, update or delete policy for any
-- role, so RLS denies those outright; the job's service-role key bypasses RLS.
alter table public.keyword_discovery_fetches enable row level security;
alter table public.keyword_discovery         enable row level security;

drop policy if exists "approved read keyword_discovery_fetches" on public.keyword_discovery_fetches;
drop policy if exists "approved read keyword_discovery"         on public.keyword_discovery;

create policy "approved read keyword_discovery_fetches" on public.keyword_discovery_fetches
  for select to authenticated using ((select public.is_approved()));

create policy "approved read keyword_discovery" on public.keyword_discovery
  for select to authenticated using ((select public.is_approved()));
