import type { VercelRequest, VercelResponse } from '@vercel/node'
import { GscReconnectError, matchProperties } from './_lib/gsc.js'
import { BRAND_BY_NAME, DOMAIN_TO_BRAND, brandCountries, isReported } from './_lib/brands.js'
import { loadConnection } from './_lib/gscStore.js'
import {
  GSC_CONFIG, cachedSites, gate, gscFailure, googleAccess, guardMethod, markIfRejected, withRetry,
} from './_lib/gscHandler.js'

export const config = GSC_CONFIG

/** Whether Google is connected; for admins also who connected it and which brand sites have a property. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guardMethod(req, res, 'GET')) return
  const g = await gate(req, res)
  if (!g) return
  try {
    const conn = await loadConnection(g.db)
    if (!conn) return res.status(200).json({ ok: true, connected: false })
    const admin = await g.isAdmin()
    const body: Record<string, unknown> = { ok: true, connected: true, status: conn.status }
    if (admin) {
      body.googleEmail = conn.googleEmail
      body.connectedBy = conn.connectedBy
      body.connectedAt = conn.connectedAt
    }
    if (admin && conn.status === 'ok') {
      try {
        const now = new Date()
        const sites = await withRetry(async () => {
          const a = await googleAccess(g.db)
          if (a.kind !== 'ok') throw new GscReconnectError('Google connection is not usable.')
          return cachedSites(g.db, a.token, now)
        })
        body.coverage = Object.entries(DOMAIN_TO_BRAND)
          .filter(([domain, brand]) => brandCountries(BRAND_BY_NAME[brand]).some((c) => isReported(domain, c)))
          .map(([domain, brand]) => ({ domain, brand, properties: matchProperties(domain, sites) }))
      } catch (err) {
        // googleAccess has already marked the connection broken (a Search Console 401 is marked here):
        // report it as state.
        if (err instanceof GscReconnectError) {
          await markIfRejected(g.db, err)
          body.status = 'broken'
        } else {
          // Anything else Google-side: the connection state is still worth showing. Say why coverage
          // is missing, in plain words, instead of leaving the panel looking healthy.
          const failure = gscFailure(err)
          if (!failure) throw err
          body.coverageError = failure.error
        }
      }
    }
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(body)
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
