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
import { DOMAIN_TO_BRAND, normalizeCountry } from './brands.js'

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
      throw new Error(
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
