import type { VercelRequest, VercelResponse } from '@vercel/node'
import { GscConfigError, GscScopeError, encryptToken, exchangeCode, gscConfig, revokeToken, verifyState } from './_lib/gsc.js'
import { clearCache, saveConnection } from './_lib/gscStore.js'
import { isAdminUser } from './_lib/requestAuth.js'
import { createAdminClient } from './_lib/snapshotStore.js'
import { guardMethod, requireEnv } from './_lib/gscHandler.js'

export const config = { maxDuration: 60 }

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/**
 * Google sends the browser here after consent. No bearer token: the browser
 * navigated. Trust comes from the signed state, the nonce cookie set at connect
 * time, and an admin check, in that order. Always redirects back to the app.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guardMethod(req, res, 'GET')) return
  const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, '')
  if (!appUrl) return res.status(500).json({ ok: false, error: 'APP_URL is not set. Add it to the Vercel environment variables.' })

  const done = (result: string) => {
    res.setHeader('Set-Cookie', 'gsc_nonce=; HttpOnly; SameSite=Lax; Path=/api/gsc-callback; Max-Age=0')
    res.setHeader('Cache-Control', 'no-store')
    return res.redirect(302, `${appUrl}/bp-sites?gsc=${result}`)
  }
  const fail = (reason: string) => done(`error&reason=${reason}`)

  if (first(req.query?.error)) return fail('denied')

  let cfg, secret, tokenKey, db
  try {
    cfg = gscConfig(process.env)
    secret = requireEnv('GSC_STATE_SECRET')
    tokenKey = requireEnv('GSC_TOKEN_KEY')
    db = createAdminClient(process.env)
  } catch {
    return fail('config')
  }

  const state = verifyState(secret, first(req.query?.state) ?? '', Date.now())
  if (!state) return fail('state')
  const nonce = cookieValue(req.headers?.cookie, 'gsc_nonce')
  if (!nonce || nonce !== state.nonce) return fail('nonce')
  if (!(await isAdminUser(db, state.userId))) return fail('admin')

  const code = first(req.query?.code)
  if (!code) return fail('google')
  try {
    const { refreshToken, email } = await exchangeCode(fetch, cfg, code)
    await saveConnection(db, {
      refreshTokenEnc: encryptToken(tokenKey, refreshToken),
      googleEmail: email,
      connectedBy: state.userId,
      connectedAt: new Date().toISOString(),
    })
    await clearCache(db)
  } catch (err) {
    if (err instanceof GscScopeError) {
      // Search Console was unticked on the consent screen. Nothing is stored; take back what Google issued.
      if (err.token) await revokeToken(fetch, err.token)
      return fail('scope')
    }
    // A malformed GSC_TOKEN_KEY (or a rejected OAuth client): configuration, and nothing was stored.
    if (err instanceof GscConfigError) {
      console.error('[gsc-callback] config error:', err.message)
      return fail('config')
    }
    // Only the reason code leaves here; the message carries no secret.
    console.error('[gsc-callback] connect failed:', (err as Error).message)
    return fail('google')
  }
  return done('connected')
}
