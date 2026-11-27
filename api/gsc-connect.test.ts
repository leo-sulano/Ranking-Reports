// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler, { config } from './gsc-connect.js'
import { verifyState } from './_lib/gsc.js'
import { GOOD_ENV, STATE_SECRET, fake, makeReq, makeRes } from './_lib/gscTestKit.js'

vi.mock('@supabase/supabase-js', async () => (await import('./_lib/gscTestKit.js')).supabaseMock)

let fetchMock: ReturnType<typeof vi.fn>
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of Object.keys(GOOD_ENV)) { saved[k] = process.env[k]; process.env[k] = GOOD_ENV[k] }
  fake.reset()
  fake.isAdmin = true
  fetchMock = vi.fn(async () => { throw new Error('no network in tests') })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  for (const k of Object.keys(GOOD_ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  vi.unstubAllGlobals()
})

describe('api/gsc-connect', () => {
  it('exports maxDuration 60 and refuses non-POST with Allow', async () => {
    expect(config.maxDuration).toBe(60)
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('POST')
  })

  it('401s without a token and 403s an unapproved user', async () => {
    let res = makeRes()
    await handler(makeReq('POST', {}, {}), res as never)
    expect(res.statusCode).toBe(401)
    fake.status = 'pending'
    res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(403)
  })

  it('REVIEW 1: 403s a non-admin approved user with no Google call and no state', async () => {
    fake.isAdmin = false
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ ok: false, error: 'Admins only' })
    expect(res.headers['Set-Cookie']).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('accounts.google.com')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.writes).toEqual([])
  })

  it('returns the consent url with a signed state and sets the nonce cookie', async () => {
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(200)
    const url = new URL(res.body.url)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/gsc-callback')
    const state = verifyState(STATE_SECRET, url.searchParams.get('state')!, Date.now())
    expect(state?.userId).toBe('user-1')
    const cookie = res.headers['Set-Cookie']
    expect(cookie).toBe(`gsc_nonce=${state!.nonce}; HttpOnly; Secure; SameSite=Lax; Path=/api/gsc-callback; Max-Age=600`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('omits Secure on a localhost APP_URL', async () => {
    process.env.APP_URL = 'http://localhost:5173'
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.headers['Set-Cookie']).not.toContain('Secure')
    expect(res.headers['Set-Cookie']).toContain('HttpOnly')
  })

  it.each(['GOOGLE_OAUTH_CLIENT_ID', 'GSC_STATE_SECRET', 'APP_URL'])('500s naming %s when it is missing', async (name) => {
    delete process.env[name]
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toContain(name)
  })
})
