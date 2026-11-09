# Ahrefs Sync (BP Sites) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Sync from API" and the Wed/Fri scheduled sync read BP rankings from the client's Ahrefs Rank Tracker, through endpoints that cost no API units, instead of OpenSEO.

**Architecture:** A server-only client (`api/_lib/ahrefs.ts`) lists the workspace's Rank Tracker projects and keeps those whose target is a BP domain. For each, it fetches the competitor list and one `competitors-overview` page, which holds the current and previous position for every slot. A browser-safe normalizer (`api/_lib/sitesNormalize.ts`) maps slots to domains and resolves sites that appear in several projects. It dates the snapshot by the weekly Ahrefs update. `api/sites.ts` and `api/cron-sync.ts` share both, and the OpenSEO client is deleted. A small script exports any past Ahrefs week as an import-ready xlsx, which is how Nov 3 gets replaced.

**Tech Stack:** TypeScript, Vercel Node functions, React + Vite, vitest, `xlsx` (SheetJS), `tsx` for the script.

**Spec:** `docs/superpowers/specs/2026-11-09-ahrefs-rank-sync-design.md`. Read it first: its "Coverage check results", "Mapping rules" and "Snapshot dating" sections are the requirements this plan implements.

## Global Constraints

- **`api/_lib/sitesNormalize.ts` ships to the browser.** No `process.env`, no `node:` imports, no secrets. `api/_lib/ahrefs.ts` is server-only and is never imported from `src/`.
- **Relative imports inside `api/` end in `.js`** (Vercel ESM under NodeNext).
- **The key reaches Ahrefs only**, as `Authorization: Bearer ${AHREFS_API_KEY}`. No response, toast, log line or error message contains the key or an upstream URL.
- **GET requests only, to three paths:** `management/projects`, `management/project-competitors` and `rank-tracker/competitors-overview`. A response whose `x-api-units-cost-total` header is above 0 fails the sync.
- **A project whose target is not a BP domain is never fetched.** That covers other clients' projects and LP projects.
- **The `api/sites.ts` auth gate is unchanged:** a Supabase session plus an approved `user_access` row.
- **Cron behaviour stays as it is:**
  - every run leaves exactly one `activity_log` row;
  - the fetch budget is still 35 s;
  - failures are non-2xx;
  - `decideWrite` is unchanged.
- **Desktop only.**
- **User-facing copy says "Ahrefs"** and never "OpenSEO".
- **Tests use synthetic fixtures only**, never the client's real Ahrefs data. Client data lives only under the gitignored `docs/references/`.

## Review Focus

1. **A late re-check must not change the weekly picture.** A check dated after the weekly update must not move the snapshot date, and it must not make the week's other rows count as "kept an earlier check" in the cron log, the toast or the sync summary.
   - Task 1: `cycleDate` tests.
   - Task 3: cron "dates the snapshot by the weekly update".
   - Task 4: `UploadSummary` switches to `cycleDate`.
2. **A competitor slot that doesn't rank becomes `NR`; it never disappears.** The nine main sites are only ever competitors.
   - Task 1: the first `normalizeAhrefs` test.
3. **A keyword Ahrefs has not checked yet (`serp_updated: null`) produces no record**, never `NR`.
   - Task 1: "makes no record for a keyword Ahrefs has not checked".
4. **If Ahrefs reorders competitors, the sync stops** instead of crediting rankings to the wrong site, and the proxy shows why.
   - Task 1: the slot-order tests.
   - Task 3: proxy "passes the normalizer's wording through".
5. **Another client's project and LP projects are never fetched.**
   - Task 2: "fetches only BP projects that have keywords".
   - Task 3: proxy "returns normalized records for the BP projects".

## File Structure

| File | Responsibility |
|---|---|
| `api/_lib/sitesNormalize.ts` | Browser-safe. Ahrefs response types, `hostOf`, `bpDomainOf`, `cycleDate` and `normalizeAhrefs`. Keeps `SyncRecord`, `SkippedDomain`, `NormalizeResult`, `canonicalDomain`, `countOlderChecks` and `SyncDataError`. The OpenSEO parts go in Task 3. |
| `api/_lib/ahrefs.ts` (new) | Server-only client: config, errors, retry, the project list, and each project's competitors and rankings. |
| `api/sites.ts`, `api/cron-sync.ts` | Switch from OpenSEO to Ahrefs. Behaviour is otherwise unchanged. |
| `src/lib/sitesNormalize.ts` | Frontend re-exports (Ahrefs types, `cycleDate`). |
| `src/components/UploadSummary.tsx` | Counts stale rows against `cycleDate`, and copy. |
| `src/App.tsx`, `src/components/DuplicateWarning.tsx`, `src/components/Sidebar.tsx`, `src/lib/sitesApi.ts` | Copy and comments. |
| `vite.config.ts`, `.env.example` | `AHREFS_API_KEY`. |
| `scripts/ahrefs-week-to-xlsx.mts` (new) | Read-only. Prints one Ahrefs week as the sync would see it and can write it as an import-ready xlsx. |
| `docs/integrations/ahrefs.md` (new), `docs/integrations/sites-api.md`, `CLAUDE.md` | Docs. |
| `api/_lib/openseo.ts`, `api/_lib/openseo.test.ts` | Deleted in Task 3. |

---

### Task 1: Normalizer (Ahrefs → records)

**Files:**
- Modify: `api/_lib/sitesNormalize.ts`. Add the Ahrefs half and leave the OpenSEO half for Task 3.
- Test: `api/_lib/sitesNormalize.test.ts`. Add new `describe` blocks and keep the OpenSEO ones until Task 3.

**Interfaces:**
- Consumes: `DOMAIN_TO_BRAND`, `LP_DOMAIN_TO_BRAND`, `normalizeCountry` from `./brands.js`, plus the existing `SyncRecord`, `NormalizeResult`, `SyncDataError` and `canonicalDomain`.
- Produces (all exported from `api/_lib/sitesNormalize.ts`):
  - `interface AhrefsSlot { url: string | null; position: number | null; position_prev?: number | null }`
  - `interface AhrefsKeywordRow { keyword: string; country: string; language: string; location?: string; serp_updated: string | null; serp_updated_prev?: string | null; competitors_list: AhrefsSlot[] }`
  - `interface AhrefsProject { projectId: number; name: string; target: string; competitors: string[]; rows: AhrefsKeywordRow[] }`. Here `target` and `competitors` are Ahrefs' raw `url` strings (`'rooster.bet/'`), and slot *i* > 0 of each row is `competitors[i-1]`.
  - `hostOf(raw: string | null | undefined): string`
  - `bpDomainOf(host: string): string`
  - `cycleDate(records: { date: string }[]): string`
  - `normalizeAhrefs(projects: AhrefsProject[]): NormalizeResult`

- [ ] **Step 0: Branch and commit the design docs**

```bash
git checkout main && git pull
git checkout -b feat/ahrefs-sync
git add docs/superpowers/specs/2026-11-09-ahrefs-rank-sync-design.md docs/superpowers/plans/2026-11-09-ahrefs-sync.md
git commit -m "docs: Ahrefs rank sync design and plan"
```

- [ ] **Step 1: Write the failing tests**

```ts
import {
  bpDomainOf, cycleDate, hostOf, normalizeAhrefs, SyncDataError,
  type AhrefsKeywordRow, type AhrefsProject,
} from './sitesNormalize.js'

const NOV3  = '2026-11-03T10:45:56Z'
const OCT27 = '2026-10-27T10:42:38Z'
type Slot = [url: string | null, position: number | null, prev: number | null]

function row(keyword: string, country: string, slots: Slot[], opts: Partial<AhrefsKeywordRow> = {}): AhrefsKeywordRow {
  return {
    keyword, country, language: country === 'DE' ? 'de' : country === 'IT' ? 'it' : 'en',
    serp_updated: NOV3, serp_updated_prev: OCT27,
    competitors_list: slots.map(([url, position, position_prev]) => ({ url, position, position_prev })),
    ...opts,
  }
}
const project = (projectId: number, target: string, competitors: string[], rows: AhrefsKeywordRow[]): AhrefsProject =>
  ({ projectId, name: `Project ${projectId}`, target, competitors, rows })
const at = (records: { domain: string }[], domain: string) => records.find((r) => r.domain === domain)

describe('hostOf / bpDomainOf', () => {
  it('reads a bare host or a full URL, without www.', () => {
    expect(hostOf('rooster.bet/')).toBe('rooster.bet')
    expect(hostOf('https://www.SpinsUp.com/en-CA')).toBe('spinsup.com')
    expect(hostOf(null)).toBe('')
  })
  it('maps a host to its BP domain, subdomains included, and nothing else', () => {
    expect(bpDomainOf('rooster.bet')).toBe('rooster.bet')
    expect(bpDomainOf('au.spinsup.com')).toBe('spinsup.com')
    expect(bpDomainOf('luckyvibe.net')).toBe('')   // an LP domain
    expect(bpDomainOf('example.com')).toBe('')
  })
})

describe('cycleDate', () => {
  const d = (date: string) => ({ date })
  it('is the weekly update day, not a later re-check', () => {
    expect(cycleDate([d('2026-11-03'), d('2026-11-03'), d('2026-11-04'), d('2026-11-08')])).toBe('2026-11-03')
  })
  it('counts only the 7 days up to the newest check', () => {
    // Mid-Tuesday: last week's rows still outnumber this week's.
    expect(cycleDate([d('2026-10-27'), d('2026-10-27'), d('2026-10-27'), d('2026-11-03')])).toBe('2026-11-03')
  })
  it('gives a tie to the later date and ignores undated records', () => {
    expect(cycleDate([d('2026-11-03'), d('2026-11-04'), d('')])).toBe('2026-11-04')
    expect(cycleDate([])).toBe('')
  })
})

describe('normalizeAhrefs', () => {
  it("turns every slot of a checked row into its domain's record", () => {
    const { records, rawDate, unknownDomains } = normalizeAhrefs([project(1, 'spinsupcasino.com/',
      ['spinsup.com/', 'spinsup.io/', 'casinospinsup.com/'], [row('spins up casino', 'NZ', [
        ['https://spinsupcasino.com/', 14, null],
        ['https://www.spinsup.com/', 1, 1],
        ['https://spinsup.io/', 17, 20],
        [null, null, null],
      ])])])
    expect(rawDate).toBe('2026-11-03')
    expect(unknownDomains).toEqual([])
    expect(records).toHaveLength(4)
    expect(at(records, 'spinsupcasino.com')).toEqual({
      domain: 'spinsupcasino.com', keyword: 'spins up casino', country: 'NZ', position: '14', previous: 'NR',
      change: '', date: '2026-11-03', searchVolume: '', affiliateUrl: '', globalSearchVolume: '',
    })
    expect(at(records, 'spinsup.com')).toMatchObject({ position: '1', previous: '1', change: '0' })
    expect(at(records, 'spinsup.io')).toMatchObject({ position: '17', previous: '20', change: '+3' })
    // An empty slot is NR for that slot's domain, never a missing row.
    expect(at(records, 'casinospinsup.com')).toMatchObject({ position: 'NR', previous: 'NR', change: '' })
  })

  it('makes no record for a keyword Ahrefs has not checked', () => {
    const result = normalizeAhrefs([project(1, 'spinsup.io/', [], [
      row('spinsup', 'AU', [[null, null, null]], { serp_updated: null, serp_updated_prev: null })])])
    expect(result).toEqual({ records: [], unknownDomains: [], rawDate: '' })
  })

  it('leaves Previous blank unless the previous check is from an earlier day', () => {
    const sameDay = normalizeAhrefs([project(1, 'spinsup.io/', [], [row('spinsup', 'AU',
      [['https://spinsup.io/', 2, 5]], { serp_updated: OCT27, serp_updated_prev: '2026-10-27T08:00:00Z' })])])
    expect(sameDay.records[0]).toMatchObject({ position: '2', previous: '', change: '' })
    const never = normalizeAhrefs([project(1, 'spinsup.io/', [], [row('spinsup', 'AU',
      [['https://spinsup.io/', 2, null]], { serp_updated_prev: null })])])
    expect(never.records[0]).toMatchObject({ previous: '', change: '' })
  })

  it('treats a zero or negative position as NR', () => {
    const { records } = normalizeAhrefs([project(1, 'spinsup.io/', [], [row('spinsup', 'AU', [['https://spinsup.io/', 0, null]])])])
    expect(records[0].position).toBe('NR')
  })

  it("stops when a ranked URL sits in another domain's slot", () => {
    const swapped = [project(1, 'spinsupcasino.com/', ['spinsup.com/', 'spinsup.io/'], [row('spinsup', 'AU', [
      [null, null, null], ['https://spinsup.io/', 3, 3], [null, null, null]])])]
    expect(() => normalizeAhrefs(swapped)).toThrow(SyncDataError)
    expect(() => normalizeAhrefs(swapped)).toThrow(
      `Ahrefs listed spinsup.io in spinsup.com's slot in "Project 1" — the competitor order changed, so nothing was saved`)
  })

  it('stops when a row has a different number of positions than the project has sites', () => {
    expect(() => normalizeAhrefs([project(1, 'spinsup.io/', ['spinsup.com/'], [row('spinsup', 'AU', [[null, null, null]])])]))
      .toThrow('Ahrefs returned 1 positions for 2 sites in "Project 1" — nothing was saved')
  })

  it("prefers a site's own project, then the best same-day position", () => {
    const { records } = normalizeAhrefs([
      project(1, 'roostersbet.com/', ['rooster.bet/'], [row('roosterbet casino', 'AU', [
        ['https://roostersbet.com/', 1, null], [null, null, null]])]),
      project(2, 'roosters.bet/', ['roostersbet.com/', 'rooster.bet/'], [row('roosterbet casino', 'AU', [
        [null, null, null], [null, null, null], ['https://rooster.bet/', 1, null]])]),
    ])
    expect(at(records, 'roostersbet.com')?.position).toBe('1')   // its own project says 1; project 2 says NR
    expect(at(records, 'rooster.bet')?.position).toBe('1')       // competitor-only: the best of NR and 1
    expect(at(records, 'roosters.bet')?.position).toBe('NR')
  })

  it('takes the newer check when two projects checked on different days', () => {
    const { records } = normalizeAhrefs([
      project(1, 'roostersbet.com/', [], [row('roosterbet casino', 'AU', [['https://roostersbet.com/', 1, null]])]),
      project(2, 'roosters.bet/', ['roostersbet.com/'], [row('roosterbet casino', 'AU',
        [[null, null, null], ['https://roostersbet.com/', 5, null]], { serp_updated: '2026-11-04T09:00:00Z' })]),
    ])
    expect(at(records, 'roostersbet.com')).toMatchObject({ position: '5', date: '2026-11-04' })
  })

  it("keeps only the target brand's domains and lists the unknown ones", () => {
    const { records, unknownDomains } = normalizeAhrefs([project(3, 'spinsup.io/',
      ['rooster.bet/', 'spinjo.de/', 'luckyvibe.net/'], [row('spinsup', 'AU', [
        ['https://spinsup.io/', 2, 2], ['https://rooster.bet/', 3, 3],
        ['https://spinjo.de/', 4, 4], ['https://luckyvibe.net/', 5, 5]])])])
    expect(records.map((r) => r.domain)).toEqual(['spinsup.io'])
    // rooster.bet is another brand's BP site. luckyvibe.net is a known LP site, so it is not listed.
    expect(unknownDomains).toEqual([{ domain: 'rooster.bet', count: 1 }, { domain: 'spinjo.de', count: 1 }])
  })

  it('ignores a project whose target is not a BP domain', () => {
    expect(normalizeAhrefs([project(4, 'trybet.ca/', ['rooster.bet/'], [row('trybet', 'CA',
      [['https://trybet.ca/', 1, 1], ['https://rooster.bet/', 2, 2]])])]))
      .toEqual({ records: [], unknownDomains: [], rawDate: '' })
  })

  it("keeps the market's main language when a keyword is tracked in two", () => {
    const { records } = normalizeAhrefs([project(1, 'spinsup.io/', [], [
      row('spinsup', 'CA', [['https://spinsup.io/', 9, 9]], { language: 'fr' }),
      row('spinsup', 'CA', [['https://spinsup.io/', 2, 2]]),
    ])])
    expect(records).toHaveLength(1)
    expect(records[0].position).toBe('2')
  })

  it('normalizes the country the way uploads do', () => {
    const { records } = normalizeAhrefs([project(1, 'spinsup.io/', [], [row('spinsup', 'au', [['https://spinsup.io/', 2, 2]])])])
    expect(records[0].country).toBe('AU')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run `npx vitest run api/_lib/sitesNormalize.test.ts`. Expected: FAIL, because `normalizeAhrefs` (and the others) are not exported.

- [ ] **Step 3: Implement the Ahrefs half of `api/_lib/sitesNormalize.ts`**

Use the signatures in Interfaces. The values the tests do not fully determine:

- **`hostOf`:** `new URL(raw.includes('://') ? raw : 'https://' + raw).hostname`, lowercased, with a leading `www.` removed. Unparseable input gives `''`.
- **`bpDomainOf`:** the exact `DOMAIN_TO_BRAND` key, else the key that `host` ends with as `.${key}`, else `''`.
- **`cycleDate`:** take the newest non-empty date N. Count the dates from N minus 6 days through N. Return the most common; a tie goes to the later date.
- **`MAIN_LANGUAGE`** is `{ AU: 'en', CA: 'en', NZ: 'en', DE: 'de', IT: 'it' }`, keyed by the normalized country.
- **`normalizeAhrefs`**, per project:
  1. **Brand.** The brand is `DOMAIN_TO_BRAND[bpDomainOf(hostOf(target))]`. With no brand, skip the project entirely.
  2. **Slots.** The slots are `[target, ...competitors]`, run through `hostOf`.
  3. **Rows.** For each row:
     - Skip it when `serp_updated` is null.
     - Throw the length `SyncDataError` when `competitors_list.length !== slots.length`.
     - Throw the slot-order error when a non-null `url`'s host is neither the slot's host nor a subdomain of it.
  4. **Each slot of a checked row:**
     - **Same-brand BP domain** → an observation `{ domain, keyword: keyword.trim(), country: normalizeCountry(country), language, own: slotIndex === 0, position, date: serp_updated.slice(0, 10), prevPosition: position_prev, prevDate: serp_updated_prev?.slice(0, 10) ?? '' }`.
     - **A BP domain of another brand, or a host in neither `DOMAIN_TO_BRAND` nor `LP_DOMAIN_TO_BRAND`** → +1 in `unknownDomains` for that host.
     - **An LP host** → skipped, not listed.

  Then pick one observation per `domain|keyword.toLowerCase()|country`:

  ```ts
  // 1. If any candidate is in MAIN_LANGUAGE[country], drop the rest.
  // 2. Keep only the candidates with the newest `date`.
  // 3. The site's own project (own === true) wins; otherwise the lowest
  //    position wins, with null (NR) worst.
  ```

  **Building each record:**
  - Ranks go through the existing `asRank` and `rankString`.
  - `previous` is `rankString(asRank(prevPosition))`, but only when `prevDate !== ''` and `prevDate < date`. Otherwise `previous` and `change` are `''`.
  - `change` uses the existing `changeString`.

  **Ordering and the result:**
  - Sort the records by domain, keyword and country with `localeCompare`, as `normalizeExports` does.
  - Sort `unknownDomains` by count descending, then by domain.
  - `rawDate` is `cycleDate(records)`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run `npx vitest run api/_lib/sitesNormalize.test.ts`. Expected: PASS, with the old OpenSEO tests still green.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/sitesNormalize.ts api/_lib/sitesNormalize.test.ts
git commit -m "feat(sync): normalize Ahrefs rank tracker data into records"
```

---

### Task 2: Ahrefs client (server-only)

**Files:**
- Create: `api/_lib/ahrefs.ts`
- Test: `api/_lib/ahrefs.test.ts`

**Interfaces:**
- Consumes: `AhrefsProject`, `AhrefsKeywordRow`, `hostOf` and `bpDomainOf` (Task 1).
- Produces (exported from `api/_lib/ahrefs.ts`):
  - `AHREFS_API_BASE = 'https://api.ahrefs.com/v3'`
  - `KEY_REJECTED = 'Ahrefs rejected the key — check AHREFS_API_KEY on the server (it may have expired or been revoked, or its creator left the Ahrefs workspace)'`
  - `interface AhrefsConfig { key: string }`
  - `class AhrefsError extends Error { readonly status: number | null }`
  - `ahrefsConfig(env: Record<string, string | undefined>): AhrefsConfig | null`
  - `isAbortLike(err: unknown): boolean`, moved from `openseo.ts`
  - `compareDate(asOf: string): string`: 7 days earlier, as `YYYY-MM-DD`
  - `interface FetchOptions { signal?: AbortSignal; requestTimeoutMs?: number; concurrency?: number; asOf?: string; retryDelayMs?: number }`
  - `fetchBpProjects(config: AhrefsConfig, opts?: FetchOptions): Promise<AhrefsProject[]>`

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AhrefsError, KEY_REJECTED, ahrefsConfig, compareDate, fetchBpProjects, type AhrefsConfig } from './ahrefs.js'

const CONFIG: AhrefsConfig = { key: 'ahk_test' }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const ROW = { keyword: 'roosterbet casino', country: 'AU', language: 'en', serp_updated: '2026-11-03T10:42:38Z',
  serp_updated_prev: '2026-10-27T10:42:38Z', competitors_list: [{ url: 'https://roostersbet.com/', position: 1, position_prev: 2 }] }
const PROJECTS = [
  { project_id: 1, project_name: 'Roostersbet.com', url: 'roostersbet.com/', keyword_count: 45 },
  { project_id: 2, project_name: 'Trybet.ca', url: 'trybet.ca/', keyword_count: 45 },                 // another client
  { project_id: 3, project_name: 'Casinorocketspin.com', url: 'casinorocketspin.com/', keyword_count: 0 },
  { project_id: 4, project_name: 'Luckyvibe.net', url: 'luckyvibe.net/', keyword_count: 10 },          // LP
]

let fetchMock: ReturnType<typeof vi.fn>
/** Routes by path. `override` answers first whenever it returns a Response. */
function stubAhrefs(override?: (path: string, url: URL) => Response | undefined) {
  fetchMock = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    if (init.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
    const url = new URL(String(input))
    const path = url.pathname.replace(/^\/v3\//, '')
    const hit = override?.(path, url)
    if (hit) return hit
    if (path === 'management/projects') return json({ projects: PROJECTS })
    if (path === 'management/project-competitors') return json({ competitors: [{ url: 'rooster.bet/', mode: 'subdomains' }] })
    return json({ keywords: [ROW] })
  })
  vi.stubGlobal('fetch', fetchMock)
}
const projectIdsFetched = () =>
  fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('project_id')).filter(Boolean)

beforeEach(() => stubAhrefs())
afterEach(() => vi.unstubAllGlobals())

describe('ahrefsConfig / compareDate', () => {
  it('returns null without a key and trims it', () => {
    expect(ahrefsConfig({})).toBeNull()
    expect(ahrefsConfig({ AHREFS_API_KEY: '  ' })).toBeNull()
    expect(ahrefsConfig({ AHREFS_API_KEY: ' k ' })).toEqual({ key: 'k' })
  })
  it('compares against 7 days earlier, across month and year ends', () => {
    expect(compareDate('2026-11-11')).toBe('2026-11-04')
    expect(compareDate('2026-03-03')).toBe('2026-02-24')
    expect(compareDate('2026-01-05')).toBe('2025-12-29')
  })
})

describe('fetchBpProjects', () => {
  it('fetches only BP projects that have keywords', async () => {
    const projects = await fetchBpProjects(CONFIG, { asOf: '2026-11-11' })
    expect(projects).toEqual([{ projectId: 1, name: 'Roostersbet.com', target: 'roostersbet.com/',
      competitors: ['rooster.bet/'], rows: [ROW] }])
    // Another client's project, an empty one and an LP one are never read.
    expect(new Set(projectIdsFetched())).toEqual(new Set(['1']))
  })

  it('sends only GETs with the Bearer key, to the three free endpoints', async () => {
    await fetchBpProjects(CONFIG, { asOf: '2026-11-11' })
    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://api.ahrefs.com')
      expect(['/v3/management/projects', '/v3/management/project-competitors', '/v3/rank-tracker/competitors-overview'])
        .toContain(url.pathname)
      expect((init as RequestInit).method ?? 'GET').toBe('GET')
      expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer ahk_test')
    }
  })

  it('asks for desktop, the as-of date and the week before, with every slot', async () => {
    await fetchBpProjects(CONFIG, { asOf: '2026-11-11' })
    const call = fetchMock.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.pathname.endsWith('competitors-overview'))!
    expect(call.searchParams.get('device')).toBe('desktop')
    expect(call.searchParams.get('date')).toBe('2026-11-11')
    expect(call.searchParams.get('date_compared')).toBe('2026-11-04')
    expect(call.searchParams.get('select')).toContain('competitors_list')
    expect(call.searchParams.get('select')).toContain('serp_updated_prev')
  })

  it('names a rejected key and does not retry it', async () => {
    for (const status of [401, 403]) {
      stubAhrefs(() => json({ error: 'nope' }, status))
      await expect(fetchBpProjects(CONFIG)).rejects.toThrow(KEY_REJECTED)
      await expect(fetchBpProjects(CONFIG)).rejects.toBeInstanceOf(AhrefsError)
      expect(fetchMock).toHaveBeenCalledTimes(2)   // one per attempt above, no retries
    }
  })

  it('retries a 5xx or 429 once, then names the request', async () => {
    let n = 0
    stubAhrefs((path) => (path === 'management/projects' && n++ === 0 ? json({}, 503) : undefined))
    await expect(fetchBpProjects(CONFIG, { asOf: '2026-11-11', retryDelayMs: 0 })).resolves.toHaveLength(1)
    stubAhrefs((path) => (path === 'management/projects' ? json({}, 429) : undefined))
    await expect(fetchBpProjects(CONFIG, { retryDelayMs: 0 })).rejects.toThrow('Ahrefs returned HTTP 429 for the project list')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("passes Ahrefs' own error text through for other refusals", async () => {
    stubAhrefs((path) => (path === 'management/projects' ? json({ error: 'API units limit reached' }, 402) : undefined))
    await expect(fetchBpProjects(CONFIG)).rejects.toThrow('Ahrefs returned HTTP 402 for the project list: API units limit reached')
  })

  it('stops when a response says it cost API units', async () => {
    stubAhrefs((path) => (path === 'management/projects'
      ? json({ projects: PROJECTS }, 200, { 'x-api-units-cost-total': '50' }) : undefined))
    await expect(fetchBpProjects(CONFIG)).rejects.toThrow(
      'Ahrefs charged API units for the project list — the sync stopped; it should only call free endpoints')
  })

  it('fails the whole fetch when one project fails, naming it', async () => {
    stubAhrefs((path) => (path.endsWith('competitors-overview') ? json({}, 500) : undefined))
    await expect(fetchBpProjects(CONFIG, { retryDelayMs: 0 })).rejects.toThrow('Ahrefs returned HTTP 500 for Roostersbet.com')
  })

  it('refuses a full page rather than truncating it', async () => {
    stubAhrefs((path) => (path.endsWith('competitors-overview') ? json({ keywords: Array(1000).fill(ROW) }) : undefined))
    await expect(fetchBpProjects(CONFIG)).rejects.toThrow(
      'Ahrefs returned 1000 rows for Roostersbet.com — more than one request can hold, so nothing was saved')
  })

  it('refuses an unexpected shape', async () => {
    stubAhrefs((path) => (path === 'management/projects' ? json({}) : undefined))
    await expect(fetchBpProjects(CONFIG)).rejects.toThrow('Ahrefs returned an unexpected project list')
  })

  it("lets the caller's cancel through untouched", async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(fetchBpProjects(CONFIG, { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run `npx vitest run api/_lib/ahrefs.test.ts`. Expected: FAIL, because `./ahrefs.js` does not exist.

- [ ] **Step 3: Implement `api/_lib/ahrefs.ts`**

Port the transport from `openseo.ts`: `getJson` with its per-request timeout covering the body, `mapLimited`, `discard`, the stop controller that cancels in-flight work after the first failure, and the rule that the caller's own signal is never retried. Then change these:

- **The request.** Every request is `GET ${AHREFS_API_BASE}/${path}?${params}` with headers `{ Authorization: 'Bearer ' + key, Accept: 'application/json' }` and `redirect: 'manual'`. A 3xx is an error and is not followed.
- **Retries.** Retry once on a network error, a timeout, a 5xx or a 429. Wait `retryDelayMs` (default `2_000`) before retrying a 429.
- **Refusals that are not retried:**
  - 401 and 403 → `AhrefsError(KEY_REJECTED, status)`.
  - Any other non-2xx → `Ahrefs returned HTTP ${status} for ${subject}`, plus `: ${body.error}` when the body has a string `error` of at most 200 characters.
- **Units guard.** When `x-api-units-cost-total` is above 0, fail with the units message, even on a 200.
- **Other messages:**
  - `Ahrefs did not answer within ${s} seconds for ${subject}`
  - `Could not reach Ahrefs for ${subject}: ${message}`
  - `Ahrefs returned something other than JSON for ${subject}`
- **Subjects.** The project list is `'the project list'`. Per-project calls use `project_name`.
- **`fetchBpProjects`:**
  1. Read `management/projects`. Without a `projects` array, fail with `Ahrefs returned an unexpected project list`.
  2. Keep the projects where `Number(keyword_count) > 0 && bpDomainOf(hostOf(url)) !== ''`.
  3. For each kept project, with `concurrency` default 6:
     - **Competitors.** Read `management/project-competitors?project_id=` and require a `competitors` array; otherwise fail with `Ahrefs returned an unexpected competitor list for ${name}`.
     - **Rankings.** Read `rank-tracker/competitors-overview` with `project_id`, `device=desktop`, `date=asOf` (default: today, UTC, `YYYY-MM-DD`), `date_compared=compareDate(asOf)`, `select=keyword,location,country,language,serp_updated,serp_updated_prev,competitors_list` and `limit=1000`. Require a `keywords` array; otherwise fail with `Ahrefs returned unexpected rankings for ${name}`. If the array holds 1,000 rows, fail with the full-page message.
  4. Return `{ projectId, name, target: url, competitors: competitors.map((c) => c.url), rows: keywords }`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run `npx vitest run api/_lib/ahrefs.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/ahrefs.ts api/_lib/ahrefs.test.ts
git commit -m "feat(sync): add a server-only Ahrefs Rank Tracker client"
```

---

### Task 3: Switch the proxy and the cron to Ahrefs, and remove OpenSEO

**Files:**
- Modify: `api/sites.ts`, `api/cron-sync.ts`, `api/sites.test.ts`, `api/cron-sync.test.ts`
- Modify: `api/_lib/sitesNormalize.ts` and `api/_lib/sitesNormalize.test.ts`. Remove `OpenSeoCell`, `OpenSeoMarket`, `OpenSeoKeyword`, `OpenSeoExport`, `marketCountries`, `normalizeExports` and their tests.
- Modify: `src/lib/sitesNormalize.ts`. The re-exports become `export type { NormalizeResult, AhrefsProject, AhrefsKeywordRow, AhrefsSlot }` and `export { canonicalDomain, countOlderChecks, cycleDate }`.
- Delete: `api/_lib/openseo.ts`, `api/_lib/openseo.test.ts`

**Interfaces:**
- Consumes: `ahrefsConfig`, `fetchBpProjects`, `isAbortLike`, `AhrefsError` and `KEY_REJECTED` (Task 2); `normalizeAhrefs` and `SyncDataError` (Task 1).
- Produces: unchanged handler contracts. `/api/sites` still answers `{ ok: true, data: { records, unknownDomains, rawDate } }`.

- [ ] **Step 1: Rewrite the two handler tests for Ahrefs**

**`api/sites.test.ts`:**
- **Environment.** `MANAGED_ENV` swaps the two OpenSEO names for `'AHREFS_API_KEY'`, and `beforeEach` sets `process.env.AHREFS_API_KEY = 'ahk_test'`.
- **The fake.** Replace the `openSeo()` fake with this one:

```ts
const PROJECTS = { projects: [
  { project_id: 1, project_name: 'Roostersbet.com', url: 'roostersbet.com/', keyword_count: 1 },
  { project_id: 2, project_name: 'Trybet.ca', url: 'trybet.ca/', keyword_count: 45 },   // another client
] }
const RANKINGS = { keywords: [{ keyword: 'rooster bet', country: 'AU', language: 'en',
  serp_updated: '2026-11-03T10:00:00Z', serp_updated_prev: '2026-10-27T10:00:00Z',
  competitors_list: [{ url: 'https://roostersbet.com/', position: 3, position_prev: 4 }, { url: null, position: null, position_prev: null }] }] }
function ahrefs(input: unknown, init: RequestInit = {}): Response {
  if (init.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
  const path = new URL(String(input)).pathname
  if (path.endsWith('/management/projects')) return json(PROJECTS)
  if (path.endsWith('/management/project-competitors')) return json({ competitors: [{ url: 'rooster.bet/', mode: 'subdomains' }] })
  return json(RANKINGS)
}
```

- **Updated and removed tests:**
  - **Rename two tests:** "reaches OpenSEO for a valid token…" becomes "reaches Ahrefs…", and "returns 500 naming OPENSEO_RANKINGS_API_KEY" becomes "…naming AHREFS_API_KEY".
  - **Delete the `OPENSEO_BASE_URL` test.**
  - **"never forwards the caller session" becomes "sends only the Ahrefs key upstream, never the caller session".** Every call's `headers.Authorization` is `'Bearer ahk_test'`.
  - **"returns normalized records for the BP projects"** asserts:
    - `rawDate` is `'2026-11-03'`.
    - The records equal roostersbet.com AU `{ position: '3', previous: '4', change: '+1' }` and rooster.bet AU `{ position: 'NR', previous: 'NR', change: '' }`.
    - The `project_id` params fetched are only `'1'`.
  - **"passes the normalizer's wording through"** sets the RANKINGS slot 1 url to `'https://example.com/'`. Expect a 502 with the error matching `/^Ahrefs listed example\.com in rooster\.bet's slot/`.
  - **Key rejection:** a 401 gives a 502 with `{ ok: false, error: KEY_REJECTED }`, imported from `./_lib/ahrefs.js`.
  - **Timeout:** the 504 text is `'Ahrefs did not respond within 45 seconds'`.

**`api/cron-sync.test.ts`:**
- **Environment.** `MANAGED` swaps the OpenSEO names for `'AHREFS_API_KEY'`, set to `'ahk_test'`. Import `KEY_REJECTED` from `./_lib/ahrefs.js`.
- **The fake.** Replace the export builder with a target-only project (`lucky7evencasino.io/`, no competitors). Each row gives exactly one record:

```ts
function rankings(rows: Array<[country: string, date: string, position: number | null]>) {
  return { keywords: rows.map(([country, date, position]) => ({ keyword: 'lucky 7even casino', country,
    language: country === 'DE' ? 'de' : country === 'IT' ? 'it' : 'en', serp_updated: `${date}T10:00:00Z`, serp_updated_prev: null,
    competitors_list: [{ url: position === null ? null : 'https://lucky7evencasino.io/', position, position_prev: null }] })) }
}
const ONE_RECORD = rankings([['DE', '2026-08-04', 3]])
// stubAhrefs(body, { projects = [{ project_id: 7, project_name: 'Lucky7evencasino.io', url: 'lucky7evencasino.io/', keyword_count: 1 }], status = 200 })
// answers management/projects, then { competitors: [] }, then `body`; any status other than 200 is returned for every call.
```

- **Expected `/log` summaries:**

| Test | Rows | Expected summary |
|---|---|---|
| writes the snapshot | `ONE_RECORD` | `'Scheduled sync — 1 records (Aug 4, 2026)'` (id `snap-bp-sites-2026-08-04`) |
| notes records that kept an earlier check | DE 08-04 #3, AU 07-28 #9 | `'Scheduled sync — 2 records (Aug 4, 2026); 1 kept an earlier check'` |
| skips a snapshot most records did not get a fresh check for | DE 08-04, AU 07-28, CA 07-28 | `"Scheduled sync — skipped Aug 4, 2026: Ahrefs' latest weekly update covers only 1 of 3 records; nothing written"` |
| **new:** dates the snapshot by the weekly update, not a later re-check | DE/AU/CA 08-04, IT 08-07 | `'Scheduled sync — 4 records (Aug 4, 2026)'`, snapshot id `snap-bp-sites-2026-08-04` |
| writes nothing when Ahrefs has no BP rankings | projects = only `trybet.ca/` | `'Scheduled sync — Ahrefs has no BP rankings; nothing written'` |
| logs a missing key | — | `'Scheduled sync failed: AHREFS_API_KEY is not configured on the server'` |
| logs a rejected key | status 401 | `` `Scheduled sync failed: ${KEY_REJECTED}` `` |
| both budget tests | — | `'Scheduled sync failed: the run exceeded its 35s fetch budget — Ahrefs did not finish responding in time'` |

- **Delete the `OPENSEO_BASE_URL` test.**

- [ ] **Step 2: Run the tests and confirm they fail**

Run `npx vitest run api/sites.test.ts api/cron-sync.test.ts`. Expected: FAIL, because the handlers still call OpenSEO.

- [ ] **Step 3: Switch the handlers**

**Imports, in both files:**
- `import { AhrefsError, ahrefsConfig, fetchBpProjects, isAbortLike } from './_lib/ahrefs.js'`
- `normalizeAhrefs` replaces `normalizeExports`.
- `ahrefsConfig` cannot throw, so the base-URL `try/catch` blocks go.

**`api/sites.ts` messages:**
- Key unset (500): `'AHREFS_API_KEY is not configured on the server'`
- Timeout (504): `` `Ahrefs did not respond within ${TIMEOUT_MS / 1000} seconds` ``
- Worded errors are `AhrefsError || SyncDataError`. Any other error becomes `` `Could not sync from Ahrefs: ${message}` ``.

**`api/cron-sync.ts`:**
- The key, empty, partial and budget summaries are exactly those in the Step 1 table.
- Rewrite the `MAX_OLDER_SHARE` comment: `rawDate` is now the weekly Ahrefs date, so a run made before most projects updated is skipped.

**Comments:** in both files, change "OpenSEO" to "Ahrefs" wherever a comment names the upstream.

- [ ] **Step 4: Remove OpenSEO**

```bash
git rm api/_lib/openseo.ts api/_lib/openseo.test.ts
```

Remove the OpenSEO types, `marketCountries`, `normalizeExports` and their tests from `sitesNormalize.ts` and `sitesNormalize.test.ts`. Drop `RUN_DATE` too if nothing uses it. Update the `src/lib/sitesNormalize.ts` re-exports as listed under **Files**.

- [ ] **Step 5: Run the checks and confirm they pass**

- `npm test` → 0 failures.
- `npm run build` → exit 0.
- `git grep -niE "openseo" -- api src/lib` → no output.

- [ ] **Step 6: Commit**

```bash
git add -A api src/lib/sitesNormalize.ts
git commit -m "feat(sync): read BP rankings from Ahrefs in the proxy and the cron; remove OpenSEO"
```

---

### Task 4: Browser wiring and copy

**Files:**
- Modify: `src/components/UploadSummary.tsx`, `src/App.tsx`, `src/components/DuplicateWarning.tsx`, `src/components/Sidebar.tsx`, `src/lib/sitesApi.ts`, `src/lib/sitesApi.test.ts`, `vite.config.ts`

**Interfaces:**
- Consumes: `cycleDate` and `countOlderChecks` from `src/lib/sitesNormalize.ts` (Task 3), and the `KEY_REJECTED` wording (Task 2).

- [ ] **Step 1: Count stale rows against the weekly date in `UploadSummary`**

In the `olderChecks` memo (`UploadSummary.tsx:116-120`), replace the newest-date loop with `countOlderChecks(records, cycleDate(records))`. Import `cycleDate` from `../lib/sitesNormalize`. Without this, one late re-check makes every other row count as "kept an earlier check".

- [ ] **Step 2: Copy changes (exact text)**

| File | Now | Becomes |
|---|---|---|
| `src/App.tsx:325` | `'OpenSEO returned no BP rankings — nothing was saved.'` | `'Ahrefs returned no BP rankings — nothing was saved.'` |
| `src/App.tsx:344` | `` `Synced ${records.length} records from OpenSEO — ${snap.displayDate}` `` | `` `Synced ${records.length} records from Ahrefs — ${snap.displayDate}` `` |
| `src/App.tsx:400` | `` `Replaced snapshot from OpenSEO — …` `` | `` `Replaced snapshot from Ahrefs — ${snap.displayDate} (${pendingRecords.length} records)` `` |
| `src/App.tsx:666` | `Syncing from OpenSEO` | `Syncing from Ahrefs` |
| `src/components/UploadSummary.tsx:176` | `kept an earlier check — OpenSEO&apos;s newest run did not cover …` | `kept an earlier check — Ahrefs&apos; latest weekly update did not cover {olderChecks !== 1 ? 'them' : 'it'}.` |
| `src/components/DuplicateWarning.tsx:46` | `OpenSEO&apos;s newest check date matches an existing snapshot. …` | `Ahrefs&apos; latest weekly update has the same date as an existing snapshot. Replacing it will overwrite any manual edits stored on that snapshot.` |
| `src/components/DuplicateWarning.tsx:51` | `… swaps that work for OpenSEO&apos;s rankings.` | `… swaps that work for Ahrefs&apos; rankings.` |
| `src/components/Sidebar.tsx:198` | `'Pull the latest BP rankings from OpenSEO'` | `'Pull the latest BP rankings from Ahrefs'` |
| `src/lib/sitesApi.test.ts:42` | the OpenSEO key-rejected literal | the Task 2 `KEY_REJECTED` text, verbatim |

Comments naming OpenSEO change to Ahrefs:
- `src/App.tsx` lines 51, 295-298, 315, 321 and 361. For lines 297-298, write "BP only. LP Sites stay on manual upload…".
- `UploadSummary.tsx` lines 113 and 242-244. For lines 242-244, write: "the server reads only BP projects; anything listed is a domain in those projects that brands.ts does not know".
- `DuplicateWarning.tsx:47`.
- `sitesApi.ts` lines 34 and 58-59.

- [ ] **Step 3: Dev server env**

In `vite.config.ts:24`, replace `'OPENSEO_RANKINGS_API_KEY', 'OPENSEO_BASE_URL'` with `'AHREFS_API_KEY'`.

- [ ] **Step 4: Run the checks and confirm they pass**

- `npm test` → 0 failures.
- `npm run build` → exit 0.
- `git grep -nE "OpenSEO|OPENSEO" -- src vite.config.ts` → no output.

- [ ] **Step 5: Commit**

```bash
git add src vite.config.ts
git commit -m "feat(sync): Ahrefs wording in the sync UI; count stale rows against the weekly date"
```

---

### Task 5: Export script, docs, env and full verification

**Files:**
- Create: `scripts/ahrefs-week-to-xlsx.mts`, `docs/integrations/ahrefs.md`
- Modify: `.env.example`, `docs/integrations/sites-api.md` (top note), `CLAUDE.md`

**Interfaces:**
- Consumes: `ahrefsConfig` and `fetchBpProjects` (Task 2); `normalizeAhrefs` and `countOlderChecks` (Tasks 1 and 3); `parseXlsx(buffer, 'bp-sites')` from `src/lib/parser.ts`; `DOMAIN_TO_BRAND`.

- [ ] **Step 1: Write `scripts/ahrefs-week-to-xlsx.mts`**

Run it as `npx tsx scripts/ahrefs-week-to-xlsx.mts <as-of YYYY-MM-DD> [out.xlsx]`. It is read-only against Ahrefs and never touches Supabase.

- **The key.** Read `process.env.AHREFS_API_KEY`, else the `AHREFS_API_KEY=` line of `./.env`. Never print it. If it is missing, exit 1 with `AHREFS_API_KEY is not set (env or .env)`. If the as-of date is not `YYYY-MM-DD`, exit 1.
- **Fetch.** `normalizeAhrefs(await fetchBpProjects(config, { asOf }))`.
- **Print** these labelled lines:

  ```
  projects: <n>
  records: <n> (ranked <n>, NR <n>)
  weekly date: <rawDate> (<countOlderChecks> kept an earlier check)
  brands: <n> · countries: <sorted list>
  skipped domains: <domain (count), …> or none
  ```

- **With an output path:**
  - Refuse unless the path ends in `.xlsx` and resolves inside `docs/references/`, which is gitignored because client data must never be committed.
  - Create the folder.
  - Write one sheet, `BP Sites`, with the header `Domain, Keyword, Country, Position, Previous, Change, Last Check`, one row per record, and every cell as text.
  - Read the file back with `parseXlsx`. Print `parser check: rawDate <d>, <n> records` and exit 1 unless there is exactly one snapshot and its `rawDate` and record count equal the normalizer's.

- [ ] **Step 2: Docs and env**

**`.env.example`.** Replace the OpenSEO block (lines 23-31) with:

```
# Ahrefs API v3 key (api/sites.ts — the "Sync from API" button on BP Sites —
# and api/cron-sync.ts). Created by an owner or admin of the client's Ahrefs
# workspace (Account settings → API keys); it can read that whole workspace.
# Server-only: must NEVER get a VITE_ prefix, or the key ships in the public
# bundle. Set it in Vercel for Production and Preview, and in .env locally —
# vite.config.ts loads it for the dev server. The sync only calls Rank Tracker
# and Management endpoints, which Ahrefs does not charge API units for.
AHREFS_API_KEY=your-ahrefs-api-key
```

**`docs/integrations/ahrefs.md`** covers:
- the three endpoints and their parameters;
- the key: who creates it, that it expires 2027-11-09, the unit cap, that it reads the whole workspace, and that it dies if its creator leaves;
- the spec's observed-behaviour table, copied;
- how records are built, linking to the spec;
- the schedule;
- the export script, and the switch-over steps under "After the plan".

It never names other clients' projects.

**`docs/integrations/sites-api.md`.** The top note becomes: superseded 2026-11-04 by OpenSEO, which was itself replaced by Ahrefs — see `docs/integrations/ahrefs.md`.

**`CLAUDE.md`:**
- **Data Flow, "Sync from API".** Describe the Ahrefs path: the project list → projects whose target is in `DOMAIN_TO_BRAND` → competitors and `competitors-overview` (free endpoints, `api/_lib/ahrefs.ts`) → `sitesNormalize.ts` → one record per domain × keyword × market, with the snapshot dated by the weekly Ahrefs update. Add that OpenSEO and the Ranks API are no longer called.
- **"Import Data".** It is the only path for LP Sites, which the sync does not read.
- **Key Files.** The `api/_lib/openseo.ts` row becomes `api/_lib/ahrefs.ts`. The `sitesNormalize.ts` and `api/sites.ts` rows name Ahrefs and `AHREFS_API_KEY`.

- [ ] **Step 3: Full verification**

- `npm test` → 0 failures.
- `npm run build` → exit 0.
- `npx vercel build` → exit 0. This catches missing `.js` extensions in `api/`.

- [ ] **Step 4: Live read-only check (no Supabase writes)**

Run `npx tsx scripts/ahrefs-week-to-xlsx.mts <today, UTC>`. Expect:
- `projects: 23`;
- about 1,535 records;
- `brands: 9` and `countries: AU, CA, DE, IT, NZ`;
- skipped domains spinjo.de and fortuneplaycasino.de;
- `weekly date` is the latest Tuesday Ahrefs has updated: 2026-11-03 until the 2026-11-10 update lands, then 2026-11-10.

If the script stops with a units, key or slot-order error, stop and report it; don't work around it.

- [ ] **Step 5: Build the Nov 3 switch-over file**

Run `npx tsx scripts/ahrefs-week-to-xlsx.mts 2026-11-03 docs/references/2026-11-03/ahrefs-bp-sites-2026-11-03.xlsx`. Expect `parser check: rawDate 2026-11-03, <n> records` with n about 1,535. `git status --short` must not list the file.

- [ ] **Step 6: Commit**

```bash
git add scripts/ahrefs-week-to-xlsx.mts docs/integrations/ahrefs.md docs/integrations/sites-api.md .env.example CLAUDE.md
git commit -m "docs(sync): document the Ahrefs sync; add the past-week export script"
```

---

## After the plan (needs the user)

1. **Review.** A fresh reviewer reads the whole branch before the PR.
2. **Vercel env, before the merge.** The user opens the `ranking-reports` project → Settings → Environment Variables and adds `AHREFS_API_KEY` for Production and Preview, using the value from the local `.env`. The value is never pasted into chat.
3. **Ship** per the Ranking-Reports workflow:
   - Raise the PR from the sandbox account.
   - Merge with `gh pr merge --merge --delete-branch` after the user's go-ahead.
   - Confirm the Production deploy, and that `/api/sites` and `/api/cron-sync` load (401 without auth).
   - Kanban: one card in In Progress when execution starts, moved to Done with the PR link.
4. **Switch-over** (the user, in this order):
   1. **Run this in the Supabase SQL editor.** Expect `rows = 1110` and `hand_typed = 0`. If `hand_typed` is above 0, stop and decide before going on.
      - The flat upload format carries no search volume, global search volume or affiliate URL (`parseRows` in `src/lib/parser.ts` reads none of them). Carry-forward fills those when the page loads (`App.tsx:158`).
      - So `hand_typed = 0` means the replacement loses nothing that the spec's "Keep the existing values" requirement protects.

      ```sql
      select count(*) as rows,
             count(*) filter (where search_volume <> '' or affiliate_url <> '' or global_search_volume <> '') as hand_typed
      from ranking_records where snapshot_id = 'snap-bp-sites-2026-11-03';
      ```

   2. **Upload the file.** Import Data → BP Sites → `docs/references/2026-11-03/ahrefs-bp-sites-2026-11-03.xlsx` → **Delete & replace** at the duplicate warning. The original hand-built file stays in `docs/references/2026-11-03/`; it is the only copy, so never delete it.
   3. **Check the result.** Expect `source = 'upload'` and a row count equal to the export's.

      ```sql
      select s.source, count(r.*) as rows from snapshots s
      left join ranking_records r on r.snapshot_id = s.id
      where s.id = 'snap-bp-sites-2026-11-03' group by s.source;
      ```

   4. **Sync from API.**
      - If Ahrefs' 2026-11-10 update has landed, it saves a new Nov 10 snapshot.
      - If not, the duplicate warning names Nov 3 → Cancel.
   5. **After the next Wed/Fri 04:00 UTC run**, `/log` shows a "Scheduled sync — … records" line.
5. **Client heads-up** that Nov 3 now shows their Ahrefs numbers. Claude drafts it on request.
6. **OpenSEO stays up, idle.** `OPENSEO_RANKINGS_API_KEY` stays in Vercel, unused, until the user decides about OpenSEO and DataForSEO.
