// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler, { runSummary, timing } from './cron-discovery.js'
import { BRANDS } from './_lib/brands.js'
import { discoveryPairs, pairKey, type DiscoveryCountry } from './_lib/keywordDiscovery.js'

const { inserts, store } = vi.hoisted(() => ({
  inserts: [] as { table: string; rows: unknown }[],
  store: {
    loadFetchedPairs:   vi.fn(),
    loadTrackedRecords: vi.fn(),
    saveFetch:          vi.fn(),
    cycleTotals:        vi.fn(),
  },
}))

// The store is tested on its own (api/_lib/discoveryStore.test.ts); here it is
// the boundary. The Supabase client only ever sees the activity_log insert.
vi.mock('./_lib/discoveryStore.js', () => store)
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: async (rows: unknown) => {
        inserts.push({ table, rows })
        return { error: null }
      },
    }),
  }),
}))

const loggedSummaries = () =>
  inserts.filter((i) => i.table === 'activity_log').map((i) => (i.rows as { summary: string }).summary)

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const LIMITS = {
  subscription: 'Standard, billed monthly', usage_reset_date: '2026-12-05T00:00:00Z',
  units_limit_workspace: 800000, units_usage_workspace: 0,
  units_limit_api_key: 200000, units_usage_api_key: 0, api_key_expiration_date: '2027-11-13T23:59:58Z',
}
const ROW = {
  keyword: 'spinsup review', best_position: 4, best_position_url: 'https://spinsup.com/review', volume: 300,
  last_update: '2026-11-02T09:00:00Z', best_position_kind: 'organic',
}
/** One row, charged 65 units: what most calls look like. */
const oneRow = () => json({ keywords: [ROW] }, 200, { 'x-api-units-cost-total': '65', 'x-api-units-cost-total-actual': '65' })

let limits: Record<string, unknown>
let organic: (call: number, init: RequestInit) => Response | Promise<Response>
let fetchMock: ReturnType<typeof vi.fn>

function stubAhrefs() {
  let call = 0
  fetchMock = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    if (init.signal?.aborted) throw init.signal.reason
    const path = new URL(String(input)).pathname
    if (path === '/v3/subscription-info/limits-and-usage') return json({ limits_and_usage: limits })
    if (path === '/v3/site-explorer/organic-keywords') return organic(call++, init)
    return json({ error: 'unexpected path' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
}
const organicCalls = () => fetchMock.mock.calls
  .map((c) => new URL(String(c[0])))
  .filter((u) => u.pathname === '/v3/site-explorer/organic-keywords')

/** Only these pairs are still missing; every other pair of the cycle is already fetched. */
function onlyMissing(pairs: Array<[domain: string, country: DiscoveryCountry]>) {
  const missing = new Set(pairs.map(([d, c]) => pairKey(d, c)))
  store.loadFetchedPairs.mockResolvedValue(new Set(
    discoveryPairs(BRANDS).map((p) => pairKey(p.domain, p.country)).filter((k) => !missing.has(k)),
  ))
}

type MockRes = VercelResponse & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> }
function makeRes(): MockRes {
  const res: Partial<MockRes> = {}
  res.status    = vi.fn(() => res as MockRes)
  res.json      = vi.fn(() => res as MockRes)
  res.setHeader = vi.fn(() => res as MockRes)
  return res as MockRes
}
const cronReq = (headers: Record<string, string> = { authorization: 'Bearer secret-value' }) =>
  ({ method: 'GET', headers, query: {} }) as unknown as VercelRequest

async function run() {
  const res = makeRes()
  await handler(cronReq(), res)
  return { status: res.status.mock.calls[0]?.[0] as number, body: res.json.mock.calls[0]?.[0] as Record<string, unknown> }
}

const DEFAULT_TIMING = { ...timing }
const saved: Record<string, string | undefined> = {}
const MANAGED = ['CRON_SECRET', 'AHREFS_API_KEY', 'AHREFS_DISCOVERY_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']

beforeEach(() => {
  inserts.length = 0
  for (const n of MANAGED) saved[n] = process.env[n]
  process.env.CRON_SECRET               = 'secret-value'
  process.env.AHREFS_API_KEY            = 'ak_test'
  process.env.AHREFS_DISCOVERY_API_KEY  = 'dk_test'
  process.env.SUPABASE_URL              = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_test'
  Object.assign(timing, DEFAULT_TIMING, { gapMs: 0 })
  limits = { ...LIMITS }
  organic = () => oneRow()
  stubAhrefs()
  store.loadFetchedPairs.mockReset().mockResolvedValue(new Set())
  store.loadTrackedRecords.mockReset().mockResolvedValue([])
  store.saveFetch.mockReset().mockResolvedValue(undefined)
  store.cycleTotals.mockReset().mockResolvedValue({ pairs: 185, units: 46300 })
})

afterEach(() => {
  for (const n of MANAGED) {
    if (saved[n] === undefined) delete process.env[n]
    else process.env[n] = saved[n]
  }
  Object.assign(timing, DEFAULT_TIMING)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('runSummary', () => {
  const BASE = { cycle: '2026-11-05', calls: 30, units: 2140, completedBrands: [] as string[], left: 125, total: 185 }

  it('reports progress, naming the brands that finished', () => {
    expect(runSummary({ ...BASE, completedBrands: ['FortunePlay', 'Rollero'] })).toBe(
      'Keyword discovery — 30 calls, 2,140 units; FortunePlay and Rollero complete for the cycle from Nov 5, 2026; 125 calls left',
    )
    expect(runSummary({ ...BASE, completedBrands: ['SpinsUp', 'Spinjo', 'Rollero'] })).toContain(
      '; SpinsUp, Spinjo and Rollero complete for',
    )
  })

  it('uses the singular for one call', () => {
    expect(runSummary({ ...BASE, calls: 1, units: 65, left: 1 }))
      .toBe('Keyword discovery — 1 call, 65 units for the cycle from Nov 5, 2026; 1 call left')
  })

  it('says why a run stopped for units', () => {
    expect(runSummary({ ...BASE, unitsLeftAtStop: 700 })).toBe(
      'Keyword discovery — 30 calls, 2,140 units for the cycle from Nov 5, 2026; 125 calls left; stopped: the discovery key has 700 units left this month',
    )
  })

  it('reports a finished cycle with its total units', () => {
    expect(runSummary({ ...BASE, left: 0, cycleUnits: 46300 }))
      .toBe('Keyword discovery — cycle from Nov 5, 2026 complete (185/185), 46,300 units in total')
  })
})

describe('api/cron-discovery — refusals', () => {
  it('rejects a request without the cron secret, touching nothing', async () => {
    const res = makeRes()
    await handler(cronReq({}), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(inserts).toEqual([])
  })

  it('fails, and says so, without a discovery key', async () => {
    delete process.env.AHREFS_DISCOVERY_API_KEY
    expect((await run()).status).toBe(500)
    expect(loggedSummaries()).toEqual(['Keyword discovery failed: AHREFS_DISCOVERY_API_KEY is not configured on the server'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses to spend units with the rankings key', async () => {
    process.env.AHREFS_DISCOVERY_API_KEY = 'ak_test'
    expect((await run()).status).toBe(500)
    expect(loggedSummaries()).toEqual([
      'Keyword discovery failed: AHREFS_DISCOVERY_API_KEY is the same key as AHREFS_API_KEY — the rankings key must never spend units',
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a key with no unit limit', async () => {
    limits = { ...LIMITS, units_limit_api_key: null }
    expect((await run()).status).toBe(500)
    expect(loggedSummaries()).toEqual([
      'Keyword discovery stopped: the discovery key has no unit limit — set a monthly limit on it in Ahrefs',
    ])
    expect(organicCalls()).toEqual([])
  })
})

describe('api/cron-discovery — runs', () => {
  it('does nothing, and logs nothing, once the cycle is complete', async () => {
    onlyMissing([])
    const { status, body } = await run()
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, outcome: 'idle' })
    expect(organicCalls()).toEqual([])
    expect(inserts).toEqual([])
  })

  it('stops before the first call when the key is nearly out of units', async () => {
    limits = { ...LIMITS, units_usage_api_key: 199300 }
    const { status } = await run()
    expect(status).toBe(200)
    expect(loggedSummaries()).toEqual(['Keyword discovery stopped: the discovery key has 700 units left this month'])
    expect(organicCalls()).toEqual([])
  })

  it('fetches only the missing pairs, in order, leaving tracked keywords out, and finishes the cycle', async () => {
    onlyMissing([['spinsup.com', 'AU'], ['spinsup.com', 'CA'], ['spinsup.com', 'DE']])
    store.loadTrackedRecords.mockResolvedValue([{ domain: 'spinsup.io', keyword: 'SpinsUp Bonus', country: 'AU' }])

    const { status, body } = await run()

    expect(status).toBe(200)
    expect(organicCalls().map((u) => [u.searchParams.get('target'), u.searchParams.get('country')]))
      .toEqual([['spinsup.com', 'au'], ['spinsup.com', 'ca'], ['spinsup.com', 'de']])
    expect(organicCalls().map((u) => u.searchParams.get('where'))).toEqual([
      '{"not":{"or":[{"field":"keyword","is":["eq","spinsup bonus"]}]}}', null, null,
    ])
    expect(store.saveFetch).toHaveBeenCalledTimes(3)
    expect(store.saveFetch.mock.calls[0][1]).toEqual({
      cycle: '2026-11-05', domain: 'spinsup.com', country: 'AU', units: 65,
      rows: [{
        cycle: '2026-11-05', brand: 'SpinsUp', domain: 'spinsup.com', country: 'AU', keyword: 'spinsup review',
        position: 4, positionKind: 'organic', url: 'https://spinsup.com/review', volume: 300,
        ahrefsChecked: '2026-11-02T09:00:00Z',
      }],
    })
    expect(store.cycleTotals).toHaveBeenCalledWith(expect.anything(), '2026-11-05')
    expect(loggedSummaries()).toEqual(['Keyword discovery — cycle from Nov 5, 2026 complete (185/185), 46,300 units in total'])
    expect(body).toMatchObject({ ok: true, outcome: 'complete', calls: 3, units: 195, left: 0 })
  })

  it('sends only the discovery key, never the rankings key', async () => {
    onlyMissing([['spinsup.com', 'AU']])
    await run()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    for (const [, init] of fetchMock.mock.calls as Array<[unknown, RequestInit]>) {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dk_test')
    }
  })

  it('stops starting calls when its time budget runs low, and reports what is left', async () => {
    onlyMissing([['spinsup.com', 'AU'], ['spinsup.com', 'CA'], ['spinjo.com', 'AU'], ['spinjo.com', 'CA'], ['spinjo.com', 'DE']])
    let clock = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    organic = () => {
      clock += 16_000
      return oneRow()
    }

    const { status, body } = await run()

    expect(status).toBe(200)
    expect(organicCalls()).toHaveLength(2)
    expect(loggedSummaries()).toEqual([
      'Keyword discovery — 2 calls, 130 units; SpinsUp complete for the cycle from Nov 5, 2026; 3 calls left',
    ])
    expect(body).toMatchObject({ outcome: 'progress', calls: 2, left: 3 })
    expect(store.cycleTotals).not.toHaveBeenCalled()
  })

  it('stops when the key runs low on units mid-run', async () => {
    onlyMissing([['spinsup.com', 'AU'], ['spinsup.com', 'CA']])
    limits = { ...LIMITS, units_usage_api_key: 198600 }
    const rows46 = { keywords: Array.from({ length: 46 }, (_, i) => ({ ...ROW, keyword: `spinsup kw ${i}` })) }
    organic = () => json(rows46, 200, { 'x-api-units-cost-total-actual': '700' })

    await run()

    expect(organicCalls()).toHaveLength(1)
    expect(loggedSummaries()).toEqual([
      'Keyword discovery — 1 call, 700 units for the cycle from Nov 5, 2026; 1 call left; stopped: the discovery key has 700 units left this month',
    ])
  })

  it('fails loudly on an Ahrefs error, keeping the pairs it already saved', async () => {
    onlyMissing([['spinsup.com', 'AU'], ['spinsup.com', 'CA']])
    organic = (call) => (call === 0 ? oneRow() : json({ error: 'internal' }, 500))

    const { status } = await run()

    expect(status).toBe(502)
    expect(loggedSummaries()).toEqual(['Keyword discovery failed: Ahrefs returned HTTP 500 for spinsup.com (CA): internal'])
    expect(store.saveFetch).toHaveBeenCalledTimes(1)
    expect(store.saveFetch.mock.calls[0][1]).toMatchObject({ domain: 'spinsup.com', country: 'AU' })
  })

  it('names its own budget when Ahrefs is still answering at the deadline', async () => {
    Object.assign(timing, { budgetMs: 50, minStartMs: 10 })
    organic = (_call, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })

    const { status } = await run()

    expect(status).toBe(502)
    expect(loggedSummaries()).toEqual([
      'Keyword discovery failed: the run exceeded its 0.05s budget — Ahrefs did not finish responding in time',
    ])
  })
})
