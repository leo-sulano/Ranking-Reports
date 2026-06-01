import type { Snapshot, RankingRecord } from '../types'
import type { CategoryId } from './categories'
import { DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND } from './brands'
import { parsePosition } from './parser'
import type { HistoryDigest, BrandSnapshotStat, Mover } from '../components/Assistant/types'

const MAX_SNAPSHOTS = 12
const MAX_MOVERS = 20

function brandOf(domain: string, category: CategoryId): string | undefined {
  const map = category === 'lp-sites' ? LP_DOMAIN_TO_BRAND : DOMAIN_TO_BRAND
  return map[domain.toLowerCase()]
}

function perBrandStats(records: RankingRecord[], category: CategoryId): BrandSnapshotStat[] {
  // brand → { sum, count, top3, top10 }
  const acc = new Map<string, { sum: number; count: number; top3: number; top10: number }>()
  for (const r of records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const pos = parsePosition(r.position)
    if (typeof pos !== 'number') continue   // 'NR' and null excluded from math
    let a = acc.get(brand)
    if (!a) { a = { sum: 0, count: 0, top3: 0, top10: 0 }; acc.set(brand, a) }
    a.sum += pos
    a.count += 1
    if (pos <= 3) a.top3 += 1
    if (pos <= 10) a.top10 += 1
  }
  return Array.from(acc.entries()).map(([brand, a]) => ({
    brand,
    rankingKeywords: a.count,
    avgPosition: a.count ? Math.round((a.sum / a.count) * 10) / 10 : 0,
    top3: a.top3,
    top10: a.top10,
  }))
}

function computeMovers(latest: Snapshot, prev: Snapshot, category: CategoryId): Mover[] {
  const key = (r: RankingRecord) => `${r.domain.toLowerCase()}|${r.keyword.toLowerCase()}|${r.country}`
  const prevByKey = new Map(prev.records.map((r) => [key(r), r]))
  const movers: Mover[] = []
  for (const r of latest.records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const before = prevByKey.get(key(r))
    if (!before) continue
    const pNow = parsePosition(r.position)
    const pPrev = parsePosition(before.position)
    // Only score movers where both ends are numeric — delta is meaningful then.
    if (typeof pNow !== 'number' || typeof pPrev !== 'number') continue
    const delta = pNow - pPrev          // negative = moved toward #1 = improved
    if (delta === 0) continue
    movers.push({ brand, keyword: r.keyword, country: r.country, from: before.position, to: r.position, delta })
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return movers.slice(0, MAX_MOVERS)
}

export function buildHistoryDigest(snapshots: Snapshot[], category: CategoryId): HistoryDigest {
  const inCat = snapshots.filter((s) => s.category === category)
  // snapshots arrive newest-first from App state; keep that order, cap at 12.
  const capped = inCat.slice(0, MAX_SNAPSHOTS)

  const brandSet = new Set<string>()
  const timeline = capped.map((s) => {
    const perBrand = perBrandStats(s.records, category)
    perBrand.forEach((b) => brandSet.add(b.brand))
    return { date: s.displayDate, rawDate: s.rawDate, perBrand }
  })

  const movers = capped.length >= 2 ? computeMovers(capped[0], capped[1], category) : []

  return {
    category,
    generatedFor: capped[0]?.displayDate ?? '',
    brands: Array.from(brandSet).sort(),
    timeline,
    movers,
  }
}
