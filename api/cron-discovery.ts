import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bearerToken } from './_lib/requestAuth.js'
import { formatDisplayDate } from './_lib/displayDate.js'
import { isAbortLike } from './_lib/ahrefs.js'
import { BRANDS, DOMAIN_TO_BRAND } from './_lib/brands.js'
import { createAdminClient, logCronActivity } from './_lib/snapshotStore.js'
import { discoveryConfig, fetchKeyLimits, fetchOrganicKeywords, sharesSyncKey } from './_lib/ahrefsDiscovery.js'
import {
  WORST_CASE_CALL_UNITS, cycleStart, discoveryPairs, excludeKeywordsWhere, mapOrganicKeywords, pairKey, trackedIndex,
  trackedKey,
} from './_lib/keywordDiscovery.js'
import { cycleTotals, loadFetchedPairs, loadTrackedRecords, saveFetch } from './_lib/discoveryStore.js'

/**
 * Daily cron: pulls one Ahrefs billing month ("cycle") of other ranking
 * keywords — the keywords Ahrefs sees each BP site ranking for in AU, CA, DE,
 * IT and NZ, minus the ones already tracked — into Supabase for the BP Sites
 * brand pages.
 *
 * A cycle is 185 calls (37 domains × 5 countries) and Ahrefs allows 60 a
 * minute, so one run cannot finish it: each run fetches whatever pairs the
 * cycle still lacks, saving each as it goes, until its time budget runs low.
 * Once every pair is in, runs return at once without calling Site Explorer and
 * without a /log line, until the next cycle starts.
 *
 * These calls SPEND Ahrefs API units, so they use their own capped key
 * (AHREFS_DISCOVERY_API_KEY) and stop before the key's monthly limit.
 * Design: docs/superpowers/specs/2026-11-13-other-ranking-keywords-design.md
 */

/** Hobby caps functions at 60 s. */
export const config = { maxDuration: 60 }

/**
 * budgetMs covers every upstream call and save in a run; no call starts with
 * less than minStartMs of it left, so a started call (requestTimeoutMs, plus
 * at most one retry) normally ends inside it, and the remaining ~20 s of the
 * 60 s cap cover the /log write. gapMs keeps call starts within Ahrefs' 60
 * requests a minute. Mutable so tests can shrink it.
 */
export const timing = { budgetMs: 40_000, minStartMs: 10_000, gapMs: 1_000, requestTimeoutMs: 8_000 }

const SECTION = 'bp-sites'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 'A', 'A and B', 'A, B and C'. */
function listOf(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The run's one /log line. */
export function runSummary(r: {
  cycle: string
  calls: number
  units: number
  completedBrands: string[]
  left: number
  total: number
  cycleUnits?: number
  unitsLeftAtStop?: number
}): string {
  const from = formatDisplayDate(r.cycle)
  if (r.left === 0 && r.cycleUnits !== undefined) {
    return `Keyword discovery — cycle from ${from} complete (${r.total}/${r.total}), ${r.cycleUnits.toLocaleString('en-US')} units in total`
  }
  let summary = `Keyword discovery — ${r.calls} call${r.calls === 1 ? '' : 's'}, ${r.units.toLocaleString('en-US')} units`
  if (r.completedBrands.length > 0) summary += `; ${listOf(r.completedBrands)} complete`
  summary += ` for the cycle from ${from}; ${r.left} call${r.left === 1 ? '' : 's'} left`
  if (r.unitsLeftAtStop !== undefined) {
    summary += `; stopped: the discovery key has ${r.unitsLeftAtStop.toLocaleString('en-US')} units left this month`
  }
  return summary
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  // Fails closed: with CRON_SECRET unset no caller can match it.
  const secret = process.env.CRON_SECRET
  const token = bearerToken(req.headers?.authorization)
  if (!secret || token !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient(process.env)
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }

  const refuse = async (status: number, summary: string) => {
    await logCronActivity(admin, SECTION, summary)
    return res.status(status).json({ ok: false, error: summary })
  }

  const ahrefs = discoveryConfig(process.env)
  if (!ahrefs) return refuse(500, 'Keyword discovery failed: AHREFS_DISCOVERY_API_KEY is not configured on the server')
  if (sharesSyncKey(process.env)) {
    return refuse(500,
      'Keyword discovery failed: AHREFS_DISCOVERY_API_KEY is the same key as AHREFS_API_KEY — the rankings key must never spend units')
  }

  const started = Date.now()
  const deadline = AbortSignal.timeout(timing.budgetMs)
  const callOptions = { signal: deadline, requestTimeoutMs: timing.requestTimeoutMs }

  try {
    const limits = await fetchKeyLimits(ahrefs, callOptions)
    if (limits.limit === null) {
      return refuse(500, 'Keyword discovery stopped: the discovery key has no unit limit — set a monthly limit on it in Ahrefs')
    }

    const cycle = cycleStart(limits.resetDate)
    const all = discoveryPairs(BRANDS)
    const fetched = await loadFetchedPairs(admin, cycle)
    const missing = all.filter((p) => !fetched.has(pairKey(p.domain, p.country)))
    if (missing.length === 0) return res.status(200).json({ ok: true, outcome: 'idle' })

    let unitsLeft = limits.limit - limits.usage
    if (unitsLeft < WORST_CASE_CALL_UNITS) {
      const summary = `Keyword discovery stopped: the discovery key has ${unitsLeft.toLocaleString('en-US')} units left this month`
      await logCronActivity(admin, SECTION, summary)
      return res.status(200).json({ ok: true, outcome: 'capped', summary })
    }

    const tracked = trackedIndex(await loadTrackedRecords(admin), DOMAIN_TO_BRAND)
    const today = new Date().toISOString().slice(0, 10)
    let calls = 0
    let units = 0
    let lastStart = 0
    let unitsLeftAtStop: number | undefined

    for (const pair of missing) {
      if (timing.budgetMs - (Date.now() - started) < timing.minStartMs) break
      if (unitsLeft < WORST_CASE_CALL_UNITS) {
        unitsLeftAtStop = unitsLeft
        break
      }
      const wait = lastStart + timing.gapMs - Date.now()
      if (calls > 0 && wait > 0) await sleep(wait)
      lastStart = Date.now()

      const response = await fetchOrganicKeywords(ahrefs, {
        domain:       pair.domain,
        country:      pair.country,
        date:         today,
        excludeWhere: excludeKeywordsWhere(tracked.get(trackedKey(pair.brand, pair.country)) ?? []),
      }, callOptions)
      const rows = mapOrganicKeywords(response.body, { cycle, brand: pair.brand, domain: pair.domain, country: pair.country })
      await saveFetch(admin, { cycle, domain: pair.domain, country: pair.country, rows, units: response.unitsActual })

      calls += 1
      units += response.unitsActual
      unitsLeft -= response.unitsActual
    }

    // Pairs are fetched in order, so the first `calls` of `missing` are done.
    const left = missing.length - calls
    const stillMissing = new Set(missing.slice(calls).map((p) => p.brand))
    const completedBrands = [...new Set(missing.map((p) => p.brand))].filter((brand) => !stillMissing.has(brand))
    const cycleUnits = left === 0 ? (await cycleTotals(admin, cycle)).units : undefined

    const summary = runSummary({ cycle, calls, units, completedBrands, left, total: all.length, cycleUnits, unitsLeftAtStop })
    await logCronActivity(admin, SECTION, summary)
    return res.status(200).json({ ok: true, outcome: left === 0 ? 'complete' : 'progress', calls, units, left, summary })
  } catch (err) {
    // Both halves matter: the deadline keeps ticking through the saves, so
    // `deadline.aborted` alone would relabel an unrelated failure.
    const timedOut = isAbortLike(err) && deadline.aborted
    const message = timedOut
      ? `the run exceeded its ${timing.budgetMs / 1000}s budget — Ahrefs did not finish responding in time`
      : (err as Error).message
    const summary = `Keyword discovery failed: ${message}`
    await logCronActivity(admin, SECTION, summary)
    // Non-2xx so Vercel's own cron log agrees with /log.
    return res.status(502).json({ ok: false, error: summary })
  }
}
