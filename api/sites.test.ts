// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler, { config } from './sites.js'
import { KEY_REJECTED } from './_lib/ahrefs.js'

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
  query: Record<string, string | string[]> = {},
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The workspace: one BP project (roostersbet.com, competitor rooster.bet) and another client's. */
const PROJECTS = { projects: [
  { project_id: 1, project_name: 'Roostersbet.com', url: 'roostersbet.com/', keyword_count: 1 },
  { project_id: 2, project_name: 'Trybet.ca', url: 'trybet.ca/', keyword_count: 45 },   // another client
] }
/** "rooster bet", AU, checked 2026-11-03: roostersbet.com 3 (was 4), rooster.bet not found either time. */
const RANKINGS = { keywords: [{ keyword: 'rooster bet', country: 'AU', language: 'en',
  serp_updated: '2026-11-03T10:00:00Z', serp_updated_prev: '2026-10-27T10:00:00Z',
  competitors_list: [{ url: 'https://roostersbet.com/', position: 3, position_prev: 4 }, { url: null, position: null, position_prev: null }] }] }

function ahrefs(input: unknown, init: RequestInit = {}): Response {
  if (init.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
  const path = new URL(String(input)).pathname
  if (path.endsWith('/management/projects')) return json(PROJECTS)
  if (path.endsWith('/management/project-competitors')) return json({ competitors: [{ url: 'rooster.bet/', mode: 'subdomains' }] })
  return json(RANKINGS)
}

let fetchMock: ReturnType<typeof vi.fn>
const savedEnv: Record<string, string | undefined> = {}
const MANAGED_ENV = [
  'AHREFS_API_KEY',
  'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
]

beforeEach(() => {
  for (const name of MANAGED_ENV) savedEnv[name] = process.env[name]
  process.env.AHREFS_API_KEY    = 'ahk_test'
  process.env.SUPABASE_URL      = 'https://project.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'anon_test'
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.co' } }, error: null })
  maybeSingleMock.mockReset()
  maybeSingleMock.mockResolvedValue({ data: { status: 'approved' }, error: null })
  createClientSpy.mockReset()
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => ahrefs(input, init))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  for (const name of MANAGED_ENV) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
  vi.unstubAllGlobals()
})

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
    await handler(makeReq('GET', {}, {}), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json.mock.calls[0][0].error).toMatch(/sign in/i)
    // Tagged so the client can tell it apart from an upstream failure.
    expect(res.json.mock.calls[0][0].code).toBe('unauthenticated')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed Authorization header with 401', async () => {
    const res = makeRes()
    await handler(makeReq('GET', {}, { authorization: 'Bearer' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a garbage token with 401 and never reaches the upstream', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } })
    const res = makeRes()
    await handler(makeReq('GET', {}, { authorization: 'Bearer garbage' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json.mock.calls[0][0].error).toMatch(/expired|not valid/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when Supabase itself cannot be reached', async () => {
    getUserMock.mockRejectedValue(new Error('network down'))
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('500s when the server has no Supabase config to verify tokens against', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.VITE_SUPABASE_URL
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json.mock.calls[0][0].error).toContain('SUPABASE_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reaches Ahrefs for a valid token, passing it to Supabase verbatim', async () => {
    const res = makeRes()
    await handler(makeReq('GET', {}, { authorization: 'Bearer good-token' }), res)
    expect(getUserMock).toHaveBeenCalledWith('good-token')
    expect(fetchMock).toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('403s a signed-in user whose account is still pending', async () => {
    maybeSingleMock.mockResolvedValue({ data: { status: 'pending' }, error: null })
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json.mock.calls[0][0].code).toBe('unapproved')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('403s a revoked user', async () => {
    maybeSingleMock.mockResolvedValue({ data: { status: 'revoked' }, error: null })
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the user_access row is missing', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the approval lookup errors', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } })
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the approval lookup throws', async () => {
    maybeSingleMock.mockRejectedValue(new Error('network down'))
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads user_access AS the caller, so RLS limits it to their own row', async () => {
    const res = makeRes()
    await handler(makeReq('GET', {}, { authorization: 'Bearer good-token' }), res)
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

  it('sends only the Ahrefs key upstream, never the caller session', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(fetchMock).toHaveBeenCalled()
    for (const [, init] of fetchMock.mock.calls) {
      const headers = (init as RequestInit).headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer ahk_test')
    }
  })
})

describe('api/sites', () => {
  it('rejects non-GET with 405', async () => {
    const res = makeRes()
    await handler(makeReq('POST'), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 500 naming AHREFS_API_KEY when it is unset', async () => {
    delete process.env.AHREFS_API_KEY
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json.mock.calls[0][0].error).toContain('AHREFS_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns normalized records for the BP projects', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    const body = res.json.mock.calls[0][0]
    expect(body.ok).toBe(true)
    expect(body.data.rawDate).toBe('2026-11-03')
    expect(body.data.records).toEqual([
      expect.objectContaining({ domain: 'rooster.bet', keyword: 'rooster bet', country: 'AU', position: 'NR', previous: 'NR', change: '' }),
      expect.objectContaining({
        domain: 'roostersbet.com', keyword: 'rooster bet', country: 'AU', position: '3', previous: '4', change: '+1', date: '2026-11-03',
      }),
    ])
    // trybet.ca is another client's project: never fetched.
    const ids = fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('project_id')).filter(Boolean)
    expect(new Set(ids)).toEqual(new Set(['1']))
  })

  it("passes the normalizer's operator wording through verbatim when Ahrefs data cannot be trusted", async () => {
    // A ranked URL in rooster.bet's slot that is not rooster.bet: the competitor order changed.
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      if (new URL(String(input)).pathname.endsWith('/rank-tracker/competitors-overview')) {
        return json({ keywords: [{ ...RANKINGS.keywords[0], competitors_list: [
          { url: 'https://roostersbet.com/', position: 3, position_prev: 4 },
          { url: 'https://example.com/', position: 5, position_prev: 5 },
        ] }] })
      }
      return ahrefs(input, init)
    })
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(502)
    expect(res.json.mock.calls[0][0].error).toMatch(/^Ahrefs listed example\.com in rooster\.bet's slot/)
  })

  it("passes Ahrefs' key rejection through as a 502 with the operator wording", async () => {
    fetchMock.mockImplementation(async () => json({ error: 'unauthorized' }, 401))
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.status).toHaveBeenCalledWith(502)
    expect(res.json.mock.calls[0][0]).toEqual({ ok: false, error: KEY_REJECTED })
  })

  it('turns the overall timeout into a 504 that names 45 seconds', async () => {
    // Every AbortSignal.timeout() the handler creates comes back already
    // expired — the same as a 45s Ahrefs stall, without the wait.
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort())
    const res = makeRes()
    await handler(makeReq('GET'), res)
    spy.mockRestore()
    expect(res.status).toHaveBeenCalledWith(504)
    // Must stay under the function's own maxDuration, or the platform kills
    // the request before this 504 can be written.
    expect(res.json.mock.calls[0][0].error).toBe('Ahrefs did not respond within 45 seconds')
  })
})
