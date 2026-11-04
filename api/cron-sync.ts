import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bearerToken } from './_lib/requestAuth.js'
import { formatDisplayDate } from './_lib/displayDate.js'
import { fetchBpExports, openSeoConfig } from './_lib/openseo.js'
import { countOlderChecks, normalizeExports } from './_lib/sitesNormalize.js'
import {
  createAdminClient, decideWrite, findSnapshot, logCronActivity, writeSnapshot,
} from './_lib/snapshotStore.js'

/** Hobby caps functions at 60s. A run takes a few seconds, so the headroom is real. */
export const config = { maxDuration: 60 }

/**
 * One budget for ALL upstream requests combined, started at handler entry.
 *
 * A per-request timeout cannot protect this handler: the domain list plus
 * dozens of exports, each granted its own ceiling, can outlast maxDuration
 * between them, and a platform kill runs neither the catch below nor
 * logCronActivity — so the run would leave no activity_log row at all, which
 * is the one thing /log is supposed to guarantee about the cron. 35s of
 * fetching leaves ~25s for the four writes, which take ~2s, so the deadline
 * always fires before Vercel does.
 */
const FETCH_BUDGET_MS = 35_000

/** Per-request ceiling, so one wedged export cannot silently eat the whole budget. */
const REQUEST_TIMEOUT_MS = 20_000

const CATEGORY = 'bp-sites'

/** True for the error a fired deadline rejects fetch with (a real timeout signal says TimeoutError). */
function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
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

  const openseo = openSeoConfig(process.env)
  if (!openseo) {
    // Every run is supposed to leave exactly one activity_log row, /log being
    // the cron's only history — so a misconfigured deployment must not fail
    // silently twice a week.
    const summary = 'Scheduled sync failed: OPENSEO_RANKINGS_API_KEY is not configured on the server'
    await logCronActivity(admin, CATEGORY, summary)
    return res.status(500).json({ ok: false, error: summary })
  }

  // Started once, here, and shared by every request below — see FETCH_BUDGET_MS.
  const deadline = AbortSignal.timeout(FETCH_BUDGET_MS)

  try {
    const exports = await fetchBpExports(openseo, { signal: deadline, requestTimeoutMs: REQUEST_TIMEOUT_MS })
    // Every record carries its run date, so a non-empty batch always has a
    // rawDate — the undated guard the Ranks API needed has nothing to catch.
    const { records, rawDate } = normalizeExports(exports)

    if (records.length === 0) {
      const summary = 'Scheduled sync — OpenSEO has no BP rankings; nothing written'
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

    // A partial OpenSEO run leaves some keywords on an older check. Say so, so
    // the snapshot cannot pass for a full fresh week in /log.
    const older = countOlderChecks(records, rawDate)
    const note  = older > 0 ? `; ${older.toLocaleString()} kept an earlier check` : ''
    const summary =
      decision === 'replace'
        ? `Scheduled sync — replaced ${display} (${records.length.toLocaleString()} records)${note}`
        : `Scheduled sync — ${records.length.toLocaleString()} records (${display})${note}`
    await logCronActivity(admin, CATEGORY, summary)
    return res.status(200).json({ ok: true, outcome: decision, summary, records: records.length })
  } catch (err) {
    // A budget abort arrives as a bare "This operation was aborted" (or "…due
    // to timeout"), which in /log would read as an unexplained failure. Name
    // the real cause.
    //
    // Both halves of this condition are load-bearing. The deadline keeps
    // ticking through the write phase, so `deadline.aborted` alone would relabel
    // an unrelated write failure that happened to land after the budget expired
    // — burying the real error in the cron's only history. Requiring the error
    // to actually BE an abort keeps the two apart.
    const timedOut = isAbortLike(err) && deadline.aborted
    const message = timedOut
      ? `the run exceeded its ${FETCH_BUDGET_MS / 1000}s fetch budget — OpenSEO did not finish responding in time`
      : (err as Error).message
    const summary = `Scheduled sync failed: ${message}`
    await logCronActivity(admin, CATEGORY, summary)
    // Non-2xx so Vercel's own cron log agrees with the activity log rather than
    // reporting a clean run.
    return res.status(502).json({ ok: false, error: summary })
  }
}
