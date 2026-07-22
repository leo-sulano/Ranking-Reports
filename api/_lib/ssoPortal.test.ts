import { describe, it, expect } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWK } from 'jose'
import { requireEnv, verifyPortalAssertion, ensureUserExists, resolveAppOrigin } from './ssoPortal'

const ISSUER = 'https://portal.example.com'
const AUDIENCE = 'test-audience-id'
const KID = 'test-key'

async function buildTestJwks() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = (await exportJWK(publicKey)) as JWK
  jwk.kid = KID
  jwk.alg = 'RS256'
  const jwks = createLocalJWKSet({ keys: [jwk] })
  return { jwks, privateKey }
}

async function sign(
  privateKey: Parameters<SignJWT['sign']>[0],
  payload: Record<string, unknown>,
  overrides: { issuer?: string; audience?: string; expiresIn?: string | number } = {}
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setExpirationTime(overrides.expiresIn ?? '5m')
    .sign(privateKey)
}

describe('requireEnv', () => {
  it('returns the value when set', () => {
    expect(requireEnv({ FOO: 'bar' }, 'FOO')).toBe('bar')
  })

  it('throws when unset', () => {
    expect(() => requireEnv({}, 'FOO')).toThrow('FOO is required for SSO')
  })

  it('throws when empty string', () => {
    expect(() => requireEnv({ FOO: '' }, 'FOO')).toThrow('FOO is required for SSO')
  })
})

describe('verifyPortalAssertion', () => {
  it('resolves the email claim for a valid token', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, { email: 'user@example.com' })

    const result = await verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ email: 'user@example.com' })
  })

  it('rejects a token with the wrong issuer', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, { email: 'user@example.com' }, { issuer: 'https://not-the-portal.example.com' })

    await expect(verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow()
  })

  it('rejects a token with the wrong audience', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, { email: 'user@example.com' }, { audience: 'some-other-dashboard' })

    await expect(verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, { email: 'user@example.com' }, { expiresIn: Math.floor(Date.now() / 1000) - 10 })

    await expect(verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow()
  })

  it('rejects a token with no email claim', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, {})

    await expect(verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow(
      'Portal token has no email claim'
    )
  })

  it('rejects a token signed by a key not in the JWKS', async () => {
    const { jwks } = await buildTestJwks()
    const { privateKey: otherPrivateKey } = await generateKeyPair('RS256', { extractable: true })
    const token = await sign(otherPrivateKey, { email: 'user@example.com' })

    await expect(verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow()
  })
})

/** Minimal stand-in for the supabase admin client's createUser surface. */
function fakeAdmin(result: { error: { code?: string; message: string; status?: number } | null }) {
  const calls: Array<{ email: string; email_confirm: boolean }> = []
  return {
    admin: {
      auth: {
        admin: {
          createUser: async (attrs: { email: string; email_confirm: boolean }) => {
            calls.push(attrs)
            return { data: { user: null }, error: result.error }
          },
        },
      },
    },
    calls,
  }
}

describe('ensureUserExists', () => {
  it('creates the user with email pre-confirmed when they do not exist', async () => {
    const { admin, calls } = fakeAdmin({ error: null })

    await ensureUserExists(admin, 'new@example.com')

    expect(calls).toEqual([{ email: 'new@example.com', email_confirm: true }])
  })

  it('treats an email_exists error code as success', async () => {
    const { admin } = fakeAdmin({ error: { code: 'email_exists', message: 'User already registered', status: 422 } })

    await expect(ensureUserExists(admin, 'existing@example.com')).resolves.toBeUndefined()
  })

  it('treats an "already been registered" message without a code as success (older GoTrue)', async () => {
    const { admin } = fakeAdmin({
      error: { message: 'A user with this email address has already been registered', status: 422 },
    })

    await expect(ensureUserExists(admin, 'existing@example.com')).resolves.toBeUndefined()
  })

  it('throws on any other createUser error', async () => {
    const { admin } = fakeAdmin({ error: { code: 'unexpected_failure', message: 'Database error', status: 500 } })

    await expect(ensureUserExists(admin, 'new@example.com')).rejects.toThrow('Database error')
  })
})

describe('resolveAppOrigin', () => {
  it('prefers APP_URL, stripping any trailing slash', () => {
    expect(resolveAppOrigin({ APP_URL: 'https://ranking-reports-alpha.vercel.app/' }, 'other.host')).toBe(
      'https://ranking-reports-alpha.vercel.app'
    )
  })

  it('falls back to https://<host> when APP_URL is unset', () => {
    expect(resolveAppOrigin({}, 'ranking-reports-alpha.vercel.app')).toBe('https://ranking-reports-alpha.vercel.app')
  })

  it('returns an empty-host https origin when neither is available', () => {
    expect(resolveAppOrigin({}, undefined)).toBe('https://')
  })
})
