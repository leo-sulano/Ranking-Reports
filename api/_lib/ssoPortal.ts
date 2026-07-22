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
  const email = typeof payload.email === 'string' ? payload.email : ''
  if (!email) throw new Error('Portal token has no email claim')
  return { email }
}
