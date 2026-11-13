/**
 * Server-only Ahrefs client for the monthly "other ranking keywords" pull
 * (api/cron-discovery.ts).
 *
 * Unlike api/_lib/ahrefs.ts — the rankings sync, which only ever calls free
 * endpoints and stops if one charges — Site Explorer's organic-keywords report
 * SPENDS API units. So it runs on its own key, AHREFS_DISCOVERY_API_KEY, which
 * carries a monthly unit limit in Ahrefs, and every response's charge is read
 * and checked against what its rows can explain. The rankings key is never
 * used here.
 *
 * Design: docs/superpowers/specs/2026-11-13-other-ranking-keywords-design.md
 */
import { AHREFS_API_BASE, isAbortLike } from './ahrefs.js'
import {
  DISCOVERY_SELECT, MIN_CALL_UNITS, ROWS_PER_CALL, UNITS_PER_ROW, type DiscoveryCountry,
} from './keywordDiscovery.js'

export const DISCOVERY_KEY_REJECTED =
  'Ahrefs rejected the discovery key — check AHREFS_DISCOVERY_API_KEY on the server (it may have expired or been revoked, or its creator left the Ahrefs workspace)'

/** How far a call's charge may exceed what its rows explain before the run stops. */
export const COST_MARGIN_UNITS = 50

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000
const DEFAULT_RETRY_DELAY_MS = 2_000
const DEFAULT_MAX_RETRY_AFTER_MS = 5_000

/** A failure already worded for whoever reads the cron log. Never carries the URL or the key. */
export class DiscoveryError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'DiscoveryError'
    this.status = status
  }
}

export interface DiscoveryConfig {
  key: string
}

/** null when the discovery key is not configured. Never falls back to AHREFS_API_KEY. */
export function discoveryConfig(env: Record<string, string | undefined>): DiscoveryConfig | null {
  const key = env.AHREFS_DISCOVERY_API_KEY?.trim()
  return key ? { key } : null
}

/** True when the discovery key is the rankings key — which must never spend units. */
export function sharesSyncKey(env: Record<string, string | undefined>): boolean {
  const discovery = env.AHREFS_DISCOVERY_API_KEY?.trim()
  const sync = env.AHREFS_API_KEY?.trim()
  return Boolean(discovery && sync && discovery === sync)
}

export interface CallOptions {
  /** The caller's deadline or cancel. When it fires, its error propagates untouched and is never retried. */
  signal?:           AbortSignal
  requestTimeoutMs?: number
  /** The pause before retrying a 429 that names no Retry-After. */
  retryDelayMs?:     number
  /** The longest a 429's Retry-After may hold the retry. */
  maxRetryAfterMs?:  number
}

type Resolved = Required<Omit<CallOptions, 'signal'>> & Pick<CallOptions, 'signal'>

function resolved(opts: CallOptions = {}): Resolved {
  return {
    signal:           opts.signal,
    requestTimeoutMs: opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    retryDelayMs:     opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    maxRetryAfterMs:  opts.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS,
  }
}

/** Release a response we will not read, so its connection is not held open. */
function discard(res: Response): void {
  void res.body?.cancel().catch(() => {})
}

/** Wait `ms`, or reject at once with the caller's own cancel. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** A 429's Retry-After (seconds or an HTTP date), capped; `fallbackMs` when it names none. */
function retryAfterMs(res: Response, fallbackMs: number, capMs: number): number {
  const raw = res.headers.get('retry-after')?.trim()
  if (!raw) return Math.min(fallbackMs, capMs)
  const seconds = Number(raw)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now()
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), capMs) : Math.min(fallbackMs, capMs)
}

/** Ahrefs' own `error` text, when it is short enough to show an operator. */
function upstreamError(text: string): string {
  try {
    const error = (JSON.parse(text) as { error?: unknown } | null)?.error
    return typeof error === 'string' && error.trim() && error.length <= 200 ? `: ${error.trim()}` : ''
  } catch {
    return ''
  }
}

/**
 * GET one endpoint and parse it, retrying once on a 429, a 5xx or a request
 * that failed in transit. A rejected key or any other refusal is not retried:
 * none of them fixes itself. `subject` names the request in error messages.
 */
async function getWithRetry(
  config: DiscoveryConfig,
  path: string,
  params: Record<string, string>,
  subject: string,
  opts: Resolved,
): Promise<{ headers: Headers; body: unknown }> {
  const query = new URLSearchParams(params).toString()
  const url = `${AHREFS_API_BASE}/${path}${query ? `?${query}` : ''}`

  for (let attempt = 1; ; attempt++) {
    const last = attempt >= 2
    const timeout = AbortSignal.timeout(opts.requestTimeoutMs)
    try {
      const res = await fetch(url, {
        method:   'GET',
        headers:  { Authorization: `Bearer ${config.key}`, Accept: 'application/json' },
        // Ahrefs does not redirect API calls; following one would send the key elsewhere.
        redirect: 'manual',
        signal:   opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      })

      if (res.status === 401 || res.status === 403) {
        discard(res)
        throw new DiscoveryError(DISCOVERY_KEY_REJECTED, res.status)
      }
      if ((res.status === 429 || res.status >= 500) && !last) {
        const wait = res.status === 429 ? retryAfterMs(res, opts.retryDelayMs, opts.maxRetryAfterMs) : 0
        discard(res)
        await pause(wait, opts.signal)
        continue
      }
      const text = await res.text()
      if (res.status < 200 || res.status >= 300) {
        throw new DiscoveryError(`Ahrefs returned HTTP ${res.status} for ${subject}${upstreamError(text)}`, res.status)
      }
      try {
        return { headers: res.headers, body: JSON.parse(text) }
      } catch {
        throw new DiscoveryError(`Ahrefs returned something other than JSON for ${subject}`, res.status)
      }
    } catch (err) {
      if (err instanceof DiscoveryError) throw err
      // The caller's deadline or cancel: theirs to word, and never retried.
      if (opts.signal?.aborted) throw err
      if (!last) continue
      throw new DiscoveryError(
        timeout.aborted || isAbortLike(err)
          ? `Ahrefs did not answer within ${opts.requestTimeoutMs / 1000} seconds for ${subject}`
          : `Could not reach Ahrefs for ${subject}: ${(err as Error).message}`,
      )
    }
  }
}

export interface KeyLimits {
  /** The key's monthly unit limit; null when the key has none. */
  limit:     number | null
  usage:     number
  /** When the billing month's usage resets (ISO). */
  resetDate: string
}

/** The discovery key's monthly limit, usage and reset date. Free: Ahrefs charges no units for it. */
export async function fetchKeyLimits(config: DiscoveryConfig, opts?: CallOptions): Promise<KeyLimits> {
  const { body } = await getWithRetry(config, 'subscription-info/limits-and-usage', {}, 'the key limits', resolved(opts))
  const limits = (body as { limits_and_usage?: Record<string, unknown> } | null)?.limits_and_usage
  const limit = limits?.units_limit_api_key
  const usage = limits?.units_usage_api_key
  const resetDate = limits?.usage_reset_date
  if (
    !limits ||
    !(limit === null || (typeof limit === 'number' && Number.isFinite(limit))) ||
    typeof usage !== 'number' || !Number.isFinite(usage) ||
    typeof resetDate !== 'string' || !resetDate
  ) {
    throw new DiscoveryError('Ahrefs returned an unexpected limits response')
  }
  return { limit: limit as number | null, usage, resetDate }
}

export interface OrganicRequest {
  domain:        string
  country:       DiscoveryCountry
  /** YYYY-MM-DD: the latest data on or before it. */
  date:          string
  /** From excludeKeywordsWhere: the keywords already tracked, left out of the response. */
  excludeWhere?: string
}

export interface OrganicResponse {
  body:        unknown
  rowCount:    number
  unitsActual: number
}

/** The most a call can legitimately cost: Ahrefs' minimum, or every row at full price. */
export function expectedMaxUnits(rowCount: number): number {
  return Math.max(MIN_CALL_UNITS, rowCount * UNITS_PER_ROW)
}

function numericHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)?.trim()
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * One domain × country: the top ROWS_PER_CALL keywords by search volume.
 * `unitsActual` is what Ahrefs actually charged; a response that does not say
 * counts at the nominal cost, then at the worst case — never as free.
 */
export async function fetchOrganicKeywords(
  config: DiscoveryConfig,
  req: OrganicRequest,
  opts?: CallOptions,
): Promise<OrganicResponse> {
  const subject = `${req.domain} (${req.country})`
  const params: Record<string, string> = {
    target:   req.domain,
    country:  req.country.toLowerCase(),
    date:     req.date,
    mode:     'subdomains',
    select:   DISCOVERY_SELECT,
    order_by: 'volume:desc',
    limit:    String(ROWS_PER_CALL),
  }
  if (req.excludeWhere) params.where = req.excludeWhere

  const { headers, body } = await getWithRetry(config, 'site-explorer/organic-keywords', params, subject, resolved(opts))
  const list = (body as { keywords?: unknown } | null)?.keywords
  const rowCount = Array.isArray(list) ? list.length : 0
  const expected = expectedMaxUnits(rowCount)
  const unitsActual =
    numericHeader(headers, 'x-api-units-cost-total-actual') ??
    numericHeader(headers, 'x-api-units-cost-total') ??
    expected
  if (unitsActual > expected + COST_MARGIN_UNITS) {
    throw new DiscoveryError(
      `Ahrefs charged ${unitsActual} units for ${subject}, more than the ${expected} expected — stopping; Ahrefs pricing may have changed`,
    )
  }
  return { body, rowCount, unitsActual }
}
