# OpenSEO Sync (BP Sites) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Sync from API" and the Wed/Fri scheduled sync pull BP rankings from OpenSEO's read-only rank export instead of the Ranks API, which stopped checking after 2026-09-24.

**Architecture:** A server-only client (`api/_lib/openseo.ts`) lists the domains OpenSEO tracks, keeps the ones in `DOMAIN_TO_BRAND`, and fetches each one's export (desktop, 8 weeks) with bounded concurrency. A browser-safe normalizer (`api/_lib/sitesNormalize.ts`, rewritten) turns those exports into `SyncRecord[]`, one per keyword × market from its newest checked week. `api/sites.ts` (the button) and `api/cron-sync.ts` (the schedule) share both, so the proxy now returns normalized records instead of raw vendor pages.

**Tech Stack:** TypeScript, Vercel Node functions (Node 24.x), React + Vite, vitest.

**Spec:** none written. The user skipped the design conversation on 2026-11-04 ("skip the questions please"), so the design calls below are Claude's and are listed for the user in the PR.

## Design calls (Claude's)

1. **Source.** `GET {OPENSEO_BASE_URL}/api/public/rankings`, header `x-api-key: OPENSEO_RANKINGS_API_KEY`, server-only. `OPENSEO_BASE_URL` defaults to `https://open-seo-selfhost.sandbox-f72.workers.dev`. The endpoint is read-only and never spends DataForSEO credit.
2. **Domains.** OpenSEO's domain list ∩ `DOMAIN_TO_BRAND` after `canonicalDomain`. On 2026-11-04 that is 37 of OpenSEO's 160 domains. The other domains are other clients' sites: not fetched, not reported.
3. **One record per (domain, keyword, country)**, taken from that pair's newest checked week in the export. A week with no cell means "not checked" and never becomes `'NR'`; a pair with no cell anywhere in the window gets no record.
4. **Fields.**
   - `position`: a number becomes its string; `null` (checked, not in the top 100) becomes `'NR'`.
   - `previous`: the pair's previous checked week, as a string or `'NR'`; `''` when the window has no earlier check.
   - `change`: `previous − position` as a signed string (`'+3'`, `'-2'`, `'0'`) when both are numbers, else `''`.
   - `date`: the week key (`YYYY-MM-DD`, the run's UTC start date).
   - `searchVolume` / `affiliateUrl` / `globalSearchVolume`: `''`. Carry-forward fills them, as it did for the Ranks API.
5. **Snapshot date.** `rawDate` is the newest record date, as before. Records dated earlier are counted ("kept an earlier check") in the toast, the sync summary and the cron log, so a partial OpenSEO run can't pass as a fresh week.
6. **Markets skipped:** city-level markets (`locationName` set) and markets without a `countryCode`.
7. **Request:** `device=desktop`, `weeks=8`.
8. **Failures are whole.**
   - A domain export that fails after one retry (network error or 5xx) fails the whole sync. A partial snapshot would make a brand look like it vanished.
   - 401 → "OpenSEO rejected the key — check OPENSEO_RANKINGS_API_KEY on the server".
   - 503 → "OpenSEO's rank export is switched off (RANKINGS_API_KEY is unset on the OpenSEO worker)".
9. **Hand uploads are protected.** The cron already skips uploaded snapshots (`decideWrite`). The manual duplicate warning gains a line when the snapshot it would replace was uploaded by hand: the Nov 3 snapshot is a hand-built "best of both checks" file.
10. **Ranks API code is deleted:** `ranks.ts`, `ranksPaging.ts`, their tests and the `ApiRow` normalizer. `SITES_API_KEY` becomes unused.

## Global Constraints

- `api/_lib` files imported from `src/` stay browser-safe: no `process.env`, no `node:` imports, no secrets. `api/_lib/openseo.ts` is SERVER-ONLY and must never be imported from `src/`.
- Relative imports inside `api/` end in `.js` (Vercel ESM; see memory "Vercel api/ ESM gotcha").
- The key never reaches the browser. No response or message echoes the upstream URL or the key.
- The `api/sites.ts` auth gate is unchanged: a Supabase session plus an approved `user_access` row.
- Cron:
  - every run leaves exactly one `activity_log` row;
  - the fetch budget stays 35 s, and failure stays non-2xx;
  - `decideWrite` is unchanged, so an upload is never replaced.
- User-facing copy says "OpenSEO", never "Ranks API".

## Review Focus

1. **Empty data.** An export with an empty `weeks`, or a keyword with no cells, yields no records and no crash. (Task 1: "returns no records for an empty export".)
2. **Domain listed twice.** The same site appears as `www.` and bare: one row per keyword × country, and the newer check wins. (Task 1: "collapses a domain listed twice".)
3. **Transient failure.** One domain fails once and is retried. If it fails twice, the sync fails and the message names the domain. (Task 2: retry tests.)
4. **Key or export problems.** A wrong key (401) or a switched-off export (503) reaches the toast and the cron log in words an operator can act on. (Task 2 wording tests; Task 3: proxy 502 and cron failure log.)
5. **Clash with an upload.** A sync whose newest date matches a hand-uploaded snapshot never overwrites it silently. The cron skips it (existing `decideWrite` test), and the manual warning names the upload. (Task 4: copy check in the build step.)

## File Structure

| File | Responsibility |
|------|----------------|
| `api/_lib/sitesNormalize.ts` (rewrite) | OpenSEO export types, `normalizeExports`, `countOlderChecks`. Keeps `canonicalDomain`, `SyncRecord`, `SkippedDomain`, `NormalizeResult`. Browser-safe. |
| `api/_lib/openseo.ts` (new) | Server-only HTTP client: config, errors, domain list, per-domain exports. |
| `api/sites.ts` | The button's proxy: auth gate, then fetch + normalize, return records. |
| `api/cron-sync.ts` | The schedule: same fetch + normalize, then the existing write rules. |
| `src/lib/sitesApi.ts` | Browser call to `/api/sites`: one request, typed result or `SitesApiError`. |
| `src/lib/sitesNormalize.ts` | Frontend re-exports + record-shape guards. |
| `src/App.tsx`, `src/components/{DuplicateWarning,Sidebar}.tsx` | Wiring and copy. |
| `vite.config.ts`, `.env.example`, `CLAUDE.md` | Env names and docs. |
| Delete `api/_lib/ranks.ts`, `ranks.test.ts`, `ranksPaging.ts`, `ranksPaging.test.ts` | Dead once both callers move. |

---

### Task 1: Normalizer (OpenSEO export → records)

**Files:**
- Rewrite: `api/_lib/sitesNormalize.ts`
- Rewrite: `api/_lib/sitesNormalize.test.ts`

**Interfaces:**
- Consumes: `DOMAIN_TO_BRAND`, `normalizeCountry` from `api/_lib/brands.js`.
- Produces:
  ```ts
  export interface OpenSeoCell    { position: number | null; previous: number | null; status: string }
  export interface OpenSeoMarket  { locationCode: number; countryCode: string | null; locationName: string | null }
  export interface OpenSeoKeyword { keyword: string; cells: Record<string, Record<string, OpenSeoCell>> }
  export interface OpenSeoExport  { domain: string; weeks: string[]; markets: OpenSeoMarket[]; keywords: OpenSeoKeyword[] }
  export function canonicalDomain(raw: string | null | undefined): string          // unchanged
  export function normalizeExports(exports: OpenSeoExport[]): NormalizeResult      // { records, unknownDomains, rawDate }
  export function countOlderChecks(records: { date: string }[], rawDate: string): number
  ```
  `SyncRecord`, `SkippedDomain` and `NormalizeResult` keep their current shapes.

- [ ] **Step 1: Write the failing tests** (fixture builder `exportFor(domain, weeks, keywords)` in the test file)
  - `takes each keyword × market from its newest checked week`: weeks `['2026-10-27','2026-11-03']`; AU has cells in both weeks, CA only in `2026-10-27` → AU record `date '2026-11-03'`, CA record `date '2026-10-27'`, `rawDate '2026-11-03'`.
  - `never turns an unchecked week into NR`: a market whose cells are `{}` → no record; a cell with `position: null` → `position 'NR'`.
  - `previous is the previous checked week, NR when that check found nothing, blank when there is none`:
    - `[5, null, 3]` over three weeks → `position '3'`, `previous 'NR'`, `change ''`.
    - `[7, 4]` → `previous '7'`, `change '+3'`.
    - `[4, 9]` → `change '-5'`.
    - `[6, 6]` → `change '0'`.
    - a single week `[2]` → `previous ''`, `change ''`.
  - `maps markets to dashboard country codes and skips city-level or unlabelled markets`: `countryCode 'AU'` → `country 'AU'`; `locationName 'Sydney'` → no record; `countryCode null` → no record.
  - `keeps only BP domains, canonicalised`: `'WWW.Rooster.bet'` → `domain 'rooster.bet'`; `'example.com'` → no records and `unknownDomains [{ domain: 'example.com', count: 1 }]` for one keyword × market.
  - `collapses a domain listed twice to one row per keyword and country, newer check wins`: `www.rooster.bet` dated `2026-10-27` + `rooster.bet` dated `2026-11-03`, same keyword and market → one record, `date '2026-11-03'`.
  - `returns no records for an empty export`: `weeks []` → `records []`, `rawDate ''`.
  - `countOlderChecks counts records dated before the snapshot date`: dates `['2026-11-03','2026-10-27','']`, rawDate `'2026-11-03'` → `1`.
  - `canonicalDomain` tests carry over unchanged.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run api/_lib/sitesNormalize.test.ts`
  Expected: FAIL (`normalizeExports` is not exported).

- [ ] **Step 3: Implement**
  Replace the Ranks API row code (`ApiRow`, `positionToString`, `changeToString`, `checkedAtDate`, `reduceLatest`, `normalizeRows`) with the interfaces above.
  - Walk `export.weeks` in order per keyword × market; the last week with a cell is "latest", and the one before it is "previous".
  - Dedupe on `domain|keyword.toLowerCase()|country`, keeping the newer `date`.
  - Records are sorted by domain, keyword and country so output is stable.

- [ ] **Step 4: Run them and watch them pass**
  Run: `npx vitest run api/_lib/sitesNormalize.test.ts`
  Expected: all PASS.

- [ ] **Step 5: Commit** — `feat(sync): normalize OpenSEO rank exports into dashboard records`

### Task 2: OpenSEO client (server-only)

**Files:**
- Create: `api/_lib/openseo.ts`
- Create: `api/_lib/openseo.test.ts`

**Interfaces:**
- Consumes: `OpenSeoExport`, `canonicalDomain` (Task 1); `DOMAIN_TO_BRAND`.
- Produces:
  ```ts
  export const DEFAULT_OPENSEO_BASE_URL = 'https://open-seo-selfhost.sandbox-f72.workers.dev'
  export const EXPORT_WEEKS = 8
  export const KEY_REJECTED = 'OpenSEO rejected the key — check OPENSEO_RANKINGS_API_KEY on the server'
  export const EXPORT_OFF   = "OpenSEO's rank export is switched off (RANKINGS_API_KEY is unset on the OpenSEO worker)"
  export interface OpenSeoConfig { key: string; baseUrl: string }
  export function openSeoConfig(env: Record<string, string | undefined>): OpenSeoConfig | null
  export class OpenSeoError extends Error { readonly status: number | null }
  export function fetchBpExports(
    config: OpenSeoConfig,
    opts?: { signal?: AbortSignal; requestTimeoutMs?: number; concurrency?: number },
  ): Promise<OpenSeoExport[]>
  ```
  Defaults: `requestTimeoutMs` 20 000, `concurrency` 6. Each request uses `AbortSignal.any([opts.signal, AbortSignal.timeout(requestTimeoutMs)])`.

- [ ] **Step 1: Write the failing tests** (stub `fetch`; route on `URL.searchParams.get('domain')`)
  - `openSeoConfig returns null without a key, trims it, defaults the base URL and drops a trailing slash`.
  - `sends the key as x-api-key, never in the URL`: no call URL contains the key, and every call has `headers['x-api-key']`.
  - `fetches only BP domains, by their original spelling, desktop, 8 weeks`: list `['rooster.bet','WWW.SpinJo.com','example.com']` → export calls for `rooster.bet` and `WWW.SpinJo.com` only, each with `device=desktop` and `weeks=8`.
  - `retries a domain once after a 5xx, then succeeds`: `rooster.bet` returns 502 then 200 → resolves; two calls for that domain.
  - `fails the whole fetch, naming the domain, when the retry fails too`: 502 twice → rejects with an `OpenSeoError` whose message includes `rooster.bet` and `502`.
  - `does not retry a 401 and words it for the operator`: one call; `message === KEY_REJECTED`; `status 401`.
  - `words a 503 as the export being switched off`: `message === EXPORT_OFF`.
  - `rejects a domain list that is not an array of strings`: `{ domains: 'x' }` → `OpenSeoError` "OpenSEO returned an unexpected domain list".
  - `stops at the caller's signal without retrying`: an already-aborted signal → rejects with `name 'AbortError'`, and the export is not retried.
  - `never runs more than concurrency exports at once`: 5 BP domains, `concurrency 2`, deferred responses → the in-flight peak is 2.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run api/_lib/openseo.test.ts`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `api/_lib/openseo.ts`, starting with the SERVER-ONLY header comment.
  - Retry once on a thrown network error or a 5xx, but not when `opts.signal` is aborted.
  - Other non-2xx responses: `OpenSEO returned HTTP ${status} for ${domain}`. For the list call the subject is "the domain list".
  - Validate shapes: `domains` is a `string[]`; an export has array `weeks`, `markets` and `keywords`.

- [ ] **Step 4: Run them and watch them pass**
  Run: `npx vitest run api/_lib/openseo.test.ts`
  Expected: all PASS.

- [ ] **Step 5: Commit** — `feat(sync): add a server-only OpenSEO rankings client`

### Task 3: Switch the proxy and the cron to OpenSEO

**Files:**
- Modify: `api/sites.ts`, `api/sites.test.ts`
- Modify: `api/cron-sync.ts`, `api/cron-sync.test.ts`
- Modify: the header comment in `api/_lib/snapshotStore.ts`
- Delete: `api/_lib/ranks.ts`, `api/_lib/ranks.test.ts`, `api/_lib/ranksPaging.ts`, `api/_lib/ranksPaging.test.ts`

**Interfaces:**
- Consumes: Task 2 (`openSeoConfig`, `fetchBpExports`, `OpenSeoError`, `KEY_REJECTED`); Task 1 (`normalizeExports`, `countOlderChecks`).
- Produces: the `/api/sites` contract for Task 4.
  - `GET /api/sites` (no query) → 200 `{ ok: true, data: { records: SyncRecord[], unknownDomains: SkippedDomain[], rawDate: string } }`, with `Cache-Control: no-store`.
  - Errors → `{ ok: false, error: string, code?: string }`:
    - 401 `unauthenticated` and 403 `unapproved`, both unchanged;
    - 500 for a missing key;
    - 502 for an `OpenSeoError`, carrying its message;
    - 504 on the 45 s overall timeout: "OpenSEO did not respond within 45 seconds".

- [ ] **Step 1: Update the tests first**
  - `api/sites.test.ts`:
    - Keep every auth-gate test, with `MANAGED_ENV` swapped to `OPENSEO_RANKINGS_API_KEY`.
    - Replace the Ranks block with:
      - `returns 500 naming OPENSEO_RANKINGS_API_KEY when it is unset`;
      - `returns normalized records for the BP domains` (stub routes the list + one export → `data.records[0]` has `domain 'rooster.bet'`, `position '3'`);
      - `passes OpenSEO's key rejection through as a 502 with the operator wording`;
      - `turns the overall timeout into a 504 that names 45 seconds`;
      - `never forwards the caller session to OpenSEO`: no `Authorization` header on the upstream calls, `x-api-key` present.
    - Keep the `maxDuration > 45` test.
  - `api/cron-sync.test.ts`:
    - Swap the fixtures to OpenSEO routes and `MANAGED` to `OPENSEO_RANKINGS_API_KEY`.
    - Keep all tests, with these expected strings:
      - write: `'Scheduled sync — 1 records (Aug 4, 2026)'`, with fixture week `'2026-08-04'`;
      - budget: `'Scheduled sync failed: the run exceeded its 35s fetch budget — OpenSEO did not finish responding in time'`.
    - Replace the "no usable checked_at" test with `writes nothing when OpenSEO has no BP rankings`: the logged summary is `'Scheduled sync — OpenSEO has no BP rankings; nothing written'`.
    - Add `notes records that kept an earlier check`: two markets, one checked only in an older week → summary `'Scheduled sync — 2 records (Aug 4, 2026); 1 kept an earlier check'`.
    - Add `logs a rejected key as a failure`: the summary contains `OPENSEO_RANKINGS_API_KEY`, status 502.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run api/sites.test.ts api/cron-sync.test.ts`
  Expected: FAIL (the handlers still call the Ranks API).

- [ ] **Step 3: Implement.**
  - `api/sites.ts`: keep the auth gate verbatim, then `openSeoConfig(process.env)` → `fetchBpExports(cfg, { signal: AbortSignal.timeout(45_000) })` → `normalizeExports`. Drop the `action`/`limit`/`offset` handling.
  - `api/cron-sync.ts`: the same calls, with the existing 35 s `deadline` as the signal. Keep the empty/undated guards, `decideWrite` and `logCronActivity` exactly as they are.
  - Delete the four Ranks files.

- [ ] **Step 4: Run the API suite**
  Run: `npx vitest run api`
  Expected: all PASS, and no test file imports the deleted modules.

- [ ] **Step 5: Commit** — `feat(sync): pull BP rankings from OpenSEO in the proxy and the cron`

### Task 4: Browser wiring and copy

**Files:**
- Modify: `src/lib/sitesApi.ts`, `src/lib/sitesApi.test.ts`
- Modify: `src/lib/sitesNormalize.ts`
- Modify: `src/App.tsx` (sync handler, overlay, replace-log copy)
- Modify: `src/components/DuplicateWarning.tsx`, `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: the `/api/sites` contract (Task 3); `countOlderChecks`, `NormalizeResult` (Task 1, via `src/lib/sitesNormalize.ts`).
- Produces:
  ```ts
  export function parseSyncBody(res: { ok: boolean; status: number }, body: unknown): NormalizeResult
  export function fetchSync(signal?: AbortSignal): Promise<NormalizeResult>
  // SitesApiError unchanged
  ```

- [ ] **Step 1: Update the tests first** (`src/lib/sitesApi.test.ts`)
  - `returns the records, skipped domains and date on success`.
  - `surfaces the server's error text, status and code verbatim`: e.g. a 502 with the `KEY_REJECTED` text.
  - `falls back to the HTTP status when the error body is empty`.
  - `rejects a success envelope without a records array`.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run src/lib/sitesApi.test.ts`
  Expected: FAIL (`parseSyncBody` is not exported).

- [ ] **Step 3: Implement.**
  - **`sitesApi.ts`:** one GET to `/api/sites` with the session bearer; drop the paging re-exports.
  - **`src/lib/sitesNormalize.ts`:** re-export the new types plus `canonicalDomain` and `countOlderChecks`, and keep both shape guards.
  - **App copy:**
    - overlay title "Syncing from OpenSEO", with the line "Fetching the latest checks…" (drop `syncProgress`);
    - the success toast appends ` · {n} kept an earlier check` when `countOlderChecks > 0`;
    - activity log entries "Synced {n} records from OpenSEO — {date}" and "Replaced snapshot from OpenSEO — {date} ({n} records)";
    - the error toast shows `err.message`.
  - **DuplicateWarning** (sync):
    - "OpenSEO's newest check date matches an existing snapshot. Replacing it will overwrite any manual edits stored on that snapshot."
    - plus, when `existing.source === 'upload'`: "This snapshot was uploaded by hand — replacing it swaps that file's rankings for OpenSEO's."
  - **Sidebar title:** "Pull the latest BP rankings from OpenSEO".

- [ ] **Step 4: Verify**
  Run: `npx vitest run src && npm run build`
  Expected: tests PASS, and the build exits 0 (including the shape guards).

- [ ] **Step 5: Commit** — `feat(sync): wire the Sync button to OpenSEO`

### Task 5: Env, docs and full verification

**Files:**
- Modify: `vite.config.ts` (dev server copies `OPENSEO_RANKINGS_API_KEY` and `OPENSEO_BASE_URL` instead of `SITES_API_KEY`)
- Modify: `.env.example` (replace the Ranks API block)
- Modify: `CLAUDE.md` (Data Flow import path, Key Files rows for `sitesNormalize.ts`, `api/sites.ts`, `api/_lib/openseo.ts`)
- Commit separately: the pending `.gitignore` line `docs/references/` (client exports must never be committed)

- [ ] **Step 1: Make the edits above.**
- [ ] **Step 2: Full suite** — `npm test` → 0 failures.
- [ ] **Step 3: Build** — `npm run build` → exit 0.
- [ ] **Step 4: Vercel build** — `npx vercel build` → exit 0 (catches missing `.js` extensions).
- [ ] **Step 5: Live read-only smoke test.**
  - A scratchpad script imports `fetchBpExports` + `normalizeExports` with the local `.env` key. It writes nothing to Supabase.
  - Expect 37 domains, about 1,110 records, `rawDate '2026-11-03'`, and 0 records with an empty country.
- [ ] **Step 6: Commit** — `docs(sync): document the OpenSEO sync` and `chore: keep docs/references out of git`.

## After the plan

- A fresh reviewer reads the whole branch before the PR.
- Ship it per the Ranking-Reports workflow: PR from the sandbox account; merge with `--merge --delete-branch` after the user's go-ahead; kanban task In Progress → Done.
- `OPENSEO_RANKINGS_API_KEY` must be in Vercel (Production and Preview) before the merge, because merging deploys Production.

## Amendments after the branch review (2026-11-04)

The fresh review found one critical issue and three important ones. These change the design calls above:

- **Design call 7 → `weeks=52`**, the endpoint's maximum. The run-date axis is shared by all markets of a domain, so re-runs in one market could push the other markets out of an 8-date window and silently drop their rows.
- **Design call 5, cron only.** The cron skips writing when more than half the records kept an earlier check (`MAX_OLDER_SHARE` in `api/cron-sync.ts`), and logs "covers only X of Y records".
  - A one-tracker test run must not date a new week unattended.
  - The manual sync still writes, with the count shown in the toast and the summary.
- **Design call 6.** OpenSEO stores a city tracker under its country's location code, and its export merges the two.
  - A city tracker beside a national one for a BP domain now fails the sync, with operator wording.
  - A city tracker with no national twin is still skipped.
- **Design call 9.** Before writing, the manual sync asks the database (`findStoredSnapshot`) whether a snapshot for that date exists, and refuses if the page hasn't loaded it.
  - The loaded state is empty during the first load and after a failed one.
  - The write deletes by id, so without this check a click during the load could replace the hand-built Nov 3 upload.
- **New behavior:**
  - `OPENSEO_BASE_URL` must be https, because the key rides on every request.
  - A body that stalls past the request timeout is retried like any other transport failure.
  - After the first failure, the exports still in flight are cancelled.
  - The cron's undated guard is restored (plan Task 3). It can't fire today, but a miss would mint a self-perpetuating junk snapshot.
- **After the re-review (all findings closed; minor notes):**
  - The sync and the single-file upload share `findExistingSnapshot`. It checks loaded state first, then the database, and hydrates a stored match, so the normal duplicate warning shows it.
    - This replaces a "reload and retry" refusal, which couldn't help when the stored snapshot is older than the 8 loaded ones.
    - The upload path had the same first-load race, which predated this branch.
  - Plain http is allowed for a loopback `OPENSEO_BASE_URL` only.
  - The normalizer's operator-worded refusal is a `SyncDataError`, which the proxy shows verbatim.
  - **Known limit, kept on purpose:** the cron's 50% rule compares UTC run dates. A batch whose trackers are started one by one across 00:00 UTC (08:00 PHT) can be skipped by the cron. That fails safe: it's logged, and a manual sync still writes. A batch launched at once shares one date.
