// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  GscReconnectError, GscUpstreamError, gscConfig, signState, verifyState, consentUrl,
  encryptToken, decryptToken, exchangeCode, accessToken, revokeToken, listSites,
  matchProperties, latestDataDate, queryRows, mergeRows, type GscConfig, type GscRow,
} from './gsc.js'

const CFG: GscConfig = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://app.test/api/gsc-callback' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

function stub(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = (async (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    return respond(String(input), init)
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('gscConfig', () => {
  it('names the missing variable, never a value', () => {
    expect(() => gscConfig({ GOOGLE_OAUTH_CLIENT_SECRET: 's', APP_URL: 'https://a' })).toThrow(/GOOGLE_OAUTH_CLIENT_ID/)
    expect(() => gscConfig({ GOOGLE_OAUTH_CLIENT_ID: 'i', APP_URL: 'https://a' })).toThrow(/GOOGLE_OAUTH_CLIENT_SECRET/)
    expect(() => gscConfig({ GOOGLE_OAUTH_CLIENT_ID: 'i', GOOGLE_OAUTH_CLIENT_SECRET: 's' })).toThrow(/APP_URL/)
  })
  it('builds the redirect uri', () => {
    expect(gscConfig({ GOOGLE_OAUTH_CLIENT_ID: 'i', GOOGLE_OAUTH_CLIENT_SECRET: 's', APP_URL: 'https://a.test/' }))
      .toEqual({ clientId: 'i', clientSecret: 's', redirectUri: 'https://a.test/api/gsc-callback' })
  })
})

describe('state', () => {
  const secret = 'x'.repeat(32)
  const p = { userId: 'u1', nonce: 'n1', exp: 2000 }
  it('round-trips', () => {
    expect(verifyState(secret, signState(secret, p), 1000)).toEqual(p)
  })
  it('rejects a changed character', () => {
    const s = signState(secret, p)
    const bad = s.slice(0, 5) + (s[5] === 'A' ? 'B' : 'A') + s.slice(6)
    expect(verifyState(secret, bad, 1000)).toBeNull()
    const badSig = s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')
    expect(verifyState(secret, badSig, 1000)).toBeNull()
  })
  it('rejects expired, wrong secret and garbage', () => {
    expect(verifyState(secret, signState(secret, p), 2001)).toBeNull()
    expect(verifyState('y'.repeat(32), signState(secret, p), 1000)).toBeNull()
    expect(verifyState(secret, 'nonsense', 1000)).toBeNull()
    expect(verifyState(secret, 'a.b', 1000)).toBeNull()
  })
})

describe('consentUrl', () => {
  it('carries every param and the exact scope', () => {
    const u = new URL(consentUrl(CFG, 'st'))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('client_id')).toBe('cid')
    expect(u.searchParams.get('redirect_uri')).toBe(CFG.redirectUri)
    expect(u.searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/webmasters.readonly')
    expect(u.searchParams.get('state')).toBe('st')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('include_granted_scopes')).toBe('true')
  })
})

describe('encryptToken', () => {
  const key = randomBytes(32).toString('base64')
  it('round-trips with a random IV', () => {
    const a = encryptToken(key, 'refresh-123')
    const b = encryptToken(key, 'refresh-123')
    expect(a).not.toBe(b)
    expect(a.startsWith('v1.')).toBe(true)
    expect(a.split('.')).toHaveLength(4)
    expect(decryptToken(key, a)).toBe('refresh-123')
  })
  it('throws on a flipped ciphertext or tag byte', () => {
    const [v, iv, tag, ct] = encryptToken(key, 'refresh-123').split('.')
    const flip = (s: string) => {
      const buf = Buffer.from(s, 'base64url')
      buf[0] ^= 1
      return buf.toString('base64url')
    }
    expect(() => decryptToken(key, [v, iv, tag, flip(ct)].join('.'))).toThrow()
    expect(() => decryptToken(key, [v, iv, flip(tag), ct].join('.'))).toThrow()
  })
  it('rejects malformed blobs', () => {
    const [v, iv, tag, ct] = encryptToken(key, 'refresh-123').split('.')
    const cut = (s: string, n: number) => Buffer.from(s, 'base64url').subarray(0, n).toString('base64url')
    expect(() => decryptToken(key, [v, iv, cut(tag, 4), ct].join('.'))).toThrow(/expected format/)
    expect(() => decryptToken(key, [v, iv, tag, ct, 'x'].join('.'))).toThrow(/expected format/)
    expect(() => decryptToken(key, ['v2', iv, tag, ct].join('.'))).toThrow(/expected format/)
    expect(() => decryptToken(key, [v, cut(iv, 8), tag, ct].join('.'))).toThrow(/expected format/)
  })
  it('throws with a different key', () => {
    expect(() => decryptToken(randomBytes(32).toString('base64'), encryptToken(key, 'x'))).toThrow()
  })
  it('names GSC_TOKEN_KEY for a bad key, not its value', () => {
    expect(() => encryptToken('c2hvcnQ=', 'x')).toThrow(/GSC_TOKEN_KEY/)
    try { encryptToken('c2hvcnQ=', 'x') } catch (e) { expect(String(e)).not.toContain('c2hvcnQ=') }
  })
})

describe('exchangeCode', () => {
  it('posts the code and returns token and email', async () => {
    const idToken = `h.${b64u({ email: 'a@b.com' })}.s`
    const { f, calls } = stub(() => json({ refresh_token: 'rt', access_token: 'at', id_token: idToken }))
    expect(await exchangeCode(f, CFG, 'CODE')).toEqual({ refreshToken: 'rt', email: 'a@b.com' })
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[0].init.method).toBe('POST')
    const body = new URLSearchParams(String(calls[0].init.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('CODE')
    expect(body.get('client_id')).toBe('cid')
    expect(body.get('client_secret')).toBe('csecret')
    expect(body.get('redirect_uri')).toBe(CFG.redirectUri)
  })
  it('gives a null email without an id_token', async () => {
    const { f } = stub(() => json({ refresh_token: 'rt' }))
    expect((await exchangeCode(f, CFG, 'c')).email).toBeNull()
  })
  it('throws GscUpstreamError without a refresh_token', async () => {
    const { f } = stub(() => json({ access_token: 'at' }))
    await expect(exchangeCode(f, CFG, 'c')).rejects.toBeInstanceOf(GscUpstreamError)
  })
  it('throws GscUpstreamError on a failed response', async () => {
    const { f } = stub(() => json({ error: 'invalid_request' }, 400))
    await expect(exchangeCode(f, CFG, 'c')).rejects.toBeInstanceOf(GscUpstreamError)
  })
})

describe('accessToken', () => {
  it('posts grant_type=refresh_token and returns the token', async () => {
    const { f, calls } = stub(() => json({ access_token: 'at' }))
    expect(await accessToken(f, CFG, 'rt')).toBe('at')
    const body = new URLSearchParams(String(calls[0].init.body))
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt')
    expect(body.get('client_id')).toBe('cid')
    expect(body.get('client_secret')).toBe('csecret')
  })
  it('maps invalid_grant to GscReconnectError', async () => {
    const { f } = stub(() => json({ error: 'invalid_grant' }, 400))
    await expect(accessToken(f, CFG, 'rt')).rejects.toBeInstanceOf(GscReconnectError)
  })
  it('maps other failures to GscUpstreamError', async () => {
    for (const [body, status] of [[{ error: 'invalid_client' }, 400], [{}, 500]] as const) {
      const { f } = stub(() => json(body, status))
      const err = await accessToken(f, CFG, 'rt').catch((e) => e)
      expect(err).toBeInstanceOf(GscUpstreamError)
      expect(err).not.toBeInstanceOf(GscReconnectError)
      expect(err.status).toBe(status)
    }
  })
})

describe('revokeToken', () => {
  it('posts the token', async () => {
    const { f, calls } = stub(() => new Response(null, { status: 200 }))
    await revokeToken(f, 'tok')
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/revoke')
    expect(new URLSearchParams(String(calls[0].init.body)).get('token')).toBe('tok')
  })
  it('swallows a network error', async () => {
    const f = (async () => { throw new Error('down') }) as unknown as typeof fetch
    await expect(revokeToken(f, 'tok')).resolves.toBeUndefined()
  })
})

describe('listSites', () => {
  it('sends the bearer token and returns entries', async () => {
    const { f, calls } = stub(() => json({ siteEntry: [{ siteUrl: 'sc-domain:x.com', permissionLevel: 'siteOwner' }] }))
    expect(await listSites(f, 'tok')).toEqual([{ siteUrl: 'sc-domain:x.com', permissionLevel: 'siteOwner' }])
    expect(calls[0].url).toBe('https://www.googleapis.com/webmasters/v3/sites')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })
  it('returns [] when there are none', async () => {
    const { f } = stub(() => json({}))
    expect(await listSites(f, 't')).toEqual([])
  })
  it('throws GscUpstreamError on 429', async () => {
    const { f } = stub(() => json({}, 429))
    const err = await listSites(f, 't').catch((e) => e)
    expect(err).toBeInstanceOf(GscUpstreamError)
    expect(err.status).toBe(429)
  })
})

describe('matchProperties', () => {
  const s = (siteUrl: string, permissionLevel = 'siteOwner') => ({ siteUrl, permissionLevel })
  it('prefers the domain property', () => {
    expect(matchProperties('www.x.com', [s('sc-domain:x.com'), s('https://x.com/')])).toEqual(['sc-domain:x.com'])
  })
  it('returns url-prefix properties for both hosts', () => {
    expect(matchProperties('x.com', [s('https://x.com/'), s('https://www.x.com/')]))
      .toEqual(['https://x.com/', 'https://www.x.com/'])
  })
  it('returns [] with no match', () => {
    expect(matchProperties('x.com', [s('sc-domain:y.com')])).toEqual([])
  })
  it('ignores siteUnverifiedUser', () => {
    expect(matchProperties('x.com', [s('sc-domain:x.com', 'siteUnverifiedUser')])).toEqual([])
  })
})

describe('queryRows', () => {
  const rowsOf = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ keys: [`q${i}`, 'aus'], clicks: 1, impressions: 10, position: 3.456 }))
  it('maps, rounds and sends the request', async () => {
    const { f, calls } = stub(() => json({ rows: [
      { keys: ['a', 'aus'], clicks: 1, impressions: 10, position: 3.456 },
      { keys: ['b', 'xkx'], clicks: 0, impressions: 5, position: 8 },
      { keys: ['c', 'zzz'], clicks: 0, impressions: 5, position: 8 },
    ] }))
    const r = await queryRows(f, 'tok', 'sc-domain:x.com', '2026-11-01', '2026-11-07')
    expect(r.rows[0]).toEqual({ query: 'a', country: 'AU', position: 3.5, clicks: 1, impressions: 10 })
    expect(r.rows[1].country).toBe('ZZ')
    expect(r.rows[2].country).toBe('ZZ')
    expect(r.truncated).toBe(false)
    expect(calls[0].url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Ax.com/searchAnalytics/query')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      startDate: '2026-11-01', endDate: '2026-11-07', dimensions: ['query', 'country'], rowLimit: 25000, startRow: 0,
    })
  })
  it('truncates at exactly 25000 rows only', async () => {
    const a = stub(() => json({ rows: rowsOf(25000) }))
    expect((await queryRows(a.f, 't', 'p', 's', 'e')).truncated).toBe(true)
    const b = stub(() => json({ rows: rowsOf(24999) }))
    expect((await queryRows(b.f, 't', 'p', 's', 'e')).truncated).toBe(false)
  })
  it('handles no rows and 5xx', async () => {
    const a = stub(() => json({}))
    expect(await queryRows(a.f, 't', 'p', 's', 'e')).toEqual({ rows: [], truncated: false })
    const b = stub(() => json({}, 503))
    await expect(queryRows(b.f, 't', 'p', 's', 'e')).rejects.toBeInstanceOf(GscUpstreamError)
  })
})

describe('mergeRows', () => {
  const r = (query: string, country: string, position: number, clicks: number, impressions: number): GscRow =>
    ({ query, country, position, clicks, impressions })
  it('sums and weights position by impressions', () => {
    expect(mergeRows([[r('q', 'AU', 2, 1, 100)], [r('q', 'AU', 4, 2, 300)]]))
      .toEqual([r('q', 'AU', 3.5, 3, 400)])
  })
  it('keeps distinct keys apart', () => {
    const out = mergeRows([[r('q', 'AU', 2, 1, 100), r('q', 'CA', 2, 1, 100)], [r('p', 'AU', 2, 1, 100)]])
    expect(out).toHaveLength(3)
  })
})

describe('latestDataDate', () => {
  it('queries today-7..today-1 by date and returns the max', async () => {
    const { f, calls } = stub(() => json({ rows: [{ keys: ['2026-11-20'] }, { keys: ['2026-11-24'] }, { keys: ['2026-11-22'] }] }))
    expect(await latestDataDate(f, 't', 'sc-domain:x.com', new Date('2026-11-27T15:00:00Z'))).toBe('2026-11-24')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.startDate).toBe('2026-11-20')
    expect(body.endDate).toBe('2026-11-26')
    expect(body.dimensions).toEqual(['date'])
  })
  it('returns null with no rows', async () => {
    const { f } = stub(() => json({}))
    expect(await latestDataDate(f, 't', 'p', new Date('2026-11-27T00:00:00Z'))).toBeNull()
  })
})

