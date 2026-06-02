import type { Snapshot, RankingRecord } from '../types'
import type { CategoryId } from './categories'
import { DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND } from './brands'
import { parsePosition } from './parser'
import type {
  HistoryDigest, BrandSnapshotStat, Mover, Transition, RangeMovers,
} from '../components/Assistant/types'

const MAX_SNAPSHOTS    = 12
const MAX_MOVERS       = 20
const MAX_RANGE_MOVERS = 15
const MAX_TRANSITIONS  = 15
const MAX_COUNTRIES    = 8
const MAX_TOP_KEYWORDS = 5

function recordKey(r: RankingRecord): string {
  return `${r.domain.toLowerCase()}|${r.keyword.toLowerCase()}|${r.country}`
}

function brandOf(domain: string, category: CategoryId): string | undefined {
  const map = category === 'lp-sites' ? LP_DOMAIN_TO_BRAND : DOMAIN_TO_BRAND
  return map[domain.toLowerCase()]
}

function numericPos(pos: string | undefined): number | null {
  if (!pos) return null
  const p = parsePosition(pos)
  return typeof p === 'number' ? p : null
}

function perBrandStats(records: RankingRecord[], category: CategoryId): BrandSnapshotStat[] {
  type CountryAcc = { sum: number; count: number; top3: number; top10: number }
  type BrandAcc = {
    sum: number; count: number; top3: number; top10: number
    byCountry: Map<string, CountryAcc>
    topKeywords: { keyword: string; country: string; position: number }[]
  }
  const acc = new Map<string, BrandAcc>()

  for (const r of records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const pos = parsePosition(r.position)
    if (typeof pos !== 'number') continue

    let a = acc.get(brand)
    if (!a) {
      a = { sum: 0, count: 0, top3: 0, top10: 0, byCountry: new Map(), topKeywords: [] }
      acc.set(brand, a)
    }

    a.sum += pos
    a.count += 1
    if (pos <= 3) a.top3 += 1
    if (pos <= 10) a.top10 += 1

    let c = a.byCountry.get(r.country)
    if (!c) { c = { sum: 0, count: 0, top3: 0, top10: 0 }; a.byCountry.set(r.country, c) }
    c.sum += pos
    c.count += 1
    if (pos <= 3) c.top3 += 1
    if (pos <= 10) c.top10 += 1

    a.topKeywords.push({ keyword: r.keyword, country: r.country, position: pos })
  }

  return Array.from(acc.entries()).map(([brand, a]) => {
    const byCountry = Array.from(a.byCountry.entries())
      .map(([country, c]) => ({
        country,
        rankingKeywords: c.count,
        avgPosition: Math.round((c.sum / c.count) * 10) / 10,
        top3: c.top3,
        top10: c.top10,
      }))
      .sort((x, y) => y.rankingKeywords - x.rankingKeywords)
      .slice(0, MAX_COUNTRIES)

    const topKeywords = [...a.topKeywords]
      .sort((x, y) => x.position - y.position)
      .slice(0, MAX_TOP_KEYWORDS)

    return {
      brand,
      rankingKeywords: a.count,
      avgPosition: a.count ? Math.round((a.sum / a.count) * 10) / 10 : 0,
      top3: a.top3,
      top10: a.top10,
      byCountry,
      topKeywords,
    }
  })
}

function computeMovers(
  latest: Snapshot,
  prev: Snapshot,
  category: CategoryId,
  cap: number,
): Mover[] {
  const prevByKey = new Map(prev.records.map((r) => [recordKey(r), r]))
  const movers: Mover[] = []

  for (const r of latest.records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const before = prevByKey.get(recordKey(r))
    if (!before) continue
    const pNow = parsePosition(r.position)
    const pPrev = parsePosition(before.position)
    if (typeof pNow !== 'number' || typeof pPrev !== 'number') continue
    const delta = pNow - pPrev
    if (delta === 0) continue
    movers.push({ brand, keyword: r.keyword, country: r.country, from: before.position, to: r.position, delta })
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return movers.slice(0, cap)
}

function computeTransitions(
  latest: Snapshot,
  prev: Snapshot,
  category: CategoryId,
): { gained: Transition[]; lost: Transition[] } {
  const prevByKey = new Map(prev.records.map((r) => [recordKey(r), r]))
  const gained: Transition[] = []
  const lost: Transition[] = []

  for (const r of latest.records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const before = prevByKey.get(recordKey(r))
    if (!before) continue
    const pNow = parsePosition(r.position)
    const pPrev = parsePosition(before.position)

    if (pPrev === 'NR' && typeof pNow === 'number') {
      gained.push({ brand, keyword: r.keyword, country: r.country, to: r.position })
    } else if (typeof pPrev === 'number' && pNow === 'NR') {
      lost.push({ brand, keyword: r.keyword, country: r.country, from: before.position })
    }
  }

  gained.sort((a, b) => (numericPos(a.to) ?? Infinity) - (numericPos(b.to) ?? Infinity))
  lost.sort((a, b) => (numericPos(a.from) ?? Infinity) - (numericPos(b.from) ?? Infinity))

  return { gained: gained.slice(0, MAX_TRANSITIONS), lost: lost.slice(0, MAX_TRANSITIONS) }
}

export function buildHistoryDigest(snapshots: Snapshot[], category: CategoryId): HistoryDigest {
  const inCat = snapshots.filter((s) => s.category === category)
  const capped = inCat.slice(0, MAX_SNAPSHOTS)

  const brandSet = new Set<string>()
  const timeline = capped.map((s) => {
    const perBrand = perBrandStats(s.records, category)
    perBrand.forEach((b) => brandSet.add(b.brand))
    return { date: s.displayDate, rawDate: s.rawDate, perBrand }
  })

  const movers = capped.length >= 2
    ? computeMovers(capped[0], capped[1], category, MAX_MOVERS)
    : []

  const { gained, lost } = capped.length >= 2
    ? computeTransitions(capped[0], capped[1], category)
    : { gained: [], lost: [] }

  const rangeMovers: RangeMovers = {
    fromDate: capped.length >= 2 ? capped[capped.length - 1].displayDate : '',
    toDate: capped[0]?.displayDate ?? '',
    movers: capped.length > 2
      ? computeMovers(capped[0], capped[capped.length - 1], category, MAX_RANGE_MOVERS)
      : [],
  }

  return {
    category,
    generatedFor: capped[0]?.displayDate ?? '',
    brands: Array.from(brandSet).sort(),
    timeline,
    movers,
    gained,
    lost,
    rangeMovers,
  }
}
