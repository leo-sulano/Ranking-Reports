// SHIPS IN THE BROWSER BUNDLE — src/lib/sitesNormalize.ts re-exports from here,
// so being under api/ does not make this server code. No secrets, no
// process.env, no node: imports. (Server-only neighbours, where those are fine:
// openseo.ts, snapshotStore.ts, requestAuth.ts, ssoPortal.ts.)
//
// One implementation for both sync paths — the Sync button's proxy and the
// cron. Countries go through the xlsx parser's own normalizeCountry: carry-
// forward keys on a byte-compared country, so a second, subtly different
// normalizer here would break GSV/SV/AFF inheritance between synced and
// uploaded snapshots.
import { DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND, normalizeCountry } from './brands.js'

/** One cell of OpenSEO's rank export: one keyword, in one market, on one run date. */
export interface OpenSeoCell {
  /** null = checked, but not found within the tracker's SERP depth. */
  position: number | null
  /**
   * OpenSEO's last RANKED position, skipping not-found weeks. Not used: the
   * dashboard's Previous column means the previous check, found or not.
   */
  previous: number | null
  status:   string
}

export interface OpenSeoMarket {
  locationCode: number
  /** Short code the export carries, e.g. "AU". */
  countryCode:  string | null
  /** Set only for city-level trackers, which are not country rankings. */
  locationName: string | null
}

export interface OpenSeoKeyword {
  keyword: string
  /** locationCode -> run date -> cell. A missing date means that run never checked the keyword. */
  cells:   Record<string, Record<string, OpenSeoCell>>
}

/** GET /api/public/rankings?domain=… — only the fields the sync reads. */
export interface OpenSeoExport {
  domain:   string
  /** Run dates (the run's UTC start date, YYYY-MM-DD), ascending. */
  weeks:    string[]
  markets:  OpenSeoMarket[]
  keywords: OpenSeoKeyword[]
}

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
  /** Exports dropped because the domain is not in BRANDS, counted in keyword × market pairs, busiest first. */
  unknownDomains: SkippedDomain[]
  /** Newest record date; '' when there are no records. */
  rawDate:        string
}

/** Lowercase, trim, drop a leading `www.`. */
export function canonicalDomain(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/^www\./, '')
}

const RUN_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * OpenSEO answered, but with data the sync cannot turn into honest records.
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
 * locationCode -> dashboard country code, for country-level markets only, plus
 * the codes where a city tracker shares a national one.
 *
 * OpenSEO stores a city tracker under its country's location code, and its
 * export keys cells by that code — so a domain tracked both nationally and in
 * a city has the two merged under one key, and nothing says which tracker a
 * cell came from. A city tracker with no national twin is simply not a
 * country ranking, and is skipped.
 */
function marketCountries(markets: OpenSeoMarket[]): {
  countries: Map<string, string>
  merged:    Array<{ code: string; city: string }>
} {
  const countries = new Map<string, string>()
  const cities = new Map<string, string>()
  for (const market of markets ?? []) {
    const code = String(market.locationCode)
    if (market.locationName) {
      cities.set(code, market.locationName)
      continue
    }
    const country = normalizeCountry(market.countryCode)
    if (country) countries.set(code, country)
  }
  const merged = [...cities].filter(([code]) => countries.has(code)).map(([code, city]) => ({ code, city }))
  return { countries, merged }
}

/**
 * One record per (domain, keyword, country), from that pair's newest checked
 * run date in the export.
 *
 * A date with no cell was not checked, so it never becomes 'NR' — the record
 * keeps the newest real check, and its own date says how old that is. A pair
 * with no checked date in the window gets no record at all.
 */
export function normalizeExports(exports: OpenSeoExport[]): NormalizeResult {
  const skipped = new Map<string, number>()
  const newest = new Map<string, SyncRecord>()

  for (const report of exports) {
    const domain = canonicalDomain(report.domain)
    const known = Boolean(DOMAIN_TO_BRAND[domain])
    const { countries, merged } = marketCountries(report.markets)
    // Refuse rather than report a city rank as national. Only a BP domain can
    // stop the sync: another client's trackers are not ours to judge.
    if (known && merged.length > 0) {
      const { code, city } = merged[0]
      throw new SyncDataError(
        `OpenSEO tracks ${domain} both nationally and in ${city.split(',')[0]} under one location (${code}), and its export merges the two — archive one of those trackers to sync`,
      )
    }

    for (const entry of report.keywords ?? []) {
      const keyword = (entry.keyword ?? '').trim()
      for (const [locationCode, byDate] of Object.entries(entry.cells ?? {})) {
        const country = countries.get(locationCode)
        if (!country || !byDate) continue
        // Sorted here rather than trusting `weeks`: the cell keys are exactly
        // the dates this keyword was checked in this market.
        const checked = Object.keys(byDate)
          .filter((d) => RUN_DATE.test(d) && byDate[d])
          .sort()
        if (checked.length === 0) continue
        if (!known) {
          skipped.set(domain, (skipped.get(domain) ?? 0) + 1)
          continue
        }

        const date = checked[checked.length - 1]
        const previousDate = checked.length > 1 ? checked[checked.length - 2] : null
        const rank = asRank(byDate[date].position)
        const previousRank = previousDate ? asRank(byDate[previousDate].position) : null

        const record: SyncRecord = {
          domain,
          keyword,
          country,
          position: rankString(rank),
          previous: previousDate ? rankString(previousRank) : '',
          change:   previousDate ? changeString(previousRank, rank) : '',
          date,
          // Not in the export. Carry-forward inherits them from the previous
          // snapshot, as it did for the Ranks API.
          searchVolume:       '',
          affiliateUrl:       '',
          globalSearchVolume: '',
        }

        // The same site can be listed twice (www. and bare) and the same text
        // can differ only in case: keep one row, from the newer check.
        const key = `${domain}|${keyword.toLowerCase()}|${country}`
        const held = newest.get(key)
        if (!held || record.date > held.date) newest.set(key, record)
      }
    }
  }

  const records = [...newest.values()].sort((a, b) =>
    a.domain.localeCompare(b.domain) || a.keyword.localeCompare(b.keyword) || a.country.localeCompare(b.country),
  )
  let rawDate = ''
  for (const r of records) if (r.date > rawDate) rawDate = r.date

  const unknownDomains: SkippedDomain[] = [...skipped.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))

  return { records, unknownDomains, rawDate }
}

/**
 * Records whose newest check is older than the snapshot date — keywords the
 * latest OpenSEO run did not cover. Surfaced so a partial run cannot pass for
 * a fresh week.
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
