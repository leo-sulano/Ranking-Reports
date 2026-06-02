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

// ---------------------------------------------------------------------------
// byCountry
// ---------------------------------------------------------------------------
describe('byCountry', () => {
  it('aggregates per-country stats within a brand', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    const rb = d.timeline[0].perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.byCountry).toHaveLength(1)
    const de = rb.byCountry[0]
    expect(de.country).toBe('Germany')
    expect(de.rankingKeywords).toBe(2)  // positions 2 and 11
    expect(de.top3).toBe(1)             // position 2
    expect(de.top10).toBe(1)            // position 2 (11 > 10)
    expect(de.avgPosition).toBe(6.5)    // (2 + 11) / 2
  })

  it('caps byCountry at 8 countries sorted by rankingKeywords desc', () => {
    const countries = ['DE', 'GB', 'AU', 'NZ', 'CA', 'US', 'ZA', 'IE', 'MT']
    const manyRecs = countries.map((c, i) => rec('rooster.bet', `kw${i}`, c, String(i + 1)))
    const d = buildHistoryDigest(
      [{ id: 'x', category: 'bp-sites', rawDate: '2026-05-20', displayDate: '20 May 26', records: manyRecs }],
      'bp-sites',
    )
    const rb = d.timeline[0].perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.byCountry).toHaveLength(8)
  })

  it('sorts byCountry by rankingKeywords desc', () => {
    const records = [
      rec('rooster.bet', 'kw1', 'GB', '2'),
      rec('rooster.bet', 'kw2', 'GB', '4'),  // GB: 2 keywords
      rec('rooster.bet', 'kw3', 'DE', '1'),  // DE: 1 keyword
    ]
    const d = buildHistoryDigest(
      [{ id: 'x', category: 'bp-sites', rawDate: '2026-05-20', displayDate: '20 May 26', records }],
      'bp-sites',
    )
    const rb = d.timeline[0].perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.byCountry[0].country).toBe('GB')   // 2 keywords — sorted first
    expect(rb.byCountry[1].country).toBe('DE')   // 1 keyword — sorted second
  })
})

// ---------------------------------------------------------------------------
// topKeywords
// ---------------------------------------------------------------------------
describe('topKeywords', () => {
  it('returns the 5 best numeric positions, excludes NR', () => {
    const records = [
      rec('rooster.bet', 'kw1', 'DE', '3'),
      rec('rooster.bet', 'kw2', 'DE', '1'),
      rec('rooster.bet', 'kw3', 'DE', 'NR'),
      rec('rooster.bet', 'kw4', 'DE', '7'),
      rec('rooster.bet', 'kw5', 'DE', '2'),
      rec('rooster.bet', 'kw6', 'DE', '5'),
    ]
    const d = buildHistoryDigest(
      [{ id: 'x', category: 'bp-sites', rawDate: '2026-05-20', displayDate: '20 May 26', records }],
      'bp-sites',
    )
    const rb = d.timeline[0].perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.topKeywords).toHaveLength(5)
    expect(rb.topKeywords[0]).toMatchObject({ keyword: 'kw2', position: 1 })
    expect(rb.topKeywords.some((k) => k.keyword === 'kw3')).toBe(false)
  })

  it('returns all keywords when fewer than 5 numeric positions exist', () => {
    const records = [
      rec('rooster.bet', 'kw1', 'DE', '3'),
      rec('rooster.bet', 'kw2', 'DE', 'NR'),
    ]
    const d = buildHistoryDigest(
      [{ id: 'x', category: 'bp-sites', rawDate: '2026-05-20', displayDate: '20 May 26', records }],
      'bp-sites',
    )
    const rb = d.timeline[0].perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.topKeywords).toHaveLength(1)
    expect(rb.topKeywords[0]).toMatchObject({ keyword: 'kw1', position: 3 })
  })
})

// ---------------------------------------------------------------------------
// gained / lost
// ---------------------------------------------------------------------------

function gainedLostSnaps(): Snapshot[] {
  return [
    {
      id: 's2', category: 'bp-sites' as const, rawDate: '2026-05-20', displayDate: '20 May 26',
      records: [
        rec('rooster.bet', 'casino', 'Germany', '5'),  // numeric → numeric — NOT a transition
        rec('rooster.bet', 'slots',  'Germany', 'NR'), // numeric → NR — lost
        rec('rooster.bet', 'poker',  'Germany', '8'),  // NR → numeric — gained
      ],
    },
    {
      id: 's1', category: 'bp-sites' as const, rawDate: '2026-05-13', displayDate: '13 May 26',
      records: [
        rec('rooster.bet', 'casino', 'Germany', '3'),
        rec('rooster.bet', 'slots',  'Germany', '6'),
        rec('rooster.bet', 'poker',  'Germany', 'NR'),
      ],
    },
  ]
}

describe('gained and lost', () => {
  it('detects NR → numeric as gained and excludes numeric-to-numeric', () => {
    const d = buildHistoryDigest(gainedLostSnaps(), 'bp-sites')
    expect(d.gained).toHaveLength(1)
    expect(d.gained[0]).toMatchObject({ keyword: 'poker', country: 'Germany', to: '8' })
  })

  it('detects numeric → NR as lost and excludes numeric-to-numeric', () => {
    const d = buildHistoryDigest(gainedLostSnaps(), 'bp-sites')
    expect(d.lost).toHaveLength(1)
    expect(d.lost[0]).toMatchObject({ keyword: 'slots', country: 'Germany', from: '6' })
  })

  it('returns empty gained/lost with fewer than 2 snapshots', () => {
    const d = buildHistoryDigest([gainedLostSnaps()[0]], 'bp-sites')
    expect(d.gained).toEqual([])
    expect(d.lost).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// rangeMovers
// ---------------------------------------------------------------------------

const threeSnaps: Snapshot[] = [
  {
    id: 's3', category: 'bp-sites', rawDate: '2026-06-01', displayDate: '01 Jun 26',
    records: [rec('rooster.bet', 'casino', 'DE', '2')],
  },
  {
    id: 's2', category: 'bp-sites', rawDate: '2026-05-15', displayDate: '15 May 26',
    records: [rec('rooster.bet', 'casino', 'DE', '5')],
  },
  {
    id: 's1', category: 'bp-sites', rawDate: '2026-05-01', displayDate: '01 May 26',
    records: [rec('rooster.bet', 'casino', 'DE', '10')],
  },
]

describe('rangeMovers', () => {
  it('uses the oldest snapshot as baseline, not the prior snapshot', () => {
    const d = buildHistoryDigest(threeSnaps, 'bp-sites')
    expect(d.rangeMovers.fromDate).toBe('01 May 26')
    expect(d.rangeMovers.toDate).toBe('01 Jun 26')
    const casino = d.rangeMovers.movers.find((m) => m.keyword === 'casino')!
    expect(casino).toMatchObject({ from: '10', to: '2', delta: -8 })
  })

  it('returns empty movers with fewer than 2 snapshots', () => {
    const d = buildHistoryDigest([threeSnaps[0]], 'bp-sites')
    expect(d.rangeMovers.movers).toEqual([])
  })

  it('returns empty movers with exactly 2 snapshots (same pair as movers)', () => {
    const d = buildHistoryDigest(threeSnaps.slice(0, 2), 'bp-sites')
    expect(d.rangeMovers.movers).toEqual([])
  })
})
