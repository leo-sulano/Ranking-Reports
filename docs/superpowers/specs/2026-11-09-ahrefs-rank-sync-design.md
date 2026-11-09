# Ahrefs Rank Tracker Sync — Design

**Date:** 2026-11-09
**Status:** Awaiting approval. The coverage check is done and the switch-over is decided.

## Why

BP Sites rankings come from our self-hosted OpenSEO, which checks Google
through DataForSEO. A full refresh of the 1,110 BP checks (domain × keyword ×
country) costs about $15 at DataForSEO's prices, and real runs have cost up to
twice that. Almost all of it pays for proving "not in the top 100": 965 of the
1,110 checks came back not ranking on 2026-11-03. OpenSEO also needs constant
care: false "not ranking" results from filtered or empty Google pages (some
Italy and AU searches cannot be measured at all), and a fragile self-host
deploy.

The client already tracks these brands in its own Ahrefs Rank Tracker and
checks the dashboard against it, so every mismatch costs a re-check and an
explanation. Their Ahrefs plan (Standard) includes API access, and every Rank
Tracker and Management endpoint is free: the coverage check made about 160
requests and every one reported 0 API units. Reading their projects costs
nothing extra and makes the dashboard show the numbers the client sees.

## Decided with the user (2026-11-09)

1. **Source.** "Sync from API" and the scheduled sync read the client's Ahrefs
   Rank Tracker: the same Ahrefs account the client's screenshots come from.
2. **Their projects define the report.** Keywords, countries and domains are
   whatever their projects track, within the BP domains in `brands.ts`.
   Keywords only OpenSEO tracked drop out. Older snapshots stay as they are and
   will not line up keyword-for-keyword with new ones.
3. **Gaps.** Anything their Ahrefs does not track is not in the report. A
   whole brand or market missing is flagged to the client. (None is missing
   today.)
4. **Desktop only**, as today. Mobile can come later; the API serves both.
5. **LP Sites stay on manual upload.** Their Ahrefs does track LP domains in
   separate projects, so moving them is a realistic follow-up.
6. **OpenSEO.** The dashboard stops calling it and nobody runs checks there.
   The OpenSEO server stays up, idle, in case Ahrefs access breaks. Shutting
   it down is a later decision outside this repo.
7. **History.** Each record's Previous and Change come from Ahrefs' own
   previous update, so they are filled from the first sync. (The BP Sites
   arrows work differently; see "Switch-over week".)
8. **Cadence.** Ahrefs updates weekly. The Wed/Fri sync picks up the newest
   update.
9. **Order of work:** get the key (done), run the coverage check (done,
   results below), then build and ship as a PR.
10. **Switch-over: replace Nov 3.** The hand-built Nov 3 snapshot is replaced
    with Ahrefs' Nov 3 data, so every comparison from Nov 10 on is Ahrefs
    against Ahrefs. See "Switch-over".

## Coverage check results (2026-11-09)

The check was a read-only, throwaway script run with the client's key. It used
GET requests only, and every response's `x-api-units-cost-total` header read 0.

### What their Ahrefs holds

- **23 BP projects.** These are the projects whose target is a BP domain in
  `brands.ts` and that have keywords. There is one per alias domain, two or
  three per brand, and each lists the brand's other domains as competitors.
  The nine main domains (rooster.bet, spinsup.com and the rest) and five
  aliases (casinoroosters.com, casinorocketspin.com, playmojo.io,
  lucky7seven.com, lucky7evencasino.org) appear **only as competitors**.
  Five more BP-named projects have no keywords and are ignored.
- **Coverage:** all 37 BP domains, all 9 brands and all 5 countries. Every
  location is national, with one language per country (AU, CA and NZ in
  English, DE in German, IT in Italian).
- **Keywords:** 75 (6–9 per brand) against the dashboard's 54, with 51 shared.
  Following their list grows the BP report from 1,110 to about 1,535 rows: 490
  new domain × keyword × country rows, and 65 that drop out. The dropped rows
  are three keywords Ahrefs does not track: "lucky 7 even", "rooster casino"
  and "rooster.bet casino".
- **The workspace also holds other clients' projects and LP projects.** Two LP
  projects list a BP domain as a competitor.
- **Two domains outside `brands.ts`** appear as competitors in BP projects:
  spinjo.de and fortuneplaycasino.de.

### How the API behaves

Where these observations disagree with the docs, the observation wins.

| Observed | Requirement |
|---|---|
| `date` returns each keyword's latest update on or before that date | Sync with today's date |
| `date_compared` returns the update on or before that date in the same response, as `*_prev` fields, competitors included (180 of 180 competitor entries carried `position_prev`) | Previous needs no extra call |
| `competitors_list` has one entry per project slot: the target first, then the competitors in `management/project-competitors` order. A slot that does not rank is `{url: null, position: null}` | Map positions to domains by slot. All 701 ranked URLs matched their slot's domain, and slot 0 matched `overview`'s target position on 933 of 933 keywords, so `overview` is redundant |
| `serp_updated: null` means never checked (1 of 933 keyword rows). `keyword_has_data` was true everywhere | A null `serp_updated` produces no record |
| A weekly cycle: all 23 projects updated on Tuesday 2026-11-03 (10:42–20:02 UTC). A few keywords were re-checked Wed–Sun, and a few kept the previous week's check | See "Snapshot dating" |
| The largest response was 45 rows | No paging. Fail loudly if a response reaches `limit` |
| The same site appears in 2–3 projects. As of Nov 3, the projects disagreed on the same day for 136 keys: 31 on sites with their own project, 105 on competitor-only sites | See the duplicate rule |

### Agreement with today's dashboard

The dashboard's Nov 3 snapshot was checked on the same day as Ahrefs' check.
Of 1,045 shared keys:

- 916 are identical.
- 22 are within two places.
- 55 show NR on the dashboard while Ahrefs ranks them.
- 28 are the reverse: Ahrefs shows NR while the dashboard ranks them.
- 24 differ in other ways.

## Goals

- Both sync paths produce the same `SyncRecord` shape they produce today, so
  the duplicate warning, carry-forward, snapshot store and `/log` keep
  working.
- A position on the dashboard equals what the client sees in Ahrefs for the
  same site, keyword, country, device and update. For a site that is a
  project's target, that means its own project.
- No DataForSEO spend for BP Sites.

## Non-goals

- **Writing to Ahrefs.** The free Management API could add keywords,
  competitors and projects. The dashboard only ever reads. *(My call: makes
  decision 3 explicit.)*
- **Search volume, global search volume and affiliate URL from Ahrefs'
  `volume`.** Carry-forward keeps filling them. *(My call.)*
- LP Sites, mobile, backfilling history from Ahrefs, and shutting down
  OpenSEO or DataForSEO.

## Anti-goals

These count as failures even if the sync "works":

- A rank that differs from the client's Ahrefs view: a competitor shown as
  not ranking when it ranks, a ranking URL credited to the wrong domain, or a
  city or region rank reported as national.
- A keyword that has not been checked yet shown as `NR`. Unchecked is not "not
  ranking".
- The cron skipping every run, or a snapshot dated by a straggler re-check.
- A partial fetch saved as a full snapshot. One failed project fails the whole
  sync.
- Another client's data in the dashboard. The key can read the whole agency
  workspace.
- The key reaching the browser bundle, a toast, a log line or an error message.
- Any request that spends API units.

## Constraints

- **Ahrefs API.** `https://api.ahrefs.com/v3/{tool}/{endpoint}`, with the key
  sent as `Authorization: Bearer <key>`. Only workspace owners and admins
  create keys. A key reads the whole workspace, has an expiry (this one runs
  to 2027-11-09), can carry a monthly unit cap, and stops working if its
  creator leaves the workspace.
- **Nobody on our side has an Ahrefs login.** Everything about the workspace
  is learned through the API.
- **Vercel.** `maxDuration` is 60 s, and the cron has a 35 s budget for all
  upstream calls combined (`FETCH_BUDGET_MS` in `api/cron-sync.ts`). A sync
  needs about 47 free calls: the project list, plus `project-competitors` and
  `competitors-overview` for each of the 23 projects. At about 1.5 calls a
  second no 429s were seen. Handle 429 with one backed-off retry.
- **Key handling.** A server-only env var, `AHREFS_API_KEY`, never `VITE_`
  prefixed: the same pattern as `OPENSEO_RANKINGS_API_KEY`. It is already in
  the local `.env` (gitignored). The user adds it to Vercel (Production and
  Preview) before the merge. It is never pasted into chat.
- **Browser bundle.** `api/_lib/sitesNormalize.ts` ships to the browser
  (re-exported by `src/lib/sitesNormalize.ts`): no secrets, no `process.env`,
  no `node:` imports there.
- **ESM.** `api/` resolves as NodeNext: relative imports need `.js`
  extensions. Verify with `npx vercel build`.

## Endpoints

| Need | Endpoint |
|---|---|
| Projects (target in `url`, plus `mode` and `keyword_count`) | `management/projects` |
| A project's competitors, in slot order (`{url, mode}`) | `management/project-competitors?project_id=` |
| Every slot's position, current and previous | `rank-tracker/competitors-overview` with `project_id`, `device=desktop`, `date`, `date_compared`, and `select` including `keyword,location,country,language,serp_updated,serp_updated_prev,competitors_list` |

## Mapping rules

- **Which projects.** Only projects whose target is a `DOMAIN_TO_BRAND`
  domain and that have keywords. LP projects, other clients' projects and
  empty projects are skipped, even when they list a BP domain. *(My call:
  matches decision 5.)*
- **Which domains.** A project produces records only for domains of its
  target's brand. *(My call: no project crosses brands today, but a sister
  brand listed as a competitor would otherwise add its keywords to the wrong
  brand table.)* `brands.ts` stays the filter. Some domains are tallied in
  `unknownDomains` and shown in the sync summary: domains `brands.ts` does
  not know (spinjo.de and fortuneplaycasino.de today) and BP domains of
  another brand. LP domains are skipped without being listed, because they
  are known and LP stays on manual upload. Adding a domain is a separate,
  one-line change to `brands.ts`. *(My call.)*
- **Slot to domain.** Slot 0 is the target. Slot *i* is the *i*-th entry of
  `project-competitors`. Canonicalize as `canonicalDomain` does (lowercase, no
  `www.`). A subdomain counts as its domain, since every BP project uses
  Ahrefs' `subdomains` mode. A ranked URL that does not match its slot's
  domain fails the sync, because it means Ahrefs changed the ordering.
  *(My call.)*
- **Position.** A positive integer stays that number. A checked row with a
  null position becomes `NR`. A null `serp_updated` produces no record.
- **Previous and Change.** These come from the compared view, with
  `date_compared` set to 7 days before the sync's as-of date. For a weekly
  cycle, that returns the previous week's update in the same call. The
  previous check must be strictly older than the record's own check, or
  Previous is `''`. Change is signed as today (`+2` = improved).
- **Record date.** The keyword's own `serp_updated` date (UTC, `YYYY-MM-DD`).
- **Country.** Through `normalizeCountry`, so carry-forward keys still match.
  If two languages ever appear for one keyword and country, keep the market's
  main language and count the rest as skipped.
- **Duplicates.** Most sites appear in two or three projects. *(My call.)*
  - **A site with its own project** takes that project's number: what the
    client sees when they open it.
  - **A site that is only a competitor** takes the best position among that
    day's checks.
  - **Across days**, the newest check wins.

  This rule and "best position everywhere" differ on 16 cells.
- Search volume, global search volume and affiliate URL stay `''` for
  carry-forward to fill.

## Snapshot dating

These requirements are settled by the coverage check. *(My calls, within the
anti-goals.)*

- **One snapshot per weekly Ahrefs cycle.** It is dated by the cycle's main
  update day: the most common check date among records checked in the 7 days
  up to the newest check (Tuesday today; a tie goes to the later date). It is
  never dated by a straggler re-check. A sync made partway through a Tuesday
  is therefore dated with the new week, not last week. Records keep their own
  check dates.
- **Re-syncs rewrite.** A second cron or manual sync in the same cycle
  rewrites the same snapshot (same id). Manual syncs still show the duplicate
  warning, as today.
- **The 50% guard measures against the cycle date.** A sync made before the
  cycle has mostly landed is skipped by the cron and flagged in the manual
  summary, as today.
- **A hand-edited snapshot stays protected.** The cron skips it, so straggler
  re-checks later that week are not applied. This is existing behaviour, and
  accepted.
- **The cron schedule stays at Wed and Fri 04:00 UTC.** Tuesday's updates had
  finished by about 20:00 UTC.

## Switch-over (decided by the user: replace Nov 3)

BP Sites draws its movement arrows, Improved/Dropped cards and stats by
comparing each snapshot with the previous dashboard snapshot
(`crossSnapPrevPos` in `src/components/PosBadge.tsx`, and
`prevLookup`/`prevPosMap` in `src/pages/BPSites.tsx`). A record's own
Previous and Change feed only Home's Top Movers and the oldest snapshot.

So the arrows always compare Ahrefs with Ahrefs, the hand-built Nov 3 upload
(`snap-bp-sites-2026-11-03`, 1,110 records) is replaced with Ahrefs' Nov 3
cycle, which was checked the same day. The client's Nov 3 numbers change: 129
of 1,045 shared rankings, plus 490 added rows and 65 dropped. Arrows on the Nov
3 snapshot itself compare with the snapshot before it, which was already from
a different tool.

- **Before replacing**, the user runs the edited-rows SQL check in Supabase,
  as on 2026-11-05. If any value was typed by hand after the upload, stop and
  decide before replacing.
- **Keep the existing values.** Replacing must not lose the search volume,
  global search volume or affiliate URL values the Nov 3 snapshot holds. The
  builder confirms where those come from (the file or carry-forward) before
  the replace.
- **Keep the original file.** The hand-built file stays at
  `docs/references/2026-11-03/import-best-of-both-plus-recheck-bp-sites-2026-11-03.xlsx`.
  It is gitignored, so that local copy is the only one. Never delete it.
- **If the build ships before Ahrefs' Tuesday 2026-11-10 update**, the first
  manual "Sync from API" produces the Nov 3 cycle. The duplicate warning names
  the uploaded snapshot, and the user picks Replace. No extra code is needed.
- **If it ships later**, Nov 3 needs a one-off fetch as of `date=2026-11-03`,
  loaded through the same replace path or as an import-ready xlsx through
  Import Data. That is the builder's choice, with no new UI for it.
- The client gets a heads-up that Nov 3 now shows their Ahrefs numbers.

## Errors

Every message is worded for the toast and `/log`, and none carries the key or
an upstream URL.

| Case | Behaviour |
|---|---|
| `AHREFS_API_KEY` unset | 500 naming the variable; the cron logs it |
| Ahrefs rejects the key (401 or 403) | "Ahrefs rejected the key", naming the likely causes: expired, revoked, or its creator left the workspace |
| Unit cap reached, if Ahrefs ever blocks free calls at the cap | Worded so the owner knows to raise the cap |
| 5xx, 429 or timeout | One retry per request, then the whole sync fails |
| A ranked URL in the wrong slot | The whole sync fails, naming the project |
| Any project fails | The whole sync fails and nothing is written |
| No BP records | The existing "nothing to save" path |

## Files

| File | Change |
|---|---|
| `api/_lib/ahrefs.ts` | New, server-only client for projects, project-competitors and competitors-overview, with bounded concurrency, one retry and operator-worded errors. Mirrors `openseo.ts`. |
| `api/_lib/sitesNormalize.ts`, or a browser-safe sibling | The Ahrefs → `SyncRecord` mapping above. Keeps `SyncRecord`, `canonicalDomain`, and `countOlderChecks` (or its cycle-aware replacement). |
| `api/sites.ts`, `api/cron-sync.ts` | Read Ahrefs with `AHREFS_API_KEY`; messages say Ahrefs; the cron guard and dating follow "Snapshot dating". |
| `src/App.tsx`, `src/lib/sitesApi.ts`, `src/components/UploadSummary.tsx`, `src/components/DuplicateWarning.tsx`, `src/components/Sidebar.tsx` | Copy changes from OpenSEO to Ahrefs. |
| `vite.config.ts` | The dev middleware passes `AHREFS_API_KEY` instead of the OpenSEO variables. |
| `.env.example` | Documents `AHREFS_API_KEY` as server-only and drops the OpenSEO entries. |
| `api/_lib/openseo.ts`, `api/_lib/openseo.test.ts` | Deleted. *(My call.)* Git keeps them, and the fallback if Ahrefs access breaks is reverting this PR while the OpenSEO server is still up. |
| Tests | New client and mapping tests built on synthetic fixtures shaped like the observed responses (never the client's real data); `api/sites.test.ts`, `api/cron-sync.test.ts` and `src/lib/sitesApi.test.ts` updated. |
| `docs/integrations/ahrefs.md` | New: endpoints, key handling, and the observed-behaviour table above. It does not name other clients' projects. |
| `CLAUDE.md` | The data-flow section and key-files table. |

`OPENSEO_RANKINGS_API_KEY` stays in Vercel until OpenSEO is shut down; it is
unused and harmless.

## Verification

- `npm run build`, the test suite and `npx vercel build` pass.
- **Before merge, without touching real data.** A script calls the new client
  and normalizer with the real key and prints the result: record count (about
  1,535), brands, countries, the cycle date, and about 10 cells checked
  against the raw Ahrefs responses. It never clicks "Sync from API" against
  production Supabase.
- **After merge.** The user runs one manual "Sync from API" in Production and
  replaces Nov 3 as described in "Switch-over". Then the user checks the first
  scheduled run's line in `/log`.

## Rollout

1. The user approves this design, then the implementation plan.
2. Build on a feature branch off `main`, raise a PR, and merge after the
   user's go-ahead (merging auto-deploys). `AHREFS_API_KEY` must be in Vercel
   before the merge.
3. One kanban card per PR.
4. After a few weeks of clean syncs, the user decides what happens to OpenSEO
   and DataForSEO.

## Left to the builder

- Module boundaries and names, concurrency, and retry details.
- The exact `select` lists.
- How "the most common check date" and the 50% guard are computed, within
  "Snapshot dating".
- Test structure.

## Out of scope

- LP Sites and mobile.
- Writing to Ahrefs.
- Filling search volume, global search volume or affiliate URL from Ahrefs.
- History backfill beyond replacing Nov 3.
- Any change to the xlsx import or to inline editing.
- Shutting down OpenSEO.
