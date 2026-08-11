// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler, { config } from './sites.js'

// The handler resolves the caller's Supabase token through supabase-js, then
// reads their user_access row through it. Stub the SDK so the tests never touch
// the network: `getUserMock` decides whether the token is valid, invalid or
// unreachable, and `maybeSingleMock` decides whether the account is approved.
const getUserMock     = vi.hoisted(() => vi.fn())
const maybeSingleMock = vi.hoisted(() => vi.fn())
/** Captures the Authorization header the access client was built with. */
const createClientSpy = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, opts?: unknown) => {
    createClientSpy(url, key, opts)
    return {
      auth: { getUser: getUserMock },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }),
    }
  },
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
  maybeSingleMock.mockReset()
  maybeSingleMock.mockResolvedValue({ data: { status: 'approved' }, error: null })
  createClientSpy.mockReset()
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
    // Tagged so the client can tell it apart from an upstream 401, which is
    // passed through with the same status but means the API key was rejected.
    expect(res.json.mock.calls[0][0].code).toBe('unauthenticated')
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

  it('403s a signed-in user whose account is still pending', async () => {
    maybeSingleMock.mockResolvedValue({ data: { status: 'pending' }, error: null })
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json.mock.calls[0][0].code).toBe('unapproved')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('403s a revoked user', async () => {
    maybeSingleMock.mockResolvedValue({ data: { status: 'revoked' }, error: null })
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the user_access row is missing', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the approval lookup errors', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } })
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the approval lookup throws', async () => {
    maybeSingleMock.mockRejectedValue(new Error('network down'))
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads user_access AS the caller, so RLS limits it to their own row', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { action: 'results' }, { authorization: 'Bearer good-token' }), res)
    // The access client is the one built with the caller's bearer token; the
    // anon key alone would read nothing, and a service-role key would read
    // everything. Neither is what this path wants.
    const withAuthHeader = createClientSpy.mock.calls.filter(
      (c) => (c[2] as { global?: { headers?: Record<string, string> } })?.global?.headers?.Authorization === 'Bearer good-token',
    )
    expect(withAuthHeader).toHaveLength(1)
    expect(createClientSpy.mock.calls.every((c) => c[1] === 'anon_test')).toBe(true)
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
