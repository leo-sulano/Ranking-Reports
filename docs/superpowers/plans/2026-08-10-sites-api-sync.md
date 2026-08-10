# Ranks API Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Sync from API" that pulls BP Sites rankings from the Ranks API into a snapshot, leaving the xlsx import and all inline editing untouched.

**Architecture:** A Vercel serverless function (`api/sites.ts`) holds `SITES_API_KEY` and proxies the upstream. The browser pages that proxy, normalizes rows into `RankingRecord[]`, and hands the result to `persistOneSnapshot` — the same write path the xlsx upload already uses. Nothing downstream of `persistOneSnapshot` changes.

**Tech Stack:** React 19, TypeScript 5.8 (strict), Vite 6, Tailwind v4 (CSS variables only, no config file), vitest, `@vercel/node`, Supabase.

**Spec:** `docs/superpowers/specs/2026-08-10-sites-api-sync-design.md`

## Global Constraints

- **No new npm dependencies.** Everything needed is already installed.
- **`SITES_API_KEY` is server-only.** It must never gain a `VITE_` prefix and must never appear in `src/`, in a commit, or in log output.
- **`api/sites.ts` must not import from `src/`.** `tsconfig.api.json` uses `module: NodeNext`, whose `.js`-extension requirement does not apply cleanly to app code. Keep the proxy self-contained.
- **The proxy must never send `project_id`.** The Rooster set is project 0 and the upstream treats `0` as falsy, returning everything. `DOMAIN_TO_BRAND` is the only filter.
- **TypeScript is strict.** `npm run build` runs `tsc -b` across `tsconfig.app.json`, `tsconfig.node.json` and `tsconfig.api.json`. It must pass.
- **Styling uses existing CSS variables only** (`var(--btn-ink)`, `var(--border-3)`, …). No new colours, no `tailwind.config.js`.
- **Test command:** `npx vitest run` (all), or `npx vitest run <path>` for one file. `vitest.config.ts` already includes `src/**/*.test.ts` and `api/**/*.test.ts`.
- **Commit after every task.** The branch `feat/sites-api-sync` already exists and holds the spec commit.

---

### Task 1: Serverless proxy + dev-server mount

Holds the key, forwards to the upstream, and is reachable under both `vercel dev` and `npm run dev`.

**Files:**
- Create: `api/sites.ts`
- Create: `api/sites.test.ts`
- Modify: `vite.config.ts` (whole file replaced)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `GET /api/sites?action=results&limit=<1-1000>&offset=<n>` returning the upstream body verbatim with the upstream status. Task 3 is its only caller.

- [ ] **Step 1: Write the failing test**

Create `api/sites.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './sites'

type MockRes = VercelResponse & {
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
}

function makeReq(method: string, query: Record<string, string | string[]>): VercelRequest {
  return { method, query } as unknown as VercelRequest
}

function makeRes(): MockRes {
  const res: Partial<MockRes> = {}
  res.status    = vi.fn(() => res as MockRes)
  res.json      = vi.fn(() => res as MockRes)
  res.send      = vi.fn(() => res as MockRes)
  res.setHeader = vi.fn(() => res as MockRes)
  return res as MockRes
}

let fetchMock: ReturnType<typeof vi.fn>
let originalKey: string | undefined

beforeEach(() => {
  originalKey = process.env.SITES_API_KEY
  process.env.SITES_API_KEY = 'bpn_test'
  fetchMock = vi.fn(async () => new Response('{"ok":true,"data":[]}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.SITES_API_KEY
  else process.env.SITES_API_KEY = originalKey
  vi.unstubAllGlobals()
})

/** The URL the handler asked fetch() for, as a URL object. */
function calledUrl(): URL {
  return new URL(String(fetchMock.mock.calls[0][0]))
}

describe('api/sites', () => {
  it('rejects non-GET with 405', async () => {
    const res = makeRes()
    await handler(makeReq('POST', {}), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 500 naming the variable when the key is unset', async () => {
    delete process.env.SITES_API_KEY
    const res = makeRes()
    await handler(makeReq('GET', {}), res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json.mock.calls[0][0].error).toContain('SITES_API_KEY')
  })

  it('rejects an unsupported action with 400', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'history' }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never sends project_id — 0 is falsy upstream and would not filter', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(calledUrl().searchParams.has('project_id')).toBe(false)
  })

  it('sends the bearer key and clamps limit to 1000', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results', limit: '99999' }), res)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bpn_test')
    expect(calledUrl().searchParams.get('limit')).toBe('1000')
  })

  it('clamps a negative offset to 0 and a garbage limit to the max', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results', limit: 'abc', offset: '-5' }), res)
    expect(calledUrl().searchParams.get('limit')).toBe('1000')
    expect(calledUrl().searchParams.get('offset')).toBe('0')
  })

  it('passes the upstream status and body through', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":false,"error":"nope"}', { status: 401 }))
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.send).toHaveBeenCalledWith('{"ok":false,"error":"nope"}')
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
  })

  it('turns a timeout into 504', async () => {
    const err = new Error('timed out')
    err.name = 'TimeoutError'
    fetchMock.mockRejectedValueOnce(err)
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(res.status).toHaveBeenCalledWith(504)
    expect(res.json.mock.calls[0][0].error).toContain('30 seconds')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run api/sites.test.ts`
Expected: FAIL — `Failed to resolve import "./sites"`.

- [ ] **Step 3: Write the handler**

Create `api/sites.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'

const UPSTREAM = 'https://3213211.xyz/bpn-panel-cc/api/ranks.php'

const ALLOWED_ACTIONS = new Set(['results', 'domains'])
const MAX_LIMIT   = 1000
const TIMEOUT_MS  = 30_000

/** Vercel gives repeated query params as an array; take the first. */
function first(raw: unknown): string | undefined {
  return Array.isArray(raw) ? (raw[0] as string | undefined) : (raw as string | undefined)
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(first(raw))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const key = process.env.SITES_API_KEY
  if (!key) {
    return res.status(500).json({
      ok: false,
      error: 'SITES_API_KEY is not configured on the server',
    })
  }

  const action = first(req.query.action) ?? 'results'
  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: `Unsupported action "${action}"` })
  }

  // Deliberately NO project_id. The Rooster set is project 0, and the upstream
  // treats 0 as falsy — passing it returns every project rather than filtering.
  // DOMAIN_TO_BRAND on the client is the authoritative filter.
  const url = new URL(UPSTREAM)
  url.searchParams.set('action', action)
  url.searchParams.set('limit',  String(clampInt(req.query.limit,  1, MAX_LIMIT,   MAX_LIMIT)))
  url.searchParams.set('offset', String(clampInt(req.query.offset, 0, 10_000_000,  0)))

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await upstream.text()

    // Surface the upstream status so the client can tell a revoked key (401)
    // from an outage (5xx). Never echo the request URL — it is built from
    // secret-bearing config.
    res.status(upstream.status)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.send(body)
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return res.status(504).json({
      ok: false,
      error: timedOut
        ? 'The sites service did not respond within 30 seconds'
        : `Could not reach the sites service: ${(err as Error).message}`,
    })
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run api/sites.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mount the handler on the Vite dev server**

`npm run dev` is Vite alone — it does not run `api/`, so `/api/sites` would fall through the catch-all rewrite and return `index.html`. Replace the whole of `vite.config.ts` with:

```ts
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Serve api/sites.ts under `npm run dev`.
 *
 * Vercel runs the functions in api/ in production; the Vite dev server does
 * not, so without this the Sync button gets index.html back. Rather than keep
 * a second dev-only proxy free to drift from the real one, adapt Node's
 * req/res to the Vercel handler signature and call the real handler.
 */
function sitesApiDevServer(mode: string): PluginOption {
  return {
    name: 'sites-api-dev-server',
    apply: 'serve',
    configureServer(server) {
      // Vite only puts VITE_-prefixed vars on import.meta.env, and puts
      // nothing on process.env. The handler reads process.env.SITES_API_KEY,
      // so load the unprefixed var explicitly and assign it.
      const env = loadEnv(mode, process.cwd(), '')
      if (env.SITES_API_KEY) process.env.SITES_API_KEY = env.SITES_API_KEY

      server.middlewares.use('/api/sites', async (req, res) => {
        try {
          const mod = await server.ssrLoadModule('/api/sites.ts')
          // `use('/api/sites', ...)` strips the mount prefix, so req.url is
          // '/?action=…'. The base is only there to satisfy the URL parser.
          const search = new URL(req.url ?? '/', 'http://localhost').searchParams
          const query = Object.fromEntries(search)

          const shim = {
            status(code: number) { res.statusCode = code; return shim },
            setHeader(name: string, value: string) { res.setHeader(name, value); return shim },
            json(body: unknown) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify(body))
              return shim
            },
            send(body: string) { res.end(body); return shim },
          }

          await mod.default({ method: req.method, query }, shim)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: `Dev proxy failed: ${(err as Error).message}` }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), sitesApiDevServer(mode)],
}))
```

- [ ] **Step 6: Verify the dev mount end to end**

Run `npm run dev` in one terminal, then in another:

```bash
curl -s "http://localhost:5173/api/sites?action=domains&limit=5" | head -c 200
```

Expected: a JSON body starting `{"ok":true,"meta":{...`. If you get `<!doctype html>`, the middleware did not mount. If you get the 500 naming `SITES_API_KEY`, the key is missing from `.env`.

Stop the dev server when done.

- [ ] **Step 7: Type-check and commit**

```bash
npm run build
git add api/sites.ts api/sites.test.ts vite.config.ts
git commit -m "feat(api): add Ranks API proxy holding SITES_API_KEY

Serves /api/sites in production via Vercel and in dev via a Vite
middleware that calls the same handler, so the two cannot drift.
Never sends project_id: the Rooster set is project 0 and the upstream
treats 0 as falsy, returning everything."
```

---

### Task 2: Normalizer

Turns raw API rows into `RankingRecord[]`. This is the only new file with real logic risk, so it is tested hardest.

**Files:**
- Create: `src/lib/sitesNormalize.ts`
- Create: `src/lib/sitesNormalize.test.ts`

**Interfaces:**
- Consumes: `DOMAIN_TO_BRAND` and `COUNTRY_LABELS` from `src/lib/brands.ts`; `RankingRecord` from `src/types`; `UnknownDomain` from `src/lib/parser.ts`.
- Produces:
  - `interface ApiRow` — consumed by Task 3.
  - `normalizeRows(rows: ApiRow[]): NormalizeResult` where `NormalizeResult = { records: RankingRecord[]; unknownDomains: UnknownDomain[]; rawDate: string }` — consumed by Task 4.
  - Also exported for testing: `canonicalDomain`, `positionToString`, `changeToString`, `checkedAtDate`, `normalizeCountry`, `reduceLatest`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sitesNormalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  canonicalDomain, positionToString, changeToString, checkedAtDate,
  normalizeCountry, reduceLatest, normalizeRows, type ApiRow,
} from './sitesNormalize'

/** A valid row with sane defaults; override only what a test cares about. */
function row(over: Partial<ApiRow> = {}): ApiRow {
  return {
    domain: 'rooster.bet',
    keyword: 'rooster bet',
    country: 'AU',
    language: 'en',
    position: 3,
    previous_position: 5,
    change: 2,
    url_found: 'https://www.rooster.bet/en-AU',
    checked_at: '2026-08-04 19:39:12',
    project_id: 0,
    ...over,
  }
}

describe('positionToString', () => {
  it('treats 0 as NR — the API uses 0, not null, for "not ranking"', () => {
    expect(positionToString(0)).toBe('NR')
  })
  it('treats null, empty and negatives as NR', () => {
    expect(positionToString(null)).toBe('NR')
    expect(positionToString('')).toBe('NR')
    expect(positionToString(-1)).toBe('NR')
    expect(positionToString('junk')).toBe('NR')
  })
  it('passes ranked positions through as strings', () => {
    expect(positionToString(1)).toBe('1')
    expect(positionToString('12')).toBe('12')
  })
})

describe('changeToString', () => {
  it('signs a positive change and leaves negatives signed', () => {
    expect(changeToString(2)).toBe('+2')
    expect(changeToString(-3)).toBe('-3')
  })
  it('renders no movement as 0 and a missing change as empty', () => {
    expect(changeToString(0)).toBe('0')
    expect(changeToString(null)).toBe('')
    expect(changeToString('junk')).toBe('')
  })
})

describe('canonicalDomain', () => {
  it('lowercases and strips a leading www.', () => {
    expect(canonicalDomain('WWW.Rooster.BET')).toBe('rooster.bet')
    expect(canonicalDomain('  Spinjo.io ')).toBe('spinjo.io')
  })
})

describe('checkedAtDate', () => {
  it('takes the date part of both the space and ISO forms', () => {
    expect(checkedAtDate('2026-08-04 19:39:12')).toBe('2026-08-04')
    expect(checkedAtDate('2026-08-04T19:39:12Z')).toBe('2026-08-04')
  })
  it('returns empty for missing or unparseable values', () => {
    expect(checkedAtDate('')).toBe('')
    expect(checkedAtDate(null)).toBe('')
    expect(checkedAtDate('soon')).toBe('')
  })
})

describe('normalizeCountry', () => {
  it('maps through COUNTRY_LABELS', () => {
    expect(normalizeCountry('AU')).toBe('AU')
    expect(normalizeCountry('Germany')).toBe('DE')
  })
  it('keeps an unmapped value rather than dropping it, uppercased', () => {
    expect(normalizeCountry('fr')).toBe('FR')
  })
})

describe('reduceLatest', () => {
  it('keeps the newest row per (domain, keyword, country)', () => {
    const out = reduceLatest([
      row({ position: 1, checked_at: '2026-07-29 10:00:00' }),
      row({ position: 9, checked_at: '2026-08-04 10:00:00' }),
      row({ position: 4, checked_at: '2026-07-15 10:00:00' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].position).toBe(9)
  })

  it('compares ISO and space-separated timestamps chronologically', () => {
    const out = reduceLatest([
      row({ position: 1, checked_at: '2026-08-04T23:00:00Z' }),
      row({ position: 2, checked_at: '2026-08-04 09:00:00' }),
    ])
    expect(out[0].position).toBe(1)
  })

  it('does not merge rows that differ by country', () => {
    expect(reduceLatest([row({ country: 'AU' }), row({ country: 'CA' })])).toHaveLength(2)
  })
})

describe('normalizeRows', () => {
  it('drops unknown domains and tallies them busiest-first', () => {
    const { records, unknownDomains } = normalizeRows([
      row(),
      row({ domain: 'cazeus.vip',  keyword: 'a' }),
      row({ domain: 'cazeus.vip',  keyword: 'b' }),
      row({ domain: 'alfcasino.digital', keyword: 'c' }),
    ])
    expect(records).toHaveLength(1)
    expect(unknownDomains).toEqual([
      { domain: 'cazeus.vip', count: 2 },
      { domain: 'alfcasino.digital', count: 1 },
    ])
  })

  it('keeps project-18 rows on Rooster domains — they fill keys project 0 did not check', () => {
    const { records } = normalizeRows([
      row({ domain: 'roosters.bet', project_id: 18, keyword: 'roosterbet' }),
    ])
    expect(records).toHaveLength(1)
    expect(records[0].domain).toBe('roosters.bet')
  })

  it('dates the snapshot from the newest KEPT row, ignoring foreign domains', () => {
    const { rawDate } = normalizeRows([
      row({ checked_at: '2026-07-29 10:00:00' }),
      row({ domain: 'rooster.bet', keyword: 'other', checked_at: '2026-08-04 10:00:00' }),
      row({ domain: 'cazeus.vip', keyword: 'x', checked_at: '2026-09-01 10:00:00' }),
    ])
    expect(rawDate).toBe('2026-08-04')
  })

  it('leaves an undated row undated rather than stamping it with the batch date', () => {
    const { records, rawDate } = normalizeRows([
      row({ keyword: 'dated',   checked_at: '2026-08-04 10:00:00' }),
      row({ keyword: 'undated', checked_at: '' }),
    ])
    expect(rawDate).toBe('2026-08-04')
    expect(records.find((r) => r.keyword === 'undated')!.date).toBe('')
  })

  it('produces a RankingRecord the storage layer accepts', () => {
    const { records } = normalizeRows([row({ position: 0, previous_position: 1, change: -1 })])
    expect(records[0]).toEqual({
      domain: 'rooster.bet',
      keyword: 'rooster bet',
      country: 'AU',
      position: 'NR',
      previous: '1',
      change: '-1',
      date: '2026-08-04',
      searchVolume: '',
      affiliateUrl: '',
      globalSearchVolume: '',
    })
  })

  it('returns empty results and no date for an all-foreign batch', () => {
    const { records, rawDate, unknownDomains } = normalizeRows([row({ domain: 'cazeus.vip' })])
    expect(records).toEqual([])
    expect(rawDate).toBe('')
    expect(unknownDomains).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/sitesNormalize.test.ts`
Expected: FAIL — `Failed to resolve import "./sitesNormalize"`.

- [ ] **Step 3: Write the normalizer**

Create `src/lib/sitesNormalize.ts`:

```ts
import type { RankingRecord } from '../types'
import type { UnknownDomain } from './parser'
import { COUNTRY_LABELS, DOMAIN_TO_BRAND } from './brands'

/**
 * One row as the Ranks API actually returns it. Types are deliberately loose:
 * the upstream is PHP and has been observed returning ints where the vendor doc
 * promises null, so every field is coerced rather than trusted.
 */
export interface ApiRow {
  domain:            string
  keyword:           string
  country:           string | null
  language?:         string | null
  position:          number | string | null
  previous_position: number | string | null
  change:            number | string | null
  url_found:         string | null
  checked_at:        string | null
  project_id?:       number
}

export interface NormalizeResult {
  records:        RankingRecord[]
  /** Rows dropped because the domain is not in BRANDS, counted per domain, busiest first. */
  unknownDomains: UnknownDomain[]
  /** Newest checked_at date among the KEPT rows; '' when none. */
  rawDate:        string
}

/** Lowercase, trim, drop a leading `www.` — the upstream mixes all three forms. */
export function canonicalDomain(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/^www\./, '')
}

/**
 * The API signals "not ranking" with 0 far more often than with null — 403 of
 * 1,109 Rooster rows are 0, while the vendor doc mentions only null. Treat
 * both, plus anything non-positive or unparseable, as NR.
 */
export function positionToString(p: number | string | null | undefined): string {
  if (p === null || p === undefined || p === '') return 'NR'
  const n = Number(p)
  if (!Number.isFinite(n) || n <= 0) return 'NR'
  return String(n)
}

/** Signed movement string. Positive means the rank improved. */
export function changeToString(c: number | string | null | undefined): string {
  if (c === null || c === undefined || c === '') return ''
  const n = Number(c)
  if (!Number.isFinite(n)) return ''
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : String(n)
}

/** Date portion of a checked_at value. Accepts 'YYYY-MM-DD HH:MM:SS' and ISO. */
export function checkedAtDate(s: string | null | undefined): string {
  if (!s) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

/**
 * Project 0 returns real country codes (AU/CA/DE/IT/NZ), which COUNTRY_LABELS
 * already maps to itself. An unrecognised value is kept rather than dropped —
 * silently discarding it would hide a real change upstream. It surfaces in the
 * import summary's Countries count.
 */
export function normalizeCountry(raw: string | null | undefined): string {
  const t = (raw ?? '').trim()
  if (!t) return ''
  return COUNTRY_LABELS[t] ?? COUNTRY_LABELS[t.toUpperCase()] ?? t.toUpperCase()
}

/**
 * Normalise a timestamp into a directly-comparable form: ISO 'T' becomes a
 * space and a trailing 'Z' is dropped. Without this a raw string compare would
 * rank any ISO row above any space-separated row on the same date ('T' is 0x54,
 * ' ' is 0x20) regardless of actual clock time.
 */
function comparableTimestamp(s: string | null | undefined): string {
  return (s ?? '').replace('T', ' ').replace(/Z$/, '')
}

/**
 * Keep only the newest row per (domain, keyword, country).
 *
 * A no-op against project 0 today — every key appears exactly once. It stays as
 * a guard: BIF-Dashboard observed up to 6 rows per key on project 18, because
 * `action=results` is a check log rather than current state. A row with an
 * empty timestamp sorts lowest, which is what we want.
 */
export function reduceLatest(rows: ApiRow[]): ApiRow[] {
  const best = new Map<string, ApiRow>()
  for (const r of rows) {
    const key = [
      canonicalDomain(r.domain),
      (r.keyword ?? '').trim().toLowerCase(),
      normalizeCountry(r.country),
    ].join('|')
    const prev = best.get(key)
    if (!prev || comparableTimestamp(r.checked_at) > comparableTimestamp(prev.checked_at)) {
      best.set(key, r)
    }
  }
  return [...best.values()]
}

export function normalizeRows(rows: ApiRow[]): NormalizeResult {
  const skippedCounts = new Map<string, number>()
  const kept: ApiRow[] = []

  // DOMAIN_TO_BRAND is the only filter — NOT project_id. The 56 project-18 rows
  // on shared Rooster domains use the same keyword vocabulary as project 0 and
  // fill (domain, keyword, country) keys project 0 did not check that week.
  for (const r of reduceLatest(rows)) {
    const domain = canonicalDomain(r.domain)
    if (!DOMAIN_TO_BRAND[domain]) {
      skippedCounts.set(domain, (skippedCounts.get(domain) ?? 0) + 1)
      continue
    }
    kept.push(r)
  }

  // Date the snapshot from the retained rows only: a foreign domain's later
  // checked_at must never date a batch that does not contain it.
  let rawDate = ''
  for (const r of kept) {
    const d = checkedAtDate(r.checked_at)
    if (d > rawDate) rawDate = d
  }

  const records: RankingRecord[] = kept.map((r) => ({
    domain:   canonicalDomain(r.domain),
    keyword:  (r.keyword ?? '').trim(),
    country:  normalizeCountry(r.country),
    position: positionToString(r.position),
    previous: positionToString(r.previous_position),
    change:   changeToString(r.change),
    // An undated row stays undated. Falling back to the batch date would stamp
    // a never-crawled row as freshly checked and destroy the only signal
    // separating "the vendor never looked" from "looked and found nothing".
    date:     checkedAtDate(r.checked_at),
    // Not supplied by the API. applyCarryForward inherits them from the
    // previous snapshot, which is exactly what it was built for.
    searchVolume:       '',
    affiliateUrl:       '',
    globalSearchVolume: '',
  }))

  const unknownDomains: UnknownDomain[] = [...skippedCounts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))

  return { records, unknownDomains, rawDate }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/lib/sitesNormalize.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sitesNormalize.ts src/lib/sitesNormalize.test.ts
git commit -m "feat(sync): normalize Ranks API rows into RankingRecords

Encodes the endpoint's observed behaviour rather than its docs:
position 0 means NR, unknown domains are dropped and tallied, and the
snapshot date comes from the kept rows so a foreign domain cannot date
a batch it is not part of. Undated rows stay undated."
```

---

### Task 3: Paging client

**Files:**
- Create: `src/lib/sitesApi.ts`
- Create: `src/lib/sitesApi.test.ts`

**Interfaces:**
- Consumes: `ApiRow` from `src/lib/sitesNormalize.ts` (Task 2); `GET /api/sites` (Task 1).
- Produces:
  - `class SitesApiError extends Error` with a `status: number | null` field.
  - `fetchSitesRows(onProgress?: (rows: number) => void): Promise<ApiRow[]>` — consumed by Task 4.
  - `fetchAllRows(fetchPage, onProgress?, pageSize?)` — exported for testing.
  - `const PAGE_SIZE = 1000`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sitesApi.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { fetchAllRows, SitesApiError } from './sitesApi'
import type { ApiRow } from './sitesNormalize'

/** n placeholder rows — only the count matters to the pager. */
function page(n: number): ApiRow[] {
  return Array.from({ length: n }, (_, i) => ({
    domain: 'rooster.bet',
    keyword: `kw-${i}`,
    country: 'AU',
    position: 1,
    previous_position: 1,
    change: 0,
    url_found: null,
    checked_at: '2026-08-04 10:00:00',
  }))
}

describe('fetchAllRows', () => {
  it('stops on the first short page', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(4))
    const rows = await fetchAllRows(fetchPage, undefined, 10)
    expect(rows).toHaveLength(24)
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 10, 20])
  })

  it('stops immediately when the first page is empty', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce([])
    expect(await fetchAllRows(fetchPage, undefined, 10)).toEqual([])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('keeps paging on a full page even though meta.total would say stop', async () => {
    // The live endpoint reported total:135 for a 154-row response, so the
    // pager must never terminate on a count.
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(3))
    expect(await fetchAllRows(fetchPage, undefined, 10)).toHaveLength(13)
  })

  it('reports cumulative progress after each page', async () => {
    const onProgress = vi.fn()
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(2))
    await fetchAllRows(fetchPage, onProgress, 10)
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([10, 12])
  })

  it('rejects when a page fails mid-pagination, yielding nothing', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockRejectedValueOnce(new SitesApiError('upstream exploded', 500))
    await expect(fetchAllRows(fetchPage, undefined, 10)).rejects.toThrow('upstream exploded')
  })

  it('aborts rather than looping forever if offset stops advancing', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(10))
    await expect(fetchAllRows(fetchPage, undefined, 10)).rejects.toThrow(/exceeded/)
  })
})
```

Note: the last test relies on the 100,000-row cap, so with a page size of 10 it makes 10,000 calls of 10 placeholder rows. That runs in well under a second.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/lib/sitesApi.test.ts`
Expected: FAIL — `Failed to resolve import "./sitesApi"`.

- [ ] **Step 3: Write the client**

Create `src/lib/sitesApi.ts`:

```ts
import type { ApiRow } from './sitesNormalize'

/** The upstream caps `limit` at 1000. */
export const PAGE_SIZE = 1000

/** Hard stop for the pagination loop — far above any real dataset (2,826 today). */
const MAX_ROWS = 100_000

export class SitesApiError extends Error {
  status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'SitesApiError'
    this.status = status
  }
}

/**
 * Page until a page comes back shorter than requested.
 *
 * Deliberately ignores the response's `meta.total`: the live endpoint reported
 * `total: 135` for a request that returned 154 rows, so terminating on a count
 * would silently truncate. Page length is the only trustworthy signal.
 *
 * A failure on any page rejects — callers must not persist a partial batch.
 */
export async function fetchAllRows(
  fetchPage: (offset: number) => Promise<ApiRow[]>,
  onProgress?: (rows: number) => void,
  pageSize: number = PAGE_SIZE,
): Promise<ApiRow[]> {
  const all: ApiRow[] = []
  let offset = 0
  for (;;) {
    const pageRows = await fetchPage(offset)
    all.push(...pageRows)
    onProgress?.(all.length)
    if (pageRows.length < pageSize) return all
    offset += pageSize
    if (all.length >= MAX_ROWS) {
      throw new SitesApiError(
        `Sites API pagination exceeded ${MAX_ROWS} rows — aborting to avoid an unbounded loop`,
      )
    }
  }
}

/** Fetch one page from our own proxy. Never talks to the upstream directly. */
async function fetchProxyPage(offset: number): Promise<ApiRow[]> {
  const url = `/api/sites?action=results&limit=${PAGE_SIZE}&offset=${offset}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new SitesApiError(`Could not reach the sites service: ${(err as Error).message}`)
  }

  const body = await res.json().catch(() => null)

  if (!res.ok || body?.ok === false) {
    throw new SitesApiError(body?.error ?? `HTTP ${res.status}`, res.status)
  }
  if (!Array.isArray(body?.data)) {
    throw new SitesApiError('Sites service returned an unexpected payload (no data array)', res.status)
  }
  return body.data as ApiRow[]
}

/** Every ranking row the key can see, paged to completion. */
export function fetchSitesRows(onProgress?: (rows: number) => void): Promise<ApiRow[]> {
  return fetchAllRows(fetchProxyPage, onProgress)
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/lib/sitesApi.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sitesApi.ts src/lib/sitesApi.test.ts
git commit -m "feat(sync): page the sites proxy to completion

Terminates on a short page rather than meta.total, which the live
endpoint has been observed to under-report. Any page failure rejects so
a partial batch never reaches persistence."
```

---

### Task 4: Wire the Sync button into the app

**Files:**
- Modify: `src/lib/activityLog.ts:3` (the `LogAction` union)
- Modify: `src/pages/Log.tsx:22-26` (`ACTION_STYLES`)
- Modify: `src/components/UploadSummary.tsx:7-11` and `:130-137` (source-aware copy)
- Modify: `src/components/DuplicateWarning.tsx:3-5`, `:30-42`, `:60-62` (source-aware copy)
- Modify: `src/components/Sidebar.tsx:45-69` and `:190-210` (the new button)
- Modify: `src/App.tsx` (state, handler, wiring)

**Interfaces:**
- Consumes: `fetchSitesRows`, `SitesApiError` (Task 3); `normalizeRows` (Task 2).
- Produces: no new exports other than the widened `LogAction` and the two optional `source` props.

There is no automated test for this task — it is React wiring. Step 8 is a scripted manual verification and is not optional.

- [ ] **Step 1: Widen `LogAction` and give the Log page a style for it**

In `src/lib/activityLog.ts`, change line 3:

```ts
export type LogAction  = 'upload' | 'sync' | 'edit' | 'delete'
```

No migration is needed: `activity_log.action` is a plain `text` column with no CHECK constraint.

In `src/pages/Log.tsx`, add the matching entry to `ACTION_STYLES` — the page does `ACTION_STYLES[e.action].bg`, so a missing key would throw on the first synced row:

```ts
const ACTION_STYLES: Record<LogAction, { label: string; bg: string; fg: string }> = {
  upload: { label: 'Upload', bg: 'var(--pos-surface)',  fg: 'var(--pos)' },
  sync:   { label: 'Sync',   bg: 'var(--info-surface)', fg: 'var(--info)' },
  edit:   { label: 'Edit',   bg: 'var(--info-surface)', fg: 'var(--info)' },
  delete: { label: 'Delete', bg: 'var(--neg-surface)',  fg: 'var(--neg)' },
}
```

- [ ] **Step 2: Make the summary modal source-aware**

In `src/components/UploadSummary.tsx`, extend the data type (lines 7-11):

```ts
export interface UploadSummaryData {
  displayDate:    string
  records:        RankingRecord[]
  unknownDomains: UnknownDomain[]
  /** Where the records came from. Defaults to 'upload' for the xlsx path. */
  source?:        'upload' | 'sync'
}
```

Destructure it where `displayDate`, `records` and `unknownDomains` are already destructured from `data`, adding `source = 'upload'`, then replace the header block (lines 132-137):

```tsx
            <h2 className="font-display text-[18px] tracking-wider text-[var(--ink)] leading-none">
              {source === 'sync' ? 'Sync Summary' : 'Import Summary'}
            </h2>
            <p className="text-[11px] text-[var(--muted)] mt-1.5">
              {displayDate} · {records.length.toLocaleString()} record{records.length !== 1 ? 's' : ''} {source === 'sync' ? 'synced' : 'uploaded'}
            </p>
```

Also change the "Uploaded" stat card label (line 152) so it reads correctly for a sync:

```tsx
            <Stat label={source === 'sync' ? 'Synced' : 'Uploaded'} value={records.length} />
```

and the empty-distribution copy (line 173):

```tsx
                No matching brands in this {source === 'sync' ? 'sync' : 'upload'}.
```

The Countries stat card already counts distinct country codes, so an unrecognised country from the API is visible here without further change.

- [ ] **Step 3: Make the duplicate modal source-aware**

In `src/components/DuplicateWarning.tsx`, extend the data type (lines 3-5):

```ts
export interface DuplicateWarningData {
  existing: Snapshot
  /** Where the incoming records came from. Defaults to 'upload'. */
  source?:  'upload' | 'sync'
}
```

Change the destructure on line 15 to `const { existing, source = 'upload' } = data`, then the header (lines 31-35):

```tsx
            <h2 className="font-display text-[16px] tracking-wider text-[var(--ink)] leading-tight">
              {source === 'sync' ? 'Snapshot already exists' : 'File already imported'}
            </h2>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              A snapshot for this date already exists
            </p>
```

and the body paragraph (lines 41-43):

```tsx
          <p className="text-[13px] text-[var(--text-2)] leading-relaxed">
            {source === 'sync' ? (
              <>The Ranks API returned a batch whose newest check date matches an existing snapshot. Replacing it will overwrite any manual edits stored on that snapshot.</>
            ) : (
              <>The file you uploaded has a <code className="font-mono text-[var(--ink)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded border border-[var(--border)]">Last Check</code> date that matches an existing snapshot. Duplicate uploads are not allowed.</>
            )}
          </p>
```

and the closing hint (lines 60-62):

```tsx
          <p className="text-[12px] text-[var(--muted)] leading-relaxed">
            To {source === 'sync' ? 're-sync' : 're-import'}, delete the existing snapshot first — or click <span className="text-[var(--neg)] font-semibold">Delete &amp; replace</span> below.
          </p>
```

- [ ] **Step 4: Add the Sidebar button**

In `src/components/Sidebar.tsx`, add `RefreshCw` to the existing lucide import on line 5:

```tsx
import { ChevronsLeft, ChevronsRight, CircleHelp, DollarSign, History, RefreshCw, Users } from 'lucide-react'
```

Add two props to `interface Props` (after `onOpenUpload`):

```ts
  onSyncFromApi: () => void
  syncing: boolean
```

Add them to the destructured parameter list in the same order, then insert the button in the footer immediately **above** the existing Import Data button (before line 192):

```tsx
          <button
            onClick={onSyncFromApi}
            title={writeGate.title ?? 'Pull the latest BP rankings from the Ranks API'}
            disabled={writeGate.disabled || syncing}
            className="w-full flex items-center gap-3 px-3 py-2 mb-2 bg-transparent border border-[var(--border-2)] text-[var(--text-2)] rounded-lg text-[12px] font-bold transition-all hover:border-[var(--brand-blue)] hover:text-[var(--ink)] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={18} className={`shrink-0 ${syncing ? 'animate-spin' : ''}`} />
            <span className={labelCls}>{syncing ? 'Syncing…' : 'Sync from API'}</span>
          </button>
```

- [ ] **Step 5: Add the sync handler to `App.tsx`**

Add to the imports near line 17:

```ts
import { fetchSitesRows, SitesApiError } from './lib/sitesApi'
import { normalizeRows } from './lib/sitesNormalize'
```

Add state beside the other `useState` calls (after line 55):

```ts
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
```

Widen the `duplicateWarning` state on line 55 to carry the source:

```ts
  const [duplicateWarning, setDuplicateWarning] = useState<{ existing: Snapshot; pendingRecords: RankingRecord[]; unknownDomains: UnknownDomain[]; source: 'upload' | 'sync' }| null>(null)
```

Set `source: 'upload'` at the existing call site inside `handleImport` (line 219):

```ts
        setDuplicateWarning({ existing: dupe, pendingRecords: parsed.records, unknownDomains, source: 'upload' })
```

Add the handler after `handleImport` (after line 265):

```tsx
  // ── Sync from the Ranks API ───────────────────────────────────────────────
  //
  // BP only. The API tracks none of the LP domains, so there is deliberately no
  // category argument — a sync can never write a half-empty LP snapshot.
  const handleSyncFromApi = useCallback(async () => {
    if (syncing) return

    // Gate before doing any work. A cancelled sign-in just means no sync;
    // there is nothing to surface as an error.
    try {
      await requireAuth(() => true)
    } catch {
      return
    }

    setSyncing(true)
    setSyncProgress(0)
    try {
      const rows = await fetchSitesRows(setSyncProgress)
      const { records, unknownDomains, rawDate } = normalizeRows(rows)

      // Everything filtered out. This is what you see when brands.ts and the
      // API disagree, so it gets the summary modal rather than an error — the
      // skipped-domain list is the whole point.
      if (records.length === 0) {
        setUploadSummary({ displayDate: '—', records: [], unknownDomains, source: 'sync' })
        addToast('Sync returned no Rooster rows — every row was filtered out.', 'warning')
        return
      }

      const dupe = state.snapshots.find((s) => s.category === 'bp-sites' && s.rawDate === rawDate)
      if (dupe) {
        setDuplicateWarning({ existing: dupe, pendingRecords: records, unknownDomains, source: 'sync' })
        return
      }

      const snap = await persistOneSnapshot({ rawDate, records }, 'bp-sites')
      if (!snap) return

      void logActivity('sync', 'bp-sites', `Synced ${records.length} records from Ranks API — ${snap.displayDate}`)
      setUploadSummary({ displayDate: snap.displayDate, records, unknownDomains, source: 'sync' })
      const counts = summarizeRecords(records, DOMAIN_TO_BRAND)
      addToast(
        `✓ Synced ${records.length.toLocaleString()} records · ${counts.brands} brand${counts.brands !== 1 ? 's' : ''} · ${counts.sites} site${counts.sites !== 1 ? 's' : ''} · ${counts.keywords} keyword${counts.keywords !== 1 ? 's' : ''} — ${snap.displayDate}`,
      )
      reportUnknownDomains(unknownDomains)
    } catch (err) {
      // A 401 means the key itself was rejected — name the variable so the fix
      // is obvious, rather than showing the upstream's generic wording.
      const msg =
        err instanceof SitesApiError && err.status === 401
          ? 'the Ranks API rejected the key — check SITES_API_KEY on the server.'
          : err instanceof Error
            ? err.message
            : String(err)
      addToast(`Sync failed: ${msg}`, 'error')
    } finally {
      setSyncing(false)
    }
  }, [addToast, persistOneSnapshot, reportUnknownDomains, requireAuth, state.snapshots, syncing])
```

- [ ] **Step 6: Make the replace path source-aware**

In `handleReplaceDuplicate` (lines 267-296), pull `source` out of the state object and use it for the log entry, the summary and the toast. Replace lines 269 and 288-294 with:

```tsx
    const { existing, pendingRecords, unknownDomains, source } = duplicateWarning
```

```tsx
    if (source === 'sync') {
      void logActivity('sync', existing.category, `Replaced snapshot from Ranks API — ${snap.displayDate} (${pendingRecords.length} records)`)
    } else {
      void logActivity('upload', existing.category, `Replaced snapshot — ${snap.displayDate} (${pendingRecords.length} records)`)
    }
    setUploadSummary({ displayDate: snap.displayDate, records: pendingRecords, unknownDomains, source })
    const domainMap = existing.category === 'lp-sites' ? LP_DOMAIN_TO_BRAND : DOMAIN_TO_BRAND
    const counts = summarizeRecords(pendingRecords, domainMap)
    addToast(
      `✓ ${source === 'sync' ? 'Synced' : 'Imported'} ${pendingRecords.length.toLocaleString()} records · ${counts.brands} brand${counts.brands !== 1 ? 's' : ''} · ${counts.sites} site${counts.sites !== 1 ? 's' : ''} · ${counts.keywords} keyword${counts.keywords !== 1 ? 's' : ''} — ${snap.displayDate}`,
    )
```

- [ ] **Step 7: Pass everything through in the render**

Add the two new props to the `<Sidebar …>` element (after `onOpenUpload={openUpload}` on line 467):

```tsx
        onSyncFromApi={handleSyncFromApi}
        syncing={syncing}
```

Pass the source to `<DuplicateWarning>` (line 508):

```tsx
          data={{ existing: duplicateWarning.existing, source: duplicateWarning.source }}
```

Add a progress overlay beside the existing `bulkProgress` one (after line 535). Row count is unknown up front, so this counts up rather than showing a percentage:

```tsx
      {syncing && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[var(--surface)] border border-[var(--border-2)] rounded-2xl w-[420px] max-w-[95vw] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.12)]">
            <h2 className="font-display text-[16px] tracking-wider text-[var(--ink-2)] mb-4">
              Syncing from Ranks API
            </h2>
            <div className="h-[5px] bg-[var(--border-3)] rounded-full overflow-hidden mb-3">
              <div
                className="h-full w-1/3 rounded-full animate-pulse"
                style={{ background: 'linear-gradient(90deg, var(--brand-navy) 0%, var(--brand-blue) 100%)' }}
              />
            </div>
            <p className="text-center text-[12px] text-[var(--muted-3)]">
              {syncProgress.toLocaleString()} rows fetched…
            </p>
          </div>
        </div>
      )}
```

- [ ] **Step 8: Verify by running the app**

```bash
npm run build          # must pass — this is the strict tsc -b across all three projects
npx vitest run         # every existing test must still pass
npm run dev
```

In the browser at `http://localhost:5173`, signed in as an approved user:

1. Click **Sync from API**. The overlay counts up and the summary modal opens headed **Sync Summary**.
2. Confirm the summary shows roughly **1,109 records, 9 brands, 37 domains, 5 countries**, and a skipped-domains panel with the non-Rooster domains.
3. Open BP Sites and confirm positions render, with `NR` where the API returned 0.
4. Confirm GSV / SV / AFF columns are populated by carry-forward from the previous snapshot rather than blank.
5. Click **Sync from API** again. The duplicate modal must appear, headed **Snapshot already exists**. Click **Cancel** and confirm nothing changed.
6. Sync once more and click **Delete & replace**. Confirm it succeeds and the record count is unchanged.
7. Open `/log` and confirm a **Sync** badge renders without a crash.
8. Temporarily rename `SITES_API_KEY` in `.env` to `SITES_API_KEY_X`, restart `npm run dev`, and click Sync. Confirm the error toast names `SITES_API_KEY`. Restore the name and restart.
9. Confirm **Import Data** still opens the upload modal and an xlsx upload still works end to end.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx src/components/UploadSummary.tsx src/components/DuplicateWarning.tsx src/lib/activityLog.ts src/pages/Log.tsx
git commit -m "feat(sync): add Sync from API to the sidebar

Pulls BP rankings from the Ranks API through the existing snapshot
write path — requireAuth, the duplicate prompt, the summary modal and
carry-forward are all reused. BP only: the API tracks no LP domains.
Import Data is unchanged."
```

---

### Task 5: Documentation and deployment notes

**Files:**
- Modify: `.env.example`
- Modify: `docs/integrations/sites-api.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing. Produces: nothing consumed by code.

- [ ] **Step 1: Document the variable**

Append to `.env.example`:

```
# Ranks API (api/sites.ts — the "Sync from API" button on BP Sites).
# Server-only: must NEVER get a VITE_ prefix, or the key ships in the public
# bundle. Set it in Vercel for Production and Preview, and in .env locally —
# vite.config.ts loads it for the dev server.
SITES_API_KEY=bpn_your_key
```

- [ ] **Step 2: Record what the endpoint actually does**

Append to `docs/integrations/sites-api.md`:

```markdown
---

## Observed behaviour (verified 2026-08-10)

Where this contradicts the sections above, the observation wins. Each line is a
requirement on `src/lib/sitesNormalize.ts`.

| Observed | Documented | Requirement |
|---|---|---|
| Rooster data is `project_id: 0` | not mentioned | `?project_id=0` does **not** filter — the upstream treats `0` as falsy and returns every project. `api/sites.ts` never sends it. |
| `position: 0` on 403 of 1,109 Rooster rows; no nulls at all | "null = not in top results" | Both `0` and `null` normalize to `NR`. |
| `country` is `AU/CA/DE/IT/NZ` with `language` a separate field | "country/language" | Project 0 returns real country codes matching `COUNTRY_LABELS`. `language` is ignored. |
| One row per (domain, keyword, country) on project 0 | implied current state | The latest-per-key reduction is a no-op here; it stays as a guard, since project 18 has been seen returning 6 rows per key. |
| `meta.total` under-reports (135 for a 154-row response) | — | Page until a page is shorter than `limit`; never terminate on a count. |
| `from` / `to` ignored on `action=results` | listed as filters | Usable only on `action=history`. |
| `keyword_count` in `action=domains` counts check rows, not distinct keywords | — | `rooster.bet` reports 688, which is its full history row count, not its 7 keywords. |
| `action=history` returns weekly history back to 2026-03-30 | listed | Not used. Backfill is deliberately out of scope — the API's dates do not line up with the xlsx "Last Check" dates. |

### Coverage

Of 2,826 total result rows across both projects, 1,109 match BP domains: all 37
BP/MAIN domains, 54 keywords, 5 countries. **No LP domains are tracked** — the
30 rows that appear to match are `lucky7evencasino.org`, which is registered
under both `domains` and `lpDomains`. LP Sites therefore stays xlsx-only.

56 of the 1,109 BP rows carry `project_id: 18` on five domains shared with
BIF-Dashboard. They are kept: their keywords all exist in the project-0
vocabulary, and they fill keys project 0 did not check that week.
```

- [ ] **Step 3: Point CLAUDE.md at the new path**

`CLAUDE.md`'s Data Flow section still describes `localStorage` and an xlsx-only
import. Correct the ingestion bullet only — the rest of the drift is out of
scope for this change. Replace the "**Import**" bullet with:

```markdown
1. **Import** — Two paths into the same `Snapshot` shape:
   - **Sync from API** (BP Sites only) — `src/lib/sitesApi.ts` pages `/api/sites`
     (a Vercel function in `api/sites.ts` holding `SITES_API_KEY`), and
     `src/lib/sitesNormalize.ts` filters rows to `DOMAIN_TO_BRAND` and converts
     them to `RankingRecord[]`. See `docs/integrations/sites-api.md`.
   - **Import Data** — user uploads an `.xlsx` via `UploadModal`;
     `src/lib/parser.ts` (`parseXlsx`) reads it, auto-detects the header row, and
     filters to known brand domains. The only path for LP Sites, which the API
     does not track.
```

Add a row to the Key Files table:

```markdown
| `src/lib/sitesNormalize.ts` | Ranks API row → `RankingRecord`. Encodes the endpoint's observed quirks (`position: 0` means NR). |
| `api/sites.ts` | Serverless proxy holding `SITES_API_KEY`; the browser never sees the key or the upstream URL. |
```

- [ ] **Step 4: Commit**

```bash
git add .env.example docs/integrations/sites-api.md CLAUDE.md
git commit -m "docs: record Ranks API behaviour and the SITES_API_KEY setup"
```

- [ ] **Step 5: Set the key in Vercel**

This cannot be done from the repo. Tell the user, verbatim:

> Add `SITES_API_KEY` to the Vercel project environment for **Production** and
> **Preview** (Settings → Environment Variables). Use the same value as `.env`.
> Do not add a `VITE_` prefix. The Sync button returns a 500 naming the variable
> until this is done.

- [ ] **Step 6: Open the PR and record it on the PMS board**

```bash
git push -u origin feat/sites-api-sync
gh pr create --title "feat: sync BP rankings from the Ranks API" --body "$(cat <<'EOF'
Adds a **Sync from API** button that pulls BP Sites rankings from the Ranks API
into a snapshot, through the write path the xlsx upload already uses.

- `api/sites.ts` — Vercel function holding `SITES_API_KEY`; the browser never
  sees the key or the upstream URL. Also mounted on the Vite dev server so
  `npm run dev` works.
- `src/lib/sitesApi.ts` — pages the proxy, terminating on a short page rather
  than the under-reporting `meta.total`.
- `src/lib/sitesNormalize.ts` — filters to `DOMAIN_TO_BRAND` and converts rows
  to `RankingRecord[]`. `position: 0` means NR.
- Reuses `requireAuth`, the duplicate Replace/Cancel prompt, the summary modal,
  the activity log and GSV/SV/AFF carry-forward unchanged.

BP only — the API tracks none of the LP domains. Import Data and all inline
editing are untouched. Scheduled sync and historical backfill are deliberately
out of scope; see the spec.

Spec: `docs/superpowers/specs/2026-08-10-sites-api-sync-design.md`
Plan: `docs/superpowers/plans/2026-08-10-sites-api-sync.md`

**Deploy note:** `SITES_API_KEY` must be set in Vercel (Production + Preview)
before the button works.
EOF
)"
```

Then, per `docs/integrations/kanban.md`: list the existing tasks on project
`cmp0w5oxq000004l2rg84dwn1` first to avoid a duplicate, create one task in the
**In Progress** column (`cmp0w5oxy000304l2ex5a7cxx`) assigned to Ivan
(`cmnffqu7g0000ashloojpkidg`) with the PR link in the description, and move it
to **Done** (`cmp0w5oxy000604l29f7v7bju`) via `PATCH /api/tasks/{id}/move` once
the PR merges. Confirm with the user before each write; reads are free.

---

## Notes for the implementer

**Do not "fix" these — they are deliberate:**

- `position: 0` meaning NR looks like a bug in the upstream. It is how it
  reports "not ranking", on 403 of 1,109 rows.
- The proxy not sending `project_id` looks like an omission. Sending
  `project_id=0` returns *more* data, not less.
- `reduceLatest` currently does nothing on real data. It is a guard against the
  check-log behaviour the sibling project hit, and it is tested as such.
- Records come out with empty `searchVolume` / `affiliateUrl` /
  `globalSearchVolume`. `applyCarryForward` fills them from the previous
  snapshot at render time; writing anything else would break the propagation
  that inline edits depend on.
- `url_found` is discarded. `RankingRecord` has no field for it and
  `ranking_records` has no column.
