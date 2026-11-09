// SERVER-ONLY. Holds the Ahrefs key, so it must never be imported from src/ —
// the browser reaches Ahrefs only through api/sites.ts. (Its browser-safe
// neighbour is sitesNormalize.ts, which shapes what this returns.)
//
// Reads the client's Ahrefs Rank Tracker through three endpoints Ahrefs does
// not charge API units for: management/projects, management/project-competitors
// and rank-tracker/competitors-overview. GET only — the dashboard never writes
// to Ahrefs. The key reads the whole agency workspace, so only projects whose
// target is a BP domain are ever fetched.
import { bpDomainOf, hostOf, type AhrefsKeywordRow, type AhrefsProject } from './sitesNormalize.js'

export const AHREFS_API_BASE = 'https://api.ahrefs.com/v3'

export const KEY_REJECTED =
  'Ahrefs rejected the key — check AHREFS_API_KEY on the server (it may have expired or been revoked, or its creator left the Ahrefs workspace)'

/** Every slot's current and previous position, in one call per project. */
const SELECT = 'keyword,location,country,language,serp_updated,serp_updated_prev,competitors_list'

/** Ahrefs' default page size. A project that fills it would need paging, which this sync does not do. */
const ROW_LIMIT = 1000

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_CONCURRENCY = 6
const DEFAULT_RETRY_DELAY_MS = 2_000
/** The longest a 429's Retry-After may hold a retry: the cron's whole fetch budget is 35 s. */
const MAX_RETRY_AFTER_MS = 10_000
const DAY_MS = 86_400_000

export interface AhrefsConfig {
  key: string
}

/** A failure already worded for whoever reads the toast or the cron log. Never carries the URL or key. */
export class AhrefsError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'AhrefsError'
    this.status = status
  }
}

/** null when the key is not configured — the caller words that for its own audience. */
export function ahrefsConfig(env: Record<string, string | undefined>): AhrefsConfig | null {
  const key = env.AHREFS_API_KEY?.trim()
  return key ? { key } : null
}

/** True for the error a fired deadline or cancel rejects with (a timeout signal says TimeoutError). */
export function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

/**
 * The date whose update counts as "previous": 7 days before `asOf`. For a
 * weekly cycle that is last week's update, fetched in the same call.
 */
export function compareDate(asOf: string): string {
  return new Date(Date.parse(`${asOf}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10)
}

export interface FetchOptions {
  /** The caller's overall deadline or cancel. When it fires, its error propagates untouched. */
  signal?:           AbortSignal
  requestTimeoutMs?: number
  concurrency?:      number
  /** The day to read rankings as of (YYYY-MM-DD). Defaults to today, UTC. */
  asOf?:             string
  /** The pause before retrying a 429. */
  retryDelayMs?:     number
}

type RequestOptions = FetchOptions & { requestTimeoutMs: number; retryDelayMs: number }

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

/**
 * How long a 429 asks us to wait before retrying — `Retry-After` in seconds or
 * as an HTTP date — capped at MAX_RETRY_AFTER_MS. `fallbackMs` when it does not say.
 */
function retryAfterMs(res: Response, fallbackMs: number): number {
  const raw = res.headers.get('retry-after')?.trim()
  if (!raw) return fallbackMs
  const seconds = Number(raw)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now()
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : fallbackMs
}

/** Ahrefs' own `error` text, when it is short enough to show an operator. */
async function upstreamError(res: Response): Promise<string> {
  try {
    const error = (JSON.parse(await res.text()) as { error?: unknown } | null)?.error
    return typeof error === 'string' && error.trim() && error.length <= 200 ? `: ${error.trim()}` : ''
  } catch {
    return ''
  }
}

/**
 * GET one Ahrefs endpoint and parse it, retrying once when the request fails in
 * transit — a network error, a 5xx, a 429, or no complete answer within
 * `requestTimeoutMs` (headers or body).
 *
 * `subject` names the request in error messages ("the project list", or the
 * project's name). A rejected key, a redirect or any other refusal is not
 * retried: none of them fixes itself. The caller's own signal is never retried
 * either; its error propagates untouched so the caller can word its own deadline.
 */
async function getJson(
  config: AhrefsConfig,
  path: string,
  params: Record<string, string>,
  subject: string,
  opts: RequestOptions,
): Promise<unknown> {
  const query = new URLSearchParams(params).toString()
  const url = `${AHREFS_API_BASE}/${path}${query ? `?${query}` : ''}`

  for (let attempt = 1; ; attempt++) {
    const last = attempt >= 2
    const timeout = AbortSignal.timeout(opts.requestTimeoutMs)
    let text: string
    let status: number
    try {
      const res = await fetch(url, {
        method:   'GET',
        headers:  { Authorization: `Bearer ${config.key}`, Accept: 'application/json' },
        // Ahrefs does not redirect API calls; following one would send the key elsewhere.
        redirect: 'manual',
        signal:   opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      })
      status = res.status

      if (status === 401 || status === 403) {
        discard(res)
        throw new AhrefsError(KEY_REJECTED, status)
      }
      if (status >= 500 || status === 429) {
        if (!last) {
          const wait = status === 429 ? retryAfterMs(res, opts.retryDelayMs) : 0
          discard(res)
          await pause(wait, opts.signal)
          continue
        }
        throw new AhrefsError(`Ahrefs returned HTTP ${status} for ${subject}${await upstreamError(res)}`, status)
      }
      if (status < 200 || status >= 300) {
        throw new AhrefsError(`Ahrefs returned HTTP ${status} for ${subject}${await upstreamError(res)}`, status)
      }
      // Every endpoint this module calls is free. A charge means something
      // changed upstream, and continuing would keep spending.
      if (Number(res.headers.get('x-api-units-cost-total') ?? 0) > 0) {
        discard(res)
        throw new AhrefsError(
          `Ahrefs charged API units for ${subject} — the sync stopped; it should only call free endpoints`,
          status,
        )
      }
      // Read the whole body inside the try: a stall or drop mid-body is a
      // transport failure like any other, not a malformed answer.
      text = await res.text()
    } catch (err) {
      if (err instanceof AhrefsError) throw err
      // The caller's deadline or cancel: theirs to word, and never retried.
      if (opts.signal?.aborted) throw err
      if (!last) continue
      throw new AhrefsError(
        timeout.aborted || isAbortLike(err)
          ? `Ahrefs did not answer within ${opts.requestTimeoutMs / 1000} seconds for ${subject}`
          : `Could not reach Ahrefs for ${subject}: ${(err as Error).message}`,
      )
    }

    try {
      return JSON.parse(text)
    } catch {
      throw new AhrefsError(`Ahrefs returned something other than JSON for ${subject}`, status)
    }
  }
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

interface ProjectListEntry {
  project_id?:    unknown
  project_name?:  unknown
  url?:           unknown
  keyword_count?: unknown
}

/**
 * Every BP Rank Tracker project in the workspace, with its competitors in slot
 * order and its rankings as of `opts.asOf` (current and previous update).
 *
 * One failed project fails the whole fetch — a partial batch would make a brand
 * look like it vanished — and cancels the requests still in flight.
 */
export async function fetchBpProjects(config: AhrefsConfig, opts: FetchOptions = {}): Promise<AhrefsProject[]> {
  const base: RequestOptions = {
    ...opts,
    requestTimeoutMs: opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    retryDelayMs:     opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  }
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10)

  const list = (await getJson(config, 'management/projects', {}, 'the project list', base)) as { projects?: unknown } | null
  if (!Array.isArray(list?.projects)) throw new AhrefsError('Ahrefs returned an unexpected project list')

  // Only BP projects with keywords: other clients' projects and LP projects
  // are never read at all.
  const bp = (list.projects as ProjectListEntry[]).filter((p) =>
    Number(p?.keyword_count) > 0 && bpDomainOf(hostOf(typeof p?.url === 'string' ? p.url : '')) !== '')

  // Fires on the first failure, so the requests still in flight stop too.
  const stop = new AbortController()
  const each: RequestOptions = { ...base, signal: opts.signal ? AbortSignal.any([opts.signal, stop.signal]) : stop.signal }

  try {
    return await mapLimited(bp, opts.concurrency ?? DEFAULT_CONCURRENCY, async (p) => {
      const id = String(p.project_id)
      const name = typeof p.project_name === 'string' && p.project_name.trim() ? p.project_name.trim() : `project ${id}`

      const competitors = (await getJson(config, 'management/project-competitors', { project_id: id }, name, each)) as
        { competitors?: unknown } | null
      if (!Array.isArray(competitors?.competitors)) {
        throw new AhrefsError(`Ahrefs returned an unexpected competitor list for ${name}`)
      }

      const rankings = (await getJson(config, 'rank-tracker/competitors-overview', {
        project_id:    id,
        device:        'desktop',
        date:          asOf,
        date_compared: compareDate(asOf),
        select:        SELECT,
        limit:         String(ROW_LIMIT),
      }, name, each)) as { keywords?: unknown } | null
      if (!Array.isArray(rankings?.keywords)) throw new AhrefsError(`Ahrefs returned unexpected rankings for ${name}`)
      if (rankings.keywords.length >= ROW_LIMIT) {
        throw new AhrefsError(`Ahrefs returned ${ROW_LIMIT} rows for ${name} — more than one request can hold, so nothing was saved`)
      }

      return {
        projectId:   Number(p.project_id),
        name,
        target:      String(p.url),
        competitors: (competitors.competitors as Array<{ url?: unknown }>).map((c) => String(c?.url ?? '')),
        rows:        rankings.keywords as AhrefsKeywordRow[],
      }
    })
  } catch (err) {
    stop.abort()
    throw err
  }
}
