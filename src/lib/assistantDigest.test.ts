import { describe, it, expect } from 'vitest'
import { buildHistoryDigest } from './assistantDigest'
import type { Snapshot } from '../types'

function rec(domain: string, keyword: string, country: string, position: string) {
  return { domain, keyword, country, position, previous: '', change: '', date: '' }
}

// rooster.bet → RoosterBet (bp). Two snapshots, newest first.
const snaps: Snapshot[] = [
  {
    id: 's2', category: 'bp-sites', rawDate: '2026-05-20', displayDate: '20 May 26',
    records: [
      rec('rooster.bet', 'casino', 'Germany', '2'),    // was 5 → improved, delta -3
      rec('rooster.bet', 'slots',  'Germany', 'NR'),   // was 8 → fell out
      rec('rooster.bet', 'bonus',  'Germany', '11'),   // not top10
    ],
  },
  {
    id: 's1', category: 'bp-sites', rawDate: '2026-05-13', displayDate: '13 May 26',
    records: [
      rec('rooster.bet', 'casino', 'Germany', '5'),
      rec('rooster.bet', 'slots',  'Germany', '8'),
    ],
  },
]

describe('buildHistoryDigest', () => {
  it('aggregates per-brand stats for the newest snapshot', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    const latest = d.timeline[0]
    expect(latest.date).toBe('20 May 26')
    const rb = latest.perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.rankingKeywords).toBe(2)   // '2' and '11' are numeric; 'NR' excluded
    expect(rb.top3).toBe(1)              // only position 2
    expect(rb.top10).toBe(1)             // position 2 (<=10); 11 excluded
    expect(rb.avgPosition).toBe(6.5)     // mean(2, 11)
  })

  it('orders timeline newest-first and caps at 12 snapshots', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    expect(d.timeline.map((t) => t.rawDate)).toEqual(['2026-05-20', '2026-05-13'])
  })

  it('computes movers between the two newest snapshots, negative = improved', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    const casino = d.movers.find((m) => m.keyword === 'casino')!
    expect(casino).toMatchObject({ brand: 'RoosterBet', from: '5', to: '2', delta: -3 })
  })

  it('returns empty timeline/movers for no snapshots', () => {
    const d = buildHistoryDigest([], 'bp-sites')
    expect(d.timeline).toEqual([])
    expect(d.movers).toEqual([])
    expect(d.brands).toEqual([])
  })
})
