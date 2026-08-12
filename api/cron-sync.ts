import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bearerToken } from './_lib/requestAuth.js'
import { formatDisplayDate } from './_lib/displayDate.js'
import { ALLOWED_ACTIONS, MAX_LIMIT, buildRanksUrl, fetchRanksPage } from './_lib/ranks.js'
import { fetchAllRows, PAGE_SIZE } from './_lib/ranksPaging.js'
import { normalizeRows, type ApiRow } from './_lib/sitesNormalize.js'
import {
  createAdminClient, decideWrite, findSnapshot, logCronActivity, writeSnapshot,
} from './_lib/snapshotStore.js'

/** Hobby caps functions at 60s. A run is ~10-15s, so the headroom is real. */
export const config = { maxDuration: 60 }

/**
 * One budget for ALL upstream pages combined, started at handler entry.
 *
 * A per-page timeout cannot protect this handler: three-plus sequential pages
 * each granted their own ceiling can outlast maxDuration between them, and a
 * platform kill runs neither the catch below nor logCronActivity — so the run
 * would leave no activity_log row at all, which is the one thing /log is
 * supposed to guarantee about the cron. 35s of fetching leaves ~25s for the
 * four writes, which take ~2s, so the deadline always fires before Vercel does.
 */
const FETCH_BUDGET_MS = 35_000

/** Per-page ceiling, so one wedged page cannot silently eat the whole budget. */
const PAGE_TIMEOUT_MS = 20_000

const CATEGORY = 'bp-sites'

// Response.json() resolves to Promise<unknown> (undici-types, in effect here
// because the api tsconfig has no DOM lib). Left as bare unknown, TS narrows
// `body?.ok` to `{}` after the non-nullish check and every property access
// below fails to compile — an explicit shape sidesteps that narrowing quirk.
interface RanksApiResponse {
  ok?:    boolean
  error?: string
  data?:  unknown
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
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

  // Admin client first: every failure from here on has something to log
  // with. This one stays genuinely unlogged — without a client there is
  // nowhere to write the activity_log row.
  let admin
  try {
    admin = createAdminClient(process.env)
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }

  const key = process.env.SITES_API_KEY
  if (!key) {
    // Every run is supposed to leave exactly one activity_log row, /log being
    // the cron's only history — so a misconfigured deployment must not fail
    // silently twice a week.
    const summary = 'Scheduled sync failed: SITES_API_KEY is not configured on the server'
    await logCronActivity(admin, CATEGORY, summary)
    return res.status(500).json({ ok: false, error: summary })
  }

  // Started once, here, and shared by every page below — see FETCH_BUDGET_MS.
  const deadline = AbortSignal.timeout(FETCH_BUDGET_MS)

  try {
    const action = 'results'
    if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Unsupported action "${action}"`)

    const rows = await fetchAllRows(async (offset) => {
      const url = buildRanksUrl(action, Math.min(PAGE_SIZE, MAX_LIMIT), offset)
      const upstream = await fetchRanksPage(key, url, PAGE_TIMEOUT_MS, deadline)
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

    // normalizeRows returns '' when no kept row had a parseable checked_at,
    // while still returning the records. Writing that would mint an id of
    // `snap-bp-sites-` labelled 'Unknown Date', sorting below every real
    // snapshot — and because the next run recomputes the same '' and finds its
    // own source: 'sync' row, it would replace it rather than supersede it, so
    // the junk snapshot never self-corrects. The upload path already refuses an
    // empty rawDate (src/App.tsx); refuse it here for the same reason.
    if (!rawDate) {
      const summary = 'Scheduled sync — records carried no usable checked_at date; nothing written'
      await logCronActivity(admin, CATEGORY, summary)
      return res.status(200).json({ ok: true, outcome: 'undated', summary })
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
    // A budget abort arrives as undici's bare "This operation was aborted",
    // which in /log would read as an unexplained failure. Name the real cause.
    const message = deadline.aborted
      ? `the run exceeded its ${FETCH_BUDGET_MS / 1000}s fetch budget — the Ranks API did not finish responding in time`
      : (err as Error).message
    const summary = `Scheduled sync failed: ${message}`
    await logCronActivity(admin, CATEGORY, summary)
    // Non-2xx so Vercel's own cron log agrees with the activity log rather than
    // reporting a clean run.
    return res.status(502).json({ ok: false, error: summary })
  }
}
