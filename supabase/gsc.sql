-- ============================================================================
-- Ranking Reports — REAL KEYWORDS (GOOGLE): Search Console connection + cache
-- ============================================================================
-- Two tables behind the "Real keywords (Google)" tab. One Google account,
-- connected once by an admin, is read live through the Search Console API.
--
--   gsc_connection  one row (id = 1): the connected account's refresh token,
--                   stored ENCRYPTED (AES-256-GCM, key in an env var), who
--                   connected it, and whether Google still accepts it
--   gsc_cache       the last Search Console answer per (domain, days), fetched
--                   at fetched_at; the server serves it for 6 hours. The row
--                   ('*', 0) holds the site list (sites.list).
--
-- ── ACCESS ───────────────────────────────────────────────────────────────────
--   Row level security is ON for both tables with NO policies, and all
--   privileges are revoked from anon and authenticated. Only the service role
--   (the Vercel functions) reads or writes them: the refresh token is a
--   credential, and no browser session may ever see it, even encrypted.
--
-- ── CHECKLIST ────────────────────────────────────────────────────────────────
--   1. Run THIS file: Supabase Dashboard → SQL Editor → New query → paste → Run.
--      Safe to run again.
-- ============================================================================

create table if not exists public.gsc_connection (
  id                smallint    primary key default 1 check (id = 1),
  refresh_token_enc text        not null,
  google_email      text,
  connected_by      uuid        not null,
  connected_at      timestamptz not null default now(),
  status            text        not null default 'ok' check (status in ('ok', 'broken'))
);

create table if not exists public.gsc_cache (
  domain     text        not null,
  days       int         not null,
  payload    jsonb       not null,
  fetched_at timestamptz not null default now(),
  primary key (domain, days)
);

alter table public.gsc_connection enable row level security;
alter table public.gsc_cache      enable row level security;

-- No policies on purpose: service role only (it bypasses RLS).
revoke all on public.gsc_connection from anon, authenticated;
revoke all on public.gsc_cache      from anon, authenticated;
