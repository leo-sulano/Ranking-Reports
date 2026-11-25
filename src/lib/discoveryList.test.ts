import { describe, it, expect } from 'vitest'
import type { DiscoveryRow } from '../../api/_lib/keywordDiscovery.js'
import {
  buildDiscoveryList, buildFoundRows, completeCycles, cycleCompletedAt, newEligibility, positionKindLabel, previousCycle,
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

  it("needs only the brand's own markets when it has them", () => {
    const noDe = fullCycle('2026-12-05').filter((f) => f.country !== 'DE')
    expect(completeCycles(BRAND.domains, noDe, ['AU', 'CA', 'IT', 'NZ'])).toEqual(['2026-12-05'])
    expect(completeCycles(BRAND.domains, noDe)).toEqual([])
  })

  it('counts a cycle where every site has an ALL fetch', () => {
    const all = BRAND.domains.map((d) => fetched('2026-12-05', d, 'ALL'))
    expect(completeCycles(BRAND.domains, all)).toEqual(['2026-12-05'])
  })

  it('counts a mixed cycle: one site ALL, the other every country', () => {
    const mixed = [
      fetched('2026-11-05', 'spinsup.com', 'ALL'),
      ...COUNTRIES.map((c) => fetched('2026-11-05', 'spinsup.io', c)),
    ]
    expect(completeCycles(BRAND.domains, mixed)).toEqual(['2026-11-05'])
  })

  it('does not count a cycle where one site has neither', () => {
    const partial = [fetched('2026-11-05', 'spinsup.com', 'ALL'), fetched('2026-11-05', 'spinsup.io', 'AU')]
    expect(completeCycles(BRAND.domains, partial)).toEqual([])
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

describe('newEligibility', () => {
  it('allows NEW only where the previous cycle has every domain', () => {
    const fetches = [
      fetched('2026-11-05', 'spinsup.com', 'AU'), fetched('2026-11-05', 'spinsup.io', 'AU'),
      fetched('2026-11-05', 'spinsup.com', 'CA'),
    ]
    const eligible = newEligibility('2026-11-05', BRAND.domains, fetches)
    expect([eligible('AU'), eligible('CA')]).toEqual([true, false])
  })

  // Each pair stores at most 50 keywords: when last month's list was cut off,
  // a keyword missing from it may simply have ranked below the cut.
  it('withholds NEW where a previous list hit the 50-row cap', () => {
    const fetches = [
      fetched('2026-11-05', 'spinsup.com', 'AU', undefined, 50), fetched('2026-11-05', 'spinsup.io', 'AU', undefined, 12),
      fetched('2026-11-05', 'spinsup.com', 'CA', undefined, 49), fetched('2026-11-05', 'spinsup.io', 'CA', undefined, 0),
    ]
    const eligible = newEligibility('2026-11-05', BRAND.domains, fetches)
    expect([eligible('AU'), eligible('CA')]).toEqual([false, true])
  })

  it('allows none without a previous cycle', () => {
    expect(newEligibility(null, BRAND.domains, fullCycle('2026-11-05'))('AU')).toBe(false)
  })

  it('lets an uncut ALL fetch for every site cover every country', () => {
    const eligible = newEligibility('2026-12-05', BRAND.domains, BRAND.domains.map((d) => fetched('2026-12-05', d, 'ALL')))
    expect([eligible('NO'), eligible('AU')]).toEqual([true, true])
  })

  it('covers nothing for a site whose ALL list hit the 200-row limit', () => {
    const fetches = [fetched('2026-12-05', 'spinsup.com', 'ALL', undefined, 200), fetched('2026-12-05', 'spinsup.io', 'ALL')]
    expect(newEligibility('2026-12-05', BRAND.domains, fetches)('NO')).toBe(false)
  })

  it("lets a per-country cycle cover only its own countries", () => {
    const eligible = newEligibility('2026-11-05', BRAND.domains, fullCycle('2026-11-05'))
    expect([eligible('AU'), eligible('NO')]).toEqual([true, false])
  })

  it("lets a site's ALL fetch supersede its cut per-country fetch in the same cycle", () => {
    const fetches = [
      fetched('2026-11-05', 'spinsup.com', 'AU', undefined, 50), fetched('2026-11-05', 'spinsup.com', 'ALL'),
      fetched('2026-11-05', 'spinsup.io', 'ALL'),
    ]
    expect(newEligibility('2026-11-05', BRAND.domains, fetches)('AU')).toBe(true)
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
    rows: [] as DiscoveryRow[], prevRows: [] as DiscoveryRow[], newEligible: (_country: string) => false,
    tracked: new Map<string, Set<string>>(), brand: BRAND, country: (code: string) => COUNTRIES.includes(code),
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

  // The page's Sites filter hides the main site by default; this list must not.
  it("lists every one of the brand's sites, main site included, and no other brand's", () => {
    const list = buildDiscoveryList(input({ rows: [
      row({ keyword: 'spin up casino', domain: 'spinsup.com', country: 'CA', position: 1 }),
      row({ keyword: 'spinsup login', domain: 'spinsup.io', position: 2 }),
      row({ keyword: 'spinjo bonus', domain: 'spinjo.com', position: 1 }),
    ] }))
    expect(list.map((i) => [i.keyword, i.site])).toEqual([['spin up casino', 'spinsup.com'], ['spinsup login', 'spinsup.io']])
  })

  it('follows the Countries filter', () => {
    const rows = [row({ keyword: 'spinsup app' }), row({ keyword: 'spinsup casino', country: 'CA' })]
    expect(keywords(buildDiscoveryList(input({ rows, country: (c) => c === 'CA' })))).toEqual(['spinsup casino|CA'])
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
      newEligible: (c) => c === 'AU',
    }))
    expect(list.map((i) => [i.keyword, i.country, i.isNew])).toEqual(expect.arrayContaining([
      ['spinsup bonus', 'AU', false], ['spinsup app', 'AU', true], ['spinsup app', 'CA', false],
    ]))
  })

  // Review Focus 2, list side: the brand's markets never land here, whatever the chips show.
  it("lists other countries only, when told the brand's markets", () => {
    const markets = ['AU', 'CA', 'IT', 'NZ']
    const list = buildDiscoveryList(input({
      rows: [row({ keyword: 'a', country: 'DE' }), row({ keyword: 'b', country: 'NO' }), row({ keyword: 'c', country: 'IT' })],
      country: (c) => !markets.includes(c),
    }))
    expect(keywords(list).sort()).toEqual(['a|DE', 'b|NO'])
  })

  it('marks nothing NEW without a previous cycle', () => {
    const list = buildDiscoveryList(input({ rows: [row({ keyword: 'spinsup app' }), row({ keyword: 'spinsup bonus' })] }))
    expect(list.every((i) => !i.isNew)).toBe(true)
  })
})

describe('buildFoundRows', () => {
  const ROOSTER = { name: 'RoosterBet', domains: ['rooster.bet', 'roosters.bet'] }
  const row = (over: Partial<DiscoveryRow>): DiscoveryRow => ({
    cycle: '2026-11-05', brand: 'RoosterBet', domain: 'rooster.bet', country: 'AU', keyword: 'rooster bet login', position: 2,
    positionKind: 'organic', url: 'https://rooster.bet/login', volume: 100, ahrefsChecked: '2026-11-20T00:00:00Z', ...over,
  })
  const found = (over: Partial<Parameters<typeof buildFoundRows>[0]>) => buildFoundRows({
    rows: [], tracked: new Map(), brand: ROOSTER, countries: ['AU', 'IT'], kwFilter: '', kwExact: false, ...over,
  })

  it('makes one row per keyword, a cell per site and country', () => {
    const rows = found({ rows: [
      row({}), row({ domain: 'roosters.bet', country: 'IT', keyword: 'Rooster Bet Login', position: 4, volume: 300 }),
    ] })
    expect(rows).toHaveLength(1)
    expect(rows[0].cells['rooster.bet'].AU.position).toBe(2)
    expect(rows[0].cells['roosters.bet'].IT.position).toBe(4)
    expect(rows[0].volume).toBe(300)
  })

  it("keeps only the brand's markets and its live sites", () => {
    const rows = found({ rows: [row({ country: 'NO' }), row({ domain: 'casinoroosters.com' })] })
    expect(rows).toEqual([])
  })

  it('keeps a keyword tracked in one market where it is not tracked', () => {
    const rows = found({
      rows: [row({ keyword: 'rooster casino', country: 'IT' }), row({ keyword: 'rooster casino', country: 'AU' })],
      tracked: new Map([['RoosterBet|IT', new Set(['rooster casino'])]]),
    })
    expect(Object.keys(rows[0].cells['rooster.bet'])).toEqual(['AU'])
  })

  it('drops a market switched off in the Countries chips', () => {
    const rows = found({ rows: [row({}), row({ country: 'IT' })], countries: ['AU'] })
    expect(Object.keys(rows[0].cells['rooster.bet'])).toEqual(['AU'])
  })

  it('follows the keyword search and sorts by search volume', () => {
    const rows = found({ rows: [
      row({ keyword: 'rooster login', volume: 50 }), row({ keyword: 'rooster bet login', volume: 900 }),
      row({ keyword: 'rooster casino', volume: 5000 }),
    ], kwFilter: 'login' })
    expect(rows.map((r) => r.keyword)).toEqual(['rooster bet login', 'rooster login'])
  })
})
