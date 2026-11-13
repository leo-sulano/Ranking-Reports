// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { BRANDS, DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND } from './brands.js'
import {
  cycleStart, discoveryPairs, excludeKeywordsWhere, mapOrganicKeywords, normalizeKeyword, pairKey, trackedIndex,
} from './keywordDiscovery.js'

describe('discoveryPairs', () => {
  it('covers exactly the 37 BP domains in all five countries, brand by brand, and no LP-only domain', () => {
    const pairs = discoveryPairs(BRANDS)
    expect(pairs).toHaveLength(185)
    expect(new Set(pairs.map((p) => pairKey(p.domain, p.country))).size).toBe(185)
    expect(pairs.slice(0, 5)).toEqual(
      ['AU', 'CA', 'DE', 'IT', 'NZ'].map((country) => ({ brand: 'Lucky 7even', domain: 'lucky7even.com', country })),
    )
    for (const p of pairs) expect(DOMAIN_TO_BRAND[p.domain]).toBe(p.brand)

    // brands.ts lists lucky7evencasino.org as both a BP and an LP domain, so
    // it belongs here; a domain that is ONLY an LP domain never does.
    const domains = new Set(pairs.map((p) => p.domain))
    expect([...domains].sort()).toEqual(Object.keys(DOMAIN_TO_BRAND).sort())
    const lpOnly = Object.keys(LP_DOMAIN_TO_BRAND).filter((d) => !(d in DOMAIN_TO_BRAND))
    expect(lpOnly.length).toBeGreaterThan(0)
    for (const d of lpOnly) expect(domains.has(d)).toBe(false)
  })

  it('lower-cases the domains it is given', () => {
    expect(discoveryPairs([{ name: 'X', domains: ['Example.COM'] }])[0])
      .toEqual({ brand: 'X', domain: 'example.com', country: 'AU' })
  })
})

describe('pairKey', () => {
  it('keys a pair by lower-case domain and upper-case country', () => {
    expect(pairKey('SpinsUp.com', 'au')).toBe('spinsup.com|AU')
  })
})

describe('cycleStart', () => {
  it.each([
    ['2026-12-05T00:00:00Z', '2026-11-05'],
    ['2027-01-05T00:00:00Z', '2026-12-05'],
    ['2026-03-31T00:00:00Z', '2026-02-28'],
    ['2024-03-30T00:00:00Z', '2024-02-29'],
    // Late in the UTC day: a local-time reading shifts the day east of UTC.
    ['2026-12-05T23:30:00Z', '2026-11-05'],
  ])('the cycle reset on %s started on %s', (reset, start) => {
    expect(cycleStart(reset)).toBe(start)
  })

  it('throws on a reset date it cannot read', () => {
    expect(() => cycleStart('not a date')).toThrow()
  })
})

describe('normalizeKeyword', () => {
  it('lower-cases, trims and collapses whitespace', () => {
    expect(normalizeKeyword('  Lucky 7even \t  Casino ')).toBe('lucky 7even casino')
  })

  it('composes decomposed characters (NFC)', () => {
    expect(normalizeKeyword('spielbank münchen')).toBe('spielbank münchen')
  })
})

describe('mapOrganicKeywords', () => {
  const CTX = { cycle: '2026-11-05', brand: 'SpinsUp', domain: 'spinsup.com', country: 'AU' } as const
  const ROW = {
    keyword: 'spinsup login', best_position: 3, best_position_url: 'https://spinsup.com/login', volume: 900,
    last_update: '2026-11-01T10:00:00Z', best_position_kind: 'organic',
  }

  it('maps an Ahrefs row to a stored row', () => {
    expect(mapOrganicKeywords({ keywords: [ROW] }, CTX)).toEqual([{
      cycle: '2026-11-05', brand: 'SpinsUp', domain: 'spinsup.com', country: 'AU', keyword: 'spinsup login',
      position: 3, positionKind: 'organic', url: 'https://spinsup.com/login', volume: 900,
      ahrefsChecked: '2026-11-01T10:00:00Z',
    }])
  })

  it('keeps null volume, url, check date and kind as empty values', () => {
    const [row] = mapOrganicKeywords({ keywords: [{
      ...ROW, volume: null, best_position_url: null, last_update: null, best_position_kind: null,
    }] }, CTX)
    expect(row).toMatchObject({ volume: null, url: '', ahrefsChecked: null, positionKind: null })
  })

  it('skips a row without a position and a row with a blank keyword', () => {
    const rows = mapOrganicKeywords({ keywords: [
      { ...ROW, best_position: null }, { ...ROW, keyword: '  ' }, { ...ROW, keyword: 'spinsup app' },
    ] }, CTX)
    expect(rows.map((r) => r.keyword)).toEqual(['spinsup app'])
  })

  it('collapses keywords that differ only in case or spacing, keeping the best position', () => {
    const worseFirst = mapOrganicKeywords({ keywords: [
      { ...ROW, keyword: 'SpinsUp Login', best_position: 9 }, { ...ROW, keyword: 'spinsup login', best_position: 3 },
    ] }, CTX)
    const betterFirst = mapOrganicKeywords({ keywords: [
      { ...ROW, keyword: 'spinsup login', best_position: 3 }, { ...ROW, keyword: 'SpinsUp  Login', best_position: 9 },
    ] }, CTX)
    expect(worseFirst.map((r) => r.position)).toEqual([3])
    expect(betterFirst.map((r) => r.position)).toEqual([3])
  })

  it('skips a row whose values have the wrong type, keeping the rest', () => {
    const rows = mapOrganicKeywords({ keywords: [
      { ...ROW, keyword: 'spinsup app', best_position: '3' },
      { ...ROW, keyword: 'spinsup vip', volume: 'lots' },
      { ...ROW, keyword: 42 },
      { ...ROW, keyword: 'spinsup login' },
    ] }, CTX)
    expect(rows.map((r) => r.keyword)).toEqual(['spinsup login'])
  })

  const { best_position: _omitted, ...rowWithoutPosition } = ROW
  const { volume: _alsoOmitted, ...rowWithoutVolume } = ROW
  it.each([
    ['no keywords array', {}],
    ['keywords that are not an array', { keywords: 'x' }],
    ['no body at all', null],
    ['a row without best_position', { keywords: [rowWithoutPosition] }],
    ['a row without volume', { keywords: [rowWithoutVolume] }],
    ['a position that is not a number', { keywords: [{ ...ROW, best_position: '3' }] }],
  ])('throws on %s', (_label, body) => {
    expect(() => mapOrganicKeywords(body, CTX)).toThrow(/unexpected organic-keywords response for spinsup.com \(AU\)/)
  })
})

describe('trackedIndex', () => {
  it('groups tracked keywords by brand and country, normalized, ignoring unknown domains', () => {
    const index = trackedIndex([
      { domain: 'spinsup.io', keyword: 'SpinsUp  Casino', country: 'au' },
      { domain: 'SpinsUp.COM', keyword: 'spinsup', country: 'AU' },
      { domain: 'unknown.com', keyword: 'x', country: 'AU' },
    ], DOMAIN_TO_BRAND)
    expect([...index.keys()]).toEqual(['SpinsUp|AU'])
    expect([...index.get('SpinsUp|AU')!].sort()).toEqual(['spinsup', 'spinsup casino'])
  })
})

describe('excludeKeywordsWhere', () => {
  it('is undefined when nothing is tracked', () => {
    expect(excludeKeywordsWhere([])).toBeUndefined()
  })

  it('excludes each normalized keyword once, in a stable order', () => {
    const expected =
      '{"not":{"or":[{"field":"keyword","is":["eq","rooster casino"]},{"field":"keyword","is":["eq","rooster.bet"]}]}}'
    expect(excludeKeywordsWhere(['Rooster Casino', 'rooster casino', 'rooster.bet'])).toBe(expected)
    expect(excludeKeywordsWhere(new Set(['rooster.bet', 'rooster casino']))).toBe(expected)
  })
})
