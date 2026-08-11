import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  bearerToken, createAccessResolver, createTokenResolver, isApprovedUser, resolveUser,
} from './_lib/requestAuth.js'

const UPSTREAM = 'https://3213211.xyz/bpn-panel-cc/api/ranks.php'

// `results` is the only action any caller uses. `domains` was allowed too, but
// it widened the surface for nothing.
const ALLOWED_ACTIONS = new Set(['results'])
const MAX_LIMIT   = 1000

/**
 * Vercel kills a function at `maxDuration` (10s Hobby / 15s Pro by default),
 * which is *below* the timeout this handler used to set — so the crafted 504
 * could never fire and the caller got a platform error instead. Raise the
 * ceiling explicitly and keep the fetch timeout comfortably under it, so a slow
 * upstream always comes back as our own 504.
 */
export const config = { maxDuration: 60 }
const TIMEOUT_MS = 45_000

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

  // Authenticate BEFORE anything else. Without this the endpoint is a public
  // read of every row the key can see (including other projects' data) and a
  // free proxy against the vendor's quota. Every other read in this app is
  // gated by Supabase, so this one is too — the browser sends the caller's
  // access token and we resolve it server-side.
  const token = bearerToken(req.headers?.authorization)
  if (!token) {
    return res.status(401).json({
      ok: false,
      // `code` separates OUR 401 from an upstream 401, which is passed through
      // with the same status but means "the vendor rejected SITES_API_KEY".
      // The client words those two very differently.
      code: 'unauthenticated',
      error: 'Sign in to sync — this request carried no Supabase session',
    })
  }

  let resolver
  let accessResolver
  try {
    resolver = createTokenResolver(process.env)
    accessResolver = createAccessResolver(process.env, token)
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }

  const user = await resolveUser(resolver, token)
  if (!user) {
    return res.status(401).json({
      ok: false,
      code: 'unauthenticated',
      error: 'Your session is not valid or has expired — sign in again and retry',
    })
  }

  // A valid session is not enough. Signup is self-serve and auto-provisions a
  // 'pending' row, so authentication alone would narrow the exposure only from
  // "anyone with the URL" to "anyone who can register". This route reads no
  // Supabase table of its own, so RLS never sees it — the check is explicit.
  if (!(await isApprovedUser(accessResolver, user.id))) {
    return res.status(403).json({
      ok: false,
      code: 'unapproved',
      error: 'Your account is not approved yet — an admin needs to approve it before you can sync',
    })
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
        ? `The sites service did not respond within ${TIMEOUT_MS / 1000} seconds`
        : `Could not reach the sites service: ${(err as Error).message}`,
    })
  }
}
