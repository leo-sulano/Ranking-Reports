import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bearerToken } from './_lib/requestAuth.js'
import { ALLOWED_ACTIONS, MAX_LIMIT, buildRanksUrl, fetchRanksPage } from './_lib/ranks.js'
import { fetchAllRows, PAGE_SIZE } from './_lib/ranksPaging.js'
import { normalizeRows, type ApiRow } from './_lib/sitesNormalize.js'
import {
  createAdminClient, decideWrite, findSnapshot, logCronActivity, writeSnapshot,
} from './_lib/snapshotStore.js'

/** Hobby caps functions at 60s. A run is ~10-15s, so the headroom is real. */
export const config = { maxDuration: 60 }
const TIMEOUT_MS = 45_000

const CATEGORY = 'bp-sites'
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Response.json() resolves to Promise<unknown> (undici-types, in effect here
// because the api tsconfig has no DOM lib). Left as bare unknown, TS narrows
// `body?.ok` to `{}` after the non-nullish check and every property access
// below fails to compile — an explicit shape sidesteps that narrowing quirk.
interface RanksApiResponse {
  ok?:    boolean
  error?: string
  data?:  unknown
}

/** '2026-08-04' → '4 Aug 26'. Mirrors formatDisplayDate in src/lib/parser.ts. */
function formatDisplayDate(rawDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate)
  if (!m) return rawDate
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1].slice(2)}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    // Optional chaining: the test double for VercelResponse stubs only
    // status/json (it exists to exercise the auth gate, not header plumbing),
    // so this stays a no-op there while still setting the header for real.
    res.setHeader?.('Allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  // Fails closed: with CRON_SECRET unset there is no value a caller could send
  // that matches, so a half-configured deployment is inert rather than an open
  // endpoint that writes to the database.
  const secret = process.env.CRON_SECRET
  const token  = bearerToken(req.headers?.authorization)
  if (!secret || token !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  const key = process.env.SITES_API_KEY
  if (!key) {
    return res.status(500).json({ ok: false, error: 'SITES_API_KEY is not configured on the server' })
  }

  let admin
  try {
    admin = createAdminClient(process.env)
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }

  try {
    const action = 'results'
    if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Unsupported action "${action}"`)

    const rows = await fetchAllRows(async (offset) => {
      const url = buildRanksUrl(action, Math.min(PAGE_SIZE, MAX_LIMIT), offset)
      const upstream = await fetchRanksPage(key, url, TIMEOUT_MS)
      const body = (await upstream.json().catch(() => null)) as RanksApiResponse | null
      if (!upstream.ok || body?.ok === false) {
        throw new Error(body?.error ?? `the Ranks API returned HTTP ${upstream.status}`)
      }
      if (!Array.isArray(body?.data)) {
        throw new Error('the Ranks API returned an unexpected payload (no data array)')
      }
      return body.data as ApiRow[]
    })

    const { records, unknownDomains, rawDate } = normalizeRows(rows)

    if (records.length === 0) {
      const summary = `Scheduled sync — 0 Rooster rows after filtering; nothing written (${unknownDomains.length} foreign domains)`
      await logCronActivity(admin, CATEGORY, summary)
      return res.status(200).json({ ok: true, outcome: 'empty', summary })
    }

    const id       = `snap-${CATEGORY}-${rawDate}`
    const display  = formatDisplayDate(rawDate)
    const existing = await findSnapshot(admin, CATEGORY, rawDate)
    const decision = decideWrite(existing)

    if (decision === 'skip') {
      const summary = `Scheduled sync — skipped ${display}: that snapshot was uploaded or edited by a person`
      await logCronActivity(admin, CATEGORY, summary)
      return res.status(200).json({ ok: true, outcome: 'skipped', summary })
    }

    await writeSnapshot(admin, {
      id: existing?.id ?? id,
      category: CATEGORY,
      rawDate,
      displayDate: display,
      records,
    })

    const summary =
      decision === 'replace'
        ? `Scheduled sync — replaced ${display} (${records.length.toLocaleString()} records)`
        : `Scheduled sync — ${records.length.toLocaleString()} records (${display})`
    await logCronActivity(admin, CATEGORY, summary)
    return res.status(200).json({ ok: true, outcome: decision, summary, records: records.length })
  } catch (err) {
    const message = (err as Error).message
    const summary = `Scheduled sync failed: ${message}`
    await logCronActivity(admin, CATEGORY, summary)
    // Non-2xx so Vercel's own cron log agrees with the activity log rather than
    // reporting a clean run.
    return res.status(502).json({ ok: false, error: summary })
  }
}
