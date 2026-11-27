import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  GscReconnectError, GscUpstreamError, latestDataDate, matchProperties, mergeRows, queryRows,
  type GscRow,
} from './_lib/gsc.js'
import { DOMAIN_TO_BRAND } from './_lib/brands.js'
import { readCache, writeCache } from './_lib/gscStore.js'
import {
  GSC_CONFIG, KEYWORDS_TTL_MS, NOT_CONNECTED_BODY, RECONNECT_BODY, cachedSites, gate, googleAccess,
  guardMethod, withRetry,
} from './_lib/gscHandler.js'

export const config = GSC_CONFIG

const DAY = 86_400_000
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

type Payload = {
  ok: true
  property: string | null
  startDate?: string
  dataUpTo?: string | null
  truncated?: boolean
  rows?: GscRow[]
}

/** One site's Google queries for the last 7, 28 or 90 days, cached for 6 hours. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guardMethod(req, res, 'GET')) return
  const g = await gate(req, res)
  if (!g) return

  const domain = String(first(req.query?.domain) ?? '').trim().toLowerCase()
  const days = Number(first(req.query?.days))
  if (!Object.prototype.hasOwnProperty.call(DOMAIN_TO_BRAND, domain)) {
    return res.status(400).json({ ok: false, error: 'Unknown domain' })
  }
  if (![7, 28, 90].includes(days)) {
    return res.status(400).json({ ok: false, error: 'days must be 7, 28 or 90' })
  }

  try {
    const now = new Date()
    const hit = await readCache<Payload>(g.db, domain, days, KEYWORDS_TTL_MS, now)
    if (hit) return res.status(200).json(hit)

    const payload = await withRetry(async (): Promise<Payload | 'not_connected' | 'broken'> => {
      const a = await googleAccess(g.db)
      if (a.kind === 'not_connected') return 'not_connected'
      if (a.kind === 'broken') return 'broken'
      const properties = matchProperties(domain, await cachedSites(g.db, a.token, now))
      if (properties.length === 0) return { ok: true, property: null }
      const dataUpTo = await latestDataDate(fetch, a.token, properties[0], now)
      const property = properties.join(' + ')
      if (!dataUpTo) {
        return { ok: true, property, startDate: '', dataUpTo: null, truncated: false, rows: [] }
      }
      const startDate = new Date(Date.parse(dataUpTo) - (days - 1) * DAY).toISOString().slice(0, 10)
      const parts = await Promise.all(properties.map((p) => queryRows(fetch, a.token, p, startDate, dataUpTo)))
      return {
        ok: true,
        property,
        startDate,
        dataUpTo,
        truncated: parts.some((p) => p.truncated),
        rows: parts.length === 1 ? parts[0].rows : mergeRows(parts.map((p) => p.rows)),
      }
    })

    if (payload === 'not_connected') return res.status(409).json(NOT_CONNECTED_BODY)
    if (payload === 'broken') return res.status(409).json(RECONNECT_BODY)
    await writeCache(g.db, domain, days, payload, now)
    return res.status(200).json(payload)
  } catch (err) {
    // googleAccess has already marked the connection broken for a refresh invalid_grant.
    if (err instanceof GscReconnectError) return res.status(409).json(RECONNECT_BODY)
    if (err instanceof GscUpstreamError) {
      return res.status(502).json({ ok: false, error: 'Google Search Console did not answer. Try again in a minute.' })
    }
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
