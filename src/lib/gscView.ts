import { brandCountries, isReported, type Brand } from './brands'
import type { GscRow } from '../../api/_lib/gsc.js'

export type GscFilters = { countries: string[]; search: string; page1: boolean }
export type GscView = 'rankings' | 'google'
export type GscDays = 7 | 28 | 90

/** How many rows the table adds each time "Show more" is pressed. */
export const PAGE_STEP = 200

export function filterRows(rows: GscRow[], f: GscFilters): GscRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (f.countries.length === 0 || f.countries.includes(r.country)) &&
      (!q || r.query.toLowerCase().includes(q)) &&
      (!f.page1 || r.position <= 10),
  )
}

export function sortByImpressions(rows: GscRow[]): GscRow[] {
  return [...rows].sort(
    (a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query),
  )
}

export function countriesOf(rows: GscRow[]): string[] {
  const total = new Map<string, number>()
  for (const r of rows) total.set(r.country, (total.get(r.country) ?? 0) + r.impressions)
  return [...total.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([c]) => c)
}

export function readGscParams(search: URLSearchParams): { view: GscView; gsite: string | null; days: GscDays } {
  const view = search.get('view') === 'google' ? 'google' : 'rankings'
  const gsite = search.get('gsite')?.trim() || null
  const d = Number(search.get('days'))
  const days: GscDays = d === 7 || d === 28 || d === 90 ? d : 28
  return { view, gsite, days }
}

/** A new URLSearchParams with `view` added or removed and nothing else changed. */
export function withView(search: URLSearchParams, view: GscView): URLSearchParams {
  const next = new URLSearchParams(search)
  if (view === 'google') next.set('view', 'google')
  else next.delete('view')
  return next
}

/** The brand's BP sites that are reported in at least one of its markets; main domain first. */
export function reportedBpDomains(brand: Brand): string[] {
  const countries = brandCountries(brand)
  const kept = brand.domains.filter((d) => countries.some((c) => isReported(d, c)))
  const main = brand.mainDomain
  return kept.includes(main) ? [main, ...kept.filter((d) => d !== main)] : kept
}

/**
 * Which site the Google tab opens on: ?gsite= if reported, else the one site the
 * Rankings tab is showing, else the main domain. Like BPSites, it picks ONE source
 * first (?site= over the path filter) and does not fall back to the other when that
 * source matches nothing (the Rankings tab then shows every site).
 */
export function defaultSite(
  brand: Brand,
  domainFilter: string | undefined,
  siteParam: string | null,
  gsite: string | null,
): string {
  const reported = reportedBpDomains(brand)
  const g = gsite?.trim().toLowerCase()
  if (g && reported.includes(g)) return g
  const src = siteParam ?? domainFilter
  if (src) {
    const matched = reported.filter((d) => src.split(',').map((x) => x.trim().toLowerCase()).includes(d))
    if (matched.length === 1) return matched[0]
  }
  return brand.mainDomain
}
