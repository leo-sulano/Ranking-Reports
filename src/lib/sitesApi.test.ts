import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchAllRows, fetchProxyPage, parsePageBody, SitesApiError } from './sitesApi'
import type { ApiRow } from './sitesNormalize'

// fetchProxyPage reads the caller's session to attach a bearer token. The
// module-level client would otherwise need real env vars to construct.
const getSessionMock = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: getSessionMock } },
}))

/** n placeholder rows — only the count matters to the pager. */
function page(n: number): ApiRow[] {
  return Array.from({ length: n }, (_, i) => ({
    domain: 'rooster.bet',
    keyword: `kw-${i}`,
    country: 'AU',
    position: 1,
    previous_position: 1,
    change: 0,
    url_found: null,
    checked_at: '2026-08-04 10:00:00',
  }))
}

describe('fetchAllRows', () => {
  it('stops on the first short page', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(4))
    const rows = await fetchAllRows(fetchPage, undefined, 10)
    expect(rows).toHaveLength(24)
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 10, 20])
  })

  it('stops immediately when the first page is empty', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce([])
    expect(await fetchAllRows(fetchPage, undefined, 10)).toEqual([])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('keeps paging on a full page even though meta.total would say stop', async () => {
    // The live endpoint reported total:135 for a 154-row response, so the
    // pager must never terminate on a count.
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(3))
    expect(await fetchAllRows(fetchPage, undefined, 10)).toHaveLength(13)
  })

  it('reports cumulative progress after each page', async () => {
    const onProgress = vi.fn()
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(2))
    await fetchAllRows(fetchPage, onProgress, 10)
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([10, 12])
  })

  it('rejects when a page fails mid-pagination, yielding nothing', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockRejectedValueOnce(new SitesApiError('upstream exploded', 500))
    await expect(fetchAllRows(fetchPage, undefined, 10)).rejects.toThrow('upstream exploded')
  })

  it('aborts rather than looping forever if offset stops advancing', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(10))
    await expect(fetchAllRows(fetchPage, undefined, 10)).rejects.toThrow(/exceeded/)
  })
})

// parsePageBody owns every word the user reads when a sync fails, so each
// response shape is pinned to its message.
describe('parsePageBody', () => {
  const ok = { ok: true, status: 200 }

  it('returns the data array on a well-formed success', () => {
    expect(parsePageBody(ok, { ok: true, data: page(2) })).toHaveLength(2)
  })

  it('surfaces the server error text on a non-2xx status', () => {
    expect(() => parsePageBody({ ok: false, status: 504 }, { ok: false, error: 'The sites service did not respond within 45 seconds' }))
      .toThrow('The sites service did not respond within 45 seconds')
  })

  it('names SITES_API_KEY verbatim when the server has no key', () => {
    // The one message that tells an operator exactly what to fix — it must
    // reach the toast unaltered.
    try {
      parsePageBody({ ok: false, status: 500 }, { ok: false, error: 'SITES_API_KEY is not configured on the server' })
      throw new Error('expected parsePageBody to throw')
    } catch (err) {
      expect((err as SitesApiError).message).toBe('SITES_API_KEY is not configured on the server')
      expect((err as SitesApiError).status).toBe(500)
    }
  })

  it('tags our own 401 with code `unauthenticated`, keeping the server wording', () => {
    try {
      parsePageBody(
        { ok: false, status: 401 },
        { ok: false, code: 'unauthenticated', error: 'Your session is not valid or has expired — sign in again and retry' },
      )
      throw new Error('expected parsePageBody to throw')
    } catch (err) {
      expect((err as SitesApiError).status).toBe(401)
      expect((err as SitesApiError).code).toBe('unauthenticated')
      expect((err as SitesApiError).message).toMatch(/sign in again/)
    }
  })

  it('leaves code null on an upstream 401, which means the API key was rejected', () => {
    // The proxy passes the vendor's 401 through verbatim; only the absence of
    // our own code tells the caller to blame SITES_API_KEY.
    try {
      parsePageBody({ ok: false, status: 401 }, { ok: false, error: 'Invalid API key' })
      throw new Error('expected parsePageBody to throw')
    } catch (err) {
      expect((err as SitesApiError).status).toBe(401)
      expect((err as SitesApiError).code).toBeNull()
    }
  })

  it('falls back to the status code when the body carries no usable error', () => {
    expect(() => parsePageBody({ ok: false, status: 502 }, null)).toThrow('HTTP 502')
    expect(() => parsePageBody({ ok: false, status: 502 }, { ok: false, error: '  ' })).toThrow('HTTP 502')
  })

  it('rejects a 200 whose envelope says ok:false', () => {
    expect(() => parsePageBody(ok, { ok: false, error: 'nope' })).toThrow('nope')
  })

  it('rejects a success with no data array', () => {
    expect(() => parsePageBody(ok, { ok: true })).toThrow(/no data array/)
    expect(() => parsePageBody(ok, { ok: true, data: 'not-an-array' })).toThrow(/no data array/)
  })
})

describe('fetchProxyPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getSessionMock.mockReset()
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } })
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: page(1) }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('sends the caller session as a bearer token', async () => {
    await fetchProxyPage(0)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123')
  })

  it('still calls the proxy when signed out, letting the server write the 401', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'Sign in to sync — this request carried no Supabase session' }), { status: 401 }),
    )
    await expect(fetchProxyPage(0)).rejects.toThrow(/Sign in to sync/)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toBeUndefined()
  })

  it('wraps a network throw in a SitesApiError naming the service', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(fetchProxyPage(0)).rejects.toThrow(/Could not reach the sites service: Failed to fetch/)
  })

  it('lets an abort through untouched so a cancel is not reported as a failure', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    fetchMock.mockRejectedValueOnce(abort)
    await expect(fetchProxyPage(0, AbortSignal.abort())).rejects.toBe(abort)
  })

  it('treats a non-JSON body as an unexpected payload rather than crashing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { status: 200 }))
    await expect(fetchProxyPage(0)).rejects.toThrow(/no data array/)
  })
})
