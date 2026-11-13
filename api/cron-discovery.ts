import type { VercelRequest, VercelResponse } from '@vercel/node'
import { bearerToken } from './_lib/requestAuth.js'
import { formatDisplayDate } from './_lib/displayDate.js'
import { isAbortLike } from './_lib/ahrefs.js'
import { BRANDS, DOMAIN_TO_BRAND } from './_lib/brands.js'
import { createAdminClient, logCronActivity, type AdminClient } from './_lib/snapshotStore.js'
import {
  DiscoveryError, discoveryConfig, fetchKeyLimits, fetchOrganicKeywords, sharesSyncKey, type DiscoveryConfig,
} from './_lib/ahrefsDiscovery.js'
import {
  WORST_CASE_CALL_UNITS, cycleStart, discoveryPairs, excludeKeywordsWhere, mapOrganicKeywords, pairKey, trackedIndex,
  trackedKey, type DiscoveryRow,
} from './_lib/keywordDiscovery.js'
import {
  acquireRunLock, cycleTotals, haltDiscovery, loadFetchedPairs, loadTrackedRecords, releaseRunLock, saveFetch,
} from './_lib/discoveryStore.js'

/**
 * Cron, three times a day: pulls one Ahrefs billing month ("cycle") of other
 * ranking keywords — the keywords Ahrefs sees each BP site ranking for in AU,
 * CA, DE, IT and NZ, minus the ones already tracked — into Supabase for the BP
 * Sites brand pages.
 *
 * A cycle is 185 calls (37 domains × 5 countries) and Ahrefs allows 60 a
 * minute, so one run cannot finish it: each run fetches whatever pairs the
 * cycle still lacks, saving each as it goes, until its time budget runs low.
 * Once every pair is in, runs return at once without calling Site Explorer and
 * without a /log line, until the next cycle starts.
 *
 * These calls SPEND Ahrefs API units, so they use their own capped key
 * (AHREFS_DISCOVERY_API_KEY), stop before the key's monthly limit, hold a run
 * lease so overlapping runs never buy the same pairs, and halt — no more paid
 * calls until a person clears it — when Ahrefs' pricing or response shape
 * changes. Design: docs/superpowers/specs/2026-11-13-other-ranking-keywords-design.md
 */

/** Hobby caps functions at 60 s. */
export const config = { maxDuration: 60 }

/**
 * budgetMs covers every upstream call and save in a run. No call starts with
 * less than minStartMs of it left, and minStartMs covers a call's worst case —
 * a timeout, a capped Retry-After wait and a second timeout — so a started
 * call always finishes inside the budget. That leaves about 15 s of the 60 s
 * cap for the /log write and the lease release. gapMs keeps call starts within
 * Ahrefs' 60 requests a minute. Mutable so tests can shrink it.
 */
export const timing = { budgetMs: 45_000, minStartMs: 21_000, gapMs: 1_000, requestTimeoutMs: 8_000, maxRetryAfterMs: 5_000 }

const SECTION = 'bp-sites'

type Outcome = { status: number; body: Record<string, unknown> }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 'A', 'A and B', 'A, B and C'. */
function listOf(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The /log line of a run that did work. */
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

  let admin: AdminClient
  try {
    admin = createAdminClient(process.env)
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }

  // Everything, including the lease release, happens before the response:
  // a function may be frozen as soon as it has answered.
  const outcome = await guardedRun(admin)
  return res.status(outcome.status).json(outcome.body)
}

async function logged(admin: AdminClient, status: number, summary: string, body: Record<string, unknown>): Promise<Outcome> {
  await logCronActivity(admin, SECTION, summary)
  return { status, body }
}

/** Key checks, the run lease and the halt check around one pull. */
async function guardedRun(admin: AdminClient): Promise<Outcome> {
  const refuse = (summary: string) => logged(admin, 500, summary, { ok: false, error: summary })

  const ahrefs = discoveryConfig(process.env)
  if (!ahrefs) return refuse('Keyword discovery failed: AHREFS_DISCOVERY_API_KEY is not configured on the server')
  if (sharesSyncKey(process.env)) {
    return refuse(
      'Keyword discovery failed: AHREFS_DISCOVERY_API_KEY is the same key as AHREFS_API_KEY — the rankings key must never spend units')
  }

  let lock: Awaited<ReturnType<typeof acquireRunLock>>
  try {
    lock = await acquireRunLock(admin)
  } catch (err) {
    const summary = `Keyword discovery failed: ${(err as Error).message}`
    return logged(admin, 502, summary, { ok: false, error: summary })
  }
  // Another run is working (a duplicate delivery, a manual trigger): it logs.
  if (!lock.acquired) return { status: 200, body: { ok: true, outcome: 'busy' } }

  try {
    if (lock.haltedReason) {
      return await refuse(
        `Keyword discovery halted: ${lock.haltedReason} — clear halted_reason in keyword_discovery_state to resume`)
    }
    return await pull(admin, ahrefs)
  } finally {
    // Best effort: an unreleased lease simply runs out.
    await releaseRunLock(admin).catch(() => {})
  }
}

async function pull(admin: AdminClient, ahrefs: DiscoveryConfig): Promise<Outcome> {
  const started = Date.now()
  const deadline = AbortSignal.timeout(timing.budgetMs)
  const callOptions = {
    signal:           deadline,
    requestTimeoutMs: timing.requestTimeoutMs,
    maxRetryAfterMs:  timing.maxRetryAfterMs,
  }
  // Paid calls started and units known to be charged, for every /log line.
  let calls = 0
  let units = 0

  try {
    const limits = await fetchKeyLimits(ahrefs, callOptions)
    if (limits.limit === null) {
      const summary = 'Keyword discovery stopped: the discovery key has no unit limit — set a monthly limit on it in Ahrefs'
      return await logged(admin, 500, summary, { ok: false, error: summary })
    }

    const cycle = cycleStart(limits.resetDate)
    const all = discoveryPairs(BRANDS)
    const fetched = await loadFetchedPairs(admin, cycle)
    const missing = all.filter((p) => !fetched.has(pairKey(p.domain, p.country)))
    if (missing.length === 0) return { status: 200, body: { ok: true, outcome: 'idle' } }

    let unitsLeft = limits.limit - limits.usage
    if (unitsLeft < WORST_CASE_CALL_UNITS) {
      const summary = `Keyword discovery stopped: the discovery key has ${unitsLeft.toLocaleString('en-US')} units left this month`
      return await logged(admin, 200, summary, { ok: true, outcome: 'capped', summary })
    }

    const tracked = trackedIndex(await loadTrackedRecords(admin), DOMAIN_TO_BRAND)
    const today = new Date().toISOString().slice(0, 10)
    let saved = 0
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

      calls += 1
      const response = await fetchOrganicKeywords(ahrefs, {
        domain:       pair.domain,
        country:      pair.country,
        date:         today,
        excludeWhere: excludeKeywordsWhere(tracked.get(trackedKey(pair.brand, pair.country)) ?? []),
      }, callOptions)
      units += response.unitsActual
      unitsLeft -= response.unitsActual

      let rows: DiscoveryRow[]
      try {
        rows = mapOrganicKeywords(response.body, { cycle, brand: pair.brand, domain: pair.domain, country: pair.country })
      } catch (err) {
        // The answer no longer reads as organic keywords: every run would buy
        // and fail on this same pair, so stop paid calls until a person looks.
        throw new DiscoveryError((err as Error).message, { halt: true })
      }
      await saveFetch(admin, { cycle, domain: pair.domain, country: pair.country, rows, units: response.unitsActual })
      saved += 1
    }

    // Pairs are saved in order, so the first `saved` of `missing` are done.
    const left = missing.length - saved
    const stillMissing = new Set(missing.slice(saved).map((p) => p.brand))
    const completedBrands = [...new Set(missing.map((p) => p.brand))].filter((brand) => !stillMissing.has(brand))
    const cycleUnits = left === 0 ? (await cycleTotals(admin, cycle)).units : undefined

    const summary = runSummary({ cycle, calls, units, completedBrands, left, total: all.length, cycleUnits, unitsLeftAtStop })
    return await logged(admin, 200, summary, {
      ok: true, outcome: left === 0 ? 'complete' : 'progress', calls, units, left, summary,
    })
  } catch (err) {
    if (err instanceof DiscoveryError && err.unitsCharged) units += err.unitsCharged
    // Both halves matter: the deadline keeps ticking through the saves, so
    // `deadline.aborted` alone would relabel an unrelated failure.
    const timedOut = isAbortLike(err) && deadline.aborted
    const message = timedOut
      ? `the run exceeded its ${timing.budgetMs / 1000}s budget — Ahrefs did not finish responding in time`
      : (err as Error).message
    const spent = calls > 0 ? ` (after ${calls} call${calls === 1 ? '' : 's'}, ${units.toLocaleString('en-US')} units)` : ''

    let summary: string
    if (err instanceof DiscoveryError && err.halt) {
      let note = ''
      try {
        await haltDiscovery(admin, message)
      } catch {
        note = ' (the halt could not be saved, so the next run may try again)'
      }
      summary = `Keyword discovery halted: ${message}${spent} — no more calls until halted_reason is cleared in keyword_discovery_state${note}`
    } else {
      summary = `Keyword discovery failed: ${message}${spent}`
    }
    // Non-2xx so Vercel's own cron log agrees with /log.
    return logged(admin, 502, summary, { ok: false, error: summary })
  }
}
