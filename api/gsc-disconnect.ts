import type { VercelRequest, VercelResponse } from '@vercel/node'
import { decryptToken, revokeToken } from './_lib/gsc.js'
import { clearCache, deleteConnection, loadConnection } from './_lib/gscStore.js'
import { gate, guardMethod } from './_lib/gscHandler.js'

export const config = { maxDuration: 60 }

/** Admin only. Revokes the token at Google (best effort), then forgets the connection and the cache. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guardMethod(req, res, 'POST')) return
  const g = await gate(req, res, { admin: true })
  if (!g) return
  try {
    const conn = await loadConnection(g.db)
    if (conn) {
      try {
        const key = process.env.GSC_TOKEN_KEY?.trim()
        if (key) await revokeToken(fetch, decryptToken(key, conn.refreshTokenEnc))
      } catch { /* best effort: an undecryptable token is deleted all the same */ }
    }
    await deleteConnection(g.db)
    await clearCache(g.db)
    return res.status(200).json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
