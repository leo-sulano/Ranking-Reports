# Other Ranking Keywords — Design

**Date:** 2026-11-13
**Status:** Approved by the user on 2026-11-13. Updated after approval with
the probe results: the key limit is 200,000, non-organic positions are kept
and labelled, and the request shape is verified.

## Why

The client asked whether the report can show keywords their BP sites rank for
that we do not track. The tracked list is whatever the client's Ahrefs Rank
Tracker projects hold: 75 brand keywords across 23 projects (see
`2026-11-09-ahrefs-rank-sync-design.md`). Anything else the sites rank for
never reaches the dashboard. Search Console data shows how much that leaves
out: between November 2025 and May 2026, fortuneplay.io appeared for 173
searches, and 164 of them are not tracked. Examples are "fortuneplay login"
(average position 7.3) and "fortuneplay casino australia" (8.1).

Ahrefs' Site Explorer "Organic keywords" report gives, for any domain and
country, the keywords Ahrefs has seen it rank for in the top 100, with
position, ranking URL and search volume. It covers all 37 BP domains on the
Ahrefs plan the agency already pays for. It costs API units, unlike the free
Rank Tracker endpoints the rankings sync uses. The Standard plan includes
800,000 units a month, and none had been used as of 2026-11-13.

## Decided with the user (2026-11-13)

1. **Source: Ahrefs Site Explorer organic keywords.** Not Search Console, and
   not OpenSEO. The user has told the client about it.
2. **Ongoing,** not a one-off list.
3. **Monthly refresh,** because the user wants this "as free as possible".
4. **A second Ahrefs key** used only by this feature, with a monthly limit
   (planned at 150,000 units), and pay-as-you-go API units switched off for
   the workspace. The owner created it on 2026-11-13, and the API reports:
   - a limit of **200,000** units, 0 used;
   - an expiry of 2027-11-13;
   - a different key from the rankings key.

   It is in the local `.env` and not yet in Vercel.
5. **What is pulled:** up to 50 keywords per site per country, highest search
   volume first, including search volume. *(I proposed this; the user said
   "looks good".)*
6. **What the client sees** (sketch approved): a section on each brand's BP
   Sites page, under the matrix. It has one row per keyword and country,
   showing the brand's best-ranking site, its position and the search volume.
   NEW marks keywords missing from the previous month's list. It follows the
   page's Sites and Countries filters, and a keyword drops out once it is
   tracked. It shows an "As of" date and has no manual refresh. Runs are
   logged on /log.

## What was checked (2026-11-13, 0 units spent)

Everything below used free endpoints or Ahrefs' free test targets. Scratch
scripts only; nothing in the repo changed.

- **Units and keys.** `subscription-info/limits-and-usage` is free. It returned
  plan "Standard, billed monthly": 800,000 units per billing month for the
  workspace, 0 used. The rankings key (`ranking-report`) has a 10,000-unit
  limit, and usage resets on the 5th (next on 2026-12-05). Ahrefs' docs say:
  - Plans include a monthly allowance. "On plans that support pay-as-you-go
    usage, additional units are automatically charged once the included limit
    is exceeded."
  - Owners can cap pay-as-you-go or switch it off in Account settings →
    Limits & usage.
  - Each key can carry its own monthly unit limit, and a workspace can have up
    to 1,000 keys.
  - Consumed units are non-refundable.
  - The rate limit is 60 requests a minute; beyond that the API returns HTTP
    429.
- **The endpoint.** `site-explorer/organic-keywords` requires `target`, `date`
  and `select`. It also takes `country`, `where`, `order_by`, `limit` and
  `mode`.
  - A call costs max(50, per-row cost × rows).
  - The per-row cost is the sum of each unique field in `select`, `where` and
    `order_by`. Most fields cost 1 unit. `volume`, `sum_traffic` and
    `keyword_difficulty` cost 10, and `all_positions` costs 5.
- **Free test targets.** For Site Explorer these are ahrefs.com, yep.com and
  firehose.com, with `limit` capped at 100. On them, `x-api-units-cost-total`
  reports the nominal cost (65 for 5 rows at 13 units). Meanwhile
  `x-api-units-cost-total-actual` is 0 and the key's usage does not move. A
  spending guard must therefore read the `-actual` header.
- **Countries.** `country=au` (and so on) works per call. Without `country`,
  the endpoint returns every country with `keyword_country`, and a `where` on
  `keyword_country` works.
- **Freshness.** On ahrefs.com in AU, CA, DE, IT and NZ, `last_update` for
  volume-0 keywords was a median of about 23 days old. About 13% were within
  a week and about 25% were one to three months old. A weekly pull would
  mostly re-buy unchanged positions.
- **Search Console inside Ahrefs.** The `gsc/*` endpoints are free, and every
  BP project has history there, but nothing after May 2026. Only the 23 alias
  domains have projects. Not used; see Out of scope.

## Goals

- Each brand's BP Sites page lists the keywords Ahrefs sees the brand's sites
  ranking for in AU, CA, DE, IT and NZ, minus those the latest BP snapshot
  tracks for that brand and country.
- The list refreshes itself once per Ahrefs billing month, with no human step.
  It completes within about a week of the cycle starting.
- It costs no money. The worst case is about 139,000 units a cycle, inside the
  200,000 limit on its own key.
- Every run that does work leaves one line in /log. After a failure, the next
  day's run carries on without re-buying what was already saved.

## Non-goals

- **Writing to Ahrefs.** Adding a keyword to tracking stays a person's job in
  Ahrefs. The next weekly sync picks the keyword up, and it then drops out of
  this list.
- **Search Console data.**
- **Anything outside the BP brand page section:** LP Sites, mobile rankings, a
  Home page widget, the Ask AI assistant, exports, and charts of the list over
  time.
- **Extra Ahrefs metrics:** keyword difficulty, traffic estimates and SERP
  features.
- **A manual refresh button.** Every click would spend units.

## Anti-goals

These count as failures even if the feature "works":

- Any Ahrefs bill, or units spent beyond the discovery key's limit.
- The rankings sync spending units, or its "free endpoints only" guard
  (`api/_lib/ahrefs.ts`) being weakened or bypassed. The rankings key
  (`AHREFS_API_KEY`) is never used for this.
- A tracked keyword shown in the list.
- A half-fetched cycle shown as a brand's list, which would make keywords seem
  to vanish. Likewise a false NEW.
- Buying the same data twice in a cycle because a run failed or restarted.
- Another client's data in the dashboard. The job only ever queries the 37 BP
  domains in `brands.ts`, never the project list.
- The key in the browser bundle, a toast, a log line or an error message.

## Constraints

- **Ahrefs.** Calls go to base `https://api.ahrefs.com/v3` as GET requests
  with `Authorization: Bearer <key>`. The limit is 60 requests a minute. Only
  workspace owners and admins create keys, and a key dies if its creator
  leaves the workspace. Nobody on our side has an Ahrefs login.
- **The key.** A new server-only env var, `AHREFS_DISCOVERY_API_KEY`, never
  `VITE_`-prefixed. It goes in Vercel (Production and Preview) and the local
  `.env`, and the user adds it before the merge. It is never pasted into chat.
- **Vercel Hobby.**
  - A cron runs at most once a day, at any point in its hour, and a project
    can have up to 100 crons.
  - A function stops at `maxDuration` 60 s. Follow the 35 s fetch budget and
    20 s per-request timeout pattern in `api/cron-sync.ts`.
- **Supabase.**
  - Reads are for approved users only, through `public.is_approved()` (see
    `supabase/auth-approved-lockdown.sql`).
  - Server writes use the service-role client (`createAdminClient` in
    `api/_lib/snapshotStore.ts`), which bypasses RLS.
  - Schema changes ship as an idempotent SQL file that the user runs in the
    SQL editor before the merge.
  - PostgREST returns at most 1,000 rows per request; see the paging in
    `loadSnapshotRecords`.
- **ESM and the bundle.** Relative imports in `api/` need `.js` extensions;
  verify with `npx vercel build`. `api/_lib/brands.ts`, and anything else the
  browser imports, must stay free of secrets, `process.env` and `node:`
  imports.

## Approaches

The source was settled with the user first. Search Console through Ahrefs is
free and is Google's own data, but it has been stale since May 2026, and only
the 23 alias domains have projects. OpenSEO's Domain Overview spends
DataForSEO credit, and its data for these domains was too sparse. The user
picked Ahrefs organic keywords and a monthly refresh. Three ways to run it
were considered:

| Approach | Trade-off | Verdict |
|---|---|---|
| A scheduled monthly pull into Supabase, plus a section on the brand page | The most to build (tables, job, section). Units are spent once a cycle however often the page is viewed, the stored history makes NEW possible, and the page loads fast. | **Picked** |
| Fetch from Ahrefs live when someone opens a brand page | No tables, but every view spends units, the page waits on Ahrefs, and there is no NEW | Dropped: spending would follow page views |
| Add it to the Wed/Fri rankings sync | Reuses the cron, but 185 more calls do not fit its 35 s budget, weekly costs about 4× the units, and it breaks the sync's free-only guard | Dropped |

## The pull

### When it runs

- A new daily cron in `vercel.json` calls a new endpoint guarded by
  `CRON_SECRET`, as `api/cron-sync.ts` is.
- **A cycle is the Ahrefs billing month** that the key's limit counts against.
  - Each run reads `usage_reset_date` from `subscription-info/limits-and-usage`
    (free, with the discovery key). The current cycle started one month
    before that date: the next reset is 2026-12-05, so the current cycle is
    the one that started 2026-11-05.
  - Each cycle gets exactly one pull, so a pull always has the key's full
    monthly limit. *(My call. "The first days of each month" becomes "the
    first days after the 5th".)*
- **Each run:**
  - If every domain × country pair already has a fetch for the current cycle,
    return after the free limits call. Write no /log line.
  - Otherwise, fetch the missing pairs brand by brand, at most one call a
    second, until the fetch budget runs low. Never start a call the budget
    cannot finish. Then write one /log line.
- **First deploy.** If the first deploy lands mid-cycle, the first runs pull
  that cycle straight away.
- **Duration.** A full cycle is 185 calls, so at about 30 calls a run it takes
  roughly a week of daily runs. The builder may add more daily cron entries at
  other hours to finish sooner.

### One call per domain and country

- `target` is the domain (one of the 37 in `DOMAIN_TO_BRAND`; never LP
  domains). `country` is one of `au`, `ca`, `de`, `it`, `nz`, and `date` is
  today (UTC).
- `select` is
  `keyword,best_position,best_position_url,volume,last_update,best_position_kind`,
  which costs 15 units a row. (The free-target probe reported a nominal 1,500
  for 100 rows.)
- `order_by` is `volume:desc`, and `limit` is 50.
- **Tracked keywords are left out of the request.** *(My call.)* A `where`
  clause excludes the keywords the newest BP snapshot tracks for that brand
  and country, read with the service-role client.
  - The 50 rows, and the units they cost, then go to untracked keywords.
    Otherwise the brand's biggest terms would take slots only to be hidden.
  - `keyword` is already selected, so the filter adds no cost per row.
  - The browser still checks at load, for keywords tracked after the pull.
  - **Verified 2026-11-13** on the free target:
    `{"not":{"or":[{"field":"keyword","is":["eq","…"]},…]}}` removes exactly
    those keywords and still returns the full `limit`.
  - `eq` is case-sensitive, so send the keywords lowercased (Ahrefs returns
    them lowercase).
- `mode` is `subdomains`, which is the endpoint's default and is passed
  explicitly. This matches how the rankings sync counts subdomains.
- **Positions.** Any position 1–100 counts as ranking; there is no position
  cut-off. *(My call.)*
- **Non-organic best positions are kept and labelled.** *(My call,
  2026-11-13, replacing "restrict to organic".)*
  - On the free target, 31 of 100 best positions were not plain organic
    results: 29 were AI Overview citations and 2 were image results. No paid
    kinds appeared.
  - Restricting to organic would drop those keywords entirely, even when the
    site also ranks organically.
  - Instead, the row keeps `best_position_kind`, and the page shows the kind
    next to the position when it is not `organic`.
- **Cost.** 185 calls × 50 rows × 15 units = 138,750 units at most per cycle.
  The floor is 185 × 50 = 9,250, since every call costs at least 50 even when
  it returns nothing.

### Spending guards

- Before fetching, read the key's limit and usage (free). Refuse to run, and
  log why, if:
  - the key's limit is null (unlimited): "the discovery key has no unit limit";
  - the remaining units cannot cover one more worst-case call (750);
  - `AHREFS_DISCOVERY_API_KEY` equals `AHREFS_API_KEY`.
- Read `x-api-units-cost-total-actual` on every response and sum it for /log.
  If one call's actual cost exceeds its worst case (max(50, rows × 15)) by
  more than a small margin, stop the run: pricing has changed.
- Retry once on 429 (honouring `Retry-After`, capped) or on a 5xx, as
  `api/_lib/ahrefs.ts` does. Never retry a 2xx.
- A response missing the selected fields stops the run, rather than saving
  blanks.

### Saving

- Save straight after each call. Replace that pair's rows for the cycle, then
  record the fetch (cycle, domain, country, row count, units, time).
- A pair with a fetch record is never fetched again in that cycle. A pair
  without one is fetched by the next run.
- A call that returns 0 rows still gets a fetch record.
- **The site list is always the current `brands.ts`.** *(My call.)* That holds
  both for which pairs are missing and for when a brand's cycle counts as
  complete. A domain added mid-cycle is fetched by the next run. A removed
  domain is ignored, and its rows stay in the table, unused.

## Data

There are two new tables; the names are the builder's.

- **Keyword rows:** one per cycle × domain × country × keyword. Columns:
  cycle, brand, domain, country (`AU`…`NZ`, as `normalizeCountry` gives),
  keyword, position, position kind (`best_position_kind`), ranking URL,
  search volume (nullable), and the Ahrefs check date (`last_update`).
- **Fetches:** one per cycle × domain × country, unique on those three.
  Columns: rows, units, fetched_at.
- **RLS:** approved users can read. No insert, update or delete policy exists
  for any user role, so only the service role writes.
- **The SQL file** is `supabase/keyword-discovery.sql`: idempotent, with the
  same header checklist style as the existing files.
- **Retention:** keep every cycle; each one is at most 9,250 rows.

## The section on the brand page

Approved sketch (numbers illustrative):

```
FortunePlay
[ stats ]  [ Sites ▾ ]  [ AU CA DE IT NZ ]  [ keyword search ]
[ tracked keywords × weeks matrix ]

Other ranking keywords · not tracked            As of 8 Dec 2026 · from Ahrefs, monthly
Keyword                          Country  Best site          Pos  Search vol
fortuneplay login           NEW  AU       fortuneplay.io       7     1,300
fortuneplay casino australia     AU       fortuneplay.com      4       900
fortune play bonus codes         CA       fortuneplay.io      21       450
…                                                             Show all 214 ▾
```

- **Which cycle is shown.** The brand's newest cycle in which every one of its
  domains (per `brands.ts`) has a fetch for every country. While a newer
  cycle is still being pulled, the previous complete one stays up.
- **Tracked.** A keyword counts as tracked for a brand and country when the
  newest BP snapshot has a record for any of the brand's domains, in that
  country, with that keyword. The comparison ignores case and extra
  whitespace.
  - "Newest" means the newest BP snapshot overall, not the one the matrix's
    date filter shows.
  - The check runs in the browser on load, so a newly tracked keyword drops
    out after the next weekly sync, without waiting for the next pull.
- **Rows.** One row per keyword × country, among the sites selected in the
  Sites filter.
  - The best (lowest) position wins. On a tie, the main domain comes first,
    then `brands.ts` order.
  - Columns: keyword (plus NEW), country, best site, position, search volume.
    When the position kind is not `organic`, a short tag follows the position,
    for example "1 · AI Overview".
  - The ranking URL and the Ahrefs check date are reachable from the row,
    through a link or a tooltip.
- **NEW.** The keyword × country was absent for this brand in the brand's
  previous cycle. NEW is shown only for countries where that previous cycle
  has a fetch for every one of the brand's domains; otherwise there is no NEW
  for that country. The first cycle has no NEW at all.
- **Filters.** Sites, Countries and the keyword search apply. The position,
  date and stats-card filters do not.
- **Order and length.** Sort by search volume, highest first (missing volume
  last), then by position. Show 25 rows, then "Show all N".
- **Header.**
  - The title is "Other ranking keywords · not tracked".
  - Then "As of {when the brand's cycle completed} · from Ahrefs, monthly".
  - A one-line note says Ahrefs re-checks these less often than the weekly
    tracker, so a position can be a few weeks old.
- **Empty states.**
  - No complete cycle yet: say the first list arrives in the first days of
    the cycle.
  - Everything is already tracked.
  - Nothing matches the filters.
- **Loading.** When a brand page opens, load that brand's rows for its shown
  cycle and the previous one. Page past the 1,000-row cap if needed. The
  matrix must not wait on this.

## /log

- Reuse `logCronActivity` (action `sync`, section `bp-sites`) so `/log` needs
  no change. Start every line with "Keyword discovery", for example:
  - "Keyword discovery — 30 calls, 2,140 units; FortunePlay and Rollero
    complete for the cycle from 5 Nov; 125 calls left"
  - "Keyword discovery — cycle from 5 Nov complete (185/185), 46,300 units in
    total"
  - "Keyword discovery stopped: the discovery key has 400 units left this
    month"
  - "Keyword discovery failed: …"
- Write no line when there was nothing to do.
- A failed run returns a non-2xx status, so Vercel's cron log agrees with
  /log.

## Errors

Word errors for an operator, as the rankings sync does, and never include the
key:

- missing key, rejected key (401/403), or identical keys;
- no unit limit on the key, or the limit reached;
- rate-limited after the retry;
- an unexpected response shape;
- a Supabase write failure;
- the fetch budget running out.

## Files

| File | Change |
|---|---|
| New cron handler in `api/` | Auth, limits check, cycle, missing pairs, fetch loop, save, /log. Modelled on `api/cron-sync.ts`. |
| New server-only client in `api/_lib/` | The limits and organic-keywords calls, the guards, retry and timeouts. It leaves `api/_lib/ahrefs.ts`, and that file's free-only guard, untouched. |
| New browser-safe module in `api/_lib/`, re-exported from `src/lib/` | Pure logic shared by the job and the page: the cycle from the reset date, missing pairs, row mapping, cycle completeness, the tracked filter, NEW and best-site grouping. |
| `supabase/keyword-discovery.sql` | Tables, the unique constraint, indexes and RLS. |
| `vercel.json` | The daily cron entry (or entries). |
| `src/lib/` loader | Reads a brand's rows and fetches with the user's session. |
| `src/pages/BPSites.tsx` (plus any new component) | The section under the matrix. |
| `.env.example` | `AHREFS_DISCOVERY_API_KEY`, documented as server-only. |
| `docs/integrations/ahrefs.md` | A new section: endpoint, units, the key, the guards and the schedule. The folder is gitignored, so commit with `git add -f`. |
| `CLAUDE.md` | The data-flow section and the key-files table. |
| Tests | Synthetic fixtures, never the client's real data. Cover the pure logic, the client guards (the `-actual` header, a null limit, identical keys, 429), and the handler (nothing to do, resume after a partial cycle, the budget stop). |

## Verification

- `npm run build`, `npm test` and `npx vercel build` pass.
- **Before the merge, spending 0 units:**
  - A script runs the real client, using the discovery key, against a free
    test target (firehose.com, yep.com or ahrefs.com).
  - It prints the mapped rows and the cost headers, and confirms the `-actual`
    cost is 0 and the key's usage did not move.
  - The `mode` value and the `best_position_kind` question were settled by
    the probe on 2026-11-13; the script keeps the check repeatable.
- **Nothing writes to production Supabase before the merge.** The user runs
  the SQL file, and the tables start empty.
- **After the merge:**
  - The first daily runs fill the current cycle.
  - The user checks /log through the first week, and one brand page once that
    brand is complete.
  - The cycle's unit total is compared with the worst case.

## Rollout

1. **The Ahrefs owner** creates the discovery key, with a 150,000-unit
   monthly limit and an expiry like the rankings key's (2027-11-09), and
   switches off pay-as-you-go API units.
2. **The user** adds `AHREFS_DISCOVERY_API_KEY` to Vercel (Production and
   Preview) and to the local `.env`, then runs `supabase/keyword-discovery.sql`
   in the Supabase SQL editor.
3. Build on a feature branch off `main`, raise a PR, and merge after the
   user's go-ahead. Merging auto-deploys.
4. One kanban card for the PR.
5. Watch /log through the first cycle. Tell the client once their brands
   show up.

## Left to the builder

- Names of files, tables, columns and the endpoint.
- The cron hour, and whether to add more daily entries.
- The batch size within the fetch budget.
- Retry details.
- Component structure, the mobile layout, link versus tooltip for the URL, and
  the exact copy.
- Test structure.

## Out of scope

- **Search Console.** Revisit if the client reconnects it in Ahrefs and adds
  projects for the main domains: it is free and first-party.
- LP Sites.
- Writing to Ahrefs.
- Home, the assistant and exports.
- Any change to the rankings sync.
