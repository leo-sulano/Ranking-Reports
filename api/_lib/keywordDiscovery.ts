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
import { normalizeCountry } from './brands.js'

export const DISCOVERY_COUNTRIES = ['AU', 'CA', 'DE', 'IT', 'NZ'] as const
export type DiscoveryCountry = (typeof DISCOVERY_COUNTRIES)[number]

/** Keywords asked for per domain × country, highest search volume first. */
export const ROWS_PER_CALL = 50
/** Per-row API units for DISCOVERY_SELECT: volume costs 10, every other field 1. */
export const UNITS_PER_ROW = 15
/** Ahrefs charges at least this for any billable request, even one that returns nothing. */
export const MIN_CALL_UNITS = 50
/** ROWS_PER_CALL × UNITS_PER_ROW. A call is never started with fewer units left on the key. */
export const WORST_CASE_CALL_UNITS = 750
export const DISCOVERY_SELECT = 'keyword,best_position,best_position_url,volume,last_update,best_position_kind'

const SELECTED_FIELDS = DISCOVERY_SELECT.split(',')

export interface DiscoveryPair { brand: string; domain: string; country: DiscoveryCountry }

export interface DiscoveryRow {
  cycle:         string
  brand:         string
  domain:        string
  country:       DiscoveryCountry
  keyword:       string
  position:      number
  /** Ahrefs' best_position_kind: 'organic', or a SERP feature such as 'ai_overview'. */
  positionKind:  string | null
  url:           string
  volume:        number | null
  /** When Ahrefs last checked this keyword's SERP (its last_update). */
  ahrefsChecked: string | null
}

/** Every BP domain × country, brand by brand, in brands.ts order. */
export function discoveryPairs(brands: ReadonlyArray<{ name: string; domains: readonly string[] }>): DiscoveryPair[] {
  const pairs: DiscoveryPair[] = []
  for (const brand of brands) {
    for (const domain of brand.domains) {
      for (const country of DISCOVERY_COUNTRIES) {
        pairs.push({ brand: brand.name, domain: domain.toLowerCase(), country })
      }
    }
  }
  return pairs
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
 * One organic-keywords response → rows to store. A missing field or an
 * unreadable value means Ahrefs changed shape, so it throws rather than saving
 * blanks; a single row with no position or a blank keyword is skipped, so one
 * odd row cannot fail the same pair every day. Keywords that differ only in
 * case or spacing collapse to the best position.
 */
export function mapOrganicKeywords(
  body: unknown,
  ctx: { cycle: string; brand: string; domain: string; country: DiscoveryCountry },
): DiscoveryRow[] {
  const unexpected = () =>
    new Error(`Ahrefs returned an unexpected organic-keywords response for ${ctx.domain} (${ctx.country})`)

  const list = (body as { keywords?: unknown } | null)?.keywords
  if (!Array.isArray(list)) throw unexpected()

  const best = new Map<string, DiscoveryRow>()
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) throw unexpected()
    const r = raw as Record<string, unknown>
    if (!SELECTED_FIELDS.every((field) => field in r)) throw unexpected()

    const { keyword, best_position: position, best_position_url: url, volume, last_update: checked } = r
    const kind = r.best_position_kind
    if (position === null || keyword === null) continue
    if (typeof keyword !== 'string' || typeof position !== 'number' || !Number.isFinite(position)) throw unexpected()
    if (volume !== null && (typeof volume !== 'number' || !Number.isFinite(volume))) throw unexpected()
    if (keyword.trim() === '') continue

    const row: DiscoveryRow = {
      cycle:         ctx.cycle,
      brand:         ctx.brand,
      domain:        ctx.domain,
      country:       ctx.country,
      keyword:       keyword.trim(),
      position,
      positionKind:  typeof kind === 'string' ? kind : null,
      url:           typeof url === 'string' ? url : '',
      volume:        volume as number | null,
      ahrefsChecked: typeof checked === 'string' ? checked : null,
    }
    const key = normalizeKeyword(keyword)
    const seen = best.get(key)
    if (!seen || row.position < seen.position) best.set(key, row)
  }
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

/**
 * The organic-keywords `where` that leaves out keywords already tracked.
 * Ahrefs' `eq` is case-sensitive and its keywords are lower-case, so the
 * keywords go out normalized. Undefined when there is nothing to exclude.
 */
export function excludeKeywordsWhere(keywords: Iterable<string>): string | undefined {
  const unique = [...new Set([...keywords].map(normalizeKeyword).filter(Boolean))].sort()
  if (unique.length === 0) return undefined
  return JSON.stringify({ not: { or: unique.map((keyword) => ({ field: 'keyword', is: ['eq', keyword] })) } })
}
