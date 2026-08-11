import { createClient } from '@supabase/supabase-js'

/**
 * Server-side verification of a caller's Supabase access token.
 *
 * `api/portal-callback.ts` verifies a *portal-issued* JWT with `jose` +
 * `createRemoteJWKSet`, because that token is signed by a third party whose
 * public keys we only know via JWKS. The token here is Supabase's own, so the
 * canonical check is `auth.getUser(jwt)`: it validates signature, issuer and
 * expiry against the project, and — unlike an offline signature check — also
 * refuses a token whose user has since been deleted or signed out. It works
 * regardless of whether the project signs with the legacy shared secret or an
 * asymmetric key, so it needs no key material on this side.
 */

export interface AuthedUser {
  id:    string
  email: string
}

/** The slice of supabase-js that `resolveUser` needs. Injectable for tests. */
export interface TokenResolver {
  auth: {
    getUser(jwt: string): Promise<{
      data:  { user: { id: string; email?: string | null } | null }
      error: { message: string } | null
    }>
  }
}

/**
 * The bearer token from an `Authorization` header, or null when absent or
 * malformed. Node lower-cases header names and may hand back an array.
 */
export function bearerToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw) return null
  const match = /^Bearer\s+(\S.*)$/i.exec(raw.trim())
  return match ? match[1].trim() : null
}

/**
 * Build the client used to resolve tokens. Reads the same env as
 * api/portal-callback.ts: SUPABASE_URL is preferred and VITE_SUPABASE_URL is
 * the fallback (the VITE_ prefix only governs Vite's client-bundle inlining,
 * not server-side process.env access). The ANON key is enough — resolving a
 * token needs no elevated privilege, so the service-role key stays out of this
 * path entirely.
 *
 * Throws when neither is configured, so a misconfigured deployment fails loudly
 * rather than silently letting every request through.
 */
export function createTokenResolver(env: Record<string, string | undefined>): TokenResolver {
  const url     = env.SUPABASE_URL      ?? env.VITE_SUPABASE_URL
  const anonKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Supabase auth is not configured on the server — set SUPABASE_URL (or VITE_SUPABASE_URL) ' +
      'and SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)',
    )
  }
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** The user behind `token`, or null when it is expired, revoked or forged. */
export async function resolveUser(resolver: TokenResolver, token: string): Promise<AuthedUser | null> {
  try {
    const { data, error } = await resolver.auth.getUser(token)
    if (error || !data?.user) return null
    return { id: data.user.id, email: data.user.email ?? '' }
  } catch {
    // A network failure reaching Supabase must not be mistaken for a valid
    // session. Fail closed.
    return null
  }
}
