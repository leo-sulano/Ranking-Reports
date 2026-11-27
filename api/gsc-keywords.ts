import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  GscReconnectError, ROW_LIMIT, capMerged, latestDataDate, matchProperties, mergeRows, queryRows,
  type GscRow,
} from './_lib/gsc.js'
import { DOMAIN_TO_BRAND } from './_lib/brands.js'
import { readCache, writeCache } from './_lib/gscStore.js'
import {
  KEYWORDS_TTL_MS, NOT_CONNECTED_BODY, RECONNECT_BODY, cachedSites, gate, gscFailure, googleAccess,
  guardMethod, markIfRejected, withRetry,
} from './_lib/gscHandler.js'

// 60 s so the timeout budget in api/_lib/gsc.ts (TIMEOUT: 5+5+4+12 s an attempt, one retry = 52 s) can run;
// Vercel's default is 10-15 s. Written as a literal because Vercel does not see a re-exported constant.
export const config = { maxDuration: 60 }

const DAY = 86_400_000
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

type Payload = {
  ok: true
  property: string | null
  startDate?: string | null
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
      const property = properties.join(' + ')
      // The 7-day check finds Google's latest data day. A site with nothing in the last week (an alias
      // domain, say) may still have data in the chosen period, so then try the day Google normally has.
      const dataUpTo = (await latestDataDate(fetch, a.token, properties[0], now)) ?? ymd(now.getTime() - 3 * DAY)
      const startDate = ymd(Date.parse(dataUpTo) - (days - 1) * DAY)
      const parts = await Promise.all(properties.map((p) => queryRows(fetch, a.token, p, startDate, dataUpTo)))
      if (parts.every((p) => p.rows.length === 0)) {
        return { ok: true, property, startDate: null, dataUpTo: null, truncated: false, rows: [] }
      }
      const capped = parts.length === 1 ? { rows: parts[0].rows, cut: false } : capMerged(mergeRows(parts.map((p) => p.rows)))
      return {
        ok: true,
        property,
        startDate,
        dataUpTo,
        truncated: capped.cut || parts.some((p) => p.truncated || p.rows.length === ROW_LIMIT),
        rows: capped.rows,
      }
    })

    if (payload === 'not_connected') return res.status(409).json(NOT_CONNECTED_BODY)
    if (payload === 'broken') return res.status(409).json(RECONNECT_BODY)
    // A site that is not in the connected account is not cached: the site list is only cached for an
    // hour, and the answer must follow it. A failed cache write must not turn a good answer into a 500.
    if (payload.property !== null) {
      try {
        await writeCache(g.db, domain, days, payload, now)
      } catch (err) {
        console.error('[gsc-keywords] cache write failed:', (err as Error).message)
      }
    }
    return res.status(200).json(payload)
  } catch (err) {
    // googleAccess has already marked the connection broken for a refresh invalid_grant; a Search
    // Console 401 is marked here.
    if (err instanceof GscReconnectError) {
      await markIfRejected(g.db, err)
      return res.status(409).json(RECONNECT_BODY)
    }
    const failure = gscFailure(err)
    if (failure) return res.status(failure.status).json({ ok: false, error: failure.error })
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
