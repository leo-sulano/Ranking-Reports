// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler, { config } from '../gsc-disconnect.js'
import { GOOD_ENV, fake, json, makeReq, makeRes, setConnection } from '../_lib/gscTestKit.js'

vi.mock('@supabase/supabase-js', async () => (await import('../_lib/gscTestKit.js')).supabaseMock)

let fetchMock: ReturnType<typeof vi.fn>
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of Object.keys(GOOD_ENV)) { saved[k] = process.env[k]; process.env[k] = GOOD_ENV[k] }
  fake.reset()
  fake.isAdmin = true
  fetchMock = vi.fn(async () => json({}))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  for (const k of Object.keys(GOOD_ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  vi.unstubAllGlobals()
})

describe('api/gsc-disconnect', () => {
  it('exports maxDuration 60 and refuses non-POST', async () => {
    expect(config.maxDuration).toBe(60)
    const res = makeRes()
    await handler(makeReq('GET'), res as never)
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('POST')
  })

  it('REVIEW 1: 403s a non-admin and leaves the connection and Google alone', async () => {
    fake.isAdmin = false
    setConnection()
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ ok: false, error: 'Admins only' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.connection).not.toBeNull()
    expect(fake.writes).toEqual([])
  })

  it('revokes the decrypted token, deletes the connection and clears the cache', async () => {
    setConnection()
    fake.cache.push({ domain: 'roostersbet.com', days: 28, payload: {}, fetched_at: new Date().toISOString() })
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://oauth2.googleapis.com/revoke')
    expect(String((init as RequestInit).body)).toBe('token=refresh-token-abc')
    expect(fake.connection).toBeNull()
    expect(fake.cache).toEqual([])
  })

  it('still disconnects when the revoke call fails', async () => {
    setConnection()
    fetchMock.mockRejectedValue(new Error('offline'))
    const res = makeRes()
    await handler(makeReq('POST'), res as never)
    expect(res.statusCode).toBe(200)
    expect(fake.connection).toBeNull()
  })
})
