// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from './sites.js'

type MockRes = VercelResponse & {
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
}

function makeReq(method: string, query: Record<string, string | string[]>): VercelRequest {
  return { method, query } as unknown as VercelRequest
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
let originalKey: string | undefined

beforeEach(() => {
  originalKey = process.env.SITES_API_KEY
  process.env.SITES_API_KEY = 'bpn_test'
  fetchMock = vi.fn(async () => new Response('{"ok":true,"data":[]}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.SITES_API_KEY
  else process.env.SITES_API_KEY = originalKey
  vi.unstubAllGlobals()
})

/** The URL the handler asked fetch() for, as a URL object. */
function calledUrl(): URL {
  return new URL(String(fetchMock.mock.calls[0][0]))
}

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
    expect(res.json.mock.calls[0][0].error).toContain('30 seconds')
  })
})
