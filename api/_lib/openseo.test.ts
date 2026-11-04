// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_OPENSEO_BASE_URL, EXPORT_OFF, KEY_REJECTED, OpenSeoError,
  fetchBpExports, openSeoConfig, type OpenSeoConfig,
} from './openseo.js'

const CONFIG: OpenSeoConfig = { key: 'secret-key', baseUrl: 'https://openseo.test' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function exportBody(domain: string) {
  return {
    domain,
    device: 'desktop',
    generatedAt: '2026-11-04T00:00:00.000Z',
    weeks: ['2026-11-03'],
    markets: [{ configId: 'c1', locationCode: 2036, country: 'Australia', countryCode: 'AU', locationName: null, languageCode: 'en' }],
    keywords: [],
  }
}

type Handler = (domain: string | null, url: URL, init: RequestInit) => Response | Promise<Response>

let fetchMock: ReturnType<typeof vi.fn>

/** Route every call by its `domain` query param: null is the domain-list call. */
function stubOpenSeo(handler: Handler) {
  fetchMock = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    if (init.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
    const url = new URL(String(input))
    return handler(url.searchParams.get('domain'), url, init)
  })
  vi.stubGlobal('fetch', fetchMock)
}

/** The list answers `domains`; every export answers 200 unless `exportFor` says otherwise. */
function stubDomains(domains: unknown, exportFor: (domain: string) => Response | Promise<Response> = (d) => json(exportBody(d))) {
  stubOpenSeo((domain) => (domain === null ? json({ domains }) : exportFor(domain)))
}

/** Headers now, body never — until the request's signal fires, like a stalled upstream. */
function stalledBody(init: RequestInit): Response {
  const stream = new ReadableStream({
    start(controller) {
      init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true })
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** No response at all until the request's signal fires. */
function stalledFetch(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
  })
}

function exportCalls(domain?: string): URL[] {
  return fetchMock.mock.calls
    .map((c) => new URL(String(c[0])))
    .filter((u) => u.searchParams.has('domain') && (domain === undefined || u.searchParams.get('domain') === domain))
}

beforeEach(() => stubDomains([]))
afterEach(() => vi.unstubAllGlobals())

describe('openSeoConfig', () => {
  it('returns null without a key, trims it, defaults the base URL and drops a trailing slash', () => {
    expect(openSeoConfig({})).toBeNull()
    expect(openSeoConfig({ OPENSEO_RANKINGS_API_KEY: '   ' })).toBeNull()
    expect(openSeoConfig({ OPENSEO_RANKINGS_API_KEY: ' k ' })).toEqual({ key: 'k', baseUrl: DEFAULT_OPENSEO_BASE_URL })
    expect(openSeoConfig({ OPENSEO_RANKINGS_API_KEY: 'k', OPENSEO_BASE_URL: ' https://x.example/ ' }))
      .toEqual({ key: 'k', baseUrl: 'https://x.example' })
  })

  it('refuses a base URL that is not https, without echoing it', () => {
    // The key rides on every request, so it must never go out over plain http.
    for (const bad of ['http://x.example', 'not a url']) {
      let err: unknown
      try {
        openSeoConfig({ OPENSEO_RANKINGS_API_KEY: 'k', OPENSEO_BASE_URL: bad })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(OpenSeoError)
      expect((err as Error).message).toContain('OPENSEO_BASE_URL')
      expect((err as Error).message).not.toContain('x.example')
    }
  })
})

describe('fetchBpExports', () => {
  it('sends the key as x-api-key, never in the URL', async () => {
    stubDomains(['rooster.bet'])
    await fetchBpExports(CONFIG)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [input, init] of fetchMock.mock.calls) {
      expect(String(input)).not.toContain('secret-key')
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('secret-key')
    }
  })

  it('fetches only BP domains, by their original spelling, desktop, the full 52 run dates', async () => {
    stubDomains(['rooster.bet', 'WWW.SpinJo.com', 'example.com'])
    const exports = await fetchBpExports(CONFIG)
    const calls = exportCalls()
    expect(calls.map((u) => u.searchParams.get('domain')).sort()).toEqual(['WWW.SpinJo.com', 'rooster.bet'])
    for (const u of calls) {
      expect(u.origin + u.pathname).toBe('https://openseo.test/api/public/rankings')
      expect(u.searchParams.get('device')).toBe('desktop')
      expect(u.searchParams.get('weeks')).toBe('52')
    }
    expect(exports.map((e) => e.domain).sort()).toEqual(['WWW.SpinJo.com', 'rooster.bet'])
  })

  it('makes no export calls when OpenSEO tracks no BP domain', async () => {
    stubDomains(['example.com'])
    await expect(fetchBpExports(CONFIG)).resolves.toEqual([])
    expect(exportCalls()).toHaveLength(0)
  })

  it('retries a domain once after a 5xx, then succeeds', async () => {
    let attempts = 0
    stubDomains(['rooster.bet'], (d) => (++attempts === 1 ? json({ error: 'boom' }, 502) : json(exportBody(d))))
    await expect(fetchBpExports(CONFIG)).resolves.toHaveLength(1)
    expect(exportCalls('rooster.bet')).toHaveLength(2)
  })

  it('retries a network error once', async () => {
    let attempts = 0
    stubDomains(['rooster.bet'], (d) => {
      if (++attempts === 1) throw new TypeError('fetch failed')
      return json(exportBody(d))
    })
    await expect(fetchBpExports(CONFIG)).resolves.toHaveLength(1)
  })

  it('fails the whole fetch, naming the domain, when the retry fails too', async () => {
    stubDomains(['rooster.bet', 'spinjo.com'], (d) => (d === 'rooster.bet' ? json({}, 502) : json(exportBody(d))))
    const err = await fetchBpExports(CONFIG).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OpenSeoError)
    expect((err as OpenSeoError).message).toContain('rooster.bet')
    expect((err as OpenSeoError).message).toContain('502')
    expect((err as OpenSeoError).status).toBe(502)
    expect(exportCalls('rooster.bet')).toHaveLength(2)
  })

  it('does not retry a 401 and words it for the operator', async () => {
    stubOpenSeo(() => json({ error: 'unauthorized' }, 401))
    const err = await fetchBpExports(CONFIG).catch((e: unknown) => e)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((err as OpenSeoError).message).toBe(KEY_REJECTED)
    expect((err as OpenSeoError).status).toBe(401)
  })

  it('words a 503 as the export being switched off', async () => {
    stubOpenSeo(() => json({ error: 'rank export not configured' }, 503))
    const err = await fetchBpExports(CONFIG).catch((e: unknown) => e)
    expect((err as OpenSeoError).message).toBe(EXPORT_OFF)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a platform 503 that is not the export being switched off', async () => {
    let attempts = 0
    stubDomains(['rooster.bet'], (d) =>
      ++attempts === 1 ? new Response('<html>overloaded</html>', { status: 503 }) : json(exportBody(d)))
    await expect(fetchBpExports(CONFIG)).resolves.toHaveLength(1)
    expect(exportCalls('rooster.bet')).toHaveLength(2)
  })

  it('says OpenSEO did not answer when a request times out twice', async () => {
    stubOpenSeo((_domain, _url, init) => stalledFetch(init))
    const err = await fetchBpExports(CONFIG, { requestTimeoutMs: 20 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OpenSeoError)
    expect((err as Error).message).toBe('OpenSEO did not answer within 0.02 seconds for the domain list')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a body that stalls past the request timeout instead of calling it not JSON', async () => {
    stubOpenSeo((_domain, _url, init) => stalledBody(init))
    const err = await fetchBpExports(CONFIG, { requestTimeoutMs: 20 }).catch((e: unknown) => e)
    expect((err as Error).message).toBe('OpenSEO did not answer within 0.02 seconds for the domain list')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("lets the caller's deadline through untouched when it fires mid-body", async () => {
    const controller = new AbortController()
    stubOpenSeo((_domain, _url, init) => {
      setTimeout(() => controller.abort(), 5)
      return stalledBody(init)
    })
    const err = await fetchBpExports(CONFIG, { signal: controller.signal }).catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still calls a body that is not JSON what it is', async () => {
    stubOpenSeo(() => new Response('<!doctype html>', { status: 200 }))
    await expect(fetchBpExports(CONFIG)).rejects.toThrow('OpenSEO returned something other than JSON for the domain list')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels the other in-flight exports once one fails', async () => {
    let pending: AbortSignal | null = null
    stubOpenSeo((domain, _url, init) => {
      if (domain === null) return json({ domains: ['rooster.bet', 'spinjo.com'] })
      if (domain === 'spinjo.com') {
        pending = init.signal ?? null
        return stalledFetch(init)
      }
      return json({ error: 'unauthorized' }, 401)
    })
    await expect(fetchBpExports(CONFIG, { concurrency: 2 })).rejects.toThrow(KEY_REJECTED)
    expect((pending as AbortSignal | null)?.aborted).toBe(true)
  })

  it('says to check the Access bypass when OpenSEO redirects', async () => {
    stubOpenSeo(() => new Response(null, { status: 302, headers: { Location: 'https://team.cloudflareaccess.com/login' } }))
    const err = await fetchBpExports(CONFIG).catch((e: unknown) => e)
    expect((err as OpenSeoError).message).toMatch(/Cloudflare Access/)
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('manual')
  })

  it('rejects a domain list that is not an array of strings', async () => {
    stubDomains('x')
    await expect(fetchBpExports(CONFIG)).rejects.toThrow('OpenSEO returned an unexpected domain list')
  })

  it('rejects an export that is missing its arrays', async () => {
    stubDomains(['rooster.bet'], () => json({ domain: 'rooster.bet', weeks: [] }))
    await expect(fetchBpExports(CONFIG)).rejects.toThrow('OpenSEO returned an unexpected export for rooster.bet')
  })

  it("stops at the caller's signal without retrying", async () => {
    stubDomains(['rooster.bet'])
    const controller = new AbortController()
    controller.abort()
    const err = await fetchBpExports(CONFIG, { signal: controller.signal }).catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never runs more than `concurrency` exports at once', async () => {
    let inFlight = 0
    let peak = 0
    stubDomains(
      ['rooster.bet', 'spinjo.com', 'luckyvibe.com', 'playmojo.com', 'rollero.com'],
      async (d) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
        return json(exportBody(d))
      },
    )
    await expect(fetchBpExports(CONFIG, { concurrency: 2 })).resolves.toHaveLength(5)
    expect(peak).toBe(2)
  })
})
