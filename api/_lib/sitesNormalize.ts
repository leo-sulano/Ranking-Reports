// SHIPS IN THE BROWSER BUNDLE — src/lib/sitesNormalize.ts re-exports from here,
// so being under api/ does not make this server code. No secrets, no
// process.env, no node: imports. (Server-only neighbours, where those are fine:
// ahrefs.ts, snapshotStore.ts, requestAuth.ts, ssoPortal.ts.)
//
// One implementation for both sync paths — the Sync button's proxy and the
// cron. Countries go through the xlsx parser's own normalizeCountry: carry-
// forward keys on a byte-compared country, so a second, subtly different
// normalizer here would break GSV/SV/AFF inheritance between synced and
// uploaded snapshots.
import { DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND, normalizeCountry } from './brands.js'

/**
 * Structurally identical to the app's RankingRecord. Declared here because
 * api/_lib must not import from src/. src/lib/sitesNormalize.ts carries a
 * compile-time guard that fails the build if the two shapes ever diverge.
 */
export interface SyncRecord {
  domain:              string
  keyword:             string
  country:             string
  position:            string
  previous:            string
  change:              string
  date:                string
  searchVolume?:       string
  affiliateUrl?:       string
  globalSearchVolume?: string
}

/** Structurally identical to the app's UnknownDomain, for the same reason. */
export interface SkippedDomain {
  domain: string
  count:  number
}

export interface NormalizeResult {
  records:        SyncRecord[]
  /**
   * Sites in BP projects that brands.ts does not know, or that belong to
   * another brand, counted in keyword × market pairs, busiest first.
   */
  unknownDomains: SkippedDomain[]
  /** The weekly Ahrefs update the records belong to (see cycleDate); '' when there are no records. */
  rawDate:        string
}

/** Lowercase, trim, drop a leading `www.`. */
export function canonicalDomain(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/^www\./, '')
}

const RUN_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Ahrefs answered, but with data the sync cannot turn into honest records.
 * Its message is already worded for the operator, so callers show it as is.
 */
export class SyncDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncDataError'
  }
}

/** A real rank, or null for "not found" (and for anything that is not a positive number). */
function asRank(p: number | null | undefined): number | null {
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null
}

function rankString(rank: number | null): string {
  return rank === null ? 'NR' : String(rank)
}

/** Signed movement, positive = improved. Only when both checks found the site. */
function changeString(previous: number | null, current: number | null): string {
  if (previous === null || current === null) return ''
  const delta = previous - current
  if (delta === 0) return '0'
  return delta > 0 ? `+${delta}` : String(delta)
}

/**
 * Records whose check is older than the snapshot date — keywords Ahrefs'
 * latest weekly update did not cover. Surfaced so a partial update cannot pass
 * for a fresh week.
 */
export function countOlderChecks(records: { date: string }[], rawDate: string): number {
  let older = 0
  for (const r of records) if (r.date && r.date < rawDate) older++
  return older
}

// ── Ahrefs Rank Tracker ───────────────────────────────────────────────────────

/** One slot of a competitors-overview row: the project's target (slot 0) or one competitor. */
export interface AhrefsSlot {
  /** The ranking page; null when the slot's site was not found. */
  url:            string | null
  /** null = checked, but not found. */
  position:       number | null
  /** The previous update's position (compared view only). */
  position_prev?: number | null
}

/** One keyword × location row of `rank-tracker/competitors-overview`. */
export interface AhrefsKeywordRow {
  keyword:            string
  /** Two-letter country code, e.g. "AU". */
  country:            string
  language:           string
  location?:          string
  /** When Ahrefs last checked this keyword (ISO timestamp); null = never checked. */
  serp_updated:       string | null
  serp_updated_prev?: string | null
  /** One entry per project slot: the target first, then the competitors in project order. */
  competitors_list:   AhrefsSlot[]
}

/** One Rank Tracker project, as api/_lib/ahrefs.ts returns it. */
export interface AhrefsProject {
  projectId:   number
  name:        string
  /** Ahrefs' raw target, e.g. "rooster.bet/". */
  target:      string
  /** Ahrefs' raw competitor targets in slot order: competitors[i] is slot i + 1. */
  competitors: string[]
  rows:        AhrefsKeywordRow[]
}

/** The language each market is tracked in. Another language for the same keyword loses. */
const MAIN_LANGUAGE: Record<string, string> = { AU: 'en', CA: 'en', NZ: 'en', DE: 'de', IT: 'it' }

const DAY_MS = 86_400_000

/** The bare host of an Ahrefs target or ranking URL — lowercase, no `www.` — or '' if unparseable. */
export function hostOf(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  try {
    return canonicalDomain(new URL(s.includes('://') ? s : `https://${s}`).hostname)
  } catch {
    return ''
  }
}

/** The BP domain `host` is, or is a subdomain of; '' for anything else, LP domains included. */
export function bpDomainOf(host: string): string {
  if (!host) return ''
  if (DOMAIN_TO_BRAND[host]) return host
  for (const domain of Object.keys(DOMAIN_TO_BRAND)) if (host.endsWith(`.${domain}`)) return domain
  return ''
}

/**
 * The weekly Ahrefs update a batch belongs to: the most common check date among
 * records checked in the 7 days up to the newest one. A re-check later in the
 * week cannot move it, and last week's checks cannot outvote this week's while
 * an update is still landing. A tie goes to the later date; '' when nothing is dated.
 */
export function cycleDate(records: { date: string }[]): string {
  let newest = ''
  for (const r of records) if (RUN_DATE.test(r.date) && r.date > newest) newest = r.date
  if (!newest) return ''
  const floor = new Date(Date.parse(`${newest}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10)

  const counts = new Map<string, number>()
  for (const r of records) {
    if (RUN_DATE.test(r.date) && r.date >= floor) counts.set(r.date, (counts.get(r.date) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [date, count] of counts) {
    if (count > bestCount || (count === bestCount && date > best)) {
      best = date
      bestCount = count
    }
  }
  return best
}

/** One project's view of one (domain, keyword, country). */
interface Observation {
  domain:       string
  keyword:      string
  country:      string
  language:     string
  /** True when this is the domain's own project (slot 0). */
  own:          boolean
  position:     number | null
  date:         string
  prevPosition: number | null
  prevDate:     string
}

/** True when `a` is a better rank than `b`; not-found (null) is the worst. */
function outranks(a: number | null, b: number | null): boolean {
  return a !== null && (b === null || a < b)
}

/**
 * One record per (domain, keyword, country) from the client's Ahrefs Rank
 * Tracker projects.
 *
 * Only projects whose target is a BP domain count, and each produces records
 * for its own brand's domains only. A keyword Ahrefs has not checked yet
 * produces no record — unchecked is not "not ranking". A site seen by several
 * projects takes its own project's number, else the best position from the
 * newest check day. Throws a SyncDataError, worded for the operator, when the
 * data cannot be credited to the right site.
 */
export function normalizeAhrefs(projects: AhrefsProject[]): NormalizeResult {
  const skipped = new Map<string, number>()
  const candidates = new Map<string, Observation[]>()

  for (const project of projects) {
    const brand = DOMAIN_TO_BRAND[bpDomainOf(hostOf(project.target))]
    // Another client's project, or an LP project: not ours to read.
    if (!brand) continue
    const slots = [project.target, ...(project.competitors ?? [])].map(hostOf)

    for (const row of project.rows ?? []) {
      if (!row.serp_updated) continue
      const list = row.competitors_list ?? []
      if (list.length !== slots.length) {
        throw new SyncDataError(
          `Ahrefs returned ${list.length} positions for ${slots.length} sites in "${project.name}" — nothing was saved`,
        )
      }
      const date = row.serp_updated.slice(0, 10)
      const prevDate = row.serp_updated_prev ? row.serp_updated_prev.slice(0, 10) : ''
      const country = normalizeCountry(row.country)
      const keyword = (row.keyword ?? '').trim()

      list.forEach((slot, i) => {
        const slotHost = slots[i]
        // The list names no competitor, so positions are credited by order. A
        // ranked URL that is not its slot's site means the order changed, and
        // every position after it would land on the wrong site.
        if (slot.url) {
          const host = hostOf(slot.url)
          if (host !== slotHost && !host.endsWith(`.${slotHost}`)) {
            throw new SyncDataError(
              `Ahrefs listed ${host} in ${slotHost}'s slot in "${project.name}" — the competitor order changed, so nothing was saved`,
            )
          }
        }

        const domain = bpDomainOf(slotHost)
        if (domain && DOMAIN_TO_BRAND[domain] === brand) {
          const key = `${domain}|${keyword.toLowerCase()}|${country}`
          const seen = candidates.get(key) ?? []
          seen.push({
            domain, keyword, country, language: row.language, own: i === 0,
            position: slot.position, date, prevPosition: slot.position_prev ?? null, prevDate,
          })
          candidates.set(key, seen)
        } else if (!LP_DOMAIN_TO_BRAND[slotHost]) {
          // Unknown to brands.ts, or another brand's site. LP domains are
          // known and deliberately out of scope, so they are not listed.
          skipped.set(slotHost, (skipped.get(slotHost) ?? 0) + 1)
        }
      })
    }
  }

  const records: SyncRecord[] = []
  for (const seen of candidates.values()) {
    const main = MAIN_LANGUAGE[seen[0].country]
    const inMain = seen.filter((o) => o.language === main)
    const pool = inMain.length > 0 ? inMain : seen
    let newest = ''
    for (const o of pool) if (o.date > newest) newest = o.date
    const sameDay = pool.filter((o) => o.date === newest)
    const chosen = sameDay.find((o) => o.own)
      ?? sameDay.reduce((best, o) => (outranks(asRank(o.position), asRank(best.position)) ? o : best))

    const rank = asRank(chosen.position)
    // Only a check from an earlier day is a previous one: a same-day value
    // would be this check seen twice.
    const hasPrevious = chosen.prevDate !== '' && chosen.prevDate < chosen.date
    const previousRank = hasPrevious ? asRank(chosen.prevPosition) : null
    records.push({
      domain:   chosen.domain,
      keyword:  chosen.keyword,
      country:  chosen.country,
      position: rankString(rank),
      previous: hasPrevious ? rankString(previousRank) : '',
      change:   hasPrevious ? changeString(previousRank, rank) : '',
      date:     chosen.date,
      // Not in Ahrefs' data. Carry-forward fills them from the previous snapshot.
      searchVolume:       '',
      affiliateUrl:       '',
      globalSearchVolume: '',
    })
  }

  records.sort((a, b) =>
    a.domain.localeCompare(b.domain) || a.keyword.localeCompare(b.keyword) || a.country.localeCompare(b.country),
  )
  const unknownDomains: SkippedDomain[] = [...skipped.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))

  return { records, unknownDomains, rawDate: cycleDate(records) }
}
