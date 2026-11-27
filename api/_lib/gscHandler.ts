/**
 * Shared plumbing for the api/gsc-*.ts endpoints: the method guard, the caller's
 * session and approval, the admin check, and the Google access path. Server-only.
 * Nothing here puts a token, code or secret into a response or a log.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  bearerToken, createAccessResolver, createTokenResolver, isAdminUser, isApprovedUser, resolveUser,
  type AuthedUser,
} from './requestAuth.js'
import { createAdminClient, type AdminClient } from './snapshotStore.js'
import {
  FORBIDDEN, GscConfigError, GscForbiddenError, GscKeyMismatchError, GscNetworkError, GscReconnectError,
  GscUnauthorizedError, GscUpstreamError, NO_ANSWER, accessToken, decryptToken, gscConfig, listSites,
  type GscSite,
} from './gsc.js'
import { loadConnection, markBroken, readCache, writeCache, type GscConnection } from './gscStore.js'

export const GSC_CONFIG = { maxDuration: 60 }
export const SITES_TTL_MS = 60 * 60 * 1000
export const KEYWORDS_TTL_MS = 6 * 60 * 60 * 1000

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} is not set. Add it to the Vercel environment variables.`)
  return v
}

export function guardMethod(req: VercelRequest, res: VercelResponse, method: string): boolean {
  if (req.method === method) return true
  res.setHeader('Allow', method)
  res.status(405).json({ ok: false, error: 'Method not allowed' })
  return false
}

export type Gate = { user: AuthedUser; db: AdminClient; isAdmin: () => Promise<boolean> }

/** Authenticates and approves the caller (and, with `admin`, requires is_admin). Responds and returns null on refusal. */
export async function gate(
  req: VercelRequest, res: VercelResponse, opts: { admin?: boolean } = {},
): Promise<Gate | null> {
  const token = bearerToken(req.headers?.authorization)
  if (!token) {
    res.status(401).json({ ok: false, code: 'unauthenticated', error: 'Sign in first: this request carried no Supabase session' })
    return null
  }
  let resolver, access, db: AdminClient
  try {
    resolver = createTokenResolver(process.env)
    access = createAccessResolver(process.env, token)
    db = createAdminClient(process.env)
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
    return null
  }
  const user = await resolveUser(resolver, token)
  if (!user) {
    res.status(401).json({ ok: false, code: 'unauthenticated', error: 'Your session is not valid or has expired. Sign in again and retry' })
    return null
  }
  if (!(await isApprovedUser(access, user.id))) {
    res.status(403).json({ ok: false, code: 'unapproved', error: 'Your account is not approved yet. An admin needs to approve it' })
    return null
  }
  let cached: boolean | undefined
  const isAdmin = async () => (cached ??= await isAdminUser(db, user.id))
  if (opts.admin && !(await isAdmin())) {
    res.status(403).json({ ok: false, error: 'Admins only' })
    return null
  }
  return { user, db, isAdmin }
}

export type Access =
  | { kind: 'not_connected' }
  | { kind: 'broken'; connection: GscConnection }
  | { kind: 'ok'; connection: GscConnection; token: string }

/** The connection and a fresh access token. Throws GscReconnectError (after marking broken) on invalid_grant. */
export async function googleAccess(db: AdminClient): Promise<Access> {
  const connection = await loadConnection(db)
  if (!connection) return { kind: 'not_connected' }
  if (connection.status === 'broken') return { kind: 'broken', connection }
  const cfg = gscConfig(process.env)
  const key = requireEnv('GSC_TOKEN_KEY')
  let refresh: string
  try {
    refresh = decryptToken(key, connection.refreshTokenEnc)
  } catch (err) {
    // A different GSC_TOKEN_KEY is this environment's configuration, not a dead connection: never
    // mark the one shared row broken for everyone because of it.
    if (err instanceof GscKeyMismatchError) throw err
    // Right key, unreadable token (row damaged): same as a revoked grant.
    await markBroken(db)
    throw new GscReconnectError('The stored Google token cannot be read.')
  }
  try {
    return { kind: 'ok', connection, token: await accessToken(fetch, cfg, refresh) }
  } catch (err) {
    if (err instanceof GscReconnectError) await markBroken(db)
    throw err
  }
}

/** Search Console's site list through the shared 1-hour cache row ('*', 0). */
export async function cachedSites(db: AdminClient, token: string, now: Date): Promise<GscSite[]> {
  const hit = await readCache<GscSite[]>(db, '*', 0, SITES_TTL_MS, now)
  if (hit) return hit
  const sites = await listSites(fetch, token)
  try {
    await writeCache(db, '*', 0, sites, now)
  } catch (err) {
    // Best effort: a failed cache write must not turn Google's answer into a 500.
    console.error('[gsc] site list cache write failed:', (err as Error).message)
  }
  return sites
}

const retryable = (e: unknown) =>
  e instanceof GscNetworkError
  || (e instanceof GscUpstreamError && (e.status === 429 || (e.status !== undefined && e.status >= 500)))

/** Runs `fn`, once more if Google answered 429 or 5xx, or did not answer at all (network error, timeout). */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!retryable(err)) throw err
    return await fn()
  }
}

export const RECONNECT_BODY = { ok: false, code: 'reconnect' } as const
export const NOT_CONNECTED_BODY = { ok: false, code: 'not_connected' } as const

/**
 * Search Console answered 401: the token is no longer accepted, so the shared connection is dead.
 * (A refresh-token invalid_grant is marked inside googleAccess.) Call before answering reconnect.
 */
export async function markIfRejected(db: AdminClient, err: unknown): Promise<void> {
  if (err instanceof GscUnauthorizedError) await markBroken(db)
}

/** The status and plain wording for a Google failure that is not a reconnect, or null for anything else. */
export function gscFailure(err: unknown): { status: number; error: string } | null {
  if (err instanceof GscConfigError || err instanceof GscKeyMismatchError) return { status: 500, error: err.message }
  if (err instanceof GscForbiddenError) return { status: 502, error: FORBIDDEN }
  if (err instanceof GscUpstreamError) return { status: 502, error: NO_ANSWER }
  return null
}
