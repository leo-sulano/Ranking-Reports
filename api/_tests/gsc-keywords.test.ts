// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler, { config } from '../gsc-keywords.js'
import { GOOD_ENV, TOKEN_KEY, fake, json, makeReq, makeRes, setConnection } from '../_lib/gscTestKit.js'
import { encryptToken } from '../_lib/gsc.js'

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
    queryRowsFor = () => []
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

const isQuery = (url: unknown, init?: RequestInit) =>
  /searchAnalytics\/query$/.test(String(url)) && (JSON.parse(String(init?.body)).dimensions as string[]).length === 2
const queryCalls = () => fetchMock.mock.calls.filter((c) => isQuery(c[0], c[1] as RequestInit))
const failQuery = (thrown: () => unknown) =>
  fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
    if (isQuery(url, init)) throw thrown()
    return google(url, init)
  })
const NO_ANSWER = 'Google Search Console did not answer. Try again in a minute.'

describe('final review: permanent and temporary Google failures (I-2, I-3, I-4)', () => {
  it('I-2: a Search Console 401 marks the connection broken and answers reconnect, without a retry', async () => {
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => (isQuery(url, init) ? json({}, 401) : google(url, init)))
    const res = await get(hit)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ ok: false, code: 'reconnect' })
    expect(fake.connection?.status).toBe('broken')
    expect(queryCalls()).toHaveLength(1)
  })

  it('I-2: a Search Console 403 answers the access wording, leaves the connection ok and is not retried', async () => {
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => (isQuery(url, init) ? json({}, 403) : google(url, init)))
    const res = await get(hit)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ ok: false, error: "Google refused access to this site's Search Console data. Check that the connected Google account still has access to it." })
    expect(fake.connection?.status).toBe('ok')
    expect(queryCalls()).toHaveLength(1)
  })

  it('I-2: a Search Console 503 is retried once, then answers the did-not-answer wording', async () => {
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => (isQuery(url, init) ? json({}, 503) : google(url, init)))
    const res = await get(hit)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ ok: false, error: NO_ANSWER })
    expect(queryCalls()).toHaveLength(2)
    expect(fake.connection?.status).toBe('ok')
  })

  it('I-2: invalid_client is a 500 operator message, is not retried and does not mark the connection broken', async () => {
    tokenResponse = () => json({ error: 'invalid_client' }, 401)
    const res = await get(hit)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ ok: false, error: "Google rejected the app's OAuth client. Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (docs/integrations/gsc.md)." })
    expect(fake.connection?.status).toBe('ok')
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/token'))).toHaveLength(1)
    expect(JSON.stringify(res.body)).not.toContain('client-secret-xyz')
  })

  it('I-3: a token written under a different GSC_TOKEN_KEY is a 500 operator message and never marks the row broken', async () => {
    fake.connection!.refresh_token_enc = encryptToken(Buffer.alloc(32, 9).toString('base64'), 'refresh-token-abc')
    const res = await get(hit)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ ok: false, error: "GSC_TOKEN_KEY here doesn't match the key that stored the Google connection. Use the same GSC_TOKEN_KEY everywhere that uses this Supabase project." })
    expect(fake.connection?.status).toBe('ok')
    expect(fake.writes).not.toContain('connection.broken')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('I-3: a tampered ciphertext under the matching key id still answers reconnect and marks broken', async () => {
    const parts = encryptToken(TOKEN_KEY, 'refresh-token-abc').split('.')
    const ct = Buffer.from(parts[4], 'base64url'); ct[0] ^= 1
    parts[4] = ct.toString('base64url')
    fake.connection!.refresh_token_enc = parts.join('.')
    const res = await get(hit)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ ok: false, code: 'reconnect' })
    expect(fake.connection?.status).toBe('broken')
  })

  it.each([
    ['fetch failed', () => new TypeError('fetch failed')],
    ['a timeout', () => new DOMException('The operation timed out.', 'TimeoutError')],
  ])('I-4: %s on the query is retried once, then answers the did-not-answer wording', async (_n, thrown) => {
    failQuery(thrown)
    const res = await get(hit)
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ ok: false, error: NO_ANSWER })
    expect(queryCalls()).toHaveLength(2)
    expect(JSON.stringify(res.body)).not.toContain('fetch failed')
  })

  it('I-4: every Google call carries a timeout signal', async () => {
    await get(hit)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4)
    for (const c of fetchMock.mock.calls) expect((c[1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })
})

describe('final review: merging, caching and the data date (I-1, M-1, M-3, M-4, M-5)', () => {
  it('I-1: a path-scoped property is not queried, so nothing is counted twice', async () => {
    sites = [
      { siteUrl: 'https://roostersbet.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://roostersbet.com/au/', permissionLevel: 'siteOwner' },
    ]
    queryRowsFor = () => [q('rooster bet', 'aus', 3, 10, 100)]
    const res = await get(hit)
    expect(res.body.property).toBe('https://roostersbet.com/')
    expect(res.body.rows).toEqual([{ query: 'rooster bet', country: 'AU', position: 3, clicks: 10, impressions: 100 }])
  })

  it('M-1: a null property answer is not cached', async () => {
    sites = [{ siteUrl: 'sc-domain:other.com', permissionLevel: 'siteOwner' }]
    const res = await get(hit)
    expect(res.body).toEqual({ ok: true, property: null })
    expect(fake.cache.some((r) => r.domain === 'roostersbet.com')).toBe(false)
    expect(fake.writes.filter((w) => w.startsWith('cache.write:roostersbet.com'))).toEqual([])
  })

  it('M-3: a failing cache write still answers 200 with the rows', async () => {
    fake.failCacheWrite = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get(hit)
    expect(res.statusCode).toBe(200)
    expect(res.body.rows).toHaveLength(1)
    expect(err.mock.calls.filter((c) => String(c[0]).includes('gsc-keywords'))).toHaveLength(1)
    expect(JSON.stringify(err.mock.calls)).not.toContain('rooster bet')
    err.mockRestore()
  })

  it('M-4: two properties with 20k distinct rows each give 25,000 rows, top by clicks, and truncated', async () => {
    sites = [
      { siteUrl: 'https://roostersbet.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://www.roostersbet.com/', permissionLevel: 'siteOwner' },
    ]
    queryRowsFor = (p) => Array.from({ length: 20_000 }, (_, i) =>
      q(`${p.includes('www') ? 'w' : 'a'} kw ${i}`, 'aus', 2, i < 10 ? 1000 : 1, 10))
    const res = await get(hit)
    expect(res.body.rows).toHaveLength(25_000)
    expect(res.body.truncated).toBe(true)
    expect(res.body.rows[0].clicks).toBe(1000)
  })

  it('M-5: an empty 7-day check with older rows falls back to today - 3 days', async () => {
    dateRows = []
    const res = await get(hit)
    expect(res.body).toEqual({
      ok: true, property: 'sc-domain:roostersbet.com', startDate: '2026-10-28', dataUpTo: '2026-11-24', truncated: false,
      rows: [{ query: 'rooster bet', country: 'AU', position: 3, clicks: 5, impressions: 100 }],
    })
    const dims = queryBodies.filter((b) => (b.body.dimensions as string[]).length === 2)
    expect(dims[0].body).toMatchObject({ startDate: '2026-10-28', endDate: '2026-11-24' })
  })

  it('a malformed GSC_TOKEN_KEY is a 500 config error: the connection is not marked broken and Google is not called', async () => {
    const bad = Buffer.alloc(31, 7).toString('base64')
    process.env.GSC_TOKEN_KEY = bad
    const res = await get(hit)
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toContain('GSC_TOKEN_KEY must be base64 of exactly 32 bytes')
    expect(JSON.stringify(res.body)).not.toContain(bad)
    expect(fake.writes).not.toContain('connection.broken')
    expect((fake.connection as Record<string, string>).status).toBe('ok')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
