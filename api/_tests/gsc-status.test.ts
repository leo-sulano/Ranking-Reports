// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler, { config } from '../gsc-status.js'
import { encryptToken } from '../_lib/gsc.js'
import { GOOD_ENV, fake, json, makeReq, makeRes, setConnection } from '../_lib/gscTestKit.js'

vi.mock('@supabase/supabase-js', async () => (await import('../_lib/gscTestKit.js')).supabaseMock)

let fetchMock: ReturnType<typeof vi.fn>
const saved: Record<string, string | undefined> = {}
const SITES = { siteEntry: [
  { siteUrl: 'sc-domain:roostersbet.com', permissionLevel: 'siteOwner' },
  { siteUrl: 'https://www.spinjo.com/', permissionLevel: 'siteFullUser' },
] }
const isToken = (url: unknown) => String(url).includes('oauth2.googleapis.com/token')

beforeEach(() => {
  for (const k of Object.keys(GOOD_ENV)) { saved[k] = process.env[k]; process.env[k] = GOOD_ENV[k] }
  fake.reset()
  fetchMock = vi.fn(async (url: unknown) => (isToken(url) ? json({ access_token: 'at-secret' }) : json(SITES)))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  for (const k of Object.keys(GOOD_ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  vi.unstubAllGlobals()
})

describe('api/gsc-status', () => {
  it('exports maxDuration 60 and refuses non-GET', async () => {
    expect(config.maxDuration).toBe(60)
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('GET')
  })

  it('401s without a token and 403s a pending user', async () => {
    let res = makeRes()
    await handler(makeReq('GET', {}, {}), res as never)
    expect(res.statusCode).toBe(401)
    fake.status = 'pending'
    res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.statusCode).toBe(403)
  })

  it('says not connected when there is no connection', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.body).toEqual({ ok: true, connected: false })
  })

  it('REVIEW 1: gives a non-admin user no admin fields and makes no Google call', async () => {
    setConnection()
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, connected: true, status: 'ok' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.writes).toEqual([])
  })

  it('gives an admin the email, who connected, when, and coverage of the reported BP sites', async () => {
    setConnection()
    fake.isAdmin = true
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    const b = res.body
    expect(b).toMatchObject({ connected: true, status: 'ok', googleEmail: 'seo@example.com', connectedBy: 'admin-1', connectedAt: '2026-11-01T00:00:00.000Z' })
    const byDomain = Object.fromEntries(b.coverage.map((c: { domain: string }) => [c.domain, c]))
    expect(byDomain['roostersbet.com'].properties).toEqual(['sc-domain:roostersbet.com'])
    expect(byDomain['roostersbet.com'].brand).toBe('RoosterBet')
    expect(byDomain['spinjo.com'].properties).toEqual(['https://www.spinjo.com/'])
    // retired site is not reported, so it is not listed
    expect(byDomain['casinoroosters.com']).toBeUndefined()
    expect(JSON.stringify(b)).not.toContain('at-secret')
    expect(JSON.stringify(b)).not.toContain('refresh')
    // the site list is cached for the next caller
    expect(fake.cache.some((r) => r.domain === '*' && r.days === 0)).toBe(true)
  })

  it('uses the cached site list without calling Google for it', async () => {
    setConnection()
    fake.isAdmin = true
    fake.cache.push({ domain: '*', days: 0, payload: SITES.siteEntry, fetched_at: new Date().toISOString() })
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.body.coverage.length).toBeGreaterThan(0)
    expect(fetchMock.mock.calls.every((c) => isToken(c[0]))).toBe(true)
  })

  it('REVIEW 3: invalid_grant while computing coverage marks the connection broken and reports it as state', async () => {
    setConnection()
    fake.isAdmin = true
    fetchMock.mockResolvedValue(json({ error: 'invalid_grant' }, 400))
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, connected: true, status: 'broken', googleEmail: 'seo@example.com' })
    expect(res.body.coverage).toBeUndefined()
    expect(fake.connection?.status).toBe('broken')
  })

  it('an undecryptable stored token marks the connection broken and reports it as state, leaking nothing', async () => {
    setConnection()
    fake.connection!.refresh_token_enc = 'v1.not.a.token'
    fake.isAdmin = true
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, connected: true, status: 'broken' })
    expect(res.body.coverage).toBeUndefined()
    expect(fake.connection?.status).toBe('broken')
    expect(JSON.stringify(res.body)).not.toMatch(/v1\.not|secret|GSC_TOKEN_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a broken connection without calling Google', async () => {
    setConnection('broken')
    fake.isAdmin = true
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.body).toMatchObject({ connected: true, status: 'broken' })
    expect(res.body.coverage).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['Search Console is down', () => json({}, 503), 'Google Search Console did not answer. Try again in a minute.', 'ok'],
    ['Search Console refuses the account', () => json({}, 403), "Google refused access to this site's Search Console data. Check that the connected Google account still has access to it.", 'ok'],
  ])('I-2: when %s the status is 200 with coverageError and no coverage', async (_n, answer, message, status) => {
    setConnection()
    fake.isAdmin = true
    fetchMock.mockImplementation(async (url: unknown) => (isToken(url) ? json({ access_token: 'at-secret' }) : answer()))
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, connected: true, status, googleEmail: 'seo@example.com', coverageError: message })
    expect(res.body.coverage).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('at-secret')
  })

  it('I-2: a rejected OAuth client shows the operator wording as coverageError and does not mark the connection broken', async () => {
    setConnection()
    fake.isAdmin = true
    fetchMock.mockResolvedValue(json({ error: 'invalid_client' }, 401))
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body.coverageError).toContain('GOOGLE_OAUTH_CLIENT_SECRET')
    expect(res.body.status).toBe('ok')
    expect(fake.connection?.status).toBe('ok')
  })

  it('I-3: a different GSC_TOKEN_KEY shows the key wording as coverageError and never marks the connection broken', async () => {
    setConnection()
    fake.connection!.refresh_token_enc = encryptToken(Buffer.alloc(32, 9).toString('base64'), 'refresh-token-abc')
    fake.isAdmin = true
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.coverageError).toContain('same GSC_TOKEN_KEY everywhere')
    expect(fake.writes).not.toContain('connection.broken')
  })

  it('I-2: a Search Console 401 marks the connection broken and reports it as state', async () => {
    setConnection()
    fake.isAdmin = true
    fetchMock.mockImplementation(async (url: unknown) => (isToken(url) ? json({ access_token: 'at' }) : json({}, 401)))
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.body).toMatchObject({ ok: true, connected: true, status: 'broken' })
    expect(res.body.coverage).toBeUndefined()
    expect(fake.connection?.status).toBe('broken')
  })
})
