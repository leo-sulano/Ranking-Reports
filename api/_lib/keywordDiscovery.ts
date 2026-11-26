/**
 * Other ranking keywords — the logic shared by the monthly Ahrefs pull
 * (api/cron-discovery.ts) and the BP Sites brand page.
 *
 * SHIPS IN THE BROWSER BUNDLE — src/lib/keywordDiscovery.ts re-exports from
 * here, so this file is compiled into the client. Same rule as brands.ts: no
 * secrets, no process.env, no node: imports.
 *
 * Design: docs/superpowers/specs/2026-11-13-other-ranking-keywords-design.md
 */
import { ALL_COUNTRIES, normalizeCountry } from './brands.js'

/**
 * The dashboard's markets. Cycles fetched before 2026-11-25 hold one fetch per
 * site × market; a brand page still reads them (src/lib/discoveryList.ts).
 */
export const DISCOVERY_COUNTRIES = ALL_COUNTRIES

/** The fetch-row country of one call that covered every country for a site. */
export const ALL_COUNTRIES_FETCH = 'ALL'

/** Keywords asked for per site, every country, highest search volume first. */
export const ROWS_PER_CALL = 200
/** What a per-country fetch (before 2026-11-25) asked for: a row count this high means its list was cut off. */
export const LEGACY_ROWS_PER_CALL = 50
/** Per-row API units for DISCOVERY_SELECT: volume costs 10, every other field 1. */
export const UNITS_PER_ROW = 16
/** Ahrefs charges at least this for any billable request, even one that returns nothing. */
export const MIN_CALL_UNITS = 50
/** ROWS_PER_CALL × UNITS_PER_ROW. A call is never started with fewer units left on the key. */
export const WORST_CASE_CALL_UNITS = ROWS_PER_CALL * UNITS_PER_ROW
export const DISCOVERY_SELECT =
  'keyword,keyword_country,best_position,best_position_url,volume,last_update,best_position_kind'

const SELECTED_FIELDS = DISCOVERY_SELECT.split(',')

/** One paid call: a live BP site, every country. */
export interface DiscoveryTarget { brand: string; domain: string }

export interface DiscoveryRow {
  cycle:         string
  brand:         string
  domain:        string
  /** Upper-case ISO country code, any country (Ahrefs' keyword_country). */
  country:       string
  keyword:       string
  position:      number
  /** Ahrefs' best_position_kind: 'organic', or a SERP feature such as 'ai_overview'. */
  positionKind:  string | null
  url:           string
  volume:        number | null
  /** When Ahrefs last checked this keyword's SERP (its last_update). */
  ahrefsChecked: string | null
}

/**
 * Every live BP site, brand by brand, in brands.ts order: one call each covers
 * every country. A brand's market list does not narrow it — keywords outside
 * the markets are listed on the page. Retired sites are not in `domains`.
 */
export function discoveryTargets(brands: ReadonlyArray<{ name: string; domains: readonly string[] }>): DiscoveryTarget[] {
  return brands.flatMap((brand) => brand.domains.map((domain) => ({ brand: brand.name, domain: domain.toLowerCase() })))
}

export function pairKey(domain: string, country: string): string {
  return `${domain.toLowerCase()}|${country.toUpperCase()}`
}

/**
 * The day the current Ahrefs billing month began: one calendar month before
 * the next usage reset, read in UTC, clamped to the shorter month's last day.
 */
export function cycleStart(usageResetDate: string): string {
  const reset = new Date(usageResetDate)
  if (Number.isNaN(reset.getTime())) throw new Error(`Unreadable Ahrefs usage reset date: ${usageResetDate}`)
  let year = reset.getUTCFullYear()
  let month = reset.getUTCMonth() - 1
  if (month < 0) {
    month = 11
    year -= 1
  }
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(reset.getUTCDate(), lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The form keywords are compared in: NFC, trimmed, lower-case, single spaces. */
export function normalizeKeyword(keyword: string): string {
  return keyword.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * One organic-keywords response (every country) → rows to store, each in the
 * country Ahrefs gives it. A missing field, or a response in which no row is
 * readable, means Ahrefs changed shape: it throws rather than saving blanks
 * (the job then halts). A single odd row — no position, no country, a blank
 * keyword, a value of the wrong type — is skipped, so one bad row cannot stop
 * the job. Keywords that differ only in case or spacing collapse, per
 * country, to the best position.
 */
export function mapOrganicKeywords(
  body: unknown,
  ctx: { cycle: string; brand: string; domain: string },
): DiscoveryRow[] {
  const unexpected = () =>
    new Error(`Ahrefs returned an unexpected organic-keywords response for ${ctx.domain}`)

  const list = (body as { keywords?: unknown } | null)?.keywords
  if (!Array.isArray(list)) throw unexpected()

  const best = new Map<string, DiscoveryRow>()
  let unreadable = 0
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) {
      unreadable += 1
      continue
    }
    const r = raw as Record<string, unknown>
    // A field missing outright means Ahrefs changed the response, not one odd row.
    if (!SELECTED_FIELDS.every((field) => field in r)) throw unexpected()

    const { keyword, best_position: position, best_position_url: url, volume, last_update: checked } = r
    const kind = r.best_position_kind
    const rawCountry = r.keyword_country
    if (position === null || keyword === null || rawCountry === null || rawCountry === '') continue
    if (
      typeof keyword !== 'string' || typeof position !== 'number' || !Number.isFinite(position) ||
      typeof rawCountry !== 'string' ||
      (volume !== null && (typeof volume !== 'number' || !Number.isFinite(volume)))
    ) {
      unreadable += 1
      continue
    }
    if (keyword.trim() === '') continue

    const row: DiscoveryRow = {
      cycle:         ctx.cycle,
      brand:         ctx.brand,
      domain:        ctx.domain,
      country:       rawCountry.trim().toUpperCase(),
      keyword:       keyword.trim(),
      position,
      positionKind:  typeof kind === 'string' ? kind : null,
      url:           typeof url === 'string' ? url : '',
      volume:        volume as number | null,
      ahrefsChecked: typeof checked === 'string' ? checked : null,
    }
    const key = `${normalizeKeyword(keyword)}|${row.country}`
    const seen = best.get(key)
    if (!seen || row.position < seen.position) best.set(key, row)
  }
  if (list.length > 0 && unreadable === list.length) throw unexpected()
  return [...best.values()]
}

export function trackedKey(brand: string, country: string): string {
  return `${brand}|${country.toUpperCase()}`
}

/** Tracked keywords by brand and country (`trackedKey`), normalized. Domains not in `domainToBrand` are ignored. */
export function trackedIndex(
  records: ReadonlyArray<{ domain: string; keyword: string; country: string }>,
  domainToBrand: Readonly<Record<string, string>>,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const record of records) {
    const brand = domainToBrand[record.domain.toLowerCase()]
    const keyword = normalizeKeyword(record.keyword)
    if (!brand || !keyword) continue
    const key = trackedKey(brand, normalizeCountry(record.country))
    let set = index.get(key)
    if (!set) {
      set = new Set()
      index.set(key, set)
    }
    set.add(keyword)
  }
  return index
}
