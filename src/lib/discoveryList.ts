/**
 * Ranking keywords from Ahrefs' index on a BP Sites brand page: which stored
 * cycle to show, where keywords may be marked NEW, the rows that join the
 * brand's table (its markets) and the list under it (other countries). Pure;
 * the loader is src/lib/keywordDiscovery.ts, the hook src/lib/useDiscovery.ts.
 *
 * Imports the shared logic straight from api/_lib (not via
 * src/lib/keywordDiscovery.ts, which imports a type from here).
 */
import {
  ALL_COUNTRIES_FETCH, DISCOVERY_COUNTRIES, LEGACY_ROWS_PER_CALL, ROWS_PER_CALL, normalizeKeyword, trackedKey,
  type DiscoveryRow,
} from '../../api/_lib/keywordDiscovery.js'

export interface DiscoveryFetchInfo {
  cycle:     string
  domain:    string
  country:   string
  fetchedAt: string
  /** Keywords that fetch stored: ROWS_PER_CALL (an ALL fetch) or LEGACY_ROWS_PER_CALL (one country) means Ahrefs' list was cut off. */
  rowCount:  number
}

export interface DiscoveryListItem {
  keyword:       string
  country:       string
  /** The brand's best-ranking site for this keyword and country. */
  site:          string
  position:      number
  positionKind:  string | null
  volume:        number | null
  url:           string
  ahrefsChecked: string | null
  isNew:         boolean
}

const lowerSet = (domains: readonly string[]) => new Set(domains.map((d) => d.toLowerCase()))

/** The brand's fetched domain|COUNTRY pairs, per cycle. Other brands' fetches are ignored. */
function brandFetchesByCycle(brandDomains: readonly string[], fetches: readonly DiscoveryFetchInfo[]) {
  const mine = lowerSet(brandDomains)
  const byCycle = new Map<string, Set<string>>()
  for (const f of fetches) {
    const domain = f.domain.toLowerCase()
    if (!mine.has(domain)) continue
    let pairs = byCycle.get(f.cycle)
    if (!pairs) {
      pairs = new Set()
      byCycle.set(f.cycle, pairs)
    }
    pairs.add(`${domain}|${f.country.toUpperCase()}`)
  }
  return byCycle
}

/**
 * Cycles in which every one of the brand's domains is fetched, newest first: a
 * domain counts with an ALL fetch, or — for cycles fetched per country — with
 * a fetch for each of `countries`.
 */
export function completeCycles(
  brandDomains: readonly string[],
  fetches: readonly DiscoveryFetchInfo[],
  countries: readonly string[] = DISCOVERY_COUNTRIES,
): string[] {
  const domains = [...lowerSet(brandDomains)]
  const complete = (have: Set<string>, d: string) =>
    have.has(`${d}|${ALL_COUNTRIES_FETCH}`) || countries.every((c) => have.has(`${d}|${c.toUpperCase()}`))
  return [...brandFetchesByCycle(brandDomains, fetches)]
    .filter(([, have]) => domains.every((d) => complete(have, d)))
    .map(([cycle]) => cycle)
    .sort()
    .reverse()
}

/** The brand's newest cycle before `cycle` that holds any of its fetches. */
export function previousCycle(cycle: string, brandDomains: readonly string[], fetches: readonly DiscoveryFetchInfo[]): string | null {
  const older = [...brandFetchesByCycle(brandDomains, fetches).keys()].filter((c) => c < cycle).sort()
  return older.length > 0 ? older[older.length - 1] : null
}

/**
 * Where a keyword missing from the previous cycle really was absent, so NEW can
 * be shown: every one of the brand's domains covers the country there. A
 * domain's ALL fetch under ROWS_PER_CALL covers every country and makes its
 * per-country fetches irrelevant; without one, a per-country fetch under
 * LEGACY_ROWS_PER_CALL covers its country. A cut-off list only holds the top
 * keywords by volume, so a keyword missing from it may simply have ranked
 * below the cut.
 */
export function newEligibility(
  prevCycle: string | null,
  brandDomains: readonly string[],
  fetches: readonly DiscoveryFetchInfo[],
): (country: string) => boolean {
  if (!prevCycle) return () => false
  const mine = lowerSet(brandDomains)
  const all = new Map<string, boolean>()          // domain -> its ALL list was complete
  const perCountry = new Set<string>()             // domain|COUNTRY with a complete list
  for (const f of fetches) {
    const domain = f.domain.toLowerCase()
    if (f.cycle !== prevCycle || !mine.has(domain)) continue
    const country = f.country.toUpperCase()
    if (country === ALL_COUNTRIES_FETCH) all.set(domain, f.rowCount < ROWS_PER_CALL)
    else if (f.rowCount < LEGACY_ROWS_PER_CALL) perCountry.add(`${domain}|${country}`)
  }
  const domains = [...mine]
  return (country: string) => {
    const c = country.toUpperCase()
    return domains.every((d) => (all.has(d) ? all.get(d) === true : perCountry.has(`${d}|${c}`)))
  }
}

/** When the brand's part of a cycle was finished: its latest fetch in that cycle. */
export function cycleCompletedAt(cycle: string, brandDomains: readonly string[], fetches: readonly DiscoveryFetchInfo[]): string | null {
  const mine = lowerSet(brandDomains)
  let latest: string | null = null
  for (const f of fetches) {
    if (f.cycle !== cycle || !mine.has(f.domain.toLowerCase())) continue
    if (latest === null || Date.parse(f.fetchedAt) > Date.parse(latest)) latest = f.fetchedAt
  }
  return latest
}

const KIND_LABELS: Record<string, string> = { ai_overview: 'AI Overview' }

/** A short tag for a position that is not a plain organic result; null for organic. */
export function positionKindLabel(kind: string | null): string | null {
  if (!kind || kind === 'organic') return null
  if (KIND_LABELS[kind]) return KIND_LABELS[kind]
  const words = kind.split('_').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function buildDiscoveryList(input: {
  rows:            readonly DiscoveryRow[]
  prevRows:        readonly DiscoveryRow[]
  newEligible:     (country: string) => boolean
  tracked:         ReadonlyMap<string, ReadonlySet<string>>
  brand:           { name: string; mainDomain: string; domains: readonly string[] }
  /** Which countries this list shows. */
  country:         (code: string) => boolean
  kwFilter:        string
  kwExact:         boolean
}): DiscoveryListItem[] {
  // Every one of the brand's sites, whatever the page's Sites filter shows:
  // that filter hides the main site by default.
  const brandSites = lowerSet(input.brand.domains)
  // Same matching as the BP Sites keyword search.
  const filter = input.kwFilter.trim().toLowerCase()
  const mainDomain = input.brand.mainDomain.toLowerCase()
  const domainOrder = input.brand.domains.map((d) => d.toLowerCase())
  const rank = (domain: string) => (domain.toLowerCase() === mainDomain ? -1 : domainOrder.indexOf(domain.toLowerCase()))
  // NEW is a brand-level fact, whatever sites are selected now.
  const previous = new Set(input.prevRows.map((r) => `${normalizeKeyword(r.keyword)}|${r.country}`))

  const groups = new Map<string, DiscoveryRow[]>()
  for (const row of input.rows) {
    if (!brandSites.has(row.domain.toLowerCase()) || !input.country(row.country)) continue
    const normalized = normalizeKeyword(row.keyword)
    if (input.tracked.get(trackedKey(input.brand.name, row.country))?.has(normalized)) continue
    const keyword = row.keyword.toLowerCase()
    if (filter && (input.kwExact ? keyword !== filter : !keyword.includes(filter))) continue
    const key = `${normalized}|${row.country}`
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }

  const items: DiscoveryListItem[] = [...groups].map(([key, group]) => {
    const best = group.reduce((a, b) =>
      b.position < a.position || (b.position === a.position && rank(b.domain) < rank(a.domain)) ? b : a)
    const volumes = group.map((r) => r.volume).filter((v): v is number => v !== null)
    return {
      keyword:       best.keyword,
      country:       best.country,
      site:          best.domain,
      position:      best.position,
      positionKind:  best.positionKind,
      volume:        volumes.length > 0 ? Math.max(...volumes) : null,
      url:           best.url,
      ahrefsChecked: best.ahrefsChecked,
      isNew:         input.newEligible(best.country) && !previous.has(key),
    }
  })

  return items.sort((a, b) =>
    (b.volume ?? -1) - (a.volume ?? -1) || a.position - b.position || a.keyword.localeCompare(b.keyword))
}

/** One site's position for one country, from Ahrefs' index. */
export interface FoundCell {
  position:      number
  positionKind:  string | null
  url:           string
  ahrefsChecked: string | null
}

/** A keyword the brand's table doesn't track: cells[domain][country]. */
export interface FoundRow {
  keyword: string
  volume:  number | null
  /** Lower-case domain → upper-case country → that site's position there. */
  cells:   Record<string, Record<string, FoundCell>>
}

/**
 * Rows that join the brand's table: keywords Ahrefs' index has the brand's
 * live sites (those the Sites filter shows) ranking for in `countries` (its
 * markets, as the page's chips show them), not tracked there for the brand,
 * matching the keyword search — so no row is all dashes.
 * One row per keyword; each (site, country) cell keeps that site's best
 * position. Sorted by search volume (missing last), then best position.
 */
export function buildFoundRows(input: {
  rows:     readonly DiscoveryRow[]
  tracked:  ReadonlyMap<string, ReadonlySet<string>>
  brand:    { name: string; domains: readonly string[] }
  /** The sites the page's Sites filter shows; every live site of the brand when omitted. */
  sites?:   readonly string[]
  countries: readonly string[]
  kwFilter: string
  kwExact:  boolean
}): FoundRow[] {
  const live = lowerSet(input.brand.domains)
  const shown = input.sites ? lowerSet(input.sites) : live
  const sites = new Set([...live].filter((d) => shown.has(d)))
  const countries = new Set(input.countries.map((c) => c.toUpperCase()))
  const filter = input.kwFilter.trim().toLowerCase()
  const groups = new Map<string, { row: FoundRow; best: number }>()
  for (const r of input.rows) {
    const domain = r.domain.toLowerCase()
    if (!sites.has(domain) || !countries.has(r.country)) continue
    const normalized = normalizeKeyword(r.keyword)
    if (input.tracked.get(trackedKey(input.brand.name, r.country))?.has(normalized)) continue
    const keyword = r.keyword.toLowerCase()
    if (filter && (input.kwExact ? keyword !== filter : !keyword.includes(filter))) continue

    let group = groups.get(normalized)
    if (!group) {
      group = { row: { keyword: r.keyword, volume: null, cells: {} }, best: Infinity }
      groups.set(normalized, group)
    }
    const byCountry = (group.row.cells[domain] ??= {})
    const seen = byCountry[r.country]
    if (!seen || r.position < seen.position) {
      byCountry[r.country] = { position: r.position, positionKind: r.positionKind, url: r.url, ahrefsChecked: r.ahrefsChecked }
    }
    if (r.volume !== null && (group.row.volume === null || r.volume > group.row.volume)) group.row.volume = r.volume
    group.best = Math.min(group.best, r.position)
  }
  return [...groups.values()]
    .sort((a, b) =>
      (b.row.volume ?? -1) - (a.row.volume ?? -1) || a.best - b.best || a.row.keyword.localeCompare(b.row.keyword))
    .map((g) => g.row)
}
