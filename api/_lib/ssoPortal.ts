import { jwtVerify, type JWTVerifyGetKey } from 'jose'

/** Reads `name` from `env`, throwing if unset/empty rather than silently treating it as "no constraint." */
export function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required for SSO`)
  return value
}

export interface PortalAssertion {
  email: string
}

/**
 * Verifies a portal-signed JWT against `jwks`, enforcing issuer, audience,
 * and expiry (via jose's own checks). Throws on any failure. Resolves the
 * asserted email on success.
 */
export async function verifyPortalAssertion(
  token: string,
  jwks: JWTVerifyGetKey,
  opts: { issuer: string; audience: string }
): Promise<PortalAssertion> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: opts.issuer,
    audience: opts.audience,
  })
  const email = (typeof payload.email === 'string' ? payload.email : '').trim()
  if (!email) throw new Error('Portal token has no email claim')
  return { email }
}

/** The slice of the supabase-js admin client that ensureUserExists needs. */
export interface AdminUserCreator {
  auth: {
    admin: {
      createUser(attrs: { email: string; email_confirm: boolean }): Promise<{
        error: { code?: string; message: string; status?: number } | null
      }>
    }
  }
}

/**
 * JIT-provision `email` in Supabase Auth: create the user (pre-confirmed, so
 * no confirmation mail fires), treating "already registered" as success.
 * Deliberately NOT listUsers()-based — that only returns the first page, so an
 * existing user beyond page 1 would be missed and re-created (which errors).
 *
 * @returns `true` when this call created the user, `false` when they already
 * existed. The caller uses that to auto-approve first-time portal arrivals
 * without re-approving a returning user an admin has since revoked — `pending`
 * means both "brand new" and "revoked" in user_access, so the status column
 * alone cannot tell them apart.
 */
export async function ensureUserExists(admin: AdminUserCreator, email: string): Promise<boolean> {
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (!error) return true
  if (error.code === 'email_exists') return false
  // Older GoTrue versions signal duplicates only via the message text.
  if (/already (?:been )?registered|already exists/i.test(error.message)) return false
  throw new Error(error.message)
}

/**
 * Origin for redirects: APP_URL (canonical, trailing slash stripped) when
 * configured, else derived from the request's host header as a fallback.
 */
export function resolveAppOrigin(env: Record<string, string | undefined>, host: string | undefined): string {
  const appUrl = env.APP_URL?.trim()
  if (appUrl) return appUrl.replace(/\/+$/, '')
  return `https://${host ?? ''}`
}
