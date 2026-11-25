# All-countries ranking keywords, and an honest "not ranking" label

Status: design, 2026-11-25. Part A of approach C (below). Part B, Google
Search Console, gets its own design once access exists.

## Intent

On the 2026-11-25 call, Meny (the client's boss) set two bars for this
dashboard:

1. **Show everything the sites rank for.** All keywords, all countries,
   filled in automatically, never by hand. "If it's an existing country, add
   it here [the BP brand table]; if it's a new country, put it here [the list
   under it]." "I don't care that it's going to be a list of 500 keywords."
   Ivan agreed on the call. The goal: judge whether the SEO work is good by
   seeing everything Google ranks the sites for, not only the keywords the
   team chose to track.
2. **At least 80% accurate against real Google.** He doubted the Home "Top
   Movers" climbers: fortuneplay.com, 12 keywords in Germany, "not ranking ->
   1".

Recording and transcript: `docs/references/2026-11-25/` (gitignored).

## What the investigation found (2026-11-25, live data)

- **The Ahrefs index is cheap but sparse.** Site Explorer `/metrics` for all
  36 live BP sites, all countries (one paid call each, 1,800 units in total):
  Ahrefs' index knows only **95 keyword rankings across all 36 sites; 26
  sites have none**. fortuneplay.casino shows 0 there, though the weekly Rank
  Tracker has it at #1 for 7 Italian keywords.
- **The cost.** One organic-keywords call per site with no country filter
  costs max(50, rows × 16) units. Today that is about 36 × 50 ≈ 1.8-2k a
  month, against ~11.5k for this month's per-country pull (185 calls). The
  discovery key's cap is 200k a month.
- **"Not ranking" means "not on page 1".** A sample of 70 Google pages saved
  by Rank Tracker (14 projects × 5 countries, Nov 24) found the deepest
  organic result at median position 9, never past 25 (AU median 6). Across
  all 1,511 synced cells the deepest ranking is #24, with 276 of 279 ranked
  cells in the top 10. Yet 1,232 cells say "Not in top 100". That overstates
  what Ahrefs checked.
- **The NR -> 1 climbers are in Ahrefs' own captures.** The saved German
  pages for brand searches show fortuneplay.com missing one week (Trustpilot
  #1) and #1 with sitelinks the next, and the other way round. The dashboard
  reports Ahrefs faithfully.

## Goals

- **G1.** The monthly Ahrefs pull covers every country: one call per live BP
  site, with no country filter.
- **G2.** On a BP Sites brand page:
  - keywords found in the brand's markets (`brandCountries`) appear inside
    the brand's table, visibly tagged as monthly Ahrefs-index data;
  - keywords found in any other country are listed under the table.
- **G3.** In BP weeks that came from Ahrefs, a "not ranking" cell reads "Not
  on page 1" instead of "Not in top 100".

## Non-goals

- Google Search Console (part B).
- LP Sites. Its data still comes from uploads; its label stays as it is.
- Changing the weekly Rank Tracker sync, Home, Top Movers, the stats cards or
  the assistant. Found keywords are not tracked keywords and are not counted
  there.
- Smoothing week-to-week flips in Ahrefs' captures. A possible follow-up;
  not asked for.

## Anti-goals (a failure even if it works)

- Anything manual.
- Spending past the discovery key's cap, or Ahrefs units on the rankings key
  (`ahrefsDiscovery.ts` already refuses that).
- Monthly index positions that look like weekly tracker numbers. They must
  be tagged.
- Hiding data Meny asked to see. A country outside a brand's markets
  (RoosterBet's DE included) is listed, not dropped.

## Constraints

- **Paid calls.** Each costs at least 50 units. organic-keywords costs per
  row: keyword 1, keyword_country 1, best_position 1, best_position_url 1,
  volume 10, last_update 1, best_position_kind 1 = 16. Ahrefs allows 60
  calls a minute.
- **No database migration.** Keep the existing `keyword_discovery*` tables
  (`supabase/keyword-discovery.sql`); the user runs SQL by hand.
- **Merging deploys to production.** Leo merges. The cron runs three times a
  day.
- **Retired sites** (`Brand.retiredDomains`) are never bought or shown.

## Approaches considered (chosen: C)

| | Gives | Cost | Catch |
|---|---|---|---|
| A. Ahrefs, all countries | What Ivan promised: automatic, every country | ~2k units a month, cheaper than now | Only what Ahrefs' index knows (95 rankings today) |
| B. Google Search Console | Every search and country with impressions | Free | Needs read access to each brand's GSC; positions are averages |
| **C. A now, B when access arrives** | A soon, then the complete picture | As A, then free | Two pieces of work |

The user chose C. This document is A, plus the label (G3), which serves
Meny's accuracy bar now.

Within A, storage:
- **(i) Reuse the tables, with fetch rows for country `ALL`.** Chosen: no
  migration, and the old cycles stay readable.
- (ii) A new table. Rejected: a migration for no gain.

## Design

### 1. The monthly pull (`api/cron-discovery.ts`, `api/_lib/keywordDiscovery.ts`, `api/_lib/ahrefsDiscovery.ts`, `api/_lib/discoveryStore.ts`)

- **Work list.** One target per live BP domain (36 today): brand plus
  domain, brands.ts order, with `country: 'ALL'`. It replaces the per-country
  pairs. Retired domains are excluded.
- **The request.**
  - organic-keywords with no `country` parameter (Ahrefs then returns every
    country and fills `keyword_country`);
  - `select` gains `keyword_country`;
  - `order_by=volume:desc`, mode `subdomains` as today;
  - `limit` = 200 (the largest site has 40 today). A full 200 marks the list
    as cut off, as ROWS_PER_CALL does now.
  - No `where` exclusion of tracked keywords. Rows are few, and display
    filtering already re-checks "tracked" against the newest snapshot.
- **Cost guard.**
  - Per-row units become 16.
  - The worst case per call (and the "never start a call with less left"
    threshold) becomes 200 × 16 = 3,200.
  - The over-charge stop compares the actual charge with max(50, rows × 16)
    plus the existing margin.
- **Mapping.**
  - Each row's country = `keyword_country`, uppercased.
  - Any ISO country is accepted: the country type widens from AU/CA/DE/IT/NZ
    to a string.
  - A missing `keyword_country` field is a response-shape change, which
    halts the job as today.
  - Keywords that differ only in case or spacing collapse per country to the
    best position, as today.
- **Storage.**
  - Saving an `ALL` fetch deletes the domain's `keyword_discovery` rows for
    that cycle (all countries), inserts the new rows, and upserts the fetch
    row `(cycle, domain, 'ALL')` with row_count and units.
  - The older per-country fetch rows of the same cycle stay as history.
- **The switch-over.**
  - From deploy on, the current cycle (from 2026-11-05) lacks the 36 `ALL`
    targets, so the next run buys them, about 2k units.
  - All-countries data then appears within a day of deploy, instead of
    waiting for the Dec 5 cycle. Merging approves that spend; the PR says so.
- **Unchanged.** The run lease, halt, budget, /log line and lock. The /log
  totals read "(36/36)".

### 2. Which cycle a brand page shows (`src/lib/discoveryList.ts`, `src/lib/keywordDiscovery.ts`)

- **When a cycle counts as complete for a brand:** every live domain has an
  `ALL` fetch in it. Older cycles stay readable: a cycle where every domain
  has every brand market per-country (today's rule) also counts.
- **Which data wins:** a cycle can hold both kinds (the switch-over month).
  The domain's `ALL` rows win, and its per-country rows for that cycle are
  ignored. The ALL save already deleted those rows; the rule covers reads
  made mid-switch.
- **NEW badges** keep today's rule. A country is eligible only where the
  previous cycle fetched it for every domain and no list was cut off. An
  `ALL` fetch under the 200 limit covers every country. A per-country
  previous cycle covers only its countries, so a first-seen other country is
  never NEW.

### 3. The brand page (`src/pages/BPSites.tsx`, `src/components/OtherRankingKeywords.tsx`)

The rows of the shown cycle split by country:

- **In the brand's markets (`brandCountries(brand)`): rows in the table.**
  - These are keywords not tracked for that brand and country.
  - They appear only in the latest week's table (they have no weekly
    history), below the tracked keywords.
  - A sub-header row reads "Also ranking · from Ahrefs' index, monthly · as
    of <cycle completed date>".
  - Each row is one keyword. Its cell for (site, country) shows the position
    Ahrefs' index has for that site and country.
  - A site or country with no index row shows "–" (unknown), never "Not on
    page 1".
  - No arrows or colours: there is no weekly comparison.
  - The page's Sites, Countries and keyword-search filters apply.
  - Not counted in the stats cards, card filters, position filter, Home or
    the assistant.
- **In any other country: the list under the table.**
  - It becomes "Ranking in other countries · not tracked", same columns:
    keyword, country, best site, position, search volume.
  - The country shows its code. The full name is a hover title; the builder
    may use `Intl.DisplayNames`.
  - The page's Countries chips don't apply to this list; they only hold the
    brand's markets. Keyword search does apply.
  - RoosterBet's DE appears here.
- **Both groups:** retired sites never show, and tracked keywords never
  show.
- **Section text** explains the source: Ahrefs' index, refreshed monthly,
  covers fewer keywords than Google really shows. The complete source is
  Search Console (part B).

### 4. The label (`src/components/PosBadge.tsx`, `src/pages/BPSites.tsx`)

- **Which weeks.** BP weeks that came from Ahrefs show "Not on page 1" for
  an NR cell. That is `rawDate >= 2026-11-03`: the Nov 3 week was replaced
  with Ahrefs data at the switch (PR #31). Older BP weeks (OpenSEO / Ranks
  API, checked deeper) and all of LP keep "Not in top 100".
- **Plumbing.** `PosBadge` gets the label from its caller. The BP matrix
  passes it per snapshot.
- **Explanation.** The cell's title tooltip: "Ahrefs saves Google's first
  page for each search; this site wasn't on it." The classification guide
  text (BPSites ~line 1762) says the same.
- **Parsing.** `parsePosition` also reads "not on page 1" as NR, so an
  exported table re-imports.

### 5. Docs

- `docs/integrations/ahrefs.md`:
  - the "Other ranking keywords" section: all countries, `ALL` fetch rows,
    costs, the switch-over;
  - the saved-page depth finding.
- `CLAUDE.md`: the data-flow item 5 and the key-files rows.
- The 2026-11-13 discovery spec: a pointer to this document.

## Testing

- **Unit tests (vitest, existing patterns):**
  - the target list (36, retired excluded, brands.ts order);
  - mapping with `keyword_country` (other countries accepted, a missing
    field halts);
  - the cost guard numbers;
  - `saveFetch` for `ALL` (mocked client, as in `discoveryStore.test.ts`);
  - the cron happy path and the switch-over;
  - `completeCycles` / NEW eligibility with `ALL`, legacy and mixed cycles;
  - the market / other-country split;
  - the label choice by rawDate and category;
  - parser reading "Not on page 1".
- **Before merge:** a read-only dry run of the new request shape on a free
  test target (ahrefs.com, 0 units).
- **Visual check:** local stub data, as before, for the table rows, the
  list and the label.

## Settled after the builder check

1. **No `country` parameter works.**
   - Verified 2026-11-13 and again 2026-11-25. On free target ahrefs.com,
     the request shape above (select incl. `keyword_country`, volume:desc)
     returned HTTP 200 with rows from BG, IN and US, each with
     `keyword_country`.
   - Headers: `x-api-units-cost-row: 16`, actual charge 0.
   - Fallback if Ahrefs ever rejects it: the existing response-shape halt
     stops paid calls, and /log says why.
2. **A list that fills 200 rows is not paged.**
   - The largest site has 40 rows today, so 200 is 5× headroom.
   - A full list is flagged as cut off: NEW badges are withheld for that
     site, as today, and the /log line names the site so the limit gets
     raised.
   - Ahrefs does support `offset` if paging is ever needed.
3. **Saving needs no transaction.**
   - Keep today's order: delete the domain's rows for the cycle, insert the
     new ones, and upsert the `(cycle, domain, 'ALL')` fetch row LAST.
   - A failed save leaves no ALL fetch row, so the next run retries that
     site. Its rows are missing until then.
4. **ALL supersedes per-country.** For a domain with an `ALL` fetch row in
   a cycle, its per-country fetch rows in that cycle are ignored, both for
   "complete cycle" and for NEW eligibility. Tested explicitly.
5. **The shape of found rows in the table is the matrix's own shape.**
   - One row per keyword.
   - A cell per (site, country) column, holding that site's index position
     in that country.
   - A keyword found in two markets, or by two sites, is still one row,
     with several filled cells.
   - The list under the table keeps "best site" per keyword and country, as
     today.
6. **"Tracked" is per brand + country + normalized keyword** (the existing
   `trackedIndex` / `trackedKey`). A keyword tracked in DE but found in IT
   shows in IT.
7. **Only BP Sites applies the label.**
   - The BP page passes "Not on page 1" for snapshots with
     `rawDate >= '2026-11-03'`. That page only renders `category ===
     'bp-sites'` snapshots.
   - LP Sites never passes it, so an LP upload of any date keeps "Not in top
     100".
8. **"As of" = the latest fetch time in the shown cycle**
   (`cycleCompletedAt`), as today.

## Left to the builder

- The exact styling of the "Also ranking" rows and sub-header (within the
  `--mx-*` tokens).
- Helper names and file split.
- Country display names.

## Calls made by the designer (the user can overrule)

- **Monthly cadence stays.** Index positions refresh slowly. Weekly would
  cost ~8k units a month and mostly repeat the same data.
- **The 200-row limit.**
- **The switch-over buys the current cycle at once,** ~2k units, so Meny
  sees all countries this week.
- **The "Not on page 1" wording** and the 2026-11-03 boundary.
- **Found rows only in the latest week's table.**
