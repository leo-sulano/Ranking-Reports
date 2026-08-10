// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler, { config } from './sites.js'

// The handler resolves the caller's Supabase token through supabase-js. Stub
// the SDK so the tests never touch the network; `getUserMock` is what each
// test drives to make a token valid, invalid or unreachable.
const getUserMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}))

type MockRes = VercelResponse & {
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
}

/** A signed-in caller. Pass `headers: {}` explicitly to test the anonymous case. */
function makeReq(
  method: string,
  query: Record<string, string | string[]>,
  headers: Record<string, string> = { authorization: 'Bearer good-token' },
): VercelRequest {
  return { method, query, headers } as unknown as VercelRequest
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
const savedEnv: Record<string, string | undefined> = {}
const MANAGED_ENV = ['SITES_API_KEY', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY']

beforeEach(() => {
  for (const name of MANAGED_ENV) savedEnv[name] = process.env[name]
  process.env.SITES_API_KEY       = 'bpn_test'
  process.env.SUPABASE_URL        = 'https://project.supabase.co'
  process.env.SUPABASE_ANON_KEY   = 'anon_test'
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.co' } }, error: null })
  fetchMock = vi.fn(async () => new Response('{"ok":true,"data":[]}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  for (const name of MANAGED_ENV) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
  vi.unstubAllGlobals()
})

/** The URL the handler asked fetch() for, as a URL object. */
function calledUrl(): URL {
  return new URL(String(fetchMock.mock.calls[0][0]))
}

describe('api/sites function config', () => {
  it('raises maxDuration above the fetch timeout so our own 504 can fire', () => {
    // Vercel's default is 10s (Hobby) / 15s (Pro) — below the 45s fetch
    // timeout — so without this the platform kills the function first.
    expect(config.maxDuration).toBeGreaterThan(45)
  })
})

describe('api/sites auth gate', () => {
  it('rejects a request with no Authorization header with 401', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }, {}), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json.mock.calls[0][0].error).toMatch(/sign in/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed Authorization header with 401', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }, { authorization: 'Bearer' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a garbage token with 401 and never reaches the upstream', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } })
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }, { authorization: 'Bearer garbage' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json.mock.calls[0][0].error).toMatch(/expired|not valid/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when Supabase itself cannot be reached', async () => {
    getUserMock.mockRejectedValue(new Error('network down'))
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('500s when the server has no Supabase config to verify tokens against', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.VITE_SUPABASE_URL
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json.mock.calls[0][0].error).toContain('SUPABASE_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies through for a valid token, passing it to Supabase verbatim', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }, { authorization: 'Bearer good-token' }), res)
    expect(getUserMock).toHaveBeenCalledWith('good-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('never forwards the caller session to the upstream — only the API key', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer bpn_test')
  })
})

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

  it('rejects `domains` too — only `results` has a caller', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'domains' }), res)
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
    // Must stay under the function's own maxDuration, or the platform kills
    // the request before this 504 can be written.
    expect(res.json.mock.calls[0][0].error).toContain('45 seconds')
  })
})
