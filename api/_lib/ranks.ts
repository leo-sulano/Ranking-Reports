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

/** One upstream request, with the key attached and a hard timeout. */
export function fetchRanksPage(
  key: string,
  url: URL,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  })
}
