import { randomBytes } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { consentUrl, gscConfig, signState } from './_lib/gsc.js'
import { GSC_CONFIG, gate, guardMethod, requireEnv } from './_lib/gscHandler.js'

export const config = GSC_CONFIG

const STATE_TTL_MS = 10 * 60 * 1000

/** Admin only. Answers the Google consent URL and sets the nonce cookie the callback checks. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guardMethod(req, res, 'POST')) return
  const g = await gate(req, res, { admin: true })
  if (!g) return
  try {
    const cfg = gscConfig(process.env)
    const secret = requireEnv('GSC_STATE_SECRET')
    const nonce = randomBytes(16).toString('hex')
    const state = signState(secret, { userId: g.user.id, nonce, exp: Date.now() + STATE_TTL_MS })
    const secure = process.env.APP_URL?.trim().startsWith('http://localhost') ? '' : '; Secure'
    res.setHeader('Set-Cookie', `gsc_nonce=${nonce}; HttpOnly${secure}; SameSite=Lax; Path=/api/gsc-callback; Max-Age=600`)
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ ok: true, url: consentUrl(cfg, state) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
