/**
 * The "Other ranking keywords" list on a BP Sites brand page: which stored
 * cycle to show, which countries may mark keywords NEW, and one item per
 * keyword × country. Pure; the loader is src/lib/keywordDiscovery.ts.
 *
 * Imports the shared logic straight from api/_lib (not via
 * src/lib/keywordDiscovery.ts, which imports a type from here).
 */
import {
  DISCOVERY_COUNTRIES, ROWS_PER_CALL, normalizeKeyword, trackedKey, type DiscoveryRow,
} from '../../api/_lib/keywordDiscovery.js'

export interface DiscoveryFetchInfo {
  cycle:     string
  domain:    string
  country:   string
  fetchedAt: string
  /** Keywords that fetch stored: ROWS_PER_CALL means Ahrefs' list was cut off there. */
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

/** Cycles in which every one of the brand's domains has every country, newest first. */
export function completeCycles(brandDomains: readonly string[], fetches: readonly DiscoveryFetchInfo[]): string[] {
  const needed = [...lowerSet(brandDomains)].flatMap((d) => DISCOVERY_COUNTRIES.map((c) => `${d}|${c}`))
  return [...brandFetchesByCycle(brandDomains, fetches)]
    .filter(([, have]) => needed.every((pair) => have.has(pair)))
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
 * Countries where a keyword missing from the previous cycle really was absent,
 * so NEW can be shown there: every one of the brand's domains was fetched for
 * that country, and no fetch was cut off at ROWS_PER_CALL. A cut-off list only
 * holds the top keywords by volume, so a keyword missing from it may simply
 * have ranked below the cut.
 */
export function newEligibleCountries(
  prevCycle: string | null,
  brandDomains: readonly string[],
  fetches: readonly DiscoveryFetchInfo[],
): Set<string> {
  if (!prevCycle) return new Set()
  const mine = lowerSet(brandDomains)
  const complete = new Set<string>()
  for (const f of fetches) {
    const domain = f.domain.toLowerCase()
    if (f.cycle !== prevCycle || !mine.has(domain)) continue
    if (f.rowCount < ROWS_PER_CALL) complete.add(`${domain}|${f.country.toUpperCase()}`)
  }
  const domains = [...mine]
  return new Set(DISCOVERY_COUNTRIES.filter((c) => domains.every((d) => complete.has(`${d}|${c}`))))
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
  newEligible:     ReadonlySet<string>
  tracked:         ReadonlyMap<string, ReadonlySet<string>>
  brand:           { name: string; mainDomain: string; domains: readonly string[] }
  selectedDomains: readonly string[]
  countries:       readonly string[]
  kwFilter:        string
  kwExact:         boolean
}): DiscoveryListItem[] {
  const selected = lowerSet(input.selectedDomains)
  const countries = new Set(input.countries.map((c) => c.toUpperCase()))
  // Same matching as the BP Sites keyword search.
  const filter = input.kwFilter.trim().toLowerCase()
  const mainDomain = input.brand.mainDomain.toLowerCase()
  const domainOrder = input.brand.domains.map((d) => d.toLowerCase())
  const rank = (domain: string) => (domain.toLowerCase() === mainDomain ? -1 : domainOrder.indexOf(domain.toLowerCase()))
  // NEW is a brand-level fact, whatever sites are selected now.
  const previous = new Set(input.prevRows.map((r) => `${normalizeKeyword(r.keyword)}|${r.country}`))

  const groups = new Map<string, DiscoveryRow[]>()
  for (const row of input.rows) {
    if (!selected.has(row.domain.toLowerCase()) || !countries.has(row.country)) continue
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
      isNew:         input.newEligible.has(best.country) && !previous.has(key),
    }
  })

  return items.sort((a, b) =>
    (b.volume ?? -1) - (a.volume ?? -1) || a.position - b.position || a.keyword.localeCompare(b.keyword))
}
