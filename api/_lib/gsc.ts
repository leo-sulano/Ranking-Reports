// Google Search Console + Google sign-in helpers. Every Google call goes through an
// injected `fetch`, so tests stub it. No Google SDK.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { alpha3ToAlpha2 } from './countryCodes.js'

export type GscConfig = { clientId: string; clientSecret: string; redirectUri: string }

/** Google said invalid_grant: the stored refresh token is dead and an admin must reconnect. */
export class GscReconnectError extends Error {}
export class GscUpstreamError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

const SCOPE = 'openid email https://www.googleapis.com/auth/webmasters.readonly'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites'

export function gscConfig(env: Record<string, string | undefined>): GscConfig {
  const need = (name: string) => {
    const v = env[name]?.trim()
    if (!v) throw new Error(`${name} is not set. Add it to the Vercel environment variables.`)
    return v
  }
  const clientId = need('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = need('GOOGLE_OAUTH_CLIENT_SECRET')
  const appUrl = need('APP_URL').replace(/\/+$/, '')
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/gsc-callback` }
}

// ---- state -----------------------------------------------------------------

export type StatePayload = { userId: string; nonce: string; exp: number }

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest()

export function signState(secret: string, p: StatePayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  return `${body}.${hmac(secret, body).toString('base64url')}`
}

export function verifyState(secret: string, state: string, now: number): StatePayload | null {
  const parts = String(state).split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const want = hmac(secret, body)
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload
    if (typeof p?.userId !== 'string' || typeof p.nonce !== 'string' || typeof p.exp !== 'number') return null
    if (p.exp < now) return null
    return p
  } catch {
    return null
  }
}

export function consentUrl(cfg: GscConfig, state: string): string {
  const u = new URL(AUTH_URL)
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', SCOPE)
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('include_granted_scopes', 'true')
  u.searchParams.set('state', state)
  return u.toString()
}

// ---- token encryption --------------------------------------------------------

function keyBytes(keyB64: string): Buffer {
  const k = Buffer.from(String(keyB64 ?? ''), 'base64')
  if (k.length !== 32) throw new Error('GSC_TOKEN_KEY must be base64 of exactly 32 bytes.')
  return k
}

export function encryptToken(keyB64: string, plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyBytes(keyB64), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

export function decryptToken(keyB64: string, blob: string): string {
  const [v, iv, tag, ct] = String(blob).split('.')
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Stored token is not in the expected format.')
  const d = createDecipheriv('aes-256-gcm', keyBytes(keyB64), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}

// ---- OAuth calls ---------------------------------------------------------------

const form = (o: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(o).toString(),
})

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const j = await res.json()
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function exchangeCode(
  f: typeof fetch, cfg: GscConfig, code: string,
): Promise<{ refreshToken: string; email: string | null }> {
  const res = await f(TOKEN_URL, form({
    grant_type: 'authorization_code', code, client_id: cfg.clientId,
    client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri,
  }))
  const j = await readJson(res)
  if (!res.ok) throw new GscUpstreamError(`Google refused the sign-in code (${res.status}).`, res.status)
  if (typeof j.refresh_token !== 'string' || !j.refresh_token) {
    throw new GscUpstreamError('Google did not return a refresh token. Remove the app from the Google account and connect again.')
  }
  let email: string | null = null
  if (typeof j.id_token === 'string') {
    try {
      const payload = JSON.parse(Buffer.from(j.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'))
      if (typeof payload.email === 'string') email = payload.email
    } catch { /* no email */ }
  }
  return { refreshToken: j.refresh_token, email }
}

export async function accessToken(f: typeof fetch, cfg: GscConfig, refreshToken: string): Promise<string> {
  const res = await f(TOKEN_URL, form({
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
  }))
  const j = await readJson(res)
  if (!res.ok) {
    if (res.status === 400 && j.error === 'invalid_grant') throw new GscReconnectError('Google access was revoked or expired.')
    throw new GscUpstreamError(`Google would not issue an access token (${res.status}).`, res.status)
  }
  if (typeof j.access_token !== 'string' || !j.access_token) throw new GscUpstreamError('Google returned no access token.', res.status)
  return j.access_token
}

export async function revokeToken(f: typeof fetch, token: string): Promise<void> {
  try {
    await f(REVOKE_URL, form({ token }))
  } catch { /* best effort */ }
}

// ---- Search Console ----------------------------------------------------------

export type GscSite = { siteUrl: string; permissionLevel: string }
export type GscRow = { query: string; country: string; position: number; clicks: number; impressions: number }

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

function upstream(res: Response, what: string): GscUpstreamError {
  return new GscUpstreamError(`Search Console ${what} failed (${res.status}).`, res.status)
}

export async function listSites(f: typeof fetch, token: string): Promise<GscSite[]> {
  const res = await f(SITES_URL, { headers: auth(token) })
  if (!res.ok) throw upstream(res, 'site list')
  const j = (await readJson(res)) as { siteEntry?: GscSite[] }
  return (j.siteEntry ?? []).map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }))
}

const bare = (h: string) => h.toLowerCase().replace(/^www\./, '')

export function matchProperties(domain: string, sites: GscSite[]): string[] {
  const d = bare(domain.trim())
  const usable = sites.filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
  const dom = usable.find((s) => s.siteUrl.toLowerCase().startsWith('sc-domain:') && bare(s.siteUrl.slice(10)) === d)
  if (dom) return [dom.siteUrl]
  return usable.filter((s) => {
    if (!/^https?:\/\//i.test(s.siteUrl)) return false
    try { return bare(new URL(s.siteUrl).hostname) === d } catch { return false }
  }).map((s) => s.siteUrl)
}

async function query(f: typeof fetch, token: string, property: string, body: unknown) {
  const res = await f(`${SITES_URL}/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw upstream(res, 'query')
  const j = (await readJson(res)) as {
    rows?: { keys: string[]; clicks?: number; impressions?: number; position?: number }[]
  }
  return j.rows ?? []
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function latestDataDate(
  f: typeof fetch, token: string, property: string, today: Date,
): Promise<string | null> {
  const day = 86_400_000
  const rows = await query(f, token, property, {
    startDate: ymd(new Date(today.getTime() - 7 * day)),
    endDate: ymd(new Date(today.getTime() - day)),
    dimensions: ['date'],
  })
  let max: string | null = null
  for (const r of rows) if (r.keys?.[0] && (max === null || r.keys[0] > max)) max = r.keys[0]
  return max
}

const ROW_LIMIT = 25000

export async function queryRows(
  f: typeof fetch, token: string, property: string, start: string, end: string,
): Promise<{ rows: GscRow[]; truncated: boolean }> {
  const raw = await query(f, token, property, {
    startDate: start, endDate: end, dimensions: ['query', 'country'], rowLimit: ROW_LIMIT, startRow: 0,
  })
  return {
    rows: raw.map((r) => ({
      query: r.keys[0],
      country: alpha3ToAlpha2(r.keys[1]),
      position: Math.round((r.position ?? 0) * 10) / 10,
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
    })),
    truncated: raw.length === ROW_LIMIT,
  }
}

export function mergeRows(parts: GscRow[][]): GscRow[] {
  const acc = new Map<string, { query: string; country: string; clicks: number; impressions: number; weighted: number; plain: number; n: number }>()
  for (const row of parts.flat()) {
    const key = `${row.country}\u0000${row.query}`
    const a = acc.get(key) ?? { query: row.query, country: row.country, clicks: 0, impressions: 0, weighted: 0, plain: 0, n: 0 }
    a.clicks += row.clicks
    a.impressions += row.impressions
    a.weighted += row.position * row.impressions
    a.plain += row.position
    a.n += 1
    acc.set(key, a)
  }
  return [...acc.values()].map((a) => ({
    query: a.query,
    country: a.country,
    position: Math.round((a.impressions > 0 ? a.weighted / a.impressions : a.plain / a.n) * 10) / 10,
    clicks: a.clicks,
    impressions: a.impressions,
  }))
}
