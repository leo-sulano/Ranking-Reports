# Other Ranking Keywords Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each brand's BP Sites page lists the keywords Ahrefs sees the
brand's sites ranking for in AU/CA/DE/IT/NZ that the report does not track.
The list refreshes once per Ahrefs billing month, through a daily cron that
spends units only through its own capped key.

**Architecture:**
- A daily Vercel cron (`api/cron-discovery.ts`) reads the discovery key's
  limits (free) and derives the current Ahrefs billing cycle.
- It fetches the domain × country pairs not yet fetched this cycle from
  `site-explorer/organic-keywords`: one call per pair, with tracked keywords
  excluded in `where`. Each pair is saved to Supabase as soon as it is
  fetched.
- When a brand page opens, it loads the brand's newest complete cycle and
  the previous one, then builds the list in the browser, re-checking
  "tracked" against the newest BP snapshot.
- Pure logic lives in a browser-safe module shared by the cron and the page.

**Tech Stack:** TypeScript, Vercel Node functions (`@vercel/node`), Supabase
(`@supabase/supabase-js`, Postgres + RLS), React 18 + Tailwind v4, Vitest
(node environment, no DOM).

**Spec:** `docs/superpowers/specs/2026-11-13-other-ranking-keywords-design.md`

## Global Constraints

- **Discovery key.** `AHREFS_DISCOVERY_API_KEY` is server-only and never
  `VITE_`-prefixed. It never appears in the bundle, a log line, a toast or an
  error message. Its Ahrefs monthly limit is 200,000 units (verified
  2026-11-13).
- **Rankings key.** `AHREFS_API_KEY` is never used for discovery, and
  `api/_lib/ahrefs.ts` is not modified (importing its exports is fine).
- **Domains.** Only the 37 BP domains in `BRANDS[].domains`
  (`api/_lib/brands.ts`). Never LP domains, and never `management/projects`.
- **Countries.** `AU, CA, DE, IT, NZ`: stored upper-case, sent to Ahrefs
  lower-case.
- **Request.**
  - Endpoint `site-explorer/organic-keywords`, with `mode=subdomains`,
    `order_by=volume:desc`, `limit=50` and `date` = today (UTC).
  - `select=keyword,best_position,best_position_url,volume,last_update,best_position_kind`,
    which costs 15 units a row.
  - Tracked keywords are excluded through `where`:
    `{"not":{"or":[{"field":"keyword","is":["eq","<lower-case keyword>"]},…]}}`.
- **Units.**
  - Every call costs at least 50 units; the worst case is 750 per call and
    138,750 per cycle.
  - Never start a call with fewer than 750 units left on the key.
  - Charge by `x-api-units-cost-total-actual`.
- **Rate limit.** Ahrefs allows 60 requests a minute, so call starts are at
  least 1,000 ms apart.
- **Vercel.** `maxDuration` is 60, and a cron runs at most once a day.
- **Code rules.**
  - Relative imports in `api/` end in `.js`.
  - `api/_lib/keywordDiscovery.ts` ships to the browser: no `process.env`, no
    `node:` imports, no secrets.
- **Supabase.** Approved users read through RLS `public.is_approved()`; only
  the service role writes.
- **Tests.** Synthetic fixtures only, never the client's real keywords.
- **Copy.**
  - Section title: `Other ranking keywords · not tracked`.
  - Subtitle: `As of {date} · from Ahrefs, monthly`.
  - Every /log line from this job starts with `Keyword discovery`.

## Review Focus

1. **A tracked keyword written differently** (case, double spaces, a
   decomposed umlaut) must not show in the list. Tests: Task 1
   (`normalizeKeyword` NFC) and Task 5 (tracked `SpinsUp  Login`).
2. **One odd Ahrefs row** (a null `best_position` or a blank keyword) must
   not fail the same pair every day and stall the cycle. Test: Task 1, where
   such rows are skipped and only an absent field throws.
3. **A response without the `-actual` header** must never count as free.
   Test: Task 2, which falls back to the nominal header and then to the worst
   case.
4. **Missing discovery tables (SQL not yet run) or a load error** must not
   break the BP page. Covered by the Task 5 loader's prefixed error, and by
   Task 6, which shows one muted line while the matrix still renders (checked
   in its visual step).
5. **A second run on the same day** (a manual trigger from Vercel plus the
   schedule) must not re-buy pairs that are already saved. Test: Task 4,
   where pairs returned by `loadFetchedPairs` are never requested.

---

### Task 1: Shared discovery logic

**Files:**
- Create: `api/_lib/keywordDiscovery.ts`
- Test: `api/_lib/keywordDiscovery.test.ts`

**Interfaces:**
- Consumes: `BRANDS`, `DOMAIN_TO_BRAND`, `LP_DOMAIN_TO_BRAND` from `./brands.js` (the last only in tests).
- Produces:

```ts
export const DISCOVERY_COUNTRIES = ['AU', 'CA', 'DE', 'IT', 'NZ'] as const
export type DiscoveryCountry = (typeof DISCOVERY_COUNTRIES)[number]
export const ROWS_PER_CALL = 50
export const UNITS_PER_ROW = 15
export const MIN_CALL_UNITS = 50
export const WORST_CASE_CALL_UNITS = 750
export const DISCOVERY_SELECT = 'keyword,best_position,best_position_url,volume,last_update,best_position_kind'
export interface DiscoveryPair { brand: string; domain: string; country: DiscoveryCountry }
export interface DiscoveryRow {
  cycle: string; brand: string; domain: string; country: DiscoveryCountry; keyword: string
  position: number; positionKind: string | null; url: string; volume: number | null; ahrefsChecked: string | null
}
export function discoveryPairs(brands: ReadonlyArray<{ name: string; domains: readonly string[] }>): DiscoveryPair[]
export function pairKey(domain: string, country: string): string            // 'spinsup.com|AU'
export function cycleStart(usageResetDate: string): string                   // 'YYYY-MM-DD'
export function normalizeKeyword(keyword: string): string
export function mapOrganicKeywords(body: unknown,
  ctx: { cycle: string; brand: string; domain: string; country: DiscoveryCountry }): DiscoveryRow[]
export function trackedKey(brand: string, country: string): string          // 'SpinsUp|AU'
export function trackedIndex(records: ReadonlyArray<{ domain: string; keyword: string; country: string }>,
  domainToBrand: Readonly<Record<string, string>>): Map<string, Set<string>>
export function excludeKeywordsWhere(keywords: Iterable<string>): string | undefined
```

- [ ] **Step 0: Create the branch and commit the spec and this plan**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/other-ranking-keywords
git add docs/superpowers/specs/2026-11-13-other-ranking-keywords-design.md docs/superpowers/plans/2026-11-13-other-ranking-keywords.md
git commit -m "docs: other ranking keywords design and plan"
```

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment node`)
  - `discoveryPairs(BRANDS)`:
    - It has length 185.
    - The first five are `{brand: 'Lucky 7even', domain: 'lucky7even.com'}`
      with `AU`, `CA`, `DE`, `IT`, `NZ` in that order.
    - Every domain is a key of `DOMAIN_TO_BRAND` and none is a key of
      `LP_DOMAIN_TO_BRAND`. Every domain is lower-case.
  - `pairKey('SpinsUp.com', 'au')` → `'spinsup.com|AU'`.
  - `cycleStart`:
    - `'2026-12-05T00:00:00Z'` → `'2026-11-05'`;
      `'2027-01-05T00:00:00Z'` → `'2026-12-05'`.
    - `'2026-03-31T00:00:00Z'` → `'2026-02-28'`;
      `'2024-03-30T00:00:00Z'` → `'2024-02-29'`.
    - `'not a date'` throws.
  - `normalizeKeyword`:
    - `'  Lucky 7even   Casino '` → `'lucky 7even casino'`.
    - `normalizeKeyword('spielbank münchen') === normalizeKeyword('spielbank münchen')`.
  - `mapOrganicKeywords`, with ctx
    `{cycle: '2026-11-05', brand: 'SpinsUp', domain: 'spinsup.com', country: 'AU'}`:
    - Input row: `{keyword: 'spinsup login', best_position: 3,
      best_position_url: 'https://spinsup.com/login', volume: 900,
      last_update: '2026-11-01T10:00:00Z', best_position_kind: 'organic'}`.
      Expected: `{cycle: '2026-11-05', brand: 'SpinsUp', domain: 'spinsup.com',
      country: 'AU', keyword: 'spinsup login', position: 3,
      positionKind: 'organic', url: 'https://spinsup.com/login', volume: 900,
      ahrefsChecked: '2026-11-01T10:00:00Z'}`.
    - Null `volume`, `best_position_url`, `last_update` and
      `best_position_kind` become `volume: null`, `url: ''`,
      `ahrefsChecked: null` and `positionKind: null`.
    - A row with `best_position: null` is skipped, and so is a row with
      `keyword: '  '`.
    - `'SpinsUp Login'` (position 9) and `'spinsup login'` (position 3)
      collapse to one row, at position 3.
    - These each throw
      `/unexpected organic-keywords response for spinsup.com \(AU\)/`: `{}`,
      `{keywords: 'x'}`, and a row with no `best_position` key.
  - `trackedIndex([{domain: 'spinsup.io', keyword: 'SpinsUp  Casino', country: 'au'},
    {domain: 'unknown.com', keyword: 'x', country: 'AU'}], DOMAIN_TO_BRAND)`
    returns a map whose only key is `'SpinsUp|AU'`, holding `'spinsup casino'`.
  - `excludeKeywordsWhere`:
    - `[]` → `undefined`.
    - `['Rooster Casino', 'rooster casino', 'rooster.bet']` →
      `'{"not":{"or":[{"field":"keyword","is":["eq","rooster casino"]},{"field":"keyword","is":["eq","rooster.bet"]}]}}'`.

- [ ] **Step 2: Run them; expect failure**

  Run: `npx vitest run api/_lib/keywordDiscovery.test.ts`. Expected: FAIL,
  because `./keywordDiscovery.js` cannot be resolved.

- [ ] **Step 3: Implement `api/_lib/keywordDiscovery.ts`**
  - Header comment: this file ships in the browser bundle, under the same
    rules as `brands.ts`.
  - `cycleStart`: take the reset date's UTC year, month and day, step back
    one calendar month, and clamp the day to that month's length.
  - `mapOrganicKeywords`: if any selected key is missing from a row, throw.
    Null and blank values follow the tests. When duplicates share a
    `normalizeKeyword` form, keep the lowest position.
  - `excludeKeywordsWhere`: unique normalized keywords, sorted.
  - `normalizeKeyword`: NFC, then trim, lower-case, and collapse whitespace.

- [ ] **Step 4: Run them; expect a pass** (same command).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/keywordDiscovery.ts api/_lib/keywordDiscovery.test.ts
git commit -m "feat(discovery): shared logic for other ranking keywords"
```

---

### Task 2: Ahrefs discovery client and the free-target check

**Files:**
- Create: `api/_lib/ahrefsDiscovery.ts`, `api/_lib/ahrefsDiscovery.test.ts`, `scripts/ahrefs-discovery-check.mts`
- Modify: `.env.example`

**Interfaces:**
- Consumes:
  - `AHREFS_API_BASE` and `isAbortLike` from `./ahrefs.js`.
  - Task 1: `DISCOVERY_SELECT`, `ROWS_PER_CALL`, `UNITS_PER_ROW`,
    `MIN_CALL_UNITS`, `DiscoveryCountry`.
- Produces:

```ts
export const DISCOVERY_KEY_REJECTED =
  'Ahrefs rejected the discovery key — check AHREFS_DISCOVERY_API_KEY on the server (it may have expired or been revoked, or its creator left the Ahrefs workspace)'
export const COST_MARGIN_UNITS = 50
export class DiscoveryError extends Error { readonly status?: number }
export interface DiscoveryConfig { key: string }
export function discoveryConfig(env: Record<string, string | undefined>): DiscoveryConfig | null
export function sharesSyncKey(env: Record<string, string | undefined>): boolean
export interface CallOptions { signal?: AbortSignal; requestTimeoutMs?: number; retryDelayMs?: number; maxRetryAfterMs?: number }
export interface KeyLimits { limit: number | null; usage: number; resetDate: string }
export function fetchKeyLimits(config: DiscoveryConfig, opts?: CallOptions): Promise<KeyLimits>
export interface OrganicRequest { domain: string; country: DiscoveryCountry; date: string; excludeWhere?: string }
export interface OrganicResponse { body: unknown; rowCount: number; unitsActual: number }
export function expectedMaxUnits(rowCount: number): number      // max(MIN_CALL_UNITS, rowCount × UNITS_PER_ROW)
export function fetchOrganicKeywords(config: DiscoveryConfig, req: OrganicRequest, opts?: CallOptions): Promise<OrganicResponse>
```

Defaults: `requestTimeoutMs` 8,000, `retryDelayMs` 2,000 and
`maxRetryAfterMs` 5,000.

- [ ] **Step 1: Write the failing tests.** Stub `fetch` the way
  `api/_lib/ahrefs.test.ts` does (`stubAhrefs`).
  - **Config.**
    - `discoveryConfig({})` and `{AHREFS_DISCOVERY_API_KEY: '  '}` → `null`;
      `' dk '` → `{key: 'dk'}`.
    - `sharesSyncKey`: `'k '` against `' k'` → `true`; different keys →
      `false`; either one missing → `false`.
  - **Request.** `fetchOrganicKeywords({key: 'dk_test'}, {domain: 'spinsup.com',
    country: 'AU', date: '2026-12-06'})` makes one GET to
    `https://api.ahrefs.com/v3/site-explorer/organic-keywords`, with
    `Authorization: Bearer dk_test`.
    - Its search params are exactly `{target: 'spinsup.com', country: 'au',
      date: '2026-12-06', mode: 'subdomains', select: DISCOVERY_SELECT,
      order_by: 'volume:desc', limit: '50'}`.
    - With `excludeWhere: W`, the params also include `where: W`.
  - **Units.**
    - Nominal `750` and `-actual` `0`, with 50 rows → `unitsActual` 0.
    - Only nominal `120`, with 8 rows → 120.
    - No cost headers, with 2 rows → 50.
  - `expectedMaxUnits`: 0 → 50, 10 → 150, 50 → 750.
  - **Over-charge.** 2 rows with actual `1000` → rejects with
    `/1000 units for spinsup.com \(AU\), more than the 50 expected/`.
  - **Errors and retries.**
    - 401 → rejects with `DISCOVERY_KEY_REJECTED` and status 401, and the
      message does not contain `dk_test`.
    - 429 (with `Retry-After: 1` and `maxRetryAfterMs: 10`), then 200 →
      resolves after 2 fetches.
    - 429 twice → rejects `/HTTP 429 for spinsup.com \(AU\)/`.
    - 500 twice → rejects `/HTTP 500 for spinsup.com \(AU\)/`, after 2
      fetches.
  - **`fetchKeyLimits`** (path `/v3/subscription-info/limits-and-usage`):
    - `{limits_and_usage: {units_limit_api_key: 200000, units_usage_api_key: 1500,
      usage_reset_date: '2026-12-05T00:00:00Z'}}` →
      `{limit: 200000, usage: 1500, resetDate: '2026-12-05T00:00:00Z'}`.
    - A null limit → `limit: null`.
    - No `usage_reset_date` → rejects `/unexpected limits response/`.

- [ ] **Step 2: Run them; expect failure.**
  `npx vitest run api/_lib/ahrefsDiscovery.test.ts`

- [ ] **Step 3: Implement `api/_lib/ahrefsDiscovery.ts`.** Write one private
  `getWithRetry(config, path, params, subject, opts)`:
  - GET with `redirect: 'manual'`, and a per-request `AbortSignal.timeout`
    combined with `opts.signal`.
  - Retry once on a 429, a 5xx or a network error. A 429 waits for
    `Retry-After`, capped at `maxRetryAfterMs`.
  - 401/403 → `DiscoveryError(DISCOVERY_KEY_REJECTED, status)`.
  - Any other non-2xx → ``DiscoveryError(`Ahrefs returned HTTP ${status} for ${subject}`)``,
    plus Ahrefs' short `error` text.

  The subject for an organic call is `` `${domain} (${country})` ``.
  `unitsActual` comes from the `-actual` header if it is numeric, else the
  nominal header if numeric, else `expectedMaxUnits(rowCount)`. Throw if
  `unitsActual > expectedMaxUnits(rowCount) + COST_MARGIN_UNITS`.

- [ ] **Step 4: Run them; expect a pass.**

- [ ] **Step 5: Document the key in `.env.example`,** under the `AHREFS_API_KEY` block:

```
# Second Ahrefs key, used ONLY by the monthly "other ranking keywords" job
# (api/cron-discovery.ts). It spends API units, so it must carry a monthly unit
# limit in Ahrefs and must never be the same key as AHREFS_API_KEY. Server-only.
AHREFS_DISCOVERY_API_KEY=your-ahrefs-discovery-key
```

- [ ] **Step 6: Write `scripts/ahrefs-discovery-check.mts`,** a live check
  that spends 0 units.
  - Load the key like `loadKey` in `scripts/ahrefs-week-to-xlsx.mts` (env,
    else `.env`). Exit 1 if it is missing or `sharesSyncKey` is true.
  - Print `fetchKeyLimits` and `cycleStart(resetDate)`.
  - Fetch `ahrefs.com` (an Ahrefs free test target), country `AU`, with
    `excludeKeywordsWhere(['ahrefs'])`, and map it with `mapOrganicKeywords`
    (brand `'TEST'`).
  - Print the row count, the first five rows, the position kinds and
    `unitsActual`.
  - Read the limits again. Exit 1 unless usage is unchanged and `ahrefs` is
    absent from the rows.
  - Never print the key, and never touch Supabase.

- [ ] **Step 7: Run it**

  Run: `npx tsx scripts/ahrefs-discovery-check.mts`
  Expected: limit `200000`, 50 rows, `unitsActual 0`, usage unchanged,
  exit 0.

- [ ] **Step 8: Commit**

```bash
git add api/_lib/ahrefsDiscovery.ts api/_lib/ahrefsDiscovery.test.ts scripts/ahrefs-discovery-check.mts .env.example
git commit -m "feat(discovery): Ahrefs organic-keywords client with unit guards"
```

---

### Task 3: Tables and the job's store

**Files:**
- Create: `supabase/keyword-discovery.sql`, `api/_lib/discoveryStore.ts`, `api/_lib/discoveryStore.test.ts`

**Interfaces:**
- Consumes:
  - `AdminClient`, `chunk` and `RECORD_CHUNK` from `./snapshotStore.js`.
  - Task 1: `DiscoveryRow`, `DiscoveryCountry`, `pairKey`.
- Produces:

```ts
export function loadFetchedPairs(admin: AdminClient, cycle: string): Promise<Set<string>>   // pairKey values
export function loadTrackedRecords(admin: AdminClient): Promise<Array<{ domain: string; keyword: string; country: string }>>
export function saveFetch(admin: AdminClient, input: { cycle: string; domain: string; country: DiscoveryCountry; rows: DiscoveryRow[]; units: number }): Promise<void>
export function cycleTotals(admin: AdminClient, cycle: string): Promise<{ pairs: number; units: number }>
```

**Schema** (idempotent; header checklist in the style of
`supabase/activity-log.sql`):
- `public.keyword_discovery_fetches`: `cycle date`, `domain text`,
  `country text`, `row_count integer`, `units integer`,
  `fetched_at timestamptz not null default now()`, with primary key
  `(cycle, domain, country)`.
- `public.keyword_discovery`: `id bigserial` primary key, `cycle date`,
  `brand text`, `domain text`, `country text`, `keyword text`,
  `position integer`, `position_kind text null`,
  `url text not null default ''`, `volume integer null`,
  `ahrefs_checked timestamptz null`.
  - Unique on `(cycle, domain, country, keyword)`.
  - Index on `(brand, cycle)`.
- RLS is enabled on both tables, each with one policy:
  `for select to authenticated using ((select public.is_approved()))`. There
  are no insert, update or delete policies.

- [ ] **Step 1: Write the failing tests.** Use a hand-rolled fake
  `AdminClient` that records each call chain (table, operation, filters,
  payload, options) and answers from a per-test script.
  - **`loadFetchedPairs(admin, '2026-11-05')`** selects `domain,country` from
    `keyword_discovery_fetches` where `cycle = '2026-11-05'`. Given
    `[{domain: 'SpinsUp.com', country: 'AU'}]`, it returns
    `Set{'spinsup.com|AU'}`.
  - **`loadTrackedRecords`**
    - First it reads one `snapshots` row: `category = 'bp-sites'`, ordered by
      `raw_date` then `created_at` (both descending), limit 1.
    - Then it reads `ranking_records` (`domain,keyword,country`) for that id,
      ordered by `id`, with `range(0, 999)`, `range(1000, 1999)` and so on,
      until a page is shorter than 1,000. Scripted pages of 1,000 and 250
      give 1,250 rows.
    - With no snapshot it returns `[]` without querying `ranking_records`.
  - **`saveFetch`**
    - The operations run in this order:
      1. a `delete` on `keyword_discovery`, filtered by cycle, domain and
         country;
      2. inserts of snake_case rows (`position_kind`, `ahrefs_checked`, …)
         in chunks of `RECORD_CHUNK`;
      3. last, an `upsert` on `keyword_discovery_fetches` of
         `{cycle, domain, country, row_count, units, fetched_at: <ISO string>}`
         with `onConflict: 'cycle,domain,country'`.
    - With zero rows there is no insert, but the upsert still happens.
    - A failing insert rejects with
      `/Could not save keyword discovery for spinsup.com \(AU\)/`, and the
      upsert is not made.
  - **`cycleTotals`** returns `{pairs: 3, units: 2140}` for units
    `[700, 740, 700]`.

- [ ] **Step 2: Run them; expect failure.**
  `npx vitest run api/_lib/discoveryStore.test.ts`

- [ ] **Step 3: Write `supabase/keyword-discovery.sql` and implement
  `api/_lib/discoveryStore.ts`.** Every error message names the operation:
  `Could not read keyword discovery progress: …`,
  `Could not read the tracked keywords: …` and
  `Could not save keyword discovery for <domain> (<country>): …`.

- [ ] **Step 4: Run them; expect a pass.**

- [ ] **Step 5: Commit**

```bash
git add supabase/keyword-discovery.sql api/_lib/discoveryStore.ts api/_lib/discoveryStore.test.ts
git commit -m "feat(discovery): tables and store for other ranking keywords"
```

---

### Task 4: The daily cron

**Files:**
- Create: `api/cron-discovery.ts`, `api/cron-discovery.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes:
  - Tasks 1–3.
  - `createAdminClient` and `logCronActivity` (`./_lib/snapshotStore.js`).
  - `bearerToken` (`./_lib/requestAuth.js`).
  - `formatDisplayDate` (`./_lib/displayDate.js`).
  - `isAbortLike` (`./_lib/ahrefs.js`).
  - `BRANDS` and `DOMAIN_TO_BRAND` (`./_lib/brands.js`).
- Produces:

```ts
export const config = { maxDuration: 60 }
/** Mutable so tests can shrink it. */
export const timing = { budgetMs: 40_000, minStartMs: 10_000, gapMs: 1_000, requestTimeoutMs: 8_000 }
export function runSummary(r: { cycle: string; calls: number; units: number; completedBrands: string[];
  left: number; total: number; cycleUnits?: number; unitsLeftAtStop?: number }): string
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<unknown>
```

**Handler order** (each refusal writes exactly one /log line through
`logCronActivity(admin, 'bp-sites', …)`):

1. A non-GET request gets 405. A missing or wrong `CRON_SECRET` bearer gets
   401. Both work as in `api/cron-sync.ts`.
2. Call `createAdminClient(process.env)`. If it fails, return 500 with no
   /log line, as cron-sync does.
3. No discovery key: log
   `Keyword discovery failed: AHREFS_DISCOVERY_API_KEY is not configured on the server`
   and return 500.
4. `sharesSyncKey` is true: log
   `Keyword discovery failed: AHREFS_DISCOVERY_API_KEY is the same key as AHREFS_API_KEY — the rankings key must never spend units`
   and return 500.
5. Call `fetchKeyLimits`. If `limit === null`, log
   `Keyword discovery stopped: the discovery key has no unit limit — set a monthly limit on it in Ahrefs`
   and return 500.
6. Set `cycle = cycleStart(resetDate)` and `missing =` the pairs from
   `discoveryPairs(BRANDS)` whose `pairKey` is not in `loadFetchedPairs`. If
   nothing is missing, return 200 `{ok: true, outcome: 'idle'}` with no /log
   line.
7. `unitsLeft = limit - usage`. If it is below `WORST_CASE_CALL_UNITS`, log
   `` `Keyword discovery stopped: the discovery key has ${unitsLeft.toLocaleString()} units left this month` ``
   and return 200 `{outcome: 'capped'}`.
8. `tracked = trackedIndex(await loadTrackedRecords(admin), DOMAIN_TO_BRAND)`.
9. For each missing pair, in order:
   1. Stop when less than `timing.minStartMs` of `timing.budgetMs` remains,
      or when `unitsLeft < WORST_CASE_CALL_UNITS`.
   2. Keep call starts at least `timing.gapMs` apart.
   3. Call `fetchOrganicKeywords` with
      `excludeWhere: excludeKeywordsWhere(tracked.get(trackedKey(brand, country)) ?? [])`
      and `requestTimeoutMs: timing.requestTimeoutMs`.
   4. Run `mapOrganicKeywords`, then `saveFetch`, then
      `unitsLeft -= unitsActual`.
10. Log `runSummary(…)` and return 200 with
    `{ok: true, outcome: 'progress' | 'complete', calls, units, left}`. The
    `complete` summary uses `cycleTotals`.
11. Anything that throws: log `Keyword discovery failed: ${message}` and
    return 502. An abort after the budget has run out is worded
    `the run exceeded its 40s budget — Ahrefs did not finish responding in time`.

**`runSummary` copy (exact):**
- When complete:
  `` `Keyword discovery — cycle from ${formatDisplayDate(cycle)} complete (${total}/${total}), ${cycleUnits.toLocaleString()} units in total` ``
- Otherwise:
  `` `Keyword discovery — ${calls} call(s), ${units.toLocaleString()} units` ``,
  then `` `; ${list} complete` `` when brands completed, then
  `` ` for the cycle from ${date}; ${left} call(s) left` ``, then
  `` `; stopped: the discovery key has ${n} units left this month` `` when a
  units stop ended the run.
  - Use the singular "call" when the count is 1.
  - The brand list reads `A`, `A and B`, `A, B and C`.

- [ ] **Step 1: Write the failing tests**
  - **Setup.**
    - Mock `./_lib/discoveryStore.js`.
    - Stub `@supabase/supabase-js` so it records `activity_log` inserts (as
      in `api/cron-sync.test.ts`).
    - Stub `fetch`, routing `subscription-info/limits-and-usage` and
      `site-explorer/organic-keywords`.
    - Env: `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `AHREFS_DISCOVERY_API_KEY = 'dk_test'` and `AHREFS_API_KEY = 'ak_test'`.
    - Set `timing.gapMs = 0` in `beforeEach`.
  - **`runSummary`.**
    - `{cycle: '2026-11-05', calls: 30, units: 2140, completedBrands:
      ['FortunePlay', 'Rollero'], left: 125, total: 185}` →
      `'Keyword discovery — 30 calls, 2,140 units; FortunePlay and Rollero complete for the cycle from Nov 5, 2026; 125 calls left'`.
    - The complete form, with `cycleUnits: 46300` →
      `'Keyword discovery — cycle from Nov 5, 2026 complete (185/185), 46,300 units in total'`.
    - `unitsLeftAtStop: 700` appends
      `'; stopped: the discovery key has 700 units left this month'`.
  - **Refusals.**
    - No secret → 401, and no fetch or insert.
    - A missing key, identical keys, or a null limit each give the exact
      log line from steps 3–5 and status 500, with no organic call.
  - **Nothing to do.** All 185 pairs already fetched → 200 `idle`, no organic
    call and no `activity_log` insert.
  - **Capped at the start.** Limit 200,000 with usage 199,300 → the log line
    `… has 700 units left this month`, 200, and no organic call.
  - **Normal run.** Three missing pairs, and tracked records holding
    `SpinsUp|AU` → `spinsup bonus`.
    - The calls follow `discoveryPairs` order.
    - The `spinsup.com` AU call carries
      `where = excludeKeywordsWhere(['spinsup bonus'])`.
    - `saveFetch` runs 3 times with the mapped rows and each call's
      `-actual` units.
    - The summary is logged.
    - Every request's `Authorization` is `Bearer dk_test` and never
      contains `ak_test`.
  - **Resume.** A pair returned by `loadFetchedPairs` is never requested.
  - **Completion.** When the run fetches the last missing pairs, the logged
    line is the complete form, using `cycleTotals`.
  - **Time budget.** Use `vi.spyOn(Date, 'now')` to advance 16,000 ms per
    organic call, with 5 pairs missing. Exactly 2 calls are made, and the
    summary says `3 calls left`.
  - **Units run out mid-run.** Usage 198,600 (1,400 left) with the first call
    at `-actual` 700 → one call is made, and the summary ends with
    `stopped: the discovery key has 700 units left this month`.
  - **Failure.** The second pair returns 500 twice → 502 and
    `Keyword discovery failed: Ahrefs returned HTTP 500 for …`, while the
    first pair's `saveFetch` still happened.

- [ ] **Step 2: Run them; expect failure.**
  `npx vitest run api/cron-discovery.test.ts`

- [ ] **Step 3: Implement `api/cron-discovery.ts`.** Add
  `{ "path": "/api/cron-discovery", "schedule": "0 5 * * *" }` to the
  `crons` in `vercel.json`.

- [ ] **Step 4: Run them; expect a pass.** Then run `npx vitest run` (the
  whole suite stays green) and `npx vercel build` (it succeeds and lists
  `api/cron-discovery`; this catches a missing `.js` import extension).

- [ ] **Step 5: Commit**

```bash
git add api/cron-discovery.ts api/cron-discovery.test.ts vercel.json
git commit -m "feat(discovery): daily cron pulls one Ahrefs cycle of other ranking keywords"
```

---

### Task 5: Browser list logic and loader

**Files:**
- Create: `src/lib/discoveryList.ts`, `src/lib/discoveryList.test.ts`, `src/lib/keywordDiscovery.ts`, `src/lib/keywordDiscovery.test.ts`

**Interfaces:**
- Consumes: Task 1 (`DiscoveryRow`, `normalizeKeyword`, `trackedKey`, and
  `DISCOVERY_COUNTRIES`, which completeness checks every domain against),
  and `supabase` from `./supabase`.
- Produces in `src/lib/discoveryList.ts`:

```ts
export interface DiscoveryFetchInfo { cycle: string; domain: string; country: string; fetchedAt: string }
export interface DiscoveryListItem { keyword: string; country: string; site: string; position: number;
  positionKind: string | null; volume: number | null; url: string; ahrefsChecked: string | null; isNew: boolean }
export function completeCycles(brandDomains: readonly string[], fetches: readonly DiscoveryFetchInfo[]): string[] // newest first
export function previousCycle(cycle: string, brandDomains: readonly string[], fetches: readonly DiscoveryFetchInfo[]): string | null
export function newEligibleCountries(prevCycle: string | null, brandDomains: readonly string[], fetches: readonly DiscoveryFetchInfo[]): Set<string>
export function cycleCompletedAt(cycle: string, brandDomains: readonly string[], fetches: readonly DiscoveryFetchInfo[]): string | null
export function positionKindLabel(kind: string | null): string | null
export function buildDiscoveryList(input: {
  rows: readonly DiscoveryRow[]; prevRows: readonly DiscoveryRow[]; newEligible: ReadonlySet<string>
  tracked: ReadonlyMap<string, ReadonlySet<string>>; brand: { name: string; mainDomain: string; domains: readonly string[] }
  selectedDomains: readonly string[]; countries: readonly string[]; kwFilter: string; kwExact: boolean
}): DiscoveryListItem[]
```

- Produces in `src/lib/keywordDiscovery.ts`:

```ts
export { normalizeKeyword, trackedIndex, trackedKey, DISCOVERY_COUNTRIES } from '../../api/_lib/keywordDiscovery.js'
export type { DiscoveryRow } from '../../api/_lib/keywordDiscovery.js'
export function loadDiscoveryFetches(domains: readonly string[]): Promise<DiscoveryFetchInfo[]>
export function loadDiscoveryRows(domains: readonly string[], cycles: readonly string[]): Promise<DiscoveryRow[]>
```

- [ ] **Step 1: Write the failing tests for `discoveryList.ts`.** Brand
  fixture: `{name: 'SpinsUp', mainDomain: 'spinsup.com',
  domains: ['spinsup.com', 'spinsup.io']}`.
  - **`completeCycles`.** `2026-11-05` has all 10 domain × country fetches
    and `2026-12-05` has 9 → `['2026-11-05']`. When both are complete, the
    newest comes first.
  - **`previousCycle('2026-12-05', …)`** → `'2026-11-05'`. It returns `null`
    when there is no older cycle, and ignores fetches for other brands'
    domains.
  - **`newEligibleCountries('2026-11-05', …)`.** AU has both domains and CA
    has only one → `Set{'AU'}`. `null` → an empty set.
  - **`cycleCompletedAt`** → the latest `fetchedAt` among the brand's
    fetches in that cycle.
  - **`positionKindLabel`.** `'organic'` → `null`; `null` → `null`;
    `'ai_overview'` → `'AI Overview'`; `'image'` → `'Image'`;
    `'knowledge_panel'` → `'Knowledge panel'`.
  - **`buildDiscoveryList`**
    - **Tracked keywords.** `'SpinsUp  Login'` is excluded when `tracked`
      maps `'SpinsUp|AU'` → `{'spinsup login'}`.
    - **One item per keyword × country.** `spinsup.io` at 3 beats
      `spinsup.com` at 4. At equal positions, `spinsup.com` (the main
      domain) wins.
    - **Filters.** Rows for domains not in `selectedDomains`, or countries
      not in `countries`, are ignored. `kwFilter: 'bonus'` keeps keywords
      containing it. `kwExact: true` with `kwFilter: 'spinsup bonus'` keeps
      only that exact keyword.
    - **Order.** Volume 900, then 450, then `null`. At equal volume, the
      lower position comes first.
    - **NEW.** `isNew` is true for a keyword × country absent from `prevRows`
      when the country is in `newEligible`, and false when the country is
      not. With empty `prevRows` and `newEligible`, nothing is NEW.

- [ ] **Step 2: Write the failing tests for `keywordDiscovery.ts`.** Use
  `vi.mock('./supabase')` with a query-builder stub.
  - **`loadDiscoveryFetches(['spinsup.com', 'spinsup.io'])`** reads
    `keyword_discovery_fetches` with `.in('domain', …)`, and maps `fetched_at`
    to `fetchedAt`.
  - **`loadDiscoveryRows(domains, ['2026-12-05', '2026-11-05'])`** reads
    `keyword_discovery` with `.in('domain')` and `.in('cycle')`, ordered by
    `id`.
    - It pages `range(0, 999)` then `range(1000, 1999)`, until a short page.
    - It maps `position_kind` to `positionKind` and `ahrefs_checked` to
      `ahrefsChecked`.
  - **`cycles: []`** → `[]` with no query.
  - **A Supabase error** rejects with
    `/^Could not load other ranking keywords: /`.

- [ ] **Step 3: Run them; expect failure.**
  `npx vitest run src/lib/discoveryList.test.ts src/lib/keywordDiscovery.test.ts`

- [ ] **Step 4: Implement both files.**
  - The `kwFilter` matching copies `BPSites.tsx` exactly: trim and
    lower-case the filter, then compare against `keyword.toLowerCase()`.
  - An item's volume is the largest non-null volume in its group.
  - NEW is checked against all of the brand's `prevRows`, not only the
    sites currently selected.

- [ ] **Step 5: Run them; expect a pass.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/discoveryList.ts src/lib/discoveryList.test.ts src/lib/keywordDiscovery.ts src/lib/keywordDiscovery.test.ts
git commit -m "feat(discovery): list building and loader for the brand page"
```

---

### Task 6: The section on the brand page

**Files:**
- Create: `src/components/OtherRankingKeywords.tsx`
- Modify: `src/pages/BPSites.tsx`. Insert the section in `BrandView`'s scroll
  container (`flex-1 overflow-y-auto … flex flex-col gap-6`), right after the
  stacked-matrices block (the `{(() => { … })()}` IIFE), around line 720.

**Interfaces:**
- Consumes:
  - Task 5 (all of it).
  - `DOMAIN_TO_BRAND`, and the `Brand` type as `BPSites.tsx` already imports
    it.
  - `formatDisplayDate` from `../lib/parser`.
  - `RankingRecord` from `../types`.
- Produces:

```tsx
export function OtherRankingKeywords(props: { brand: Brand; trackedRecords: readonly RankingRecord[];
  selectedDomains: readonly string[]; countries: readonly string[]; kwFilter: string; kwExact: boolean }): JSX.Element
```

Wiring in `BrandView`:

```tsx
<OtherRankingKeywords brand={brand} trackedRecords={latestSnap?.records ?? []}
  selectedDomains={visibleDomains} countries={activeCountries} kwFilter={kwFilter} kwExact={kwExact} />
```

`latestSnap` is the brand's newest BP snapshot, whatever the date filter
shows. That is the tracked list the spec means.

**Behaviour:**
- **Loading.** Load once per `brand.name`:
  1. fetches;
  2. `shown = completeCycles(…)[0] ?? null`;
  3. `prev = shown ? previousCycle(…) : null`;
  4. rows for the non-null cycles among `[shown, prev]`, split by cycle.

  The section renders its own loading line and never delays the matrix.
- **Header.**
  - Title: `Other ranking keywords · not tracked`.
  - Right-aligned:
    `` `As of ${formatDisplayDate(completedAt.slice(0, 10))} · from Ahrefs, monthly` ``.
  - Note: `Keywords Ahrefs has seen these sites rank for in the top 100 that aren't in the tracked list. Ahrefs re-checks these less often than the weekly tracker, so a position can be a few weeks old.`
- **Columns.**
  - Keyword: links to `url` in a new tab (`rel="noopener noreferrer"`), with
    title `` `Ahrefs checked ${date}` `` when known, and a `NEW` pill when
    `isNew`.
  - Country.
  - Best site: hidden below `sm`, where the site shows under the keyword
    instead.
  - Pos: the position, plus ``` ` · ${label}` ``` when `positionKindLabel`
    is non-null.
  - Search vol: `toLocaleString()`, or `—` when null.
- **Length.** Show 25 rows, then a `Show all ${n}` button styled like the
  page's "Show older snapshots" button.
- **States (exact copy):**
  - loading: `Loading other ranking keywords…`
  - error: `Couldn't load other ranking keywords.` (and `console.error` the
    error)
  - no complete cycle: `No list yet — it appears once Ahrefs has been checked for all of this brand's sites.`
  - nothing untracked, even with every site and country and no keyword
    search: `Every keyword Ahrefs sees for these sites is already tracked.`
  - otherwise empty: `Nothing matches the filters.`
- **Colours.** Use only existing CSS tokens (`--surface`, `--border`,
  `--muted`, `--ink`, `--text-2`, …). Add no new hex values.

- [ ] **Step 1: Implement the component and the wiring.** The list logic is
  already tested in Task 5, and Vitest has no DOM here.

- [ ] **Step 2: Build.** Run `npm run build`. Expected: it succeeds with no
  type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/OtherRankingKeywords.tsx src/pages/BPSites.tsx
git commit -m "feat(discovery): other ranking keywords section on BP Sites brand pages"
```

- [ ] **Step 4: Visual check with stubbed data.** Signed out, local RLS
  returns no rows, so stub everything.
  1. Temporarily make the two loaders return fixtures: two cycles, a NEW
     keyword, an AI Overview position, a null volume, and 30+ rows.
  2. Temporarily render the section outside `BrandView`'s
     `brandSnapshots.length === 0` branch.
  3. Run `npm run dev`. With Playwright, open `/bp-sites/spinsup?site=all`
     and screenshot at 1440 px and 375 px.
  4. Make a loader throw, and confirm the error line shows while the rest
     of the page renders.
  5. Drop the stubs: `git checkout src/lib/keywordDiscovery.ts src/pages/BPSites.tsx`.
     Expected: `git status` is clean.

---

### Task 7: Docs, full verification, PR

**Files:**
- Modify: `docs/integrations/ahrefs.md` (a gitignored folder, so use
  `git add -f`), `CLAUDE.md`

- [ ] **Step 1: Update `docs/integrations/ahrefs.md`.** Add a section,
  "Other ranking keywords (paid Site Explorer units)", covering:
  - the second key and its 200,000 limit, and that pay-as-you-go must stay
    off;
  - the request and its costs (15 units a row; worst case 750 per call and
    138,750 per cycle);
  - the guards;
  - the cycle (the Ahrefs billing month, from `usage_reset_date`; it resets
    on the 5th) and the daily 05:00 UTC cron, about 30 calls a run;
  - the two tables and the /log lines;
  - `npx tsx scripts/ahrefs-discovery-check.mts`, which spends 0 units.

  Reword "Every call the sync makes is free" so it is clearly about
  `AHREFS_API_KEY` only. Name no other clients.

- [ ] **Step 2: Update `CLAUDE.md`.** Add an "Other ranking keywords" item to
  the data flow (cron → Supabase → BP Sites section). Add rows for
  `api/_lib/keywordDiscovery.ts`, `api/_lib/ahrefsDiscovery.ts`,
  `api/cron-discovery.ts` and `src/components/OtherRankingKeywords.tsx` to
  the key-files table.

- [ ] **Step 3: Verify everything.**
  - `npm test`: everything passes (up from 143).
  - `npm run build` and `npx vercel build` both succeed.
  - `npx tsx scripts/ahrefs-discovery-check.mts` exits 0 with usage
    unchanged.
  - A small script reads the key from `.env` and greps `dist/` for it and
    for the name `AHREFS_DISCOVERY_API_KEY`. It prints counts only, and both
    must be 0.

- [ ] **Step 4: Commit.** Run `git add -f docs/integrations/ahrefs.md` and
  `git add CLAUDE.md` as separate commands (the first exits 1 on the
  gitignore advisory). Then commit with
  `docs(discovery): document other ranking keywords`.

- [ ] **Step 5: Push and open the PR,** following the Ranking-Reports PR
  workflow.
  - Push: `git push -u origin feat/other-ranking-keywords`.
  - Open the PR:
    `GH_TOKEN=$(gh auth token --user optinet-solutions-sandbx) gh pr create --base main --title "Other ranking keywords: monthly Ahrefs discovery on BP Sites" --body-file <file>`.
  - The PR body covers what it does, the units and limits, the two user
    steps below, and the after-merge checks.
  - Create a kanban card in In Progress (project `cmp0w5oxq000004l2rg84dwn1`,
    column `cmp0w5oxy000304l2ex5a7cxx`, assignee
    `cmnffqu7g0000ashloojpkidg`) with the PR link.

- [ ] **Step 6: Before the merge, the user** adds `AHREFS_DISCOVERY_API_KEY`
  to Vercel (Production and Preview), and runs
  `supabase/keyword-discovery.sql` in the Supabase SQL editor. Wait for
  them to confirm both.

- [ ] **Step 7: Merge after the user's go-ahead.** As the sandbox account:
  `gh pr merge --merge --delete-branch`. Then check that the Production
  deploy is ready:
  - `GET /api/cron-discovery` without the secret → 401;
  - the live bundle contains neither the key nor its name.

  Then move the kanban card to Done.

- [ ] **Follow-up (not part of the merge):**
  - The morning after the deploy, /log shows the first
    `Keyword discovery — …` line.
  - About a week later it shows the `… complete (185/185) …` line, with the
    cycle's units.
  - One brand page shows the section with real data.
