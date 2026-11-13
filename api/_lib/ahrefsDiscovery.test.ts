// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DISCOVERY_KEY_REJECTED, DiscoveryError, discoveryConfig, expectedMaxUnits, fetchKeyLimits, fetchOrganicKeywords,
  sharesSyncKey,
} from './ahrefsDiscovery.js'

const CONFIG = { key: 'dk_test' }
const REQ = { domain: 'spinsup.com', country: 'AU', date: '2026-12-06' } as const
/** Keeps retry waits out of the test run. */
const FAST = { retryDelayMs: 0, maxRetryAfterMs: 10 }

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

/** An organic-keywords body with `n` complete rows, as Ahrefs returns them. */
const rows = (n: number) => ({
  keywords: Array.from({ length: n }, (_, i) => ({
    keyword: `spinsup keyword ${i}`, best_position: i + 1, best_position_url: 'https://spinsup.com/', volume: 100 - i,
    last_update: '2026-12-01T08:00:00Z', best_position_kind: 'organic',
  })),
})

let fetchMock: ReturnType<typeof vi.fn>
/** Each fetch answers with the next factory; the last one repeats. A factory may throw (a network failure). */
function stubFetch(...answers: Array<() => Response>) {
  let call = 0
  fetchMock = vi.fn(async (_input: unknown, init: RequestInit = {}) => {
    if (init.signal?.aborted) throw init.signal.reason
    return answers[Math.min(call++, answers.length - 1)]()
  })
  vi.stubGlobal('fetch', fetchMock)
}
const sentUrl = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]))

afterEach(() => vi.unstubAllGlobals())

describe('discoveryConfig / sharesSyncKey', () => {
  it('reads only the discovery key, trimmed', () => {
    expect(discoveryConfig({})).toBeNull()
    expect(discoveryConfig({ AHREFS_DISCOVERY_API_KEY: '  ' })).toBeNull()
    expect(discoveryConfig({ AHREFS_API_KEY: 'ak' })).toBeNull()
    expect(discoveryConfig({ AHREFS_DISCOVERY_API_KEY: ' dk ' })).toEqual({ key: 'dk' })
  })

  it('notices when the discovery key is the rankings key', () => {
    expect(sharesSyncKey({ AHREFS_DISCOVERY_API_KEY: 'k ', AHREFS_API_KEY: ' k' })).toBe(true)
    expect(sharesSyncKey({ AHREFS_DISCOVERY_API_KEY: 'k1', AHREFS_API_KEY: 'k2' })).toBe(false)
    expect(sharesSyncKey({ AHREFS_DISCOVERY_API_KEY: 'k' })).toBe(false)
    expect(sharesSyncKey({ AHREFS_API_KEY: 'k' })).toBe(false)
  })
})

describe('fetchOrganicKeywords — the request', () => {
  it('asks for one domain and country, top 50 by volume, with the discovery key', async () => {
    stubFetch(() => json(rows(1)))
    await fetchOrganicKeywords(CONFIG, REQ)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(input)
    expect(url.origin + url.pathname).toBe('https://api.ahrefs.com/v3/site-explorer/organic-keywords')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      target: 'spinsup.com', country: 'au', date: '2026-12-06', mode: 'subdomains',
      select: 'keyword,best_position,best_position_url,volume,last_update,best_position_kind',
      order_by: 'volume:desc', limit: '50',
    })
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.redirect).toBe('manual')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dk_test')
  })

  it('adds the where clause when there are keywords to exclude', async () => {
    stubFetch(() => json(rows(1)))
    const where = '{"not":{"or":[{"field":"keyword","is":["eq","spinsup"]}]}}'
    await fetchOrganicKeywords(CONFIG, { ...REQ, excludeWhere: where })
    expect(sentUrl().searchParams.get('where')).toBe(where)
  })
})

describe('fetchOrganicKeywords — units', () => {
  it('counts what Ahrefs actually charged', async () => {
    stubFetch(() => json(rows(50), 200, { 'x-api-units-cost-total': '750', 'x-api-units-cost-total-actual': '0' }))
    const res = await fetchOrganicKeywords(CONFIG, REQ)
    expect(res.unitsActual).toBe(0)
    expect(res.rowCount).toBe(50)
    expect(res.body).toEqual(rows(50))
  })

  it('falls back to the nominal cost when the actual header is missing', async () => {
    stubFetch(() => json(rows(8), 200, { 'x-api-units-cost-total': '120' }))
    expect((await fetchOrganicKeywords(CONFIG, REQ)).unitsActual).toBe(120)
  })

  it('assumes the worst case when Ahrefs sends no cost at all', async () => {
    stubFetch(() => json(rows(2)))
    expect((await fetchOrganicKeywords(CONFIG, REQ)).unitsActual).toBe(50)
  })

  it('expects at most max(50, 15 units a row)', () => {
    expect([0, 10, 50].map(expectedMaxUnits)).toEqual([50, 150, 750])
  })

  it('accepts a cost up to 50 units over what the rows explain', async () => {
    stubFetch(() => json(rows(2), 200, { 'x-api-units-cost-total-actual': '100' }))
    expect((await fetchOrganicKeywords(CONFIG, REQ)).unitsActual).toBe(100)
  })

  it('stops when a call costs more than its rows can explain', async () => {
    stubFetch(() => json(rows(2), 200, { 'x-api-units-cost-total-actual': '1000' }))
    await expect(fetchOrganicKeywords(CONFIG, REQ))
      .rejects.toThrow(/1000 units for spinsup.com \(AU\), more than the 50 expected/)
  })
})

describe('fetchOrganicKeywords — errors and retries', () => {
  it('names the discovery key when Ahrefs rejects it, never the key itself, without retrying', async () => {
    stubFetch(() => json({ error: 'invalid key dk_test' }, 401))
    const err = await fetchOrganicKeywords(CONFIG, REQ, FAST).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DiscoveryError)
    expect((err as DiscoveryError).message).toBe(DISCOVERY_KEY_REJECTED)
    expect((err as DiscoveryError).status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 429 once, after its Retry-After', async () => {
    stubFetch(() => json({}, 429, { 'Retry-After': '1' }), () => json(rows(1)))
    await expect(fetchOrganicKeywords(CONFIG, REQ, FAST)).resolves.toMatchObject({ rowCount: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after a second 429', async () => {
    stubFetch(() => json({}, 429), () => json({}, 429))
    await expect(fetchOrganicKeywords(CONFIG, REQ, FAST)).rejects.toThrow(/HTTP 429 for spinsup.com \(AU\)/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("gives up after a second 5xx, quoting Ahrefs' own error", async () => {
    stubFetch(() => json({ error: 'internal' }, 500), () => json({ error: 'internal' }, 500))
    await expect(fetchOrganicKeywords(CONFIG, REQ, FAST)).rejects.toThrow(/HTTP 500 for spinsup.com \(AU\): internal/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a request Ahrefs refused as bad', async () => {
    stubFetch(() => json({ error: 'bad where' }, 400))
    await expect(fetchOrganicKeywords(CONFIG, REQ, FAST)).rejects.toThrow(/HTTP 400 for spinsup.com \(AU\): bad where/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a network failure once', async () => {
    stubFetch(() => { throw new TypeError('fetch failed') }, () => json(rows(3)))
    await expect(fetchOrganicKeywords(CONFIG, REQ, FAST)).resolves.toMatchObject({ rowCount: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('times out a request that does not answer, twice, then says so', async () => {
    fetchMock = vi.fn((_input: unknown, init: RequestInit = {}) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchOrganicKeywords(CONFIG, REQ, { ...FAST, requestTimeoutMs: 20 }))
      .rejects.toThrow(/did not answer within .* for spinsup.com \(AU\)/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("passes the caller's own cancel through untouched", async () => {
    stubFetch(() => json(rows(1)))
    const cancel = new AbortController()
    cancel.abort(new Error('deadline reached'))
    await expect(fetchOrganicKeywords(CONFIG, REQ, { ...FAST, signal: cancel.signal })).rejects.toThrow('deadline reached')
  })
})

describe('fetchKeyLimits', () => {
  const LIMITS = {
    subscription: 'Standard, billed monthly', usage_reset_date: '2026-12-05T00:00:00Z',
    units_limit_workspace: 800000, units_usage_workspace: 0,
    units_limit_api_key: 200000, units_usage_api_key: 1500, api_key_expiration_date: '2027-11-13T23:59:58Z',
  }

  it("reads the key's limit, usage and reset date", async () => {
    stubFetch(() => json({ limits_and_usage: LIMITS }))
    expect(await fetchKeyLimits(CONFIG)).toEqual({ limit: 200000, usage: 1500, resetDate: '2026-12-05T00:00:00Z' })
    expect(sentUrl().pathname).toBe('/v3/subscription-info/limits-and-usage')
    expect((fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers.Authorization)
      .toBe('Bearer dk_test')
  })

  it('reports a key without a limit as a null limit', async () => {
    stubFetch(() => json({ limits_and_usage: { ...LIMITS, units_limit_api_key: null } }))
    expect((await fetchKeyLimits(CONFIG)).limit).toBeNull()
  })

  it('refuses a response without a reset date', async () => {
    const { usage_reset_date: _dropped, ...noReset } = LIMITS
    stubFetch(() => json({ limits_and_usage: noReset }))
    await expect(fetchKeyLimits(CONFIG)).rejects.toThrow(/unexpected limits response/)
  })
})
