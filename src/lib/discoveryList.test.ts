import { describe, it, expect } from 'vitest'
import type { DiscoveryRow } from '../../api/_lib/keywordDiscovery.js'
import {
  buildDiscoveryList, completeCycles, cycleCompletedAt, newEligibleCountries, positionKindLabel, previousCycle,
  type DiscoveryFetchInfo,
} from './discoveryList'

const BRAND = { name: 'SpinsUp', mainDomain: 'spinsup.com', domains: ['spinsup.com', 'spinsup.io'] }
const COUNTRIES = ['AU', 'CA', 'DE', 'IT', 'NZ']

const fetched = (cycle: string, domain: string, country: string, fetchedAt = `${cycle}T05:00:00Z`, rowCount = 10): DiscoveryFetchInfo =>
  ({ cycle, domain, country, fetchedAt, rowCount })
/** Every domain × country of the brand fetched in `cycle`. */
const fullCycle = (cycle: string) => BRAND.domains.flatMap((d) => COUNTRIES.map((c) => fetched(cycle, d, c)))

describe('completeCycles', () => {
  it('only counts a cycle once every domain has every country', () => {
    const december = fullCycle('2026-12-05').filter((f) => !(f.domain === 'spinsup.io' && f.country === 'NZ'))
    expect(completeCycles(BRAND.domains, [...fullCycle('2026-11-05'), ...december])).toEqual(['2026-11-05'])
  })

  it('lists complete cycles newest first', () => {
    expect(completeCycles(BRAND.domains, [...fullCycle('2026-11-05'), ...fullCycle('2026-12-05')]))
      .toEqual(['2026-12-05', '2026-11-05'])
  })

  it("is not fooled by another brand's fetches", () => {
    const almost = fullCycle('2026-11-05').filter((f) => !(f.domain === 'spinsup.com' && f.country === 'AU'))
    expect(completeCycles(BRAND.domains, [...almost, fetched('2026-11-05', 'spinjo.com', 'AU')])).toEqual([])
  })
})

describe('previousCycle', () => {
  it("is the brand's newest cycle before the given one", () => {
    const fetches = [...fullCycle('2026-10-05'), ...fullCycle('2026-11-05'), fetched('2026-12-05', 'spinsup.com', 'AU')]
    expect(previousCycle('2026-12-05', BRAND.domains, fetches)).toBe('2026-11-05')
  })

  it('is null when nothing older exists for this brand', () => {
    expect(previousCycle('2026-11-05', BRAND.domains, [...fullCycle('2026-11-05'), fetched('2026-10-05', 'spinjo.com', 'AU')]))
      .toBeNull()
  })
})

describe('newEligibleCountries', () => {
  it('allows NEW only where the previous cycle has every domain', () => {
    const fetches = [
      fetched('2026-11-05', 'spinsup.com', 'AU'), fetched('2026-11-05', 'spinsup.io', 'AU'),
      fetched('2026-11-05', 'spinsup.com', 'CA'),
    ]
    expect(newEligibleCountries('2026-11-05', BRAND.domains, fetches)).toEqual(new Set(['AU']))
  })

  // Each pair stores at most 50 keywords: when last month's list was cut off,
  // a keyword missing from it may simply have ranked below the cut.
  it('withholds NEW where a previous list hit the 50-row cap', () => {
    const fetches = [
      fetched('2026-11-05', 'spinsup.com', 'AU', undefined, 50), fetched('2026-11-05', 'spinsup.io', 'AU', undefined, 12),
      fetched('2026-11-05', 'spinsup.com', 'CA', undefined, 49), fetched('2026-11-05', 'spinsup.io', 'CA', undefined, 0),
    ]
    expect(newEligibleCountries('2026-11-05', BRAND.domains, fetches)).toEqual(new Set(['CA']))
  })

  it('allows none without a previous cycle', () => {
    expect(newEligibleCountries(null, BRAND.domains, fullCycle('2026-11-05'))).toEqual(new Set())
  })
})

describe('cycleCompletedAt', () => {
  it("is the brand's last fetch in that cycle", () => {
    const fetches = [
      fetched('2026-11-05', 'spinsup.com', 'AU', '2026-11-06T05:00:00Z'),
      fetched('2026-11-05', 'spinsup.io', 'NZ', '2026-11-08T05:10:00Z'),
      fetched('2026-11-05', 'spinjo.com', 'AU', '2026-11-09T05:00:00Z'),
      fetched('2026-12-05', 'spinsup.com', 'AU', '2026-12-06T05:00:00Z'),
    ]
    expect(cycleCompletedAt('2026-11-05', BRAND.domains, fetches)).toBe('2026-11-08T05:10:00Z')
    expect(cycleCompletedAt('2026-10-05', BRAND.domains, fetches)).toBeNull()
  })
})

describe('positionKindLabel', () => {
  it.each([
    ['organic', null], [null, null], ['ai_overview', 'AI Overview'], ['image', 'Image'], ['knowledge_panel', 'Knowledge panel'],
  ] as Array<[string | null, string | null]>)('%s → %s', (kind, label) => {
    expect(positionKindLabel(kind)).toBe(label)
  })
})

describe('buildDiscoveryList', () => {
  const row = (over: Partial<DiscoveryRow>): DiscoveryRow => ({
    cycle: '2026-12-05', brand: 'SpinsUp', domain: 'spinsup.com', country: 'AU', keyword: 'spinsup bonus', position: 5,
    positionKind: 'organic', url: 'https://spinsup.com/bonus', volume: 450, ahrefsChecked: '2026-12-01T00:00:00Z', ...over,
  })
  const input = (over: Partial<Parameters<typeof buildDiscoveryList>[0]>) => ({
    rows: [] as DiscoveryRow[], prevRows: [] as DiscoveryRow[], newEligible: new Set<string>(),
    tracked: new Map<string, Set<string>>(), brand: BRAND, selectedDomains: BRAND.domains, countries: COUNTRIES,
    kwFilter: '', kwExact: false, ...over,
  })
  const keywords = (items: Array<{ keyword: string; country: string }>) => items.map((i) => `${i.keyword}|${i.country}`)

  it('describes each keyword fully', () => {
    expect(buildDiscoveryList(input({ rows: [row({ positionKind: 'ai_overview' })] }))).toEqual([{
      keyword: 'spinsup bonus', country: 'AU', site: 'spinsup.com', position: 5, positionKind: 'ai_overview', volume: 450,
      url: 'https://spinsup.com/bonus', ahrefsChecked: '2026-12-01T00:00:00Z', isNew: false,
    }])
  })

  it('leaves out keywords tracked for that brand and country, however they are written', () => {
    const list = buildDiscoveryList(input({
      rows: [row({ keyword: 'SpinsUp  Login' }), row({ keyword: 'spinsup bonus' }), row({ keyword: 'spinsup login', country: 'CA' })],
      tracked: new Map([['SpinsUp|AU', new Set(['spinsup login'])]]),
    }))
    expect(keywords(list)).toEqual(['spinsup bonus|AU', 'spinsup login|CA'])
  })

  it('shows each keyword and country once, at its best site', () => {
    const better = buildDiscoveryList(input({ rows: [
      row({ keyword: 'spinsup app', domain: 'spinsup.com', position: 4 }),
      row({ keyword: 'spinsup app', domain: 'spinsup.io', position: 3, url: 'https://spinsup.io/app' }),
    ] }))
    expect(better).toHaveLength(1)
    expect(better[0]).toMatchObject({ site: 'spinsup.io', position: 3, url: 'https://spinsup.io/app' })

    const tie = buildDiscoveryList(input({ rows: [
      row({ keyword: 'spinsup app', domain: 'spinsup.io', position: 4 }),
      row({ keyword: 'spinsup app', domain: 'spinsup.com', position: 4 }),
    ] }))
    expect(tie.map((i) => i.site)).toEqual(['spinsup.com'])
  })

  it("takes the group's search volume even when the best site's row lacks it", () => {
    const list = buildDiscoveryList(input({ rows: [
      row({ keyword: 'spinsup app', domain: 'spinsup.io', position: 2, volume: null }),
      row({ keyword: 'spinsup app', domain: 'spinsup.com', position: 9, volume: 300 }),
    ] }))
    expect(list[0]).toMatchObject({ site: 'spinsup.io', volume: 300 })
  })

  it('follows the Sites and Countries filters', () => {
    const rows = [
      row({ keyword: 'spinsup app', domain: 'spinsup.com', position: 1 }),
      row({ keyword: 'spinsup app', domain: 'spinsup.io', position: 6 }),
      row({ keyword: 'spinsup casino', country: 'CA' }),
    ]
    expect(buildDiscoveryList(input({ rows, selectedDomains: ['spinsup.io'] })).map((i) => [i.keyword, i.site, i.position]))
      .toEqual([['spinsup app', 'spinsup.io', 6]])
    expect(keywords(buildDiscoveryList(input({ rows, countries: ['CA'] })))).toEqual(['spinsup casino|CA'])
  })

  it('follows the keyword search, contains or exact, ignoring case', () => {
    const rows = [row({ keyword: 'spinsup bonus' }), row({ keyword: 'spinsup bonus code' }), row({ keyword: 'spinsup app' })]
    expect(buildDiscoveryList(input({ rows, kwFilter: ' BONUS ' })).map((i) => i.keyword).sort())
      .toEqual(['spinsup bonus', 'spinsup bonus code'])
    expect(buildDiscoveryList(input({ rows, kwFilter: 'spinsup bonus', kwExact: true })).map((i) => i.keyword))
      .toEqual(['spinsup bonus'])
  })

  it('sorts by search volume, missing last, then by position', () => {
    const list = buildDiscoveryList(input({ rows: [
      row({ keyword: 'a', volume: 450 }), row({ keyword: 'b', volume: null }), row({ keyword: 'c', volume: 900 }),
      row({ keyword: 'd', volume: 300, position: 7 }), row({ keyword: 'e', volume: 300, position: 2 }),
    ] }))
    expect(list.map((i) => i.keyword)).toEqual(['c', 'a', 'e', 'd', 'b'])
  })

  it('marks NEW only for keywords the brand lacked last cycle, where last cycle is complete', () => {
    const list = buildDiscoveryList(input({
      rows: [
        row({ keyword: 'spinsup bonus' }), row({ keyword: 'spinsup app' }), row({ keyword: 'spinsup app', country: 'CA' }),
      ],
      prevRows: [row({ cycle: '2026-11-05', keyword: 'SpinsUp  Bonus', domain: 'spinsup.io' })],
      newEligible: new Set(['AU']),
    }))
    expect(list.map((i) => [i.keyword, i.country, i.isNew])).toEqual(expect.arrayContaining([
      ['spinsup bonus', 'AU', false], ['spinsup app', 'AU', true], ['spinsup app', 'CA', false],
    ]))
  })

  it('marks nothing NEW without a previous cycle', () => {
    const list = buildDiscoveryList(input({ rows: [row({ keyword: 'spinsup app' }), row({ keyword: 'spinsup bonus' })] }))
    expect(list.every((i) => !i.isNew)).toBe(true)
  })
})
