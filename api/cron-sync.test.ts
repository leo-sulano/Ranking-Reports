// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './cron-sync.js'

// Several of these tests stop at the auth gate, but the rest deliberately get
// past it, so the stub has to survive a full run: findSnapshot's select chain
// and logCronActivity's insert both get called. A bare {} here throws inside
// the handler's try, the catch logs, and that throws again. Every insert is
// recorded so a test can assert what was written and, more often, what wasn't.
const { inserts, insertFailure } = vi.hoisted(() => ({
  inserts: [] as { table: string; rows: unknown }[],
  /**
   * Lets one test make a single table's insert fail. `onCall` fires before the
   * failure is returned, so a test can change the world at the exact moment the
   * write goes wrong — which is how the deadline-during-write case is staged.
   */
  insertFailure: { table: '', message: '', onCall: undefined as (() => void) | undefined },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: async (rows: unknown) => {
        inserts.push({ table, rows })
        if (insertFailure.table === table) {
          insertFailure.onCall?.()
          return { error: { message: insertFailure.message } }
        }
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

type Cells = Record<string, Record<string, { position: number | null; previous: number | null; status: string }>>

/** One keyword's OpenSEO export for lucky7even.com, DE (2276) and AU (2036). */
function exportBody(weeks: string[], cells: Cells) {
  return {
    domain:   'lucky7even.com',
    weeks,
    markets:  [
      { locationCode: 2276, countryCode: 'DE', locationName: null },
      { locationCode: 2036, countryCode: 'AU', locationName: null },
    ],
    keywords: [{ keyword: 'lucky 7even casino', cells }],
  }
}

const cell = (position: number | null) => ({ position, previous: null, status: 'new' })

/** Checked once, in DE, on 2026-08-04, at position 3. */
const ONE_RECORD = exportBody(['2026-08-04'], { '2276': { '2026-08-04': cell(3) } })

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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

/** OpenSEO listing `domains`, answering every export with `body` (or a failure status). */
function stubOpenSeo(body: unknown, { domains = ['lucky7even.com'], status = 200 } = {}) {
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
    if (status !== 200) return json({ error: 'nope' }, status)
    const domain = new URL(String(input)).searchParams.get('domain')
    return domain === null ? json({ domains }) : json(body)
  })
  vi.stubGlobal('fetch', fetchMock)
}

const saved: Record<string, string | undefined> = {}
const MANAGED = ['CRON_SECRET', 'OPENSEO_RANKINGS_API_KEY', 'OPENSEO_BASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']

beforeEach(() => {
  inserts.length = 0
  insertFailure.table = ''
  insertFailure.message = ''
  insertFailure.onCall = undefined
  for (const n of MANAGED) saved[n] = process.env[n]
  process.env.CRON_SECRET               = 'secret-value'
  process.env.OPENSEO_RANKINGS_API_KEY  = 'osk_test'
  process.env.OPENSEO_BASE_URL          = 'https://openseo.test'
  process.env.SUPABASE_URL              = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_test'
  stubOpenSeo(ONE_RECORD)
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

  it('gets past the gate with the right secret and reaches OpenSEO', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)
    expect(fetchMock).toHaveBeenCalled()
  })
})

describe('api/cron-sync writes', () => {
  it('writes the snapshot and logs it with the shared date format', async () => {
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    const snap = inserts.find((i) => i.table === 'snapshots')?.rows as Record<string, string>
    expect(snap.id).toBe('snap-bp-sites-2026-08-04')
    expect(snap.raw_date).toBe('2026-08-04')
    // The one formatDisplayDate, shared with src/lib/parser.ts.
    expect(snap.display_date).toBe('Aug 4, 2026')
    expect(snap.source).toBe('sync')
    expect(loggedSummaries()).toEqual(['Scheduled sync — 1 records (Aug 4, 2026)'])
  })

  it('notes records that kept an earlier check', async () => {
    // DE was re-checked on 2026-08-04; AU was last checked a week earlier.
    stubOpenSeo(exportBody(['2026-07-28', '2026-08-04'], {
      '2276': { '2026-07-28': cell(4), '2026-08-04': cell(3) },
      '2036': { '2026-07-28': cell(9) },
    }))
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(loggedSummaries()).toEqual(['Scheduled sync — 2 records (Aug 4, 2026); 1 kept an earlier check'])
  })

  it('writes nothing when OpenSEO has no BP rankings', async () => {
    stubOpenSeo(ONE_RECORD, { domains: ['example.com'] })
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(inserts.some((i) => i.table === 'snapshots')).toBe(false)
    expect(inserts.some((i) => i.table === 'ranking_records')).toBe(false)
    expect(loggedSummaries()).toEqual(['Scheduled sync — OpenSEO has no BP rankings; nothing written'])
  })

  it('logs a missing key as a failure', async () => {
    delete process.env.OPENSEO_RANKINGS_API_KEY
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loggedSummaries()).toEqual([
      'Scheduled sync failed: OPENSEO_RANKINGS_API_KEY is not configured on the server',
    ])
  })

  it('logs a rejected key as a failure', async () => {
    stubOpenSeo(ONE_RECORD, { status: 401 })
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)

    expect(res.status).toHaveBeenCalledWith(502)
    expect(inserts.some((i) => i.table === 'snapshots')).toBe(false)
    expect(loggedSummaries()).toEqual([
      'Scheduled sync failed: OpenSEO rejected the key — check OPENSEO_RANKINGS_API_KEY on the server',
    ])
  })
})

describe('api/cron-sync time budget', () => {
  it('logs a run that ran out of time as a budget failure, not a bare abort', async () => {
    // The handler's run-wide deadline, already expired. Stands in for an
    // upstream slow enough that the platform would otherwise kill the function
    // first — the case that leaves no activity_log row at all.
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort())
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)
    spy.mockRestore()

    // Non-2xx so Vercel's cron log agrees with /log.
    expect(res.status).toHaveBeenCalledWith(502)
    expect(inserts.some((i) => i.table === 'snapshots')).toBe(false)
    expect(loggedSummaries()).toEqual([
      'Scheduled sync failed: the run exceeded its 35s fetch budget — OpenSEO did not finish responding in time',
    ])
  })

  it('names the budget even when the deadline surfaces as a TimeoutError', async () => {
    // A real AbortSignal.timeout() rejects fetch with a TimeoutError, not an
    // AbortError, so the budget check has to accept both.
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
      AbortSignal.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    )
    fetchMock.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      throw init?.signal?.reason ?? new Error('unreachable')
    })
    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)
    spy.mockRestore()

    expect(res.status).toHaveBeenCalledWith(502)
    expect(loggedSummaries()).toEqual([
      'Scheduled sync failed: the run exceeded its 35s fetch budget — OpenSEO did not finish responding in time',
    ])
  })

  it('names the real error when a write fails after the deadline has passed', async () => {
    // The deadline covers fetching, but it keeps ticking through the write. So
    // "fetch finished at 34s, the deadline fired at 35s, the write then failed
    // for its own reason" is reachable — and deciding the message from
    // `deadline.aborted` alone would report a timeout and bury the real cause
    // in the cron's only history.
    const controller = new AbortController()
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    insertFailure.table = 'snapshots'
    insertFailure.message = 'duplicate key value violates unique constraint'
    insertFailure.onCall = () => controller.abort()   // the deadline expires mid-write

    const res = makeRes()
    await handler(makeReq('GET', { authorization: 'Bearer secret-value' }), res)
    spy.mockRestore()

    expect(res.status).toHaveBeenCalledWith(502)
    expect(loggedSummaries()).toEqual([
      'Scheduled sync failed: Could not write the snapshot: duplicate key value violates unique constraint',
    ])
  })
})
