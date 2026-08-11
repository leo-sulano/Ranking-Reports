// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './cron-sync.js'

// Four of these tests stop at the auth gate, but the fifth deliberately gets
// past it, so the stub has to survive a full no-rows run: findSnapshot's
// select chain and logCronActivity's insert both get called. A bare {} here
// throws inside the handler's try, the catch logs, and that throws again.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: async () => ({ error: null }),
      delete: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    }),
  }),
}))

type MockRes = VercelResponse & {
  status:     ReturnType<typeof vi.fn>
  json:       ReturnType<typeof vi.fn>
  setHeader:  ReturnType<typeof vi.fn>
}

function makeRes(): MockRes {
  const res: Partial<MockRes> = {}
  res.status    = vi.fn(() => res as MockRes)
  res.json      = vi.fn(() => res as MockRes)
  res.setHeader = vi.fn(() => res as MockRes)
  return res as MockRes
}

function makeReq(method: string, headers: Record<string, string>): VercelRequest {
  return { method, headers, query: {} } as unknown as VercelRequest
}

let fetchMock: ReturnType<typeof vi.fn>
const saved: Record<string, string | undefined> = {}
const MANAGED = ['CRON_SECRET', 'SITES_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']

beforeEach(() => {
  for (const n of MANAGED) saved[n] = process.env[n]
  process.env.CRON_SECRET               = 'secret-value'
  process.env.SITES_API_KEY             = 'bpn_test'
  process.env.SUPABASE_URL              = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_test'
  fetchMock = vi.fn(async () => new Response('{"ok":true,"data":[]}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  for (const n of MANAGED) {
    if (saved[n] === undefined) delete process.env[n]
    else process.env[n] = saved[n]
  }
  vi.unstubAllGlobals()
})

describe('api/cron-sync auth', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = makeRes()
    await handler(makeReq('GET', {}), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer nope' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when CRON_SECRET is unset, rejecting even a matching header', async () => {
    delete process.env.CRON_SECRET
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer undefined' }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-GET even with the right secret', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { authorization: 'Bearer secret-value' }), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gets past the gate with the right secret and reaches the vendor', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)
    expect(fetchMock).toHaveBeenCalled()
  })
})
