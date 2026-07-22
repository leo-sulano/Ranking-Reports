import { describe, it, expect } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWK } from 'jose'
import { requireEnv, verifyPortalAssertion } from './ssoPortal'

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
})
