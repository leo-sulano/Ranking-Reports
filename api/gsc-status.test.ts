// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler, { config } from './gsc-status.js'
import { GOOD_ENV, fake, json, makeReq, makeRes, setConnection } from './_lib/gscTestKit.js'

vi.mock('@supabase/supabase-js', async () => (await import('./_lib/gscTestKit.js')).supabaseMock)

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
})
