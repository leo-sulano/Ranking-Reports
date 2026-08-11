# Scheduled Ranks API Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the BP Sites Ranks API sync automatically at 12:00 PHT on Wednesdays and Fridays, without a human clicking anything, and without ever overwriting a snapshot a person uploaded or edited.

**Architecture:** A Vercel Cron hits `api/cron-sync.ts`, gated by `CRON_SECRET`. To let one normalizer serve both the button and the cron, the brand maps and `normalizeRows` move into `api/_lib/` and their old `src/lib` paths become re-exports — so no frontend import changes. A new `source` column on `snapshots` records who created each one, and the cron only replaces its own.

**Tech Stack:** TypeScript 5.8 (strict), Vercel serverless functions (`@vercel/node`), Supabase (`@supabase/supabase-js`), Vite 6, vitest.

**Spec:** `docs/superpowers/specs/2026-08-11-scheduled-sites-sync-design.md`

## Global Constraints

- **No new npm dependencies.** `@supabase/supabase-js`, `@vercel/node` and `jose` are already installed.
- **Secrets are server-only.** `SITES_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` must never gain a `VITE_` prefix, appear in `src/`, or be printed. `SUPABASE_SERVICE_ROLE_KEY` already exists in Vercel; `CRON_SECRET` is new and the user adds it.
- **`api/` uses `module: NodeNext`** — every relative import inside `api/` needs an explicit `.js` extension. `api/_lib/requestAuth.ts` and `api/sites.ts` are the working precedent. This is a **runtime** requirement on Vercel, not just a type-check one.
- **`src/` uses `moduleResolution: bundler`**, which resolves a `.js` specifier to the sibling `.ts` file. That is what lets `src/lib/*` re-export from `api/_lib/*.js`.
- **Files under `api/_lib/` that `src/` also imports must not import from `src/`.** They define their own types. Task 2 adds a compile-time guard so those types cannot drift from the app's.
- **TypeScript is strict.** `npm run build` runs `tsc -b` across `tsconfig.app.json`, `tsconfig.node.json` and `tsconfig.api.json` and must pass.
- **Test command:** `npx vitest run` (all) or `npx vitest run <path>` (one file). `vitest.config.ts` includes `src/**/*.test.ts` and `api/**/*.test.ts`.
- **Test baseline: 96 passing, 2 failing.** Both failures are in `api/_lib/ssoPortal.test.ts`, both pre-date this work, and neither is yours to fix. The count of passing tests must never go *down*.
- **The 63 existing sync tests must keep passing unchanged** (`src/lib/sitesNormalize.test.ts` 21, `src/lib/sitesApi.test.ts` 19, `api/sites.test.ts` 23). A test that has to change means a move altered behaviour — stop and report it.
- **Commit after every task.** Branch `feat/scheduled-sites-sync` already exists and holds the spec commit.

---

### Task 1: Move brand data and `normalizeCountry` into `api/_lib/`

The cron needs `DOMAIN_TO_BRAND`. This moves the data, leaves `src/lib/brands.ts` as the frontend's import site, and pulls `normalizeCountry` out of `parser.ts` so nothing importing it drags in `xlsx`.

**Files:**
- Create: `api/_lib/brands.ts`
- Modify: `src/lib/brands.ts` (becomes a re-export plus the UI-only exports)
- Modify: `src/lib/parser.ts:69-92` (delete `normalizeCountry`, import it instead)
- Modify: `src/types/index.ts:36-45` (re-export `Brand` from its new home)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces, from `api/_lib/brands.ts`: `interface Brand`, `BRANDS: Brand[]`, `DOMAIN_TO_BRAND: Record<string,string>`, `LP_DOMAIN_TO_BRAND: Record<string,string>`, `COUNTRY_LABELS: Record<string,string>`, `normalizeCountry(raw: unknown): string`. Tasks 2, 5 and 6 import from here.
- `src/lib/brands.ts` keeps exporting every name it exports today, so no consumer changes.

- [ ] **Step 1: Create the shared module**

Create `api/_lib/brands.ts`. Move the bodies of `BRANDS`, `BRAND_BY_NAME`, `DOMAIN_TO_BRAND`, `LP_DOMAIN_TO_BRAND` and `COUNTRY_LABELS` **verbatim** from `src/lib/brands.ts`, and `normalizeCountry` **verbatim** from `src/lib/parser.ts:75-92`. Do not retype the brand list — copy it, or you will introduce a typo in a domain and silently drop a brand.

The file must have **no imports at all**, so define `Brand` here:

```ts
/**
 * Brand configuration, shared by the browser and the serverless functions.
 *
 * This lives under api/ rather than src/ because api/ cannot import from src/
 * (tsconfig.api.json uses NodeNext, and Vercel's runtime needs explicit .js
 * specifiers), while src/ CAN import from here — bundler resolution maps the
 * .js specifier back to this .ts file. src/lib/brands.ts re-exports everything
 * below, so the frontend's import site is unchanged.
 *
 * Nothing here may import from src/, or the serverless build breaks.
 */
export interface Brand {
  name: string
  abbr: string
  color: string
  mainDomain: string
  domains: string[]
  lpDomains: string[]
}

export const BRANDS: Brand[] = [ /* …verbatim from src/lib/brands.ts… */ ]

export const BRAND_BY_NAME: Record<string, Brand> = Object.fromEntries(
  BRANDS.map((b) => [b.name, b]),
)

// domain (lowercase) → brand name. BP/MAIN domains only.
export const DOMAIN_TO_BRAND: Record<string, string> = {}
BRANDS.forEach((b) => b.domains.forEach((d) => { DOMAIN_TO_BRAND[d.toLowerCase()] = b.name }))

// Landing-page domain → brand name. Kept separate from DOMAIN_TO_BRAND so the
// BP and LP namespaces don't bleed across category-tagged uploads.
export const LP_DOMAIN_TO_BRAND: Record<string, string> = {}
BRANDS.forEach((b) => b.lpDomains.forEach((d) => { LP_DOMAIN_TO_BRAND[d.toLowerCase()] = b.name }))

export const COUNTRY_LABELS: Record<string, string> = { /* …verbatim… */ }
```

Then append `normalizeCountry`, moved verbatim including its doc comment, which explains why it must not be duplicated.

- [ ] **Step 2: Turn `src/lib/brands.ts` into a re-export**

Replace the moved declarations with re-exports, and keep the UI-only exports where they are. The file should end up as:

```ts
// Brand data now lives in api/_lib/brands.ts so the serverless functions can
// import it too — api/ cannot import from src/, but src/ can import from api/.
// This file stays the frontend's import site, so no consumer changed.
export type { Brand } from '../../api/_lib/brands.js'
export {
  BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND, COUNTRY_LABELS,
  normalizeCountry,
} from '../../api/_lib/brands.js'

import { BRANDS } from '../../api/_lib/brands.js'

export function brandToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export const BRAND_BY_SLUG: Record<string, import('../../api/_lib/brands.js').Brand> =
  Object.fromEntries(BRANDS.map((b) => [brandToSlug(b.name), b]))
```

Then keep `BRAND_LOGO_COLORS` and `BRAND_FAVICONS` exactly as they are — they are UI-only and stay here.

- [ ] **Step 3: Point `parser.ts` and `types/index.ts` at the new home**

In `src/lib/parser.ts`, delete the `normalizeCountry` function body and add it to the existing brands import:

```ts
import { DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND, COUNTRY_LABELS, normalizeCountry } from './brands'
```

`COUNTRY_LABELS` is still used elsewhere in `parser.ts`; leave those uses alone.

In `src/types/index.ts`, delete the `Brand` interface and re-export it so every existing `import type { Brand } from '../types'` keeps working:

```ts
export type { Brand } from '../../api/_lib/brands.js'
```

- [ ] **Step 4: Verify nothing changed behaviourally**

Run: `npx vitest run`
Expected: 96 passing, 2 failing (the pre-existing `ssoPortal` pair). **Not one sync test may change or fail** — they exercise `DOMAIN_TO_BRAND` and `normalizeCountry` heavily, so a green run here is the real proof the move was faithful.

Run: `npm run build`
Expected: passes. If `tsc` complains about the `.js` specifier from `src/`, do **not** switch it to an extensionless import — that would break the `api/` side. Report the error instead.

- [ ] **Step 5: Verify the serverless build still resolves**

Run: `npx vercel build`
Expected: completes without a module-resolution error. This project has hit that failure mode before, and it is invisible to `tsc`. If `vercel build` is not authenticated for this project, say so in your report rather than skipping silently.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/brands.ts src/lib/brands.ts src/lib/parser.ts src/types/index.ts
git commit -m "refactor: move brand data into api/_lib so functions can use it

api/ cannot import from src/, but src/ can import from api/. src/lib/brands.ts
stays the frontend's import site, so no consumer changed. normalizeCountry moves
with it, which also gets xlsx out of the sync module's dependency graph."
```

---

### Task 2: Move the normalizer into `api/_lib/`

**Files:**
- Create: `api/_lib/sitesNormalize.ts`
- Modify: `src/lib/sitesNormalize.ts` (becomes a re-export plus a type guard)
- Move: `src/lib/sitesNormalize.test.ts` → `api/_lib/sitesNormalize.test.ts`

**Interfaces:**
- Consumes: `DOMAIN_TO_BRAND`, `normalizeCountry` from `api/_lib/brands.js` (Task 1).
- Produces, from `api/_lib/sitesNormalize.ts`: `interface ApiRow`, `interface SyncRecord`, `interface SkippedDomain`, `normalizeRows(rows: ApiRow[]): { records: SyncRecord[]; unknownDomains: SkippedDomain[]; rawDate: string }`, plus `canonicalDomain`, `positionToString`, `changeToString`, `checkedAtDate`, `reduceLatest`. Tasks 3 and 6 import from here.

- [ ] **Step 1: Create the shared module**

Create `api/_lib/sitesNormalize.ts` by moving `src/lib/sitesNormalize.ts` **verbatim**, with exactly three changes:

1. Imports become:

```ts
import { DOMAIN_TO_BRAND, normalizeCountry } from './brands.js'
```

2. The two types it used to import from `src/` are declared locally, because this file must not import from `src/`:

```ts
/**
 * Structurally identical to the app's RankingRecord. Declared here because
 * api/_lib must not import from src/. src/lib/sitesNormalize.ts carries a
 * compile-time guard that fails the build if the two shapes ever diverge.
 */
export interface SyncRecord {
  domain:              string
  keyword:             string
  country:             string
  position:            string
  previous:            string
  change:              string
  date:                string
  searchVolume?:       string
  affiliateUrl?:       string
  globalSearchVolume?: string
}

/** Structurally identical to the app's UnknownDomain, for the same reason. */
export interface SkippedDomain {
  domain: string
  count:  number
}
```

3. `NormalizeResult` now reads:

```ts
export interface NormalizeResult {
  records:        SyncRecord[]
  /** Rows dropped because the domain is not in BRANDS, counted per domain, busiest first. */
  unknownDomains: SkippedDomain[]
  /** Newest checked_at date among the KEPT rows; '' when none. */
  rawDate:        string
}
```

Everything else — every rule, every comment explaining the observed API behaviour — moves unchanged.

- [ ] **Step 2: Turn `src/lib/sitesNormalize.ts` into a re-export with a drift guard**

```ts
import type { RankingRecord } from '../types'
import type { UnknownDomain } from './parser'
import type { SyncRecord, SkippedDomain } from '../../api/_lib/sitesNormalize.js'

// The normalizer moved to api/_lib so the cron can use it. This file stays the
// frontend's import site.
export type { ApiRow, NormalizeResult } from '../../api/_lib/sitesNormalize.js'
export {
  normalizeRows, canonicalDomain, positionToString, changeToString,
  checkedAtDate, reduceLatest,
} from '../../api/_lib/sitesNormalize.js'

/**
 * api/_lib declares its own record types because it cannot import from src/.
 * These assertions fail the build if the two ever drift — which matters because
 * applyCarryForward keys on a byte-compared country field, so a shape change on
 * one side and not the other would silently break GSV/SV/AFF inheritance.
 * Assignability is checked in BOTH directions on purpose: one direction alone
 * would let a field be added to either side unnoticed.
 */
type Assert<T extends true> = T
type Mutually<A, B> = A extends B ? (B extends A ? true : false) : false
export type _RecordShapesMatch  = Assert<Mutually<SyncRecord, RankingRecord>>
export type _SkippedShapesMatch = Assert<Mutually<SkippedDomain, UnknownDomain>>
```

- [ ] **Step 3: Move the tests**

```bash
git mv src/lib/sitesNormalize.test.ts api/_lib/sitesNormalize.test.ts
```

Change only the import line to `from './sitesNormalize.js'`, and add `// @vitest-environment node` as the first line to match the other `api/` tests. **Change nothing else** — all 21 assertions must pass untouched.

- [ ] **Step 4: Verify**

Run: `npx vitest run api/_lib/sitesNormalize.test.ts`
Expected: PASS, 21 tests.

Run: `npx vitest run`
Expected: 96 passing, 2 failing (the pre-existing pair).

Run: `npm run build`
Expected: passes. A failure on `_RecordShapesMatch` means the shapes genuinely differ — fix `SyncRecord`, never delete the guard.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move the sites normalizer into api/_lib

One implementation for the button and the cron. src/lib/sitesNormalize.ts
re-exports it and carries a bidirectional type guard, so the locally-declared
SyncRecord cannot drift from RankingRecord without failing the build."
```

---

### Task 3: Share the upstream fetch and the paging loop

Today `api/sites.ts` owns the vendor URL and clamps, and `src/lib/sitesApi.ts` owns the page-until-short loop. The cron needs both server-side. Extract each into one place.

**Files:**
- Create: `api/_lib/ranks.ts`
- Create: `api/_lib/ranksPaging.ts`
- Create: `api/_lib/ranksPaging.test.ts`
- Modify: `api/sites.ts` (use `api/_lib/ranks.js`)
- Modify: `src/lib/sitesApi.ts` (import `fetchAllRows` from `api/_lib/ranksPaging.js`)
- Modify: `src/lib/sitesApi.test.ts` (drop the `fetchAllRows` tests that move)

**Interfaces:**
- Consumes: `ApiRow` from `api/_lib/sitesNormalize.js` (Task 2).
- Produces:
  - `api/_lib/ranks.ts`: `RANKS_UPSTREAM: string`, `ALLOWED_ACTIONS: Set<string>`, `MAX_LIMIT = 1000`, `clampInt(raw, min, max, fallback): number`, `buildRanksUrl(action: string, limit: number, offset: number): URL`, `fetchRanksPage(key: string, url: URL, timeoutMs: number, signal?: AbortSignal): Promise<Response>`.
  - `api/_lib/ranksPaging.ts`: `PAGE_SIZE = 1000`, `MAX_ROWS = 100_000`, `fetchAllRows(fetchPage, onProgress?, pageSize?): Promise<ApiRow[]>`.
- Task 6 uses both.

- [ ] **Step 1: Move the paging loop**

Create `api/_lib/ranksPaging.ts` containing `PAGE_SIZE`, `MAX_ROWS` and `fetchAllRows`, moved **verbatim** from `src/lib/sitesApi.ts` including the comment explaining why `meta.total` is ignored. Its only import:

```ts
import type { ApiRow } from './sitesNormalize.js'
```

`fetchAllRows` currently throws `SitesApiError`, which lives in `src/lib/sitesApi.ts` and must not move (the browser branches on it). Have the paging module throw a plain `Error` for its one internal case and let callers wrap:

```ts
    if (all.length >= MAX_ROWS) {
      throw new Error(
        `Sites API pagination exceeded ${MAX_ROWS} rows — aborting to avoid an unbounded loop`,
      )
    }
```

In `src/lib/sitesApi.ts`, keep `SitesApiError` and `fetchProxyPage` exactly as they are, and re-export the moved pieces:

```ts
export { PAGE_SIZE, fetchAllRows } from '../../api/_lib/ranksPaging.js'
import { fetchAllRows } from '../../api/_lib/ranksPaging.js'
```

- [ ] **Step 2: Move the paging tests**

Create `api/_lib/ranksPaging.test.ts` by moving the six `fetchAllRows` tests out of `src/lib/sitesApi.test.ts` verbatim, with `// @vitest-environment node` first and the import changed to `./ranksPaging.js`. Change the one assertion that expects `SitesApiError` on the cap:

```ts
  it('aborts rather than looping past the row cap', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(10))
    await expect(fetchAllRows(fetchPage, undefined, 10)).rejects.toThrow(/exceeded/)
  })
```

Leave the 13 `parsePageBody` / `fetchProxyPage` tests in `src/lib/sitesApi.test.ts`.

- [ ] **Step 3: Run both test files**

Run: `npx vitest run api/_lib/ranksPaging.test.ts src/lib/sitesApi.test.ts`
Expected: PASS, 19 total (6 + 13).

- [ ] **Step 4: Extract the upstream fetch**

Create `api/_lib/ranks.ts` with the URL, allow-list, clamp and fetch that `api/sites.ts` holds today, moved verbatim:

```ts
/** The vendor endpoint. Defined once so the proxy and the cron cannot drift. */
export const RANKS_UPSTREAM = 'https://3213211.xyz/bpn-panel-cc/api/ranks.php'

// `results` is the only action any caller uses. `domains` was allowed once; it
// widened the surface for nothing.
export const ALLOWED_ACTIONS = new Set(['results'])
export const MAX_LIMIT = 1000

export function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * Deliberately NO project_id. The Rooster set is project 0, and the upstream
 * treats 0 as falsy — passing it returns every project rather than filtering.
 * DOMAIN_TO_BRAND is the authoritative filter.
 */
export function buildRanksUrl(action: string, limit: number, offset: number): URL {
  const url = new URL(RANKS_UPSTREAM)
  url.searchParams.set('action', action)
  url.searchParams.set('limit',  String(limit))
  url.searchParams.set('offset', String(offset))
  return url
}

/** One upstream request, with the key attached and a hard timeout. */
export function fetchRanksPage(
  key: string,
  url: URL,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  })
}
```

Then rewrite `api/sites.ts`'s URL-building and fetch to call these, deleting its local copies. Keep its `TIMEOUT_MS`, `config`, auth gate and error handling exactly as they are.

- [ ] **Step 5: Verify the proxy is unchanged**

Run: `npx vitest run api/sites.test.ts`
Expected: PASS, 23 tests, **none modified**. These assert the built URL, the bearer header, the clamps and the absence of `project_id` — if they still pass, the extraction was faithful.

Run: `npx vitest run` → 96 passing, 2 failing. Then `npm run build` → passes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: one home for the ranks upstream and the paging loop

api/sites.ts and the coming cron both need them; keeping two copies is how the
normalizeCountry divergence happened."
```

---

### Task 4: Record who created each snapshot

**Files:**
- Create: `supabase/cron-sync.sql`
- Modify: `src/lib/storage.ts:169` (`upsertSnapshot` takes a source) and `:223` (`updateRecordFields` marks the snapshot human-touched)
- Modify: `src/App.tsx` (pass `'upload'` or `'sync'` at each call site)
- Modify: `src/types/index.ts` (add `source` to `Snapshot`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `snapshots.source` column (`'upload' | 'sync'`, default `'upload'`); `type SnapshotSource = 'upload' | 'sync'` exported from `src/types/index.ts`; `upsertSnapshot(snapshot: Snapshot, source: SnapshotSource): Promise<void>`. Task 5 reads the column.

- [ ] **Step 1: Write the migration**

Create `supabase/cron-sync.sql`:

```sql
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
```

- [ ] **Step 2: Thread the source through the type and the writer**

In `src/types/index.ts`, add the type and the field:

```ts
/** Who created a snapshot. The scheduled sync only ever replaces its own. */
export type SnapshotSource = 'upload' | 'sync'
```

and inside `interface Snapshot`, after `displayDate`:

```ts
  /** Absent on snapshots loaded before the column existed; treat as 'upload'. */
  source?: SnapshotSource
```

In `src/lib/storage.ts`, change the signature and the insert:

```ts
export async function upsertSnapshot(snapshot: Snapshot, source: SnapshotSource): Promise<void> {
```

```ts
  const { error: eIns } = await supabase.from('snapshots').insert({
    id:           snapshot.id,
    raw_date:     snapshot.rawDate,
    display_date: snapshot.displayDate,
    category:     snapshot.category,
    source,
  })
```

Add `SnapshotSource` to the type import at the top of `storage.ts`.

- [ ] **Step 3: Make an inline edit mark the snapshot human-touched**

Still in `src/lib/storage.ts`, append to `updateRecordFields`, after the existing records update succeeds:

```ts
  // A hand edit makes this snapshot human work, whatever created it. Without
  // this, the scheduled sync would happily replace a button-synced snapshot
  // that someone had since typed a GSV value onto, and the "never destroys a
  // snapshot a person edited" guarantee would be nominal only.
  const { error: eSrc } = await supabase
    .from('snapshots')
    .update({ source: 'upload' })
    .eq('id', snapshotId)
  if (eSrc) throw eSrc
```

- [ ] **Step 4: Pass the source at every call site**

In `src/App.tsx`, `persistOneSnapshot` is the single writer. Give it a source parameter and pass it through:

```ts
  const persistOneSnapshot = useCallback(async (
    parsed: ParsedSnapshot,
    category: CategoryId,
    source: SnapshotSource,
  ): Promise<Snapshot | null> => {
```

```ts
      await requireAuth(() => upsertSnapshot(newSnap, source))
```

Add `SnapshotSource` to the type import from `./types`. Then update all four call sites — `handleImport`'s single-snapshot path and its bulk loop pass `'upload'`; `handleSyncFromApi` passes `'sync'`; `handleReplaceDuplicate` passes `source === 'sync' ? 'sync' : 'upload'`, reusing the `source` it already destructures from `duplicateWarning`. TypeScript will point at any you miss.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: passes. The added parameter is required, so a missed call site is a compile error, not a silent default.

Run: `npx vitest run`
Expected: 96 passing, 2 failing.

- [ ] **Step 6: Ask the user to run the migration, then verify it landed**

Tell the user, verbatim:

> Run `supabase/cron-sync.sql` in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run). It adds one column and is safe to re-run. Nothing else in this task works until it has run.

Once they confirm, verify from the repo:

```bash
node -e "
const fs=require('fs');
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
(async()=>{
  const b=await (await fetch(env.VITE_SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:env.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:env.Email,password:env.Password})})).json();
  const r=await fetch(env.VITE_SUPABASE_URL+'/rest/v1/snapshots?select=id,source&limit=3',{headers:{apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:'Bearer '+b.access_token}});
  console.log(r.status, await r.text());
})();
"
```

Expected: `200` and rows whose `source` is `"upload"`. A 400 mentioning `source` means the migration has not run. Never print the credentials this script reads.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(storage): record whether a snapshot was uploaded or synced

The scheduled sync needs to replace its own snapshots without touching one a
person made. An inline edit also flips source to 'upload', so a hand-edited
sync snapshot stops being replaceable."
```

---

### Task 5: Service-role persistence and the overwrite rule

**Files:**
- Create: `api/_lib/snapshotStore.ts`
- Create: `api/_lib/snapshotStore.test.ts`

**Interfaces:**
- Consumes: `SyncRecord` from `api/_lib/sitesNormalize.js` (Task 2); the `source` column (Task 4).
- Produces:
  - `decideWrite(existing: { source?: string | null } | null): 'insert' | 'replace' | 'skip'`
  - `createAdminClient(env: Record<string,string|undefined>): AdminClient`
  - `findSnapshot(admin, category: string, rawDate: string): Promise<{ id: string; source?: string | null } | null>`
  - `writeSnapshot(admin, snap: { id: string; category: string; rawDate: string; displayDate: string; records: SyncRecord[] }): Promise<void>`
  - `logCronActivity(admin, section: string, summary: string): Promise<void>`
  - `RECORD_CHUNK = 500`
- Task 6 uses all of them.

- [ ] **Step 1: Write the failing test**

Create `api/_lib/snapshotStore.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { decideWrite, chunk, writeSnapshot, RECORD_CHUNK } from './snapshotStore.js'
import type { AdminClient } from './snapshotStore.js'

describe('decideWrite', () => {
  it('inserts when no snapshot exists for the date', () => {
    expect(decideWrite(null)).toBe('insert')
  })

  it('replaces a snapshot the sync itself created', () => {
    expect(decideWrite({ source: 'sync' })).toBe('replace')
  })

  it('skips a snapshot a person uploaded', () => {
    expect(decideWrite({ source: 'upload' })).toBe('skip')
  })

  it('skips when the source is missing — an un-migrated row is human work', () => {
    expect(decideWrite({})).toBe('skip')
    expect(decideWrite({ source: null })).toBe('skip')
  })

  it('skips an unrecognised source rather than guessing', () => {
    expect(decideWrite({ source: 'imported-by-some-future-thing' })).toBe('skip')
  })
})

describe('chunk', () => {
  it('splits on the 500-row boundary', () => {
    const rows = Array.from({ length: 1109 }, (_, i) => i)
    const out = chunk(rows, RECORD_CHUNK)
    expect(out.map((c) => c.length)).toEqual([500, 500, 109])
  })

  it('returns nothing for an empty list', () => {
    expect(chunk([], RECORD_CHUNK)).toEqual([])
  })

  it('returns one chunk when the input is shorter than the size', () => {
    expect(chunk([1, 2, 3], RECORD_CHUNK)).toEqual([[1, 2, 3]])
  })
})

describe('writeSnapshot', () => {
  /**
   * A stub whose record-insert fails on the Nth call. Everything else succeeds,
   * so the only thing under test is whether the failure surfaces.
   */
  function adminFailingInsertOn(n: number) {
    let inserts = 0
    return {
      from: (table: string) => ({
        delete: () => ({ eq: async () => ({ error: null }) }),
        insert: async () => {
          if (table !== 'ranking_records') return { error: null }
          inserts += 1
          return inserts === n ? { error: { message: 'payload too large' } } : { error: null }
        },
      }),
    } as unknown as AdminClient
  }

  const snap = (count: number) => ({
    id: 'snap-bp-sites-2026-08-04',
    category: 'bp-sites',
    rawDate: '2026-08-04',
    displayDate: '4 Aug 26',
    records: Array.from({ length: count }, (_, i) => ({
      domain: 'rooster.bet', keyword: `kw-${i}`, country: 'AU',
      position: '1', previous: '1', change: '0', date: '2026-08-04',
    })),
  })

  it('propagates a failure on the FIRST record chunk rather than swallowing it', async () => {
    await expect(writeSnapshot(adminFailingInsertOn(1), snap(1109)))
      .rejects.toThrow(/payload too large/)
  })

  it('propagates a failure on a LATER chunk — the loop must not ignore it', async () => {
    // The regression this guards: a for-loop that collects errors instead of
    // throwing would write chunks 1 and 2 and report success.
    await expect(writeSnapshot(adminFailingInsertOn(3), snap(1109)))
      .rejects.toThrow(/payload too large/)
  })

  it('resolves when every chunk succeeds', async () => {
    await expect(writeSnapshot(adminFailingInsertOn(99), snap(1109))).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run api/_lib/snapshotStore.test.ts`
Expected: FAIL — `Failed to resolve import "./snapshotStore.js"`.

- [ ] **Step 3: Implement the module**

Create `api/_lib/snapshotStore.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import type { SyncRecord } from './sitesNormalize.js'

/** PostgREST handles far more, but 500 keeps request bodies comfortably small. */
export const RECORD_CHUNK = 500

/**
 * Whether the scheduled sync may write over what is already there.
 *
 * Fails safe in every uncertain case: only a snapshot explicitly marked as the
 * sync's own output is replaceable. A row with no source predates the migration
 * and is therefore human work, and an unrecognised source belongs to something
 * this function does not know about — neither is ours to destroy.
 */
export function decideWrite(
  existing: { source?: string | null } | null,
): 'insert' | 'replace' | 'skip' {
  if (!existing) return 'insert'
  return existing.source === 'sync' ? 'replace' : 'skip'
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The admin client. This is the one place the service-role key is used on the
 * sync path, and it is used because a cron has no user session to act as — RLS
 * would reject every write. api/sites.ts deliberately does NOT use it: there a
 * real caller exists, so their own token is the right authority.
 */
export type AdminClient = ReturnType<typeof createClient>

export function createAdminClient(env: Record<string, string | undefined>): AdminClient {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Scheduled sync is not configured — set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY',
    )
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function findSnapshot(
  admin: AdminClient,
  category: string,
  rawDate: string,
): Promise<{ id: string; source?: string | null } | null> {
  const { data, error } = await admin
    .from('snapshots')
    .select('id, source')
    .eq('category', category)
    .eq('raw_date', rawDate)
    .maybeSingle()
  if (error) throw new Error(`Could not read existing snapshots: ${error.message}`)
  return (data as { id: string; source?: string | null } | null) ?? null
}

/**
 * Delete-then-insert, matching src/lib/storage.ts. Records are cleared
 * explicitly rather than trusting ON DELETE CASCADE — if the FK is not actually
 * configured that way, deleting only the snapshot leaves orphans and the next
 * write silently doubles the data.
 *
 * Not transactional: PostgREST cannot wrap these in one transaction, so a
 * failure mid-insert leaves a partial snapshot. That risk already exists on the
 * upload path and is out of scope here; the run fails loudly and the next one
 * rewrites the same date.
 */
export async function writeSnapshot(
  admin: AdminClient,
  snap: { id: string; category: string; rawDate: string; displayDate: string; records: SyncRecord[] },
): Promise<void> {
  const { error: eRecs } = await admin.from('ranking_records').delete().eq('snapshot_id', snap.id)
  if (eRecs) throw new Error(`Could not clear existing records: ${eRecs.message}`)

  const { error: eSnap } = await admin.from('snapshots').delete().eq('id', snap.id)
  if (eSnap) throw new Error(`Could not clear the existing snapshot: ${eSnap.message}`)

  const { error: eIns } = await admin.from('snapshots').insert({
    id:           snap.id,
    raw_date:     snap.rawDate,
    display_date: snap.displayDate,
    category:     snap.category,
    source:       'sync',
  })
  if (eIns) throw new Error(`Could not write the snapshot: ${eIns.message}`)

  for (const slice of chunk(snap.records, RECORD_CHUNK)) {
    const { error } = await admin.from('ranking_records').insert(
      slice.map((r) => ({
        snapshot_id:          snap.id,
        domain:               r.domain,
        keyword:              r.keyword,
        country:              r.country,
        position:             r.position,
        previous:             r.previous,
        change:               r.change,
        date:                 r.date,
        search_volume:        r.searchVolume ?? '',
        affiliate_url:        r.affiliateUrl ?? '',
        global_search_volume: r.globalSearchVolume ?? '',
      })),
    )
    if (error) throw new Error(`Could not write records: ${error.message}`)
  }
}

/**
 * One row per run, success or failure — /log is the cron's only history.
 * user_id is null because no user ran this; the column is nullable, and the
 * service-role client bypasses the RLS policy that would demand auth.uid().
 */
export async function logCronActivity(
  admin: AdminClient,
  section: string,
  summary: string,
): Promise<void> {
  const { error } = await admin.from('activity_log').insert({
    user_id: null,
    email:   'cron@ranking-reports',
    action:  'sync',
    section,
    summary,
  })
  // Never let a failed log write mask the outcome it was describing.
  if (error) console.error('logCronActivity failed:', error.message)
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run api/_lib/snapshotStore.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/snapshotStore.ts api/_lib/snapshotStore.test.ts
git commit -m "feat(cron): service-role snapshot persistence and the overwrite rule

decideWrite fails safe: only a snapshot explicitly marked 'sync' is
replaceable, so a missing or unrecognised source is left alone."
```

---

### Task 6: The cron endpoint

**Files:**
- Create: `api/cron-sync.ts`
- Create: `api/cron-sync.test.ts`
- Modify: `vercel.json`
- Modify: `.env.example`
- Modify: `docs/integrations/sites-api.md`

**Interfaces:**
- Consumes: everything produced by Tasks 1, 2, 3 and 5.
- Produces: `GET /api/cron-sync`, and `export const config = { maxDuration: 60 }`.

- [ ] **Step 1: Write the failing test**

Create `api/cron-sync.test.ts`. This covers the auth gate, which is the part that must be right before anything else matters:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './cron-sync.js'

// Four of these tests stop at the auth gate, but the fifth deliberately gets
// past it, so the stub has to survive a full no-rows run: findSnapshot's
// select chain and logCronActivity's insert both get called. A bare {} here
// throws inside the handler's try, the catch logs, and that throws again.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: async () => ({ error: null }),
      delete: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    }),
  }),
}))

type MockRes = VercelResponse & {
  status: ReturnType<typeof vi.fn>
  json:   ReturnType<typeof vi.fn>
}

function makeRes(): MockRes {
  const res: Partial<MockRes> = {}
  res.status = vi.fn(() => res as MockRes)
  res.json   = vi.fn(() => res as MockRes)
  return res as MockRes
}

function makeReq(method: string, headers: Record<string, string>): VercelRequest {
  return { method, headers, query: {} } as unknown as VercelRequest
}

let fetchMock: ReturnType<typeof vi.fn>
const saved: Record<string, string | undefined> = {}
const MANAGED = ['CRON_SECRET', 'SITES_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']

beforeEach(() => {
  for (const n of MANAGED) saved[n] = process.env[n]
  process.env.CRON_SECRET               = 'secret-value'
  process.env.SITES_API_KEY             = 'bpn_test'
  process.env.SUPABASE_URL              = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_test'
  fetchMock = vi.fn(async () => new Response('{"ok":true,"data":[]}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  for (const n of MANAGED) {
    if (saved[n] === undefined) delete process.env[n]
    else process.env[n] = saved[n]
  }
  vi.unstubAllGlobals()
})

describe('api/cron-sync auth', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = makeRes()
    await handler(makeReq('GET', {}), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer nope' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when CRON_SECRET is unset, rejecting even a matching header', async () => {
    delete process.env.CRON_SECRET
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer undefined' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-GET even with the right secret', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { authorization: 'Bearer secret-value' }), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gets past the gate with the right secret and reaches the vendor', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)
    expect(fetchMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run api/cron-sync.test.ts`
Expected: FAIL — `Failed to resolve import "./cron-sync.js"`.

- [ ] **Step 3: Implement the handler**

Create `api/cron-sync.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bearerToken } from './_lib/requestAuth.js'
import { ALLOWED_ACTIONS, MAX_LIMIT, buildRanksUrl, fetchRanksPage } from './_lib/ranks.js'
import { fetchAllRows, PAGE_SIZE } from './_lib/ranksPaging.js'
import { normalizeRows, type ApiRow } from './_lib/sitesNormalize.js'
import {
  createAdminClient, decideWrite, findSnapshot, logCronActivity, writeSnapshot,
} from './_lib/snapshotStore.js'

/** Hobby caps functions at 60s. A run is ~10-15s, so the headroom is real. */
export const config = { maxDuration: 60 }
const TIMEOUT_MS = 45_000

const CATEGORY = 'bp-sites'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** '2026-08-04' → '4 Aug 26'. Mirrors formatDisplayDate in src/lib/parser.ts. */
function formatDisplayDate(rawDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate)
  if (!m) return rawDate
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1].slice(2)}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  // Fails closed: with CRON_SECRET unset there is no value a caller could send
  // that matches, so a half-configured deployment is inert rather than an open
  // endpoint that writes to the database.
  const secret = process.env.CRON_SECRET
  const token  = bearerToken(req.headers?.authorization)
  if (!secret || token !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  const key = process.env.SITES_API_KEY
  if (!key) {
    return res.status(500).json({ ok: false, error: 'SITES_API_KEY is not configured on the server' })
  }

  let admin
  try {
    admin = createAdminClient(process.env)
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }

  try {
    const action = 'results'
    if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Unsupported action "${action}"`)

    const rows = await fetchAllRows(async (offset) => {
      const url = buildRanksUrl(action, Math.min(PAGE_SIZE, MAX_LIMIT), offset)
      const upstream = await fetchRanksPage(key, url, TIMEOUT_MS)
      const body = await upstream.json().catch(() => null)
      if (!upstream.ok || body?.ok === false) {
        throw new Error(body?.error ?? `the Ranks API returned HTTP ${upstream.status}`)
      }
      if (!Array.isArray(body?.data)) {
        throw new Error('the Ranks API returned an unexpected payload (no data array)')
      }
      return body.data as ApiRow[]
    })

    const { records, unknownDomains, rawDate } = normalizeRows(rows)

    if (records.length === 0) {
      const summary = `Scheduled sync — 0 Rooster rows after filtering; nothing written (${unknownDomains.length} foreign domains)`
      await logCronActivity(admin, CATEGORY, summary)
      return res.status(200).json({ ok: true, outcome: 'empty', summary })
    }

    const id       = `snap-${CATEGORY}-${rawDate}`
    const display  = formatDisplayDate(rawDate)
    const existing = await findSnapshot(admin, CATEGORY, rawDate)
    const decision = decideWrite(existing)

    if (decision === 'skip') {
      const summary = `Scheduled sync — skipped ${display}: that snapshot was uploaded or edited by a person`
      await logCronActivity(admin, CATEGORY, summary)
      return res.status(200).json({ ok: true, outcome: 'skipped', summary })
    }

    await writeSnapshot(admin, {
      id: existing?.id ?? id,
      category: CATEGORY,
      rawDate,
      displayDate: display,
      records,
    })

    const summary =
      decision === 'replace'
        ? `Scheduled sync — replaced ${display} (${records.length.toLocaleString()} records)`
        : `Scheduled sync — ${records.length.toLocaleString()} records (${display})`
    await logCronActivity(admin, CATEGORY, summary)
    return res.status(200).json({ ok: true, outcome: decision, summary, records: records.length })
  } catch (err) {
    const message = (err as Error).message
    const summary = `Scheduled sync failed: ${message}`
    await logCronActivity(admin, CATEGORY, summary)
    // Non-2xx so Vercel's own cron log agrees with the activity log rather than
    // reporting a clean run.
    return res.status(502).json({ ok: false, error: summary })
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run api/cron-sync.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Register the schedule**

Replace `vercel.json` with:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "crons": [
    { "path": "/api/cron-sync", "schedule": "0 4 * * 3,5" }
  ]
}
```

04:00 UTC is 12:00 PHT; the Philippines observes no DST, so this needs no seasonal adjustment. On the Hobby plan Vercel may fire it at any minute inside that hour.

- [ ] **Step 6: Document the new secret**

Append to `.env.example`:

```
# Scheduled sync (api/cron-sync.ts, Wed + Fri 04:00 UTC = 12:00 PHT).
# Vercel sends this automatically as `Authorization: Bearer $CRON_SECRET` once
# the variable exists in the project environment. Any long random string.
# Server-only: never add a VITE_ prefix. The endpoint 401s everything while it
# is unset, so a half-configured deployment cannot write to the database.
# The write itself uses SUPABASE_SERVICE_ROLE_KEY, which the SSO callback
# already requires — a cron has no user session, so RLS would reject it.
CRON_SECRET=generate-a-long-random-string
```

Append to `docs/integrations/sites-api.md`:

```markdown
### Scheduled sync

`api/cron-sync.ts` runs the same pull automatically at 04:00 UTC (12:00 PHT) on
Wednesdays and Fridays, registered in `vercel.json`. It is gated by
`CRON_SECRET` and fails closed while that variable is unset.

It writes with the service-role key, because a cron has no user session for RLS
to evaluate. It only ever replaces a snapshot whose `snapshots.source` is
`'sync'` — one that a person uploaded, or has since edited inline, is skipped
and the skip is logged. Every run writes one `activity_log` row, so `/log` is
the cron's history.
```

- [ ] **Step 7: Verify the whole thing**

Run: `npx vitest run`
Expected: 112 passing, 2 failing (the pre-existing `ssoPortal` pair). The passing count must be higher than the 96 baseline, never lower.

Run: `npm run build` → passes.

Run: `npx vercel build`
Expected: completes, and lists `api/cron-sync` among the built functions. Report the output.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(cron): scheduled BP sync on Wednesdays and Fridays at 12:00 PHT

Gated by CRON_SECRET and failing closed while it is unset. Replaces only
snapshots the sync itself created; a snapshot someone uploaded or edited is
skipped and the skip is logged. Every run writes one activity_log row."
```

- [ ] **Step 9: Hand the deployment steps to the user**

Generate a secret for them:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Then tell them, verbatim, substituting the generated value:

> Add `CRON_SECRET` to the Vercel project environment (Production) with this
> value: `<generated>`. Do not add a `VITE_` prefix. Vercel will send it
> automatically on every scheduled invocation. Until it exists the endpoint
> rejects everything, including Vercel's own cron.
>
> Cron jobs only run from a **production** deployment, so this starts firing
> after the branch is merged and deployed to production — not from a preview.

After they confirm and the branch is deployed, verify with one manual call:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <secret>" \
  "https://<production-domain>/api/cron-sync"
```

Expected: `200`. Then confirm the run appears on `/log` as a Sync row. A `401`
means the variable is missing from Vercel; a `502` means the run itself failed
and the reason is in the response body and the log row.

---

## Notes for the implementer

**Do not "fix" these — they are deliberate:**

- `api/_lib/brands.ts` holding brand configuration looks misplaced. `api/` cannot import from `src/` and `src/` can import from `api/`, so this is the only direction that works without a third tsconfig project. `src/lib/brands.ts` is still the frontend's import site.
- `api/_lib/sitesNormalize.ts` declaring `SyncRecord` instead of importing `RankingRecord` looks like duplication. The bidirectional type guard in `src/lib/sitesNormalize.ts` is what stops it becoming real duplication; deleting the guard is the only way to get this wrong.
- `decideWrite` treating a missing `source` as `skip` looks over-cautious. A row without one predates the migration, which means a human made it.
- `writeSnapshot` deleting records explicitly before deleting the snapshot looks redundant against `ON DELETE CASCADE`. `src/lib/storage.ts` does the same, for the documented reason that the cascade has not always been configured.
- The cron calls the vendor directly instead of going through `/api/sites`. The proxy exists to keep the key out of the browser; server-side that hop would only add a timeout budget and an auth dance.
