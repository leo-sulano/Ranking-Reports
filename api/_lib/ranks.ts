// SERVER-ONLY. Unlike brands.ts, sitesNormalize.ts and ranksPaging.ts in this
// same directory, nothing in src/ may import this file — it holds the upstream
// URL that api/sites.ts exists to keep out of the browser.

/** The vendor endpoint. Defined once so the proxy and the cron cannot drift. */
export const RANKS_UPSTREAM = 'https://3213211.xyz/bpn-panel-cc/api/ranks.php'

// `results` is the only action any caller uses. `domains` was allowed once; it
// widened the surface for nothing.
export const ALLOWED_ACTIONS = new Set(['results'])
export const MAX_LIMIT = 1000

export function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * Deliberately NO project_id. The Rooster set is project 0, and the upstream
 * treats 0 as falsy — passing it returns every project rather than filtering.
 * DOMAIN_TO_BRAND is the authoritative filter.
 */
export function buildRanksUrl(action: string, limit: number, offset: number): URL {
  const url = new URL(RANKS_UPSTREAM)
  url.searchParams.set('action', action)
  url.searchParams.set('limit',  String(limit))
  url.searchParams.set('offset', String(offset))
  return url
}

/**
 * One upstream request, with the key attached and a hard timeout.
 *
 * `signal` is combined with the per-page timeout rather than replacing it, so a
 * caller paging in a loop can hand in one run-wide deadline (api/cron-sync.ts
 * does) and still have each individual page bounded. Whichever fires first
 * aborts the fetch.
 */
export function fetchRanksPage(
  key: string,
  url: URL,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  return fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
}
