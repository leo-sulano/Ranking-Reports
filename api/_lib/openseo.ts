// SERVER-ONLY. Holds the OpenSEO key, so it must never be imported from src/ —
// the browser reaches OpenSEO only through api/sites.ts. (Its browser-safe
// neighbour is sitesNormalize.ts, which shapes what this returns.)
//
// OpenSEO's /api/public/rankings is a read-only export: it never runs a check
// or spends DataForSEO credit, so calling it any number of times is free.
import { DOMAIN_TO_BRAND } from './brands.js'
import { canonicalDomain, type OpenSeoExport } from './sitesNormalize.js'

export const DEFAULT_OPENSEO_BASE_URL = 'https://open-seo-selfhost.sandbox-f72.workers.dev'

/**
 * How many run dates each export carries: the most the endpoint allows. Only
 * the newest two per keyword × market are used (current + previous), but the
 * date axis is shared by every market of a domain, so frequent re-runs in one
 * market would push the others' runs out of a shorter window entirely.
 */
export const EXPORT_WEEKS = 52

export const KEY_REJECTED = 'OpenSEO rejected the key — check OPENSEO_RANKINGS_API_KEY on the server'
export const EXPORT_OFF   = "OpenSEO's rank export is switched off (RANKINGS_API_KEY is unset on the OpenSEO worker)"
const BAD_BASE_URL        = 'OPENSEO_BASE_URL must be an https:// URL — check it on the server'

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_CONCURRENCY = 6

export interface OpenSeoConfig {
  key:     string
  baseUrl: string
}

/** A failure already worded for whoever reads the toast or the cron log. Never carries the URL or key. */
export class OpenSeoError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'OpenSeoError'
    this.status = status
  }
}

/**
 * null when the key is not configured — the caller words that for its own
 * audience. Throws an OpenSeoError when OPENSEO_BASE_URL is set but is not an
 * https URL: the key rides on every request, so it never goes out in clear.
 */
export function openSeoConfig(env: Record<string, string | undefined>): OpenSeoConfig | null {
  const key = env.OPENSEO_RANKINGS_API_KEY?.trim()
  if (!key) return null
  const baseUrl = (env.OPENSEO_BASE_URL?.trim() || DEFAULT_OPENSEO_BASE_URL).replace(/\/+$/, '')
  let protocol = ''
  try {
    protocol = new URL(baseUrl).protocol
  } catch {
    // Reported below without echoing the value.
  }
  if (protocol !== 'https:') throw new OpenSeoError(BAD_BASE_URL)
  return { key, baseUrl }
}

/** True for the error a fired deadline or cancel rejects with (a timeout signal says TimeoutError). */
export function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

export interface FetchOptions {
  /** The caller's overall deadline or cancel. When it fires, its error propagates untouched. */
  signal?:           AbortSignal
  requestTimeoutMs?: number
  concurrency?:      number
}

/** Release a response we will not read, so its connection is not held open. */
function discard(res: Response): void {
  void res.body?.cancel().catch(() => {})
}

/**
 * GET one rankings URL and parse it, retrying once when the request fails in
 * transit — a network error, a 5xx, or no complete answer within
 * `requestTimeoutMs` (headers or body).
 *
 * `subject` names the request in error messages ("the domain list", or the
 * domain). A 401, a redirect or a switched-off export is not retried: none of
 * them fixes itself. The caller's own signal is never retried either; its
 * error propagates untouched so the caller can word its own deadline.
 */
async function getJson(
  config: OpenSeoConfig,
  query: string,
  subject: string,
  opts: Required<Pick<FetchOptions, 'requestTimeoutMs'>> & FetchOptions,
): Promise<unknown> {
  const url = `${config.baseUrl}/api/public/rankings${query}`

  for (let attempt = 1; ; attempt++) {
    const last = attempt >= 2
    const timeout = AbortSignal.timeout(opts.requestTimeoutMs)
    let text: string
    let status: number
    try {
      const res = await fetch(url, {
        headers:  { 'x-api-key': config.key, Accept: 'application/json' },
        // A redirect here is Cloudflare Access sending us to its login page —
        // following it would hand back HTML with a 200.
        redirect: 'manual',
        signal:   opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      })
      status = res.status

      if (status === 401) {
        discard(res)
        throw new OpenSeoError(KEY_REJECTED, 401)
      }
      if (status >= 300 && status < 400) {
        discard(res)
        throw new OpenSeoError(
          `OpenSEO redirected the request for ${subject} — check that Cloudflare Access still bypasses /api/public/*`,
          status,
        )
      }
      if (status >= 500) {
        const body = await res.text()
        // OpenSEO's own "not configured" answer is permanent; anything else at
        // 5xx is the platform having a moment, and gets the usual retry.
        if (status === 503 && /not configured/i.test(body)) throw new OpenSeoError(EXPORT_OFF, 503)
        if (!last) continue
        throw new OpenSeoError(`OpenSEO returned HTTP ${status} for ${subject}`, status)
      }
      if (!res.ok) {
        discard(res)
        throw new OpenSeoError(`OpenSEO returned HTTP ${status} for ${subject}`, status)
      }
      // Read the whole body inside the try: a stall or drop mid-body is a
      // transport failure like any other, not a malformed answer.
      text = await res.text()
    } catch (err) {
      if (err instanceof OpenSeoError) throw err
      // The caller's deadline or cancel: theirs to word, and never retried.
      if (opts.signal?.aborted) throw err
      if (!last) continue
      throw new OpenSeoError(
        timeout.aborted || isAbortLike(err)
          ? `OpenSEO did not answer within ${opts.requestTimeoutMs / 1000} seconds for ${subject}`
          : `Could not reach OpenSEO for ${subject}: ${(err as Error).message}`,
      )
    }

    try {
      return JSON.parse(text)
    } catch {
      throw new OpenSeoError(`OpenSEO returned something other than JSON for ${subject}`, status)
    }
  }
}

function isExport(body: unknown): body is OpenSeoExport {
  const b = body as Partial<OpenSeoExport> | null
  return typeof b?.domain === 'string'
    && Array.isArray(b.weeks) && Array.isArray(b.markets) && Array.isArray(b.keywords)
}

/** Run `fn` over `items`, at most `limit` at a time. Stops starting new work after the first failure. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++
      try {
        results[i] = await fn(items[i])
      } catch (err) {
        failed = true
        throw err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

/**
 * The rank export of every BP domain OpenSEO tracks.
 *
 * Domains come from OpenSEO's own list, kept only when DOMAIN_TO_BRAND knows
 * them; everything else there is other clients' sites. Each export is fetched
 * by the domain's spelling in that list, because OpenSEO matches it exactly.
 * One failed domain fails the whole fetch — a partial batch would make a brand
 * look like it vanished — and cancels the requests still in flight.
 */
export async function fetchBpExports(config: OpenSeoConfig, opts: FetchOptions = {}): Promise<OpenSeoExport[]> {
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const list = (await getJson(config, '', 'the domain list', { ...opts, requestTimeoutMs })) as { domains?: unknown } | null
  const domains = list?.domains
  if (!Array.isArray(domains) || !domains.every((d) => typeof d === 'string')) {
    throw new OpenSeoError('OpenSEO returned an unexpected domain list')
  }

  const bp = [...new Set(domains as string[])].filter((d) => DOMAIN_TO_BRAND[canonicalDomain(d)])

  // Fires on the first failure, so the exports still in flight stop too.
  const stop = new AbortController()
  const signal = opts.signal ? AbortSignal.any([opts.signal, stop.signal]) : stop.signal

  try {
    return await mapLimited(bp, opts.concurrency ?? DEFAULT_CONCURRENCY, async (domain) => {
      const query = `?${new URLSearchParams({ domain, device: 'desktop', weeks: String(EXPORT_WEEKS) })}`
      const body = await getJson(config, query, domain, { ...opts, signal, requestTimeoutMs })
      if (!isExport(body)) throw new OpenSeoError(`OpenSEO returned an unexpected export for ${domain}`)
      return body
    })
  } catch (err) {
    stop.abort()
    throw err
  }
}
