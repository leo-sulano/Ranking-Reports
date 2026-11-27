import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchGscKeywords, fetchGscStatus, startGscConnect, disconnectGsc } from './gscApi'

const getSessionMock = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: getSessionMock } } }))

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('fetchGscKeywords', () => {
  it('sends the bearer token and returns rows', async () => {
    const body = { ok: true, property: 'sc-domain:a.com', startDate: '2026-11-01', dataUpTo: '2026-11-28', truncated: false, rows: [] }
    fetchMock.mockResolvedValue(json(200, body))
    expect(await fetchGscKeywords('a.com', 28)).toEqual(body)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/gsc-keywords?domain=a.com&days=28')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })
  it('passes code through on 409', async () => {
    fetchMock.mockResolvedValue(json(409, { ok: false, code: 'reconnect' }))
    expect(await fetchGscKeywords('a.com', 7)).toMatchObject({ ok: false, code: 'reconnect' })
  })
  it('passes code through on a 401 body and keeps the server text', async () => {
    fetchMock.mockResolvedValue(json(401, { ok: false, code: 'not_connected', error: 'Sign in' }))
    expect(await fetchGscKeywords('a.com', 7)).toMatchObject({ ok: false, code: 'not_connected', error: 'Sign in' })
  })
  it('401/403 without text gets the default', async () => {
    fetchMock.mockResolvedValue(json(403, null))
    expect(await fetchGscKeywords('a.com', 7)).toEqual({ ok: false, error: 'You are not allowed to see this.' })
  })
  it('502 carries the server error', async () => {
    fetchMock.mockResolvedValue(json(502, { ok: false, error: 'Google down' }))
    expect(await fetchGscKeywords('a.com', 7)).toEqual({ ok: false, error: 'Google down' })
  })
  it('network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('x'))
    expect(await fetchGscKeywords('a.com', 7)).toEqual({ ok: false, error: 'Could not reach the dashboard server.' })
  })
  it('rethrows an abort', async () => {
    const c = new AbortController()
    c.abort()
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(fetchGscKeywords('a.com', 7, c.signal)).rejects.toThrow()
  })
})

describe('other calls', () => {
  it('fetchGscStatus returns the body and throws on non-200', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, connected: false }))
    expect(await fetchGscStatus()).toEqual({ ok: true, connected: false })
    fetchMock.mockResolvedValueOnce(json(500, { ok: false, error: 'boom' }))
    await expect(fetchGscStatus()).rejects.toThrow('boom')
  })
  it('startGscConnect POSTs and returns the url', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, url: 'https://g/x' }))
    expect(await startGscConnect()).toBe('https://g/x')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    fetchMock.mockResolvedValueOnce(json(403, { ok: false, error: 'Admins only' }))
    await expect(startGscConnect()).rejects.toThrow('Admins only')
  })
  it('disconnectGsc throws on failure', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }))
    await expect(disconnectGsc()).resolves.toBeUndefined()
    fetchMock.mockResolvedValueOnce(json(500, { ok: false, error: 'nope' }))
    await expect(disconnectGsc()).rejects.toThrow('nope')
  })
})
