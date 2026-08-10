# Ranks API Sync — Design

**Date:** 2026-08-10
**Status:** Approved

## Purpose

BP Sites ranking data is currently entered by uploading an `.xlsx` export. The
same data is available from the Ranks API documented in
`docs/integrations/sites-api.md`. This spec covers replacing the manual step
with a one-click **Sync from API**, while leaving the xlsx upload and every
inline-edit affordance exactly as they are.

The sibling `BIF-Dashboard` project already consumes this endpoint. Its
`api/sites.ts`, `src/lib/sitesApi.ts` and `src/lib/normalize.ts` are ported here
with the differences noted below, rather than written from scratch.

## What the API actually returns

Probed live on 2026-08-10 with the key in `.env`. Where the vendor doc and the
endpoint disagree, the observed behaviour below is the requirement.

| Observed | Documented | Consequence |
|---|---|---|
| Rooster data is `project_id: 0` | not mentioned | `?project_id=0` does **not** filter — PHP treats `0` as falsy and returns everything. The proxy must not send it. |
| `position: 0` on 403 of 1,109 BP rows | "null = not in top results" | Both `0` and `null` normalize to `NR`. No nulls were observed at all. |
| `country` is `AU / CA / DE / IT / NZ`, with `language` a separate field | "country/language" | Project 0 returns real country codes matching `COUNTRY_LABELS` exactly. `language` is redundant here and is ignored. |
| One row per (domain, keyword, country) | implied current state | The latest-per-key reduction is a no-op today. It stays as a guard: BIF observed up to 6 rows per key on project 18. |
| `meta.total` reported 135 for a 154-row response (BIF) | — | Page until a page is shorter than `limit`; never terminate on a count. |
| `action=history` returns weekly history to 2026-03-30 | listed | Not used in this build. See Out of scope. |
| `from` / `to` ignored on `action=results` | listed as filters | Usable only on `action=history`. |
| `keyword_count` in `action=domains` counts check rows, not distinct keywords | — | `rooster.bet` reports 688, which equals its full history row count, not its 7 keywords. Not used. |

### Coverage

Of 2,826 total result rows across both projects, **1,109 match BP domains** in
`brands.ts`: all 37 BP/MAIN domains, 54 distinct keywords, 5 countries. This is
the same shape the xlsx upload produces (37 x ~6 x 5), so the switch is not a
loss of coverage.

**Zero LP domains are tracked.** The 30 rows that appear to match `lpDomains`
are `lucky7evencasino.org`, which is registered under both `domains` and
`lpDomains` for Lucky 7even. LP Sites therefore keeps its xlsx path untouched
and the sync never targets it.

### Rows from project 18

56 of the 1,109 BP rows carry `project_id: 18` on five domains shared with BIF
(`casinoroosters.com`, `luckyvibe.io`, `roosters.bet`, `roostersbet.com`,
`spinjo.io`). They are **kept**, not filtered:

- Every one of their keywords already exists in the project-0 keyword set — no
  foreign vocabulary leaks in.
- No (domain, keyword, country) key appears twice across the whole BP set, so
  these 56 rows fill keys project 0 did not check that week. Filtering by
  `project_id` would punch 56 holes in the grid.

`DOMAIN_TO_BRAND` is the only filter. The latest-per-key reduction protects
against a future collision.

## Approach

A Vercel serverless proxy holds the key; the browser normalizes and persists
through the write path that already exists.

```
Sidebar "Sync from API"
  -> App.handleSyncFromApi()
      -> sitesApi.fetchSitesRows()      GET /api/sites?action=results&limit=1000&offset=N (paged)
          -> api/sites.ts               adds Authorization: Bearer SITES_API_KEY
              -> ranks.php
      -> sitesNormalize.normalizeRows() ApiRow[] -> { records, unknownDomains, rawDate }
      -> [existing] DuplicateWarning -> persistOneSnapshot -> logActivity -> UploadSummary
```

The sync produces a `ParsedSnapshot` — the same shape `parseXlsx` returns — so
nothing downstream of `persistOneSnapshot` changes. `requireAuth`,
`DuplicateWarning`, `UploadSummary`, `logActivity` and `applyCarryForward` are
all reused as-is.

### Rejected alternatives

**A Supabase Edge Function writing directly with the service-role key.** It
sets up the future cron cleanly, but bypasses RLS and the approved-user write
gate, moves normalization away from the types and tests in `src/lib`, and makes
the Replace/Cancel prompt incoherent — the write would already have happened by
the time the browser could ask.

**Calling the upstream from the browser.** A `VITE_`-prefixed key ships in the
downloaded bundle. A keyless request returns 401, so the key is a real secret.

Neither choice forecloses the cron follow-up: the normalizer is a pure function
over rows, so a later `api/cron-sync.ts` imports the same module and only the
write path is new.

## Files

| File | Change |
|---|---|
| `api/sites.ts` | New. Self-contained proxy, no imports from `src/` — `tsconfig.api.json` uses NodeNext resolution, whose `.js`-extension rule does not apply cleanly to app code. |
| `src/lib/sitesApi.ts` | New. Pages the proxy. `SitesApiError` carries the upstream status so callers can tell 401 from 5xx. |
| `src/lib/sitesNormalize.ts` | New. Pure `ApiRow[] -> RankingRecord[]`. The only new file with real logic risk. |
| `src/lib/sitesNormalize.test.ts` | New. |
| `src/lib/sitesApi.test.ts` | New. |
| `api/sites.test.ts` | New, ported from BIF. |
| `vite.config.ts` | Dev middleware mounting `/api/sites` so `npm run dev` works, not only `vercel dev`. |
| `src/App.tsx` | `handleSyncFromApi` plus a `syncing` flag. |
| `src/components/Sidebar.tsx` | "Sync from API" button in the footer, above Import Data, same `writeGate` treatment. |
| `src/components/UploadSummary.tsx` | Distinguish "API sync" from "Upload" in its heading and copy, and list the distinct country codes present in the batch so an unrecognised one is visible. |
| `src/components/DuplicateWarning.tsx` | Name the source of the incoming data. |
| `src/lib/activityLog.ts` | Add `'sync'` to `LogAction`. No migration: `activity_log.action` is free text with no CHECK constraint. |
| `src/pages/Log.tsx` | Add an `ACTION_STYLES.sync` entry. The page indexes that map directly, so a missing entry would throw on the first synced row. |
| `.env.example` | Document `SITES_API_KEY` as server-only. |
| `docs/integrations/sites-api.md` | Append the observed-behaviour table above. |

`api/sites.ts` accepts only `action=results` and `action=domains`, clamps
`limit` to 1–1000 and `offset` to a non-negative integer, times out at 30s,
passes the upstream status through, sets `Cache-Control: no-store`, and never
echoes the request URL — that URL is built from secret-bearing config.

## Normalization

| Rule | Rationale |
|---|---|
| `position` `0`, `null`, `''`, non-finite or <= 0 -> `'NR'` | 403 of 1,109 BP rows are `0`. |
| `domain` lowercased, leading `www.` stripped | `url_found` shows `www.` hosts upstream. |
| Drop rows whose domain is absent from `DOMAIN_TO_BRAND`; tally per domain, busiest first | 1,687 of 2,826 rows belong to other projects. Reuses the existing `UnknownDomain` type and the summary's skipped-domain list. |
| `country` mapped through `COUNTRY_LABELS`; unmapped values kept as-is and surfaced in the summary | Project 0 already returns the exact five codes. Silently dropping an unrecognised country would hide a real change upstream. |
| `language` ignored | Redundant here. |
| Keep the newest `checked_at` per (domain, keyword, country) | Guard, per above. |
| Empty `checked_at` -> the record's `date` stays `''` | Adopted from BIF's corrected normalizer. Stamping an undated row with the batch date destroys the only signal separating "never crawled" from "crawled, found nothing". `''` also matches what `normalizeDate` produces for a blank xlsx cell and round-trips through `date text not null default ''`. No empty values were observed in the BP set, but 46 of 1,727 rows on the BIF side had them. |
| Per-record `date` is that row's own `checked_at` date as `yyyy-MM-dd` | Matches `normalizeDate`'s output for xlsx records. |
| Snapshot `rawDate` = newest `checked_at` date **among the kept rows** | A batch straddles dates: 1,100 rows on 2026-08-04, 9 on 2026-07-29. Computed after filtering, so a foreign domain's later timestamp can never date a snapshot that does not contain it. |
| `url_found` discarded | `RankingRecord` has no such field and `ranking_records` has no such column. Adding one is out of scope. |
| `change` rendered signed: `+2`, `-3`, `0`; `''` when null | Matches `parseChange`'s expectations. |
| `searchVolume` / `affiliateUrl` / `globalSearchVolume` -> `''` | Not supplied by the API. `applyCarryForward` inherits them from the prior snapshot, which is what it was built for. |
| Page until a page is shorter than `limit` | `meta.total` is untrustworthy. |

## Sync flow

1. `requireAuth` — signed out opens the login modal and resumes on success.
2. The button enters a "Syncing..." state; the pager reports row progress
   through the existing `bulkProgress` mechanism.
3. Normalize. **Zero matching rows** opens the summary modal explaining that
   every row was filtered, listing the busiest skipped domains. Nothing is
   written. This is the expected view if `brands.ts` and the API drift apart,
   and it must read as information rather than an outage.
4. If a snapshot with id `snap-bp-sites-<rawDate>` already exists,
   `DuplicateWarning` offers Replace / Cancel, naming the date, the existing
   record count and the incoming one. Nothing is ever overwritten silently:
   manual GSV / SV / AFF edits live on snapshot records.
5. `persistOneSnapshot` writes it, then
   `logActivity('sync', 'bp-sites', 'Synced 1,109 records from Ranks API — 4 Aug 26')`.
6. `UploadSummary` opens, labelled as a sync.

**BP only.** No category picker, and no path by which the sync can write a
half-empty LP snapshot.

## Failure handling

Nothing is written unless the entire batch fetched cleanly.

| Failure | Behaviour |
|---|---|
| `SITES_API_KEY` unset on the server | Proxy 500 naming the variable; the toast repeats it verbatim. The first thing anyone hits on a fresh Vercel env. |
| Upstream 401 | Toast distinguishing a rejected key from an outage. Nothing written. |
| Upstream 5xx or timeout | Proxy 504 after 30s with a retry-able message. Existing snapshots untouched. |
| A page fails mid-pagination | The pager rejects; no partial batch reaches `persistOneSnapshot`. |
| Runaway pagination | Hard stop at 100,000 rows. Today's full payload is 2,826. |
| Zero matching rows | Summary modal, not an error. See step 3 above. |
| Supabase write fails | Existing behaviour: error toast, local state unchanged, so the UI never shows a snapshot that was not persisted. |
| `logActivity` fails | Already best-effort and non-throwing. Unchanged. |

## Testing

`vitest.config.ts` already includes `src/**/*.test.ts` and `api/**/*.test.ts`;
`api/_lib/ssoPortal.test.ts` is the precedent for handler tests.

**`sitesNormalize.test.ts`** — `position` `0` / `null` / `''` / negative -> `NR`,
ranked values pass through; `WWW.Rooster.BET` -> `rooster.bet`; unknown domains
dropped and tallied busiest-first; `country` mapped via `COUNTRY_LABELS` with
unmapped values preserved; empty `checked_at` inherits the batch's newest date;
`rawDate` is the newest date across a batch straddling two; six rows for one key
collapse to the newest; `change` renders `+2` / `-3` / `0`; SV / AFF / GSV come
out `''`.

**`sitesApi.test.ts`** — terminates on a short page; keeps paging when a full
page contradicts `meta.total`; a mid-pagination rejection surfaces and yields no
rows; the `MAX_ROWS` guard fires.

**`api/sites.test.ts`** — non-GET -> 405; missing key -> 500; unknown action ->
400; upstream status passed through; `limit` clamped to 1–1000; timeout -> 504.

Not covered by tests: the `App.tsx` wiring and the dev middleware. Both are
verified by running the app and syncing once.

## Ops

**Local dev.** `npm run dev` is Vite alone and does not serve `/api/*`; the
catch-all rewrite would hand the Sync button `index.html`. A `configureServer`
plugin in `vite.config.ts` mounts `/api/sites` by adapting Node's `req`/`res` to
the handler's Vercel signature, so there is one proxy implementation rather than
a dev copy free to drift. The plugin reads `SITES_API_KEY` via
`loadEnv(mode, process.cwd(), '')` and assigns it onto `process.env` before
delegating, because the handler reads it from `process.env` and Vite loads only
`VITE_`-prefixed variables there by default.

**Production.** `SITES_API_KEY` must be set in the Vercel project environment
(Production and Preview). Server-only; it must never gain a `VITE_` prefix.
`vercel.json`'s catch-all rewrite does not shadow `/api/*` — Vercel resolves
functions before rewrites.

**PMS.** One card per PR on project `cmp0w5oxq000004l2rg84dwn1`, assigned to
Ivan, created in In Progress and moved to Done on merge. Existing tasks are
listed first to avoid duplicates.

## Out of scope

- **Vercel Cron / scheduled sync.** The follow-up, once the button is trusted.
  It needs a service-role write path and cron auth, neither of which this build
  introduces.
- **Historical backfill via `action=history`.** The API can replay weekly data
  to 2026-03-30, but the dates do not necessarily line up with the "Last Check"
  dates of existing xlsx snapshots, so a backfill would produce near-duplicate
  snapshots a week apart. History accrues from the first sync forward.
- **LP Sites.** Not tracked by the API.
- **Changing or removing the xlsx import.** It stays exactly as it is,
  alongside every inline-edit affordance.
- **Search volume, global search volume and affiliate URL from the API.** Not
  supplied; carry-forward already handles them.
