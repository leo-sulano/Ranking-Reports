// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import {
  GscReconnectError, GscUpstreamError, GscConfigError, GscKeyMismatchError, GscNetworkError, GscForbiddenError,
  GscUnauthorizedError, GscScopeError, capMerged, gscConfig, signState, verifyState, consentUrl,
  encryptToken, decryptToken, exchangeCode, accessToken, revokeToken, listSites,
  matchProperties, latestDataDate, queryRows, mergeRows, type GscConfig, type GscRow,
} from './gsc.js'

const CFG: GscConfig = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://app.test/api/gsc-callback' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const SCOPES = 'openid email https://www.googleapis.com/auth/webmasters.readonly'
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
    expect(a.split('.')).toHaveLength(5)
    expect(decryptToken(key, a)).toBe('refresh-123')
  })
  it('I-3: carries a key id: the first 8 hex characters of sha256 over the key bytes', () => {
    const kid = encryptToken(key, 'x').split('.')[1]
    expect(kid).toMatch(/^[0-9a-f]{8}$/)
    expect(kid).toBe(createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 8))
  })
  it('throws on a flipped ciphertext or tag byte', () => {
    const [v, kid, iv, tag, ct] = encryptToken(key, 'refresh-123').split('.')
    const flip = (s: string) => {
      const buf = Buffer.from(s, 'base64url')
      buf[0] ^= 1
      return buf.toString('base64url')
    }
    for (const blob of [[v, kid, iv, tag, flip(ct)], [v, kid, iv, flip(tag), ct]]) {
      const err = (() => { try { decryptToken(key, blob.join('.')) } catch (e) { return e } })()
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(GscKeyMismatchError)
    }
  })
  it('rejects malformed blobs', () => {
    const [v, kid, iv, tag, ct] = encryptToken(key, 'refresh-123').split('.')
    const cut = (s: string, n: number) => Buffer.from(s, 'base64url').subarray(0, n).toString('base64url')
    expect(() => decryptToken(key, [v, kid, iv, cut(tag, 4), ct].join('.'))).toThrow(/expected format/)
    expect(() => decryptToken(key, [v, kid, iv, tag, ct, 'x'].join('.'))).toThrow(/expected format/)
    expect(() => decryptToken(key, ['v2', kid, iv, tag, ct].join('.'))).toThrow(/expected format/)
    expect(() => decryptToken(key, [v, kid, cut(iv, 8), tag, ct].join('.'))).toThrow(/expected format/)
    expect(() => decryptToken(key, [v, iv, tag, ct].join('.'))).toThrow(/expected format/)
  })
  it('I-3: a malformed key id is rejected as a bad format, not as a key mismatch', () => {
    const [v, kid, iv, tag, ct] = encryptToken(key, 'x').split('.')
    for (const bad of [kid.replace(/[0-9]/g, 'A').toUpperCase(), kid.slice(0, 7), `${kid}0`, 'zzzzzzzz']) {
      const err = (() => { try { decryptToken(key, [v, bad, iv, tag, ct].join('.')) } catch (e) { return e } })()
      expect(String(err)).toMatch(/expected format/)
    }
  })
  it('I-3: a different key gives GscKeyMismatchError', () => {
    expect(() => decryptToken(randomBytes(32).toString('base64'), encryptToken(key, 'x'))).toThrow(GscKeyMismatchError)
  })
  it('names GSC_TOKEN_KEY for a bad key, not its value', () => {
    expect(() => encryptToken('c2hvcnQ=', 'x')).toThrow(/GSC_TOKEN_KEY/)
    try { encryptToken('c2hvcnQ=', 'x') } catch (e) { expect(String(e)).not.toContain('c2hvcnQ=') }
  })
})

describe('malformed GSC_TOKEN_KEY', () => {
  const short = Buffer.alloc(31, 9).toString('base64')
  it('encryptToken throws GscConfigError for a 31-byte key, without the key value', () => {
    const err = (() => { try { encryptToken(short, 'x') } catch (e) { return e } })()
    expect(err).toBeInstanceOf(GscConfigError)
    expect(String((err as Error).message)).toContain('GSC_TOKEN_KEY')
    expect(String((err as Error).message)).not.toContain(short)
  })
  it('decryptToken throws GscConfigError for a 31-byte key, without the key value', () => {
    const blob = encryptToken(randomBytes(32).toString('base64'), 'x')
    const err = (() => { try { decryptToken(short, blob) } catch (e) { return e } })()
    expect(err).toBeInstanceOf(GscConfigError)
    expect(String((err as Error).message)).not.toContain(short)
  })
})

describe('exchangeCode', () => {
  it('posts the code and returns token and email', async () => {
    const idToken = `h.${b64u({ email: 'a@b.com' })}.s`
    const { f, calls } = stub(() => json({ refresh_token: 'rt', access_token: 'at', id_token: idToken, scope: SCOPES }))
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
    const { f } = stub(() => json({ refresh_token: 'rt', scope: SCOPES }))
    expect((await exchangeCode(f, CFG, 'c')).email).toBeNull()
  })
  it('throws GscUpstreamError without a refresh_token', async () => {
    const { f } = stub(() => json({ access_token: 'at', scope: SCOPES }))
    await expect(exchangeCode(f, CFG, 'c')).rejects.toBeInstanceOf(GscUpstreamError)
  })
  it('I-2: a token response without the Search Console scope throws GscScopeError carrying the token to revoke', async () => {
    for (const scope of ['openid email', undefined]) {
      const { f } = stub(() => json({ refresh_token: 'rt', access_token: 'at', scope }))
      const err = await exchangeCode(f, CFG, 'c').catch((e) => e)
      expect(err).toBeInstanceOf(GscScopeError)
      expect(err.token).toBe('rt')
    }
  })
  it('I-4: a network failure is a GscNetworkError and the call carries a timeout signal', async () => {
    const { f, calls } = stub(() => json({ refresh_token: 'rt', scope: SCOPES }))
    await exchangeCode(f, CFG, 'c')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    const down = (() => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    await expect(exchangeCode(down, CFG, 'c')).rejects.toBeInstanceOf(GscNetworkError)
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
    for (const [body, status] of [[{ error: 'invalid_request' }, 400], [{}, 500]] as const) {
      const { f } = stub(() => json(body, status))
      const err = await accessToken(f, CFG, 'rt').catch((e) => e)
      expect(err).toBeInstanceOf(GscUpstreamError)
      expect(err).not.toBeInstanceOf(GscReconnectError)
      expect(err.status).toBe(status)
    }
  })
})

describe('accessToken: permanent and network failures (I-2, I-4)', () => {
  it('invalid_client and unauthorized_client are a GscConfigError naming the env vars', async () => {
    for (const [error, status] of [['invalid_client', 401], ['invalid_client', 400], ['unauthorized_client', 400]] as const) {
      const { f } = stub(() => json({ error }, status))
      const err = await accessToken(f, CFG, 'rt').catch((e) => e)
      expect(err).toBeInstanceOf(GscConfigError)
      expect(err).not.toBeInstanceOf(GscUpstreamError)
      expect(err.message).toBe("Google rejected the app's OAuth client. Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (docs/integrations/gsc.md).")
    }
  })
  it('a network error or timeout is a GscNetworkError and the call carries a signal', async () => {
    const { f, calls } = stub(() => json({ access_token: 'at' }))
    await accessToken(f, CFG, 'rt')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    for (const e of [new TypeError('fetch failed'), new DOMException('timed out', 'TimeoutError')]) {
      const down = (() => { throw e }) as unknown as typeof fetch
      const err = await accessToken(down, CFG, 'rt').catch((x) => x)
      expect(err).toBeInstanceOf(GscNetworkError)
      expect(err).toBeInstanceOf(GscUpstreamError)
    }
  })
})

describe('revokeToken', () => {
  it('posts the token', async () => {
    const { f, calls } = stub(() => new Response(null, { status: 200 }))
    await revokeToken(f, 'tok')
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/revoke')
    expect(new URLSearchParams(String(calls[0].init.body)).get('token')).toBe('tok')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
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

describe('Search Console 401 / 403 (I-2)', () => {
  it('401 is a GscUnauthorizedError (a reconnect) from the site list and from a query', async () => {
    const { f } = stub(() => json({}, 401))
    const a = await listSites(f, 't').catch((e) => e)
    const b = await queryRows(f, 't', 'p', 's', 'e').catch((e) => e)
    for (const err of [a, b]) {
      expect(err).toBeInstanceOf(GscUnauthorizedError)
      expect(err).toBeInstanceOf(GscReconnectError)
    }
  })
  it('403 is a GscForbiddenError', async () => {
    const { f } = stub(() => json({}, 403))
    const err = await listSites(f, 't').catch((e) => e)
    expect(err).toBeInstanceOf(GscForbiddenError)
    expect(err.status).toBe(403)
  })
  it('I-4: a network error is a GscNetworkError and every Search Console call has a timeout signal', async () => {
    const { f, calls } = stub(() => json({}))
    await listSites(f, 't'); await queryRows(f, 't', 'p', 's', 'e'); await latestDataDate(f, 't', 'p', new Date())
    expect(calls).toHaveLength(3)
    for (const c of calls) expect(c.init.signal).toBeInstanceOf(AbortSignal)
    const down = (() => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    await expect(queryRows(down, 't', 'p', 's', 'e')).rejects.toBeInstanceOf(GscNetworkError)
    await expect(listSites(down, 't')).rejects.toBeInstanceOf(GscNetworkError)
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
  it('I-1: a path-scoped URL-prefix property is not matched, the root ones still are', () => {
    expect(matchProperties('x.com', [s('https://x.com/au/'), s('https://x.com/'), s('https://www.x.com/blog'), s('https://www.x.com/')]))
      .toEqual(['https://x.com/', 'https://www.x.com/'])
    expect(matchProperties('x.com', [s('https://x.com/au/')])).toEqual([])
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

describe('capMerged (M-4)', () => {
  const r = (i: number, clicks: number): GscRow => ({ query: `q${i}`, country: 'AU', position: 1, clicks, impressions: 10 })
  it('keeps the top 25,000 by clicks and says it cut', () => {
    const rows = Array.from({ length: 25_001 }, (_, i) => r(i, i === 0 ? 0 : 5))
    const out = capMerged(rows)
    expect(out.cut).toBe(true)
    expect(out.rows).toHaveLength(25_000)
    expect(out.rows.some((x) => x.query === 'q0')).toBe(false)
  })
  it('leaves a short list alone', () => {
    const out = capMerged([r(1, 1), r(2, 9)])
    expect(out.cut).toBe(false)
    expect(out.rows.map((x) => x.query)).toEqual(['q2', 'q1'])
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

