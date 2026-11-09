import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchSync, parseSyncBody, SitesApiError } from './sitesApi'
import type { NormalizeResult } from './sitesNormalize'

// fetchSync reads the caller's session to attach a bearer token. The
// module-level client would otherwise need real env vars to construct.
const getSessionMock = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: getSessionMock } },
}))

const RESULT: NormalizeResult = {
  records: [{
    domain: 'rooster.bet', keyword: 'rooster bet', country: 'AU',
    position: '3', previous: '', change: '', date: '2026-11-03',
    searchVolume: '', affiliateUrl: '', globalSearchVolume: '',
  }],
  unknownDomains: [],
  rawDate: '2026-11-03',
}

/** Pull the SitesApiError out of a call that is expected to throw. */
function thrown(fn: () => unknown): SitesApiError {
  try {
    fn()
  } catch (err) {
    return err as SitesApiError
  }
  throw new Error('expected a SitesApiError')
}

// parseSyncBody owns every word the user reads when a sync fails, so each
// response shape is pinned to its message.
describe('parseSyncBody', () => {
  const ok = { ok: true, status: 200 }

  it('returns the records, skipped domains and date on success', () => {
    expect(parseSyncBody(ok, { ok: true, data: RESULT })).toEqual(RESULT)
  })

  it("surfaces the server's error text, status and code verbatim", () => {
    const keyRejected = 'Ahrefs rejected the key — check AHREFS_API_KEY on the server (it may have expired or been revoked, or its creator left the Ahrefs workspace)'
    const err = thrown(() => parseSyncBody({ ok: false, status: 502 }, { ok: false, error: keyRejected }))
    expect(err).toBeInstanceOf(SitesApiError)
    expect(err.message).toBe(keyRejected)
    expect(err.status).toBe(502)
    expect(err.code).toBeNull()

    const ours = thrown(() => parseSyncBody(
      { ok: false, status: 401 },
      { ok: false, code: 'unauthenticated', error: 'Your session is not valid or has expired — sign in again and retry' },
    ))
    expect(ours.code).toBe('unauthenticated')
    expect(ours.message).toMatch(/sign in again/)
  })

  it('falls back to the HTTP status when the error body is empty', () => {
    expect(() => parseSyncBody({ ok: false, status: 502 }, null)).toThrow('HTTP 502')
    expect(() => parseSyncBody({ ok: false, status: 502 }, { ok: false, error: '  ' })).toThrow('HTTP 502')
  })

  it('rejects a 200 whose envelope says ok:false', () => {
    expect(() => parseSyncBody(ok, { ok: false, error: 'nope' })).toThrow('nope')
  })

  it('rejects a success envelope without a records array', () => {
    expect(() => parseSyncBody(ok, { ok: true })).toThrow(/unexpected/)
    expect(() => parseSyncBody(ok, { ok: true, data: { records: 'x', rawDate: '2026-11-03' } })).toThrow(/unexpected/)
  })
})

describe('fetchSync', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getSessionMock.mockReset()
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } })
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: RESULT }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('makes one call to the proxy with the caller session as a bearer token', async () => {
    await expect(fetchSync()).resolves.toEqual(RESULT)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sites')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123')
  })

  it('still calls the proxy when signed out, letting the server write the 401', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'Sign in to sync — this request carried no Supabase session' }), { status: 401 }),
    )
    await expect(fetchSync()).rejects.toThrow(/Sign in to sync/)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toBeUndefined()
  })

  it('wraps a network throw in a SitesApiError naming the dashboard server', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(fetchSync()).rejects.toThrow(/Could not reach the dashboard's sync service: Failed to fetch/)
  })

  it('lets an abort through untouched so a cancel is not reported as a failure', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    fetchMock.mockRejectedValueOnce(abort)
    await expect(fetchSync(AbortSignal.abort())).rejects.toBe(abort)
  })

  it('treats a non-JSON body as an unexpected payload rather than crashing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<!doctype html>', { status: 200 }))
    await expect(fetchSync()).rejects.toThrow(/unexpected/)
  })
})
