import type { VercelRequest, VercelResponse } from '@vercel/node'

const UPSTREAM = 'https://3213211.xyz/bpn-panel-cc/api/ranks.php'

const ALLOWED_ACTIONS = new Set(['results', 'domains'])
const MAX_LIMIT   = 1000
const TIMEOUT_MS  = 30_000

/** Vercel gives repeated query params as an array; take the first. */
function first(raw: unknown): string | undefined {
  return Array.isArray(raw) ? (raw[0] as string | undefined) : (raw as string | undefined)
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(first(raw))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const key = process.env.SITES_API_KEY
  if (!key) {
    return res.status(500).json({
      ok: false,
      error: 'SITES_API_KEY is not configured on the server',
    })
  }

  const action = first(req.query.action) ?? 'results'
  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: `Unsupported action "${action}"` })
  }

  // Deliberately NO project_id. The Rooster set is project 0, and the upstream
  // treats 0 as falsy — passing it returns every project rather than filtering.
  // DOMAIN_TO_BRAND on the client is the authoritative filter.
  const url = new URL(UPSTREAM)
  url.searchParams.set('action', action)
  url.searchParams.set('limit',  String(clampInt(req.query.limit,  1, MAX_LIMIT,   MAX_LIMIT)))
  url.searchParams.set('offset', String(clampInt(req.query.offset, 0, 10_000_000,  0)))

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await upstream.text()

    // Surface the upstream status so the client can tell a revoked key (401)
    // from an outage (5xx). Never echo the request URL — it is built from
    // secret-bearing config.
    res.status(upstream.status)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.send(body)
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return res.status(504).json({
      ok: false,
      error: timedOut
        ? 'The sites service did not respond within 30 seconds'
        : `Could not reach the sites service: ${(err as Error).message}`,
    })
  }
}
