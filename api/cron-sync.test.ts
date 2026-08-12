// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './cron-sync.js'

// Several of these tests stop at the auth gate, but the rest deliberately get
// past it, so the stub has to survive a full run: findSnapshot's select chain
// and logCronActivity's insert both get called. A bare {} here throws inside
// the handler's try, the catch logs, and that throws again. Every insert is
// recorded so a test can assert what was written and, more often, what wasn't.
const { inserts } = vi.hoisted(() => ({
  inserts: [] as { table: string; rows: unknown }[],
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: async (rows: unknown) => {
        inserts.push({ table, rows })
        return { error: null }
      },
      delete: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    }),
  }),
}))

/** The one activity_log row every run is supposed to leave behind. */
function loggedSummaries(): string[] {
  return inserts
    .filter((i) => i.table === 'activity_log')
    .map((i) => (i.rows as { summary: string }).summary)
}

function apiRow(overrides: Record<string, unknown> = {}) {
  return {
    domain:            'lucky7even.com',
    keyword:           'lucky 7even casino',
    country:           'DE',
    position:          3,
    previous_position: 4,
    change:            1,
    url_found:         null,
    checked_at:        '2026-08-04 06:12:00',
    ...overrides,
  }
}

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
  inserts.length = 0
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

function stubVendorRows(rows: unknown[]) {
  fetchMock = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
    if (init?.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
    return new Response(JSON.stringify({ ok: true, data: rows }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
}

describe('api/cron-sync writes', () => {
  it('writes the snapshot and logs it with the shared date format', async () => {
    stubVendorRows([apiRow()])
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    const snap = inserts.find((i) => i.table === 'snapshots')?.rows as Record<string, string>
    expect(snap.id).toBe('snap-bp-sites-2026-08-04')
    expect(snap.raw_date).toBe('2026-08-04')
    // The one formatDisplayDate, shared with src/lib/parser.ts.
    expect(snap.display_date).toBe('Aug 4, 2026')
    expect(loggedSummaries()).toEqual(['Scheduled sync — 1 records (Aug 4, 2026)'])
  })

  it('writes nothing when no kept row carried a usable checked_at', async () => {
    stubVendorRows([apiRow({ checked_at: null })])
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(inserts.some((i) => i.table === 'snapshots')).toBe(false)
    expect(inserts.some((i) => i.table === 'ranking_records')).toBe(false)
    expect(loggedSummaries()).toEqual([
      'Scheduled sync — records carried no usable checked_at date; nothing written',
    ])
  })
})

describe('api/cron-sync time budget', () => {
  it('logs a run that ran out of time as a budget failure, not a bare abort', async () => {
    // The handler's run-wide deadline, already expired. Stands in for a vendor
    // slow enough that the platform would otherwise kill the function first —
    // the case that leaves no activity_log row at all.
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort())
    stubVendorRows([apiRow()])
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)
    spy.mockRestore()

    // Non-2xx so Vercel's cron log agrees with /log.
    expect(res.status).toHaveBeenCalledWith(502)
    expect(inserts.some((i) => i.table === 'snapshots')).toBe(false)
    expect(loggedSummaries()).toEqual([
      'Scheduled sync failed: the run exceeded its 35s fetch budget — the Ranks API did not finish responding in time',
    ])
  })
})
