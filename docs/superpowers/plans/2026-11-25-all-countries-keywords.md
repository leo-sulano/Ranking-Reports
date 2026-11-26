# All-countries ranking keywords + "Not on page 1" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The monthly Ahrefs pull covers every country with one call per live
BP site. On a BP brand page, found keywords join the latest table (in-market)
or the list under it (other countries). Ahrefs-era "not ranking" cells read
"Not on page 1".

**Architecture:**
- **The pull.** Keeps its lease, halt and budget. It swaps per-country pairs
  for per-site targets, stored as fetch rows with country `ALL` (no
  migration).
- **The page.** A new `useDiscovery` hook loads one cycle for the brand
  page. Pure functions in `discoveryList.ts` split it into table rows
  (`buildFoundRows`) and the other-countries list (`buildDiscoveryList`).
- **The label.** `nrLabelFor(snapshot)` picks it, and `PosBadge` renders it.

**Tech Stack:** TypeScript, React 19, Vite, Vercel functions (`api/`, NodeNext,
`.js` import specifiers), Supabase, Vitest (`npm test` = `vitest run`).

**Spec:** `docs/superpowers/specs/2026-11-25-all-countries-keywords-design.md`
(read it first, including "Settled after the builder check").

## Global Constraints

- **The request.**
  - Endpoint `site-explorer/organic-keywords`, with no `country` parameter
    and no `where`.
  - `select` = `keyword,keyword_country,best_position,best_position_url,volume,last_update,best_position_kind`.
  - `order_by=volume:desc`, `mode=subdomains`, `limit=200`.
- **Units.** 16 per row; minimum 50 per call; worst case per call
  200 × 16 = 3,200; over-charge margin stays `COST_MARGIN_UNITS` = 50.
- **Fetch rows.** The fetch-row country for an all-countries fetch is the
  literal `'ALL'`.
- **Legacy fetches.** Per-country fetch rows were capped at 50 rows; a
  legacy row with 50 rows counts as cut off.
- **Keys.** Discovery key only (`AHREFS_DISCOVERY_API_KEY`); the rankings
  key never spends.
- **Retired sites** (`Brand.retiredDomains`) are never fetched or shown.
- **No SQL migration;** `supabase/keyword-discovery.sql` is unchanged.
- **Copy (exact):**
  - table sub-header: `Also ranking · from Ahrefs' index, monthly · as of <date>`;
  - list heading: `Ranking in other countries · not tracked`;
  - label: `Not on page 1`;
  - label tooltip: `Ahrefs saves Google's first page for each search; this site wasn't on it.`
- **Label boundary.** The label applies to BP snapshots with
  `rawDate >= '2026-11-03'` only. LP and older BP keep `Not in top 100`.
- **Paste-safe source.** Windows PowerShell 5.1 mangles UTF-8: edit with the
  Edit tool or Node, never `Set-Content`.

## Review Focus

1. **A missing country.** A row whose `keyword_country` is null or `''` is
   one odd row: skip it, never halt. A missing field (absent key) is a shape
   change: halt. Tested in Task 1.
2. **Chips vs the list.** A market country switched off in the Countries
   chips hides that country's found rows from the table. It must not move
   them into the "other countries" list. Tested in Task 2.
3. **Retired sites.** Stored discovery rows of a retired site (e.g.
   casinoroosters.com in the Nov cycle) never appear in the table or the
   list. Tested in Task 2.
4. **Tracked in one country.** A keyword tracked in one market but found in
   another shows in the other (tracked = brand + country). Tested in Task 2.
5. **The label boundary is exact.** BP 2026-11-03 gets the new label; BP
   2026-10-27 and an LP 2026-11-24 do not. Tested in Task 4.

---

### Task 1: The monthly pull fetches every country per site

**Files:**
- Modify: `api/_lib/keywordDiscovery.ts` (constants, targets, mapping; remove pairs + `excludeKeywordsWhere`)
- Modify: `api/_lib/ahrefsDiscovery.ts` (`OrganicRequest`, `fetchOrganicKeywords`)
- Modify: `api/_lib/discoveryStore.ts` (`saveFetch`; remove `loadTrackedRecords`)
- Modify: `api/cron-discovery.ts` (targets, save, summary)
- Modify: `src/lib/keywordDiscovery.ts` (re-exports follow the renames)
- Test: `api/_lib/keywordDiscovery.test.ts`, `api/_lib/ahrefsDiscovery.test.ts`, `api/_lib/discoveryStore.test.ts`, `api/cron-discovery.test.ts`

**Interfaces:**

- Produces, in `api/_lib/keywordDiscovery.ts`:
  - constants: `ALL_COUNTRIES_FETCH = 'ALL'`, `ROWS_PER_CALL = 200`,
    `LEGACY_ROWS_PER_CALL = 50`, `UNITS_PER_ROW = 16`,
    `MIN_CALL_UNITS = 50`, `WORST_CASE_CALL_UNITS = 3200`;
  - `DISCOVERY_SELECT` as in Global Constraints;
  - `DISCOVERY_COUNTRIES = ALL_COUNTRIES` (imported from `./brands.js`; kept
    for legacy cycles);
  - `interface DiscoveryTarget { brand: string; domain: string }`;
  - `discoveryTargets(brands: ReadonlyArray<{ name: string; domains: readonly string[] }>): DiscoveryTarget[]`
    (live domains lower-cased, brands.ts order);
  - `DiscoveryRow.country: string` (upper-case ISO; was `DiscoveryCountry`);
  - `mapOrganicKeywords(body: unknown, ctx: { cycle: string; brand: string; domain: string }): DiscoveryRow[]`.
- Removed (no other users after this task): `discoveryPairs`,
  `DiscoveryPair`, `DiscoveryCountry`, `excludeKeywordsWhere`,
  `loadTrackedRecords`. `pairKey`, `trackedKey`, `trackedIndex` and
  `normalizeKeyword` are unchanged.
- Produces, in `api/_lib/ahrefsDiscovery.ts`:
  `interface OrganicRequest { domain: string; date: string }`;
  `fetchOrganicKeywords(config, req, opts)` keeps its return type.
- Produces, in `api/_lib/discoveryStore.ts`:
  `saveFetch(admin, input: { cycle: string; domain: string; rows: DiscoveryRow[]; units: number }): Promise<void>`.
- Produces, in `api/cron-discovery.ts`: `runSummary` gains an optional
  `cutOff?: string[]`.

- [ ] **Step 1: Write the failing tests in `api/_lib/keywordDiscovery.test.ts`**

  Replace the `discoveryPairs` describe and delete the `excludeKeywordsWhere` tests.
  - **`discoveryTargets`:**
    - `discoveryTargets(BRANDS)` has length 36. The first is
      `{ brand: 'Lucky 7even', domain: 'lucky7even.com' }`. No
      `casinoroosters.com`. The domains equal
      `Object.keys(DOMAIN_TO_BRAND)` minus `RETIRED_DOMAINS`, sorted.
    - `discoveryTargets([{ name: 'X', domains: ['Example.COM'] }])` equals
      `[{ brand: 'X', domain: 'example.com' }]`.
  - **`mapOrganicKeywords`:** ctx `{ cycle: '2026-11-05', brand: 'RoosterBet', domain: 'rooster.bet' }`.
    - Takes each row's country from `keyword_country`, upper-cased: an `'no'`
      row gives `country: 'NO'`.
    - Collapses case/space duplicates per (keyword, country) to the best
      position. `'Rooster Bet'` and `'rooster  bet'` in `'it'` give one row;
      in `'it'` and `'au'` they give two.
    - A row with `keyword_country: null` or `''` is skipped, not thrown.
    - A row missing the `keyword_country` key throws (the shape guard).
  - **Units:** the existing mapping tests that build rows gain a
    `keyword_country`. Assert `UNITS_PER_ROW === 16`,
    `WORST_CASE_CALL_UNITS === ROWS_PER_CALL * UNITS_PER_ROW` and
    `ROWS_PER_CALL === 200`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run api/_lib/keywordDiscovery.test.ts`
  Expected: FAIL. `discoveryTargets` is not a function, and the country
  comes from ctx.

- [ ] **Step 3: Implement the `keywordDiscovery.ts` changes listed in Interfaces**

  `SELECTED_FIELDS` follows `DISCOVERY_SELECT`, so the missing-field guard
  covers `keyword_country`. The collapse key becomes
  `${normalizeKeyword(keyword)}|${country}`. Update the file header comment:
  all countries, one call per site.

- [ ] **Step 4: Write the failing tests in `api/_lib/ahrefsDiscovery.test.ts`**

  - `'asks for one domain, every country, top 200 by volume, with the discovery key'`.
    The URL has `target`, `date`, `mode=subdomains`, `select=DISCOVERY_SELECT`,
    `order_by=volume:desc` and `limit=200`, and has no `country` and no
    `where` params.
  - Delete the where-clause test.
  - `expectedMaxUnits`: `expectedMaxUnits(0) === 50`, `expectedMaxUnits(3) === 50`
    and `expectedMaxUnits(10) === 160`.

- [ ] **Step 5: Implement the `fetchOrganicKeywords` change**

  The params are as in Global Constraints. The error subject is the domain
  alone.

- [ ] **Step 6: Write the failing tests in `api/_lib/discoveryStore.test.ts`**

  - **`'replaces the site's rows for the cycle in every country, then records an ALL fetch last'`:**
    - The delete chain is exactly
      `[['eq',['cycle','2026-11-05']],['eq',['domain','rooster.bet']]]`,
      with no country filter.
    - Then the insert chunks.
    - Then an upsert on `keyword_discovery_fetches` with
      `{ cycle, domain, country: 'ALL', row_count, units, fetched_at }` and
      `{ onConflict: 'cycle,domain,country' }`.
  - Keep the "rows failed", "clearing failed" and "nothing returned" cases,
    adapted to the new input.
  - Delete the `loadTrackedRecords` tests.

- [ ] **Step 7: Implement `saveFetch` and remove `loadTrackedRecords`**

  The error text drops the country: `Could not save keyword discovery for <domain>: …`.

- [ ] **Step 8: Write the failing tests in `api/cron-discovery.test.ts`**

  - **The harness:**
    - `ROW` gains `keyword_country: 'au'`.
    - `onlyMissing(domains: string[])` marks every other target's
      `pairKey(domain,'ALL')` as fetched.
    - Drop `loadTrackedRecords` from the store mock.
  - **`'fetches only the missing sites, every country at once, and finishes the cycle'`:**
    - With `onlyMissing(['spinsup.com','spinsup.io'])`, the organic calls
      target those two, in that order, with no `country` param.
    - `saveFetch` is called with `{ cycle:'2026-11-05', domain:'spinsup.com', units:65, rows:[{… country:'AU' …}] }`.
    - The /log line reads
      `Keyword discovery — cycle from Nov 5, 2026 complete (36/36), 46,300 units in total`.
  - **`'names sites whose list hit the 200-keyword limit'`:**
    - A response with 200 rows, charged 3,200, finishing a 1-site cycle that
      is still in progress.
    - The progress /log line contains `; spinsup.com hit the 200-keyword limit`.
  - **`runSummary`:** given `cutOff: ['a.com','b.com']`, the progress line
    contains `; a.com and b.com hit the 200-keyword limit`.
  - **The remaining run, halt and lock tests** keep passing after mechanical
    edits: pairs become targets, and "units left" thresholds use 3,200.

- [ ] **Step 9: Implement the cron changes**

  - `all = discoveryTargets(BRANDS)`.
  - Missing targets are those whose `pairKey(domain, ALL_COUNTRIES_FETCH)`
    is not in `loadFetchedPairs`.
  - No tracked load and no `excludeWhere`.
  - Save with the new `saveFetch` input.
  - Collect `cutOff` when `response.rowCount >= ROWS_PER_CALL`, and pass it
    to `runSummary`.
  - `runSummary` inserts `; ${listOf(cutOff)} hit the 200-keyword limit`
    after the calls/units part of a progress line.
  - The header comment says one call per live site, every country.

- [ ] **Step 10: Run the whole suite and the type-check**

  Run: `npx vitest run` and `npx tsc -p tsconfig.api.json --noEmit` and `npm run build`
  Expected: all pass. `src/lib/keywordDiscovery.ts` re-exports compile (drop
  any removed names).

- [ ] **Step 11: Dry-run the real request shape on a free target**

  Write a scratchpad script (outside the repo) that calls
  `fetchOrganicKeywords(discoveryConfig(env), { domain: 'ahrefs.com', date: <today> })`,
  then `mapOrganicKeywords`. It must print `unitsActual === 0` and at least
  one row with a non-AU/CA/DE/IT/NZ country. Run from the repo root with
  `npx tsx`.

- [ ] **Step 12: Commit**

  ```bash
  git add api/_lib/keywordDiscovery.ts api/_lib/keywordDiscovery.test.ts api/_lib/ahrefsDiscovery.ts api/_lib/ahrefsDiscovery.test.ts api/_lib/discoveryStore.ts api/_lib/discoveryStore.test.ts api/cron-discovery.ts api/cron-discovery.test.ts src/lib/keywordDiscovery.ts
  git commit -m "feat(discovery): one Ahrefs call per site, every country"
  ```

### Task 2: Shape one cycle into table rows and an other-countries list

**Files:**
- Modify: `src/lib/discoveryList.ts`
- Create: `src/lib/useDiscovery.ts` (the loader effect moved out of `OtherRankingKeywords.tsx`)
- Test: `src/lib/discoveryList.test.ts`

**Interfaces:**

- Consumes: `DiscoveryRow`, `ROWS_PER_CALL`, `LEGACY_ROWS_PER_CALL`,
  `ALL_COUNTRIES_FETCH`, `DISCOVERY_COUNTRIES`, `normalizeKeyword` and
  `trackedKey` (Task 1); `brandCountries` (`src/lib/brands.ts`).
- Produces, in `src/lib/discoveryList.ts`:
  - `completeCycles(brandDomains, fetches, countries = DISCOVERY_COUNTRIES): string[]`.
    A domain is complete in a cycle when it has an `ALL` fetch, or (legacy)
    a fetch for every one of `countries`.
  - `newEligibility(prevCycle: string | null, brandDomains: readonly string[], fetches: readonly DiscoveryFetchInfo[]): (country: string) => boolean`.
    This replaces `newEligibleCountries`. A domain covers country C when it
    has an `ALL` fetch in `prevCycle` with `rowCount < ROWS_PER_CALL`. With
    no `ALL` fetch, it covers C when it has a C fetch with
    `rowCount < LEGACY_ROWS_PER_CALL`. An `ALL` fetch makes the domain's
    per-country fetches in that cycle irrelevant. Eligible means every
    domain covers C. A null `prevCycle` means never eligible.
  - `buildDiscoveryList(input)`: `countries: readonly string[]` becomes
    `country: (code: string) => boolean`, and `newEligible: ReadonlySet<string>`
    becomes `newEligible: (country: string) => boolean`. Everything else is
    unchanged.
  - `interface FoundCell { position: number; positionKind: string | null; url: string; ahrefsChecked: string | null }`.
  - `interface FoundRow { keyword: string; volume: number | null; cells: Record<string, Record<string, FoundCell>> }`.
    The outer key is the lower-case domain, the inner key the country.
  - `buildFoundRows(input: { rows: readonly DiscoveryRow[]; tracked: ReadonlyMap<string, ReadonlySet<string>>; brand: { name: string; domains: readonly string[] }; countries: readonly string[]; kwFilter: string; kwExact: boolean }): FoundRow[]`.
    It keeps rows that:
    - are in `brand.domains`;
    - have a country in `countries`;
    - are not tracked for `trackedKey(brand.name, country)`;
    - match the keyword search (same matching as the list).

    It groups by normalized keyword. A cell keeps the best position for its
    (domain, country). `volume` is the max of the group. Sort: volume desc
    (null last), then the best position anywhere, then the keyword.
- Produces, in `src/lib/useDiscovery.ts`:
  - `type DiscoveryLoad = { status: 'loading' } | { status: 'error' } | { status: 'ready'; shown: string | null; completedAt: string | null; rows: DiscoveryRow[]; prevRows: DiscoveryRow[]; newEligible: (country: string) => boolean }`.
  - `useDiscovery(brand: Brand): DiscoveryLoad`: the current
    `OtherRankingKeywords` effect, calling
    `completeCycles(brand.domains, fetches, brandCountries(brand))`.

- [ ] **Step 1: Write the failing tests in `src/lib/discoveryList.test.ts`**

  The existing tests are adapted: Set → predicate, `countries` → `country`.
  - **`completeCycles`:**
    - `'counts a cycle where every site has an ALL fetch'`.
    - `'counts a mixed cycle: one site ALL, the other every country'`.
    - `'does not count a cycle where one site has neither'`.
  - **`newEligibility`:**
    - An uncut `ALL` prev cycle for both sites makes `'NO'` and `'AU'`
      eligible.
    - An `ALL` with `rowCount` 200 on one site makes nothing eligible.
    - A legacy prev cycle (per-country, all < 50) makes `'AU'` eligible and
      `'NO'` not.
    - A site with both a cut legacy `AU` fetch (50 rows) and an uncut `ALL`
      fetch in the same cycle makes `'AU'` eligible (ALL supersedes).
  - **`buildFoundRows`, with brand `{ name:'RoosterBet', domains:['rooster.bet','roosters.bet'] }` and `countries:['AU','IT']`:**
    - Rows for (rooster.bet, AU, 'rooster bet login', 2) and (roosters.bet,
      IT, 'Rooster Bet Login', 4) give ONE row, with
      `cells['rooster.bet'].AU.position === 2` and
      `cells['roosters.bet'].IT.position === 4`.
    - A row in `'NO'` is excluded.
    - A row on `casinoroosters.com` is excluded (Review Focus 3).
    - `'rooster casino'`, tracked for `RoosterBet|IT`, is excluded in IT but
      kept in AU (Review Focus 4).
    - `countries: ['AU']` drops the IT cell (Review Focus 2, table side).
    - `kwFilter: 'login'` keeps only matches.
    - Sorted by volume desc.
  - **`buildDiscoveryList` with `country: (c) => !['AU','CA','IT','NZ'].includes(c)`:**
    - A `'DE'` row and a `'NO'` row are listed.
    - An `'IT'` row is not listed, even if the page's chips would hide IT
      (Review Focus 2, list side).

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/lib/discoveryList.test.ts`
  Expected: FAIL. `buildFoundRows` and `newEligibility` are undefined, and
  ALL cycles are not complete.

- [ ] **Step 3: Implement the `discoveryList.ts` changes, and create `useDiscovery.ts`**

  - The hook body is the existing effect moved verbatim, plus the
    `brandCountries` argument and `newEligibility`.
  - Keep `OtherRankingKeywords.tsx` behaving exactly as today: it calls
    `useDiscovery(brand)` instead of its own effect, and passes
    `country: (c) => countries.includes(c)` (its existing `countries` prop).
    Task 3 changes what it shows.

- [ ] **Step 4: Run the tests and the build**

  Run: `npx vitest run src/lib/discoveryList.test.ts`, then `npm run build`
  Expected: both pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/discoveryList.ts src/lib/discoveryList.test.ts src/lib/useDiscovery.ts src/components/OtherRankingKeywords.tsx
  git commit -m "feat(discovery): split a cycle into in-market table rows and other countries"
  ```

### Task 3: Show found keywords in the table and other countries under it

**Files:**
- Modify: `src/pages/BPSites.tsx` (`BrandView`: load and derive; `SnapshotMatrix`: render the found rows)
- Modify: `src/components/OtherRankingKeywords.tsx` (becomes presentational: other countries only)

**Interfaces:**

- Consumes: `useDiscovery`, `DiscoveryLoad`, `buildFoundRows`, `FoundRow`
  and `buildDiscoveryList` (Task 2); `trackedIndex` and `DOMAIN_TO_BRAND`;
  `formatDisplayDate` (`src/lib/parser`).
- Produces:
  - `SnapshotMatrix` gains the prop
    `found: { rows: FoundRow[]; asOf: string | null } | null`.
  - `OtherRankingKeywords` props become
    `{ brand: Brand; discovery: DiscoveryLoad; trackedRecords: readonly RankingRecord[]; kwFilter: string; kwExact: boolean }`.
    The `countries` prop is gone.

- [ ] **Step 1: Wire `BrandView`**

  - Call `const discovery = useDiscovery(brand)` once.
  - Compute `tracked = trackedIndex(latestSnap?.records ?? [], DOMAIN_TO_BRAND)`.
  - Compute `foundRows` with `buildFoundRows({ rows: ready ? discovery.rows : [], tracked, brand, countries: visibleCountries, kwFilter, kwExact })`.
  - Pass `found = { rows: foundRows, asOf: discovery.completedAt }` only to
    the latest snapshot's `SnapshotMatrix`. Pass it only when
    `posFilter === 'all' && cardFilter === null` and the load is ready;
    otherwise pass `null`.
  - Pass `discovery` to `OtherRankingKeywords`.

- [ ] **Step 2: Render the found rows in `SnapshotMatrix` after the tracked rows**

  - **When it renders:** only when `found` is set and `found.rows.length > 0`.
  - **Sub-header row:** one `<td colSpan={1 + groups.length * colsPerGroup}>`
    with the exact sub-header copy. The date is
    `formatDisplayDate(asOf.slice(0, 10))`; drop ` · as of <date>` when
    `asOf` is null. Muted text on `--mx-bg`; the keyword column stays
    sticky.
  - **One `<tr>` per `FoundRow`:**
    - the keyword cell is styled like a tracked keyword but not bold;
    - per group and visible country, the cell shows
      `cells[g.dk]?.[c]?.position`, else `–`;
    - the same `pinStyle` and borders as tracked cells, with no arrows or
      colours;
    - the cell `title` is `url` plus `· Ahrefs checked <date>` when
      `ahrefsChecked` is set.
  - These rows are not counted anywhere: the stats, cards and Home use
    tracked records only, and nothing changes there.

- [ ] **Step 3: Rework `OtherRankingKeywords`**

  - **The list.** Delete the effect; use the `discovery` prop.
    - `markets = brandCountries(brand)`.
    - The list is `buildDiscoveryList({ …, country: (c) => !markets.includes(c), kwFilter, kwExact })`.
    - `untrackedTotal` uses the same predicate with no search.
  - **Heading and intro text.**
    - The heading is the exact list copy.
    - The intro: "Countries outside this brand's markets where Ahrefs' index
      shows its sites, the main site included, in Google's top 100, and the
      keywords aren't tracked. From Ahrefs' index, refreshed monthly. It
      knows fewer keywords than Google really shows; Google Search Console
      is the complete source."
  - **The country cell** renders the code with `title` =
    `new Intl.DisplayNames(['en'], { type: 'region' }).of(code)`, falling
    back to the code if that throws.
  - **Empty states.**
    - No cycle yet: keep today's copy.
    - Nothing anywhere (`untrackedTotal === 0`): "Ahrefs' index shows no
      rankings in other countries for these sites."
    - Search hides everything: "Nothing matches the search."

- [ ] **Step 4: Run the suite and the build**

  Run: `npx vitest run` and `npm run build`
  Expected: all pass.

- [ ] **Step 5: Commit the real change**

  ```bash
  git add src/pages/BPSites.tsx src/components/OtherRankingKeywords.tsx
  git commit -m "feat(bp-sites): found keywords join the table; other countries listed under it"
  ```

- [ ] **Step 6: Visual check, then drop the stub**

  - **Stub (never committed).** Snapshots are stubbed in `App.tsx`'s load
    `.then`, as in the 2026-11-25 RoosterBet check. `useDiscovery` returns a
    ready stub with RoosterBet rows in AU, IT, DE and NO, plus one on
    casinoroosters.com.
  - **Run.** `npx vite --port 5179 --strictPort`, then open
    `/bp-sites/roosterbet?site=all` with Playwright.
  - **Expected:**
    - the latest table shows the sub-header and the AU/IT found rows with
      `–` gaps;
    - the list shows DE and NO;
    - casinoroosters.com appears nowhere;
    - switching the IT chip off removes the IT cells but doesn't add IT to
      the list.
  - **Clean up.** Then `git checkout src/App.tsx src/lib/useDiscovery.ts`
    and confirm `git status` shows no changes.

### Task 4: "Not on page 1" for Ahrefs-era BP weeks

**Files:**
- Create: `src/lib/nrLabel.ts`
- Modify: `src/components/PosBadge.tsx`, `src/pages/BPSites.tsx` (matrix cell + classification guide ~line 1762), `src/lib/parser.ts` (`parsePosition`)
- Test: `src/lib/nrLabel.test.ts`, `src/lib/parser.test.ts`

**Interfaces:**

- Produces:
  - `AHREFS_FIRST_WEEK = '2026-11-03'`.
  - `interface NrLabel { text: string; title?: string }`.
  - `nrLabelFor(snapshot: { rawDate: string; category?: string }): NrLabel`.
  - `PosBadge` gains the optional prop `nrLabel?: NrLabel`. The default
    text is `Not in top 100`, with no title.

- [ ] **Step 1: Write the failing tests**

  `nrLabel.test.ts` (Review Focus 5):
  - `nrLabelFor({ rawDate: '2026-11-03', category: 'bp-sites' })` equals
    `{ text: 'Not on page 1', title: <exact tooltip> }`;
  - `'2026-11-24'` (BP) gives the same;
  - `'2026-10-27'` (BP) gives `{ text: 'Not in top 100' }`;
  - `{ rawDate: '2026-11-24', category: 'lp-sites' }` gives
    `{ text: 'Not in top 100' }`.

  `parser.test.ts`:
  - `parsePosition('Not on page 1') === 'NR'` and
    `parsePosition('not on page 1') === 'NR'`.

- [ ] **Step 2: Run them to see them fail**

  Run: `npx vitest run src/lib/nrLabel.test.ts src/lib/parser.test.ts`
  Expected: FAIL. The module is missing, and the parser returns null.

- [ ] **Step 3: Implement the label**

  - Implement `nrLabel.ts`.
  - `PosBadge` renders `nrLabel.text` with `title={nrLabel.title}` for NR.
  - `SnapshotMatrix` passes `nrLabel={nrLabelFor(snapshot)}`.
  - The guide condition reads: Position is "Not on page 1" (weeks from Nov
    3, 2026 on; earlier weeks say "Not in top 100").
  - `parsePosition` accepts `not on page 1`.
  - LP Sites passes nothing.

- [ ] **Step 4: Run the suite and the build**

  Run: `npx vitest run` and `npm run build`
  Expected: all pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/nrLabel.ts src/lib/nrLabel.test.ts src/components/PosBadge.tsx src/pages/BPSites.tsx src/lib/parser.ts src/lib/parser.test.ts
  git commit -m "feat(bp-sites): 'Not on page 1' for Ahrefs-era weeks"
  ```

### Task 5: Docs, verification, PR

**Files:**
- Modify: `docs/integrations/ahrefs.md` (tracked inside a gitignored folder: `git add` exits 1 with an advisory, so never chain a commit after it); `CLAUDE.md`; `docs/superpowers/specs/2026-11-13-other-ranking-keywords-design.md` (a one-line pointer to the new spec)

- [ ] **Step 1: Update the docs**

  - **`ahrefs.md`, "Other ranking keywords" section:**
    - one call per live site, every country, fetch rows `ALL`;
    - 16 units a row, worst case 3,200;
    - the switch-over (the first run after deploy buys the current cycle,
      ~2k units);
    - the /log cut-off note.
  - **`ahrefs.md`, a "Saved page depth" note:** a median of 9 organic
    results, max 25 (70 pages, 2026-11-24), so the label reads "Not on page
    1".
  - **`CLAUDE.md`:** data-flow item 5 and the key-files rows for
    `cron-discovery.ts`, `keywordDiscovery.ts` and
    `OtherRankingKeywords.tsx`.

- [ ] **Step 2: Full verification**

  Run: `npx vitest run`, `npm run build` and `npx tsc -p tsconfig.api.json --noEmit`
  Expected: all green. Then run the Task 1 dry-run script once more: 0
  units, other-country rows.

- [ ] **Step 3: Commit the docs, push, and open the PR**

  - **Push.** Push `feat/all-countries-keywords`.
  - **Open the PR** with
    `GH_TOKEN=$(gh auth token --user optinet-solutions-sandbx) gh pr create --repo leo-sulano/Ranking-Reports --base main`.
  - **The PR body** says merging approves the switch-over spend: about 2k
    discovery units at the next cron run.
  - **Kanban.** Create the card in In Progress (project
    `cmp0w5oxq000004l2rg84dwn1`).
  - **Review.** Request an opus whole-branch review before Leo merges.

- [ ] **Step 4: After Leo merges**

  - Confirm the Production deploy.
  - With the user's go-ahead (it spends units), the cron's next run
    (05:00/11:00/17:00 UTC) or one manual
    `GET /api/cron-discovery` buys the 36 sites.
  - The /log line should end `(36/36)`. Key usage should rise by about 2k.
  - Move the card to Done.
