// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from '../gsc-callback.js'
import { decryptToken, signState } from '../_lib/gsc.js'
import { GOOD_ENV, STATE_SECRET, TOKEN_KEY, fake, json, makeReq, makeRes } from '../_lib/gscTestKit.js'

vi.mock('@supabase/supabase-js', async () => (await import('../_lib/gscTestKit.js')).supabaseMock)

let fetchMock: ReturnType<typeof vi.fn>
const saved: Record<string, string | undefined> = {}
const CLEAR = 'gsc_nonce=; HttpOnly; SameSite=Lax; Path=/api/gsc-callback; Max-Age=0'

const idToken = () => `h.${Buffer.from(JSON.stringify({ email: 'seo@example.com' })).toString('base64url')}.s`
const state = (over: Partial<{ userId: string; nonce: string; exp: number }> = {}) =>
  signState(STATE_SECRET, { userId: 'admin-1', nonce: 'n-1', exp: Date.now() + 60_000, ...over })

async function run(query: Record<string, string>, cookie: string | null = 'gsc_nonce=n-1') {
  const res = makeRes()
  await handler(makeReq('GET', query, cookie === null ? {} : { cookie }), res as never)
  return res
}
const rejected = (res: ReturnType<typeof makeRes>, reason: string) => {
  expect(res.redirected).toEqual([302, `https://app.example.com/bp-sites?gsc=error&reason=${reason}`])
  expect(res.headers['Set-Cookie']).toBe(CLEAR)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(fake.connection).toBeNull()
  expect(fake.writes).toEqual([])
}
const resetFake = () => { fake.reset(); fake.admins.add('admin-1'); fetchMock.mockClear() }

beforeEach(() => {
  for (const k of Object.keys(GOOD_ENV)) { saved[k] = process.env[k]; process.env[k] = GOOD_ENV[k] }
  fake.reset()
  fake.admins.add('admin-1')
  fetchMock = vi.fn(async () => json({ refresh_token: 'refresh-token-abc', id_token: idToken(), access_token: 'at' }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  for (const k of Object.keys(GOOD_ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  vi.unstubAllGlobals()
})

describe('api/gsc-callback', () => {
  it('saves an encrypted token, clears the cache and the cookie, and redirects connected', async () => {
    fake.cache.push({ domain: 'roostersbet.com', days: 28, payload: {}, fetched_at: new Date().toISOString() })
    const res = await run({ code: 'auth-code', state: state() })
    expect(res.redirected).toEqual([302, 'https://app.example.com/bp-sites?gsc=connected'])
    expect(res.headers['Set-Cookie']).toBe(CLEAR)
    const row = fake.connection as Record<string, string>
    expect(row.refresh_token_enc).not.toContain('refresh-token-abc')
    expect(decryptToken(TOKEN_KEY, row.refresh_token_enc)).toBe('refresh-token-abc')
    expect(row.connected_by).toBe('admin-1')
    expect(row.google_email).toBe('seo@example.com')
    expect(row.status).toBe('ok')
    expect(fake.cache).toEqual([])
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('code=auth-code')
  })

  it('refuses non-GET', async () => {
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(405)
  })

  it('REVIEW 2: a tampered state stores nothing', async () => {
    const [body, sig] = state().split('.')
    const forged = Buffer.from(JSON.stringify({ userId: 'attacker', nonce: 'n-1', exp: Date.now() + 60_000 })).toString('base64url')
    rejected(await run({ code: 'c', state: `${forged}.${sig}` }), 'state')
    resetFake()
    rejected(await run({ code: 'c', state: `${body}.AAAA` }), 'state')
  })

  it('REVIEW 2: an expired state stores nothing', async () => {
    rejected(await run({ code: 'c', state: state({ exp: Date.now() - 1000 }) }), 'state')
  })

  it('REVIEW 2: a nonce that does not match the cookie stores nothing', async () => {
    rejected(await run({ code: 'c', state: state() }, 'gsc_nonce=other'), 'nonce')
  })

  it('REVIEW 2: a replayed nonce (cookie already cleared) stores nothing', async () => {
    const ok = await run({ code: 'c', state: state() })
    expect(ok.redirected![1]).toContain('gsc=connected')
    resetFake()
    // The browser dropped the cookie when the first reply cleared it.
    rejected(await run({ code: 'c', state: state() }, null), 'nonce')
  })

  it('REVIEW 2: a user who is no longer admin stores nothing', async () => {
    fake.admins.clear()
    rejected(await run({ code: 'c', state: state() }), 'admin')
  })

  it('maps the error param from Google to reason=denied without calling Google', async () => {
    rejected(await run({ error: 'access_denied', state: state() }), 'denied')
  })

  it('reports a refused code as reason=google and stores nothing', async () => {
    fetchMock.mockResolvedValue(json({ error: 'invalid_request' }, 400))
    const res = await run({ code: 'bad', state: state() })
    expect(res.redirected).toEqual([302, 'https://app.example.com/bp-sites?gsc=error&reason=google'])
    expect(fake.connection).toBeNull()
  })

  it('reports a missing secret as reason=config', async () => {
    delete process.env.GSC_STATE_SECRET
    const res = await run({ code: 'c', state: state() })
    expect(res.redirected![1]).toBe('https://app.example.com/bp-sites?gsc=error&reason=config')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('500s naming APP_URL when it is missing', async () => {
    delete process.env.APP_URL
    const res = await run({ code: 'c', state: state() })
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toContain('APP_URL')
  })
})
