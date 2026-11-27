// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler, { config } from '../gsc-keywords.js'
import { GOOD_ENV, fake, json, makeReq, makeRes, setConnection } from '../_lib/gscTestKit.js'

vi.mock('@supabase/supabase-js', async () => (await import('../_lib/gscTestKit.js')).supabaseMock)

let fetchMock: ReturnType<typeof vi.fn>
const saved: Record<string, string | undefined> = {}
const NOW = new Date('2026-11-27T12:00:00.000Z')

let sites: Array<{ siteUrl: string; permissionLevel: string }>
let queryBodies: Array<{ property: string; body: Record<string, unknown> }>
let queryRowsFor: (property: string) => unknown[]
let tokenResponse: () => Response
let dateRows: unknown[]

function google(url: unknown, init?: RequestInit): Response {
  const u = String(url)
  if (u.includes('oauth2.googleapis.com/token')) return tokenResponse()
  if (u.endsWith('/webmasters/v3/sites')) return json({ siteEntry: sites })
  const m = /sites\/(.+)\/searchAnalytics\/query$/.exec(u)
  const body = JSON.parse(String(init?.body))
  const property = decodeURIComponent(m![1])
  queryBodies.push({ property, body })
  if ((body.dimensions as string[])[0] === 'date') return json({ rows: dateRows })
  return json({ rows: queryRowsFor(property) })
}
const q = (query: string, country: string, position: number, clicks = 1, impressions = 10) =>
  ({ keys: [query, country], position, clicks, impressions })
const get = async (query: Record<string, string>) => {
  const res = makeRes()
  await handler(makeReq('GET', query), res as never)
  return res
}
const hit = { domain: 'roostersbet.com', days: '28' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const k of Object.keys(GOOD_ENV)) { saved[k] = process.env[k]; process.env[k] = GOOD_ENV[k] }
  fake.reset()
  setConnection()
  sites = [{ siteUrl: 'sc-domain:roostersbet.com', permissionLevel: 'siteOwner' }]
  queryBodies = []
  dateRows = [{ keys: ['2026-11-24'] }, { keys: ['2026-11-25'] }, { keys: ['2026-11-23'] }]
  queryRowsFor = () => [q('rooster bet', 'aus', 3.04, 5, 100)]
  tokenResponse = () => json({ access_token: 'at-secret' })
  fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => google(url, init))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  for (const k of Object.keys(GOOD_ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  vi.unstubAllGlobals()
})

describe('api/gsc-keywords', () => {
  it('exports maxDuration 60 and refuses non-GET', async () => {
    expect(config.maxDuration).toBe(60)
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('GET')
  })

  it('401s without a token and 403s a pending user', async () => {
    let res = makeRes()
    await handler(makeReq('GET', hit, {}), res as never)
    expect(res.statusCode).toBe(401)
    fake.status = 'pending'
    res = await get(hit)
    expect(res.statusCode).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400s a domain that is not a BP site, and days outside 7/28/90, without touching Google', async () => {
    for (const bad of [{ domain: 'example.com', days: '28' }, { domain: 'constructor', days: '28' }, { domain: '', days: '28' },
      { domain: 'roostersbet.com', days: '30' }, { domain: 'roostersbet.com', days: '' }]) {
      const res = await get(bad)
      expect(res.statusCode).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('409 not_connected when nobody has connected Google', async () => {
    fake.connection = null
    const res = await get(hit)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ ok: false, code: 'not_connected' })
  })

  it('409 reconnect for a connection already marked broken, with no Google call', async () => {
    setConnection('broken')
    const res = await get(hit)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ ok: false, code: 'reconnect' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('REVIEW 3: invalid_grant marks the connection broken and answers reconnect', async () => {
    tokenResponse = () => json({ error: 'invalid_grant' }, 400)
    const res = await get(hit)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ ok: false, code: 'reconnect' })
    expect(fake.connection?.status).toBe('broken')
  })

  it('an undecryptable stored token marks the connection broken and answers reconnect, leaking nothing', async () => {
    fake.connection!.refresh_token_enc = 'v1.not.a.token'
    const res = await get(hit)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ ok: false, code: 'reconnect' })
    expect(fake.connection?.status).toBe('broken')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a domain property makes one query for the range ending at the latest data date', async () => {
    const res = await get(hit)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      ok: true, property: 'sc-domain:roostersbet.com', startDate: '2026-10-29', dataUpTo: '2026-11-25', truncated: false,
      rows: [{ query: 'rooster bet', country: 'AU', position: 3, clicks: 5, impressions: 100 }],
    })
    const dims = queryBodies.filter((b) => (b.body.dimensions as string[]).length === 2)
    expect(dims).toHaveLength(1)
    expect(dims[0].body).toMatchObject({ startDate: '2026-10-29', endDate: '2026-11-25', dimensions: ['query', 'country'], rowLimit: 25000 })
    expect(JSON.stringify(res.body)).not.toContain('at-secret')
  })

  it('days=90 asks for 90 days ending at dataUpTo', async () => {
    const res = await get({ domain: 'roostersbet.com', days: '90' })
    expect(res.body.dataUpTo).toBe('2026-11-25')
    expect(res.body.startDate).toBe('2026-08-28')
  })

  it('merges several URL-prefix properties and joins their names', async () => {
    sites = [
      { siteUrl: 'https://roostersbet.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.roostersbet.com/', permissionLevel: 'siteOwner' },
    ]
    queryRowsFor = (p) => (p.startsWith('https://www.') ? [q('rooster bet', 'aus', 5, 2, 100)] : [q('rooster bet', 'aus', 3, 4, 100)])
    const res = await get(hit)
    expect(res.body.property).toBe('https://roostersbet.com/ + https://www.roostersbet.com/')
    expect(res.body.rows).toEqual([{ query: 'rooster bet', country: 'AU', position: 4, clicks: 6, impressions: 200 }])
    expect(queryBodies.filter((b) => (b.body.dimensions as string[]).length === 2)).toHaveLength(2)
  })

  it('passes truncated through', async () => {
    queryRowsFor = () => Array.from({ length: 25000 }, (_, i) => q(`kw ${i}`, 'aus', 1))
    const res = await get(hit)
    expect(res.body.truncated).toBe(true)
    expect(res.body.rows).toHaveLength(25000)
  })

  it('answers property:null when no property matches', async () => {
    sites = [{ siteUrl: 'sc-domain:other.com', permissionLevel: 'siteOwner' }]
    const res = await get(hit)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, property: null })
  })

  it('answers empty rows and dataUpTo null when Google has no recent data', async () => {
    dateRows = []
    const res = await get(hit)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, property: 'sc-domain:roostersbet.com', dataUpTo: null, startDate: null, rows: [] })
  })

  it('serves a fresh cache hit with no Google call, and writes the cache on a miss', async () => {
    await get(hit)
    expect(fake.cache.some((r) => r.domain === 'roostersbet.com' && r.days === 28)).toBe(true)
    fetchMock.mockClear()
    const res = await get(hit)
    expect(res.statusCode).toBe(200)
    expect(res.body.rows).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores a cache row older than 6 hours', async () => {
    fake.cache.push({ domain: 'roostersbet.com', days: 28, payload: { ok: true, property: 'stale', rows: [] }, fetched_at: new Date(NOW.getTime() - 6 * 3600_000 - 1000).toISOString() })
    const res = await get(hit)
    expect(res.body.property).toBe('sc-domain:roostersbet.com')
  })

  it('retries once on a Google 503, then succeeds', async () => {
    let failed = false
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/webmasters/v3/sites') && !failed) { failed = true; return json({}, 503) }
      return google(url, init)
    })
    const res = await get(hit)
    expect(res.statusCode).toBe(200)
    expect(res.body.property).toBe('sc-domain:roostersbet.com')
  })

  it('answers 502 with the worded message after the retry also fails', async () => {
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) =>
      (String(url).endsWith('/webmasters/v3/sites') ? json({}, 429) : google(url, init)))
    const res = await get(hit)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ ok: false, error: 'Google Search Console did not answer. Try again in a minute.' })
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/webmasters/v3/sites'))).toHaveLength(2)
  })

  it.each(['GSC_TOKEN_KEY', 'GOOGLE_OAUTH_CLIENT_ID'])('500s naming %s when it is missing', async (name) => {
    delete process.env[name]
    const res = await get(hit)
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toContain(name)
    expect(res.body.error).not.toContain('client-secret-xyz')
  })
})
