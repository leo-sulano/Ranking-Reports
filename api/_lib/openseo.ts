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
 * How many run dates each export carries. Only the newest two per keyword ×
 * market are used (current + previous); the rest is headroom so a market that
 * missed a run or two still has a previous check.
 */
export const EXPORT_WEEKS = 8

export const KEY_REJECTED = 'OpenSEO rejected the key — check OPENSEO_RANKINGS_API_KEY on the server'
export const EXPORT_OFF   = "OpenSEO's rank export is switched off (RANKINGS_API_KEY is unset on the OpenSEO worker)"

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_CONCURRENCY = 6

export interface OpenSeoConfig {
  key:     string
  baseUrl: string
}

/** null when the key is not configured — the caller words that for its own audience. */
export function openSeoConfig(env: Record<string, string | undefined>): OpenSeoConfig | null {
  const key = env.OPENSEO_RANKINGS_API_KEY?.trim()
  if (!key) return null
  const baseUrl = (env.OPENSEO_BASE_URL?.trim() || DEFAULT_OPENSEO_BASE_URL).replace(/\/+$/, '')
  return { key, baseUrl }
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

export interface FetchOptions {
  /** The caller's overall deadline or cancel. When it fires, its error propagates untouched. */
  signal?:           AbortSignal
  requestTimeoutMs?: number
  concurrency?:      number
}

function isTimeout(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'TimeoutError'
}

/**
 * GET one rankings URL, retrying once on a network error or a 5xx.
 *
 * `subject` names the request in error messages ("the domain list", or the
 * domain). A 401 or a switched-off export is not retried: neither fixes itself.
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
    let res: Response
    try {
      res = await fetch(url, {
        headers:  { 'x-api-key': config.key, Accept: 'application/json' },
        // A redirect here is Cloudflare Access sending us to its login page —
        // following it would hand back HTML with a 200.
        redirect: 'manual',
        signal:   opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      })
    } catch (err) {
      // The caller's deadline or cancel: theirs to word, and never retried.
      if (opts.signal?.aborted) throw err
      if (!last) continue
      throw new OpenSeoError(
        isTimeout(err)
          ? `OpenSEO did not answer within ${opts.requestTimeoutMs / 1000} seconds for ${subject}`
          : `Could not reach OpenSEO for ${subject}: ${(err as Error).message}`,
      )
    }

    if (res.status === 401) throw new OpenSeoError(KEY_REJECTED, 401)
    if (res.status >= 300 && res.status < 400) {
      throw new OpenSeoError(
        `OpenSEO redirected the request for ${subject} — check that Cloudflare Access still bypasses /api/public/*`,
        res.status,
      )
    }
    if (res.status === 503) {
      // OpenSEO's own "not configured" answer is permanent; anything else at
      // 503 is the platform having a moment, and gets the usual retry.
      const body = await res.text().catch(() => '')
      if (/not configured/i.test(body)) throw new OpenSeoError(EXPORT_OFF, 503)
    }
    if (res.status >= 500 && !last) continue
    if (!res.ok) throw new OpenSeoError(`OpenSEO returned HTTP ${res.status} for ${subject}`, res.status)

    try {
      return await res.json()
    } catch {
      throw new OpenSeoError(`OpenSEO returned something other than JSON for ${subject}`, res.status)
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
 * One failed domain fails the whole fetch: a partial batch would make a brand
 * look like it vanished from the rankings.
 */
export async function fetchBpExports(config: OpenSeoConfig, opts: FetchOptions = {}): Promise<OpenSeoExport[]> {
  const settings = { ...opts, requestTimeoutMs: opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS }

  const list = (await getJson(config, '', 'the domain list', settings)) as { domains?: unknown } | null
  const domains = list?.domains
  if (!Array.isArray(domains) || !domains.every((d) => typeof d === 'string')) {
    throw new OpenSeoError('OpenSEO returned an unexpected domain list')
  }

  const bp = [...new Set(domains as string[])].filter((d) => DOMAIN_TO_BRAND[canonicalDomain(d)])

  return mapLimited(bp, opts.concurrency ?? DEFAULT_CONCURRENCY, async (domain) => {
    const query = `?${new URLSearchParams({ domain, device: 'desktop', weeks: String(EXPORT_WEEKS) })}`
    const body = await getJson(config, query, domain, settings)
    if (!isExport(body)) throw new OpenSeoError(`OpenSEO returned an unexpected export for ${domain}`)
    return body
  })
}
