import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  bearerToken, createAccessResolver, createTokenResolver, isApprovedUser, resolveUser,
} from './_lib/requestAuth.js'
import { OpenSeoError, fetchBpExports, isAbortLike, openSeoConfig } from './_lib/openseo.js'
import { SyncDataError, normalizeExports } from './_lib/sitesNormalize.js'

/**
 * Vercel kills a function at `maxDuration` (10s Hobby / 15s Pro by default),
 * which is *below* the timeout this handler sets — so the crafted 504 could
 * never fire and the caller would get a platform error instead. Raise the
 * ceiling explicitly and keep the fetch timeout comfortably under it, so a slow
 * upstream always comes back as our own 504.
 */
export const config = { maxDuration: 60 }
const TIMEOUT_MS = 45_000

/**
 * The Sync button's one request: every BP ranking OpenSEO holds, already
 * normalized into dashboard records.
 *
 * Answers `{ ok: true, data: { records, unknownDomains, rawDate } }`, or
 * `{ ok: false, error, code? }` where `error` is already worded for the toast.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  // Authenticate BEFORE anything else. Without this the endpoint is a public
  // read of every BP ranking OpenSEO holds, and a free way to make this server
  // hammer OpenSEO. Every other read in this app is gated by Supabase, so this
  // one is too — the browser sends the caller's access token and we resolve it
  // server-side.
  const token = bearerToken(req.headers?.authorization)
  if (!token) {
    return res.status(401).json({
      ok: false,
      // `code` marks OUR refusal of the caller, as opposed to an upstream
      // failure, so the client can word the two differently.
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

  let openseo
  try {
    openseo = openSeoConfig(process.env)
  } catch (err) {
    // A malformed OPENSEO_BASE_URL — worded without echoing it.
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
  if (!openseo) {
    return res.status(500).json({
      ok: false,
      error: 'OPENSEO_RANKINGS_API_KEY is not configured on the server',
    })
  }

  // One deadline for the whole fan-out (domain list + every export).
  const deadline = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const result = normalizeExports(await fetchBpExports(openseo, { signal: deadline }))
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ ok: true, data: result })
  } catch (err) {
    if (deadline.aborted && isAbortLike(err)) {
      return res.status(504).json({
        ok: false,
        error: `OpenSEO did not respond within ${TIMEOUT_MS / 1000} seconds`,
      })
    }
    // OpenSeoError and SyncDataError messages are already worded for the toast
    // and never carry the upstream URL or the key.
    const worded = err instanceof OpenSeoError || err instanceof SyncDataError
    return res.status(502).json({
      ok: false,
      error: worded ? (err as Error).message : `Could not sync from OpenSEO: ${(err as Error).message}`,
    })
  }
}
