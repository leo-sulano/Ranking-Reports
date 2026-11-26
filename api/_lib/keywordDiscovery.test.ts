// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { BRANDS, DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND, RETIRED_DOMAINS } from './brands.js'
import {
  ROWS_PER_CALL, UNITS_PER_ROW, WORST_CASE_CALL_UNITS,
  cycleStart, discoveryTargets, mapOrganicKeywords, normalizeKeyword, pairKey, trackedIndex,
} from './keywordDiscovery.js'

describe('discoveryTargets', () => {
  it('lists every live BP site once, brand by brand, and no retired or LP-only site', () => {
    const targets = discoveryTargets(BRANDS)
    expect(targets).toHaveLength(36)
    expect(targets[0]).toEqual({ brand: 'Lucky 7even', domain: 'lucky7even.com' })
    expect(targets.some((t) => t.domain === 'casinoroosters.com')).toBe(false)
    for (const t of targets) expect(DOMAIN_TO_BRAND[t.domain]).toBe(t.brand)
    // brands.ts lists lucky7evencasino.org as both a BP and an LP domain, so
    // it belongs here; a domain that is ONLY an LP domain never does.
    const domains = targets.map((t) => t.domain)
    expect([...domains].sort()).toEqual(Object.keys(DOMAIN_TO_BRAND).filter((d) => !RETIRED_DOMAINS.has(d)).sort())
    const lpOnly = Object.keys(LP_DOMAIN_TO_BRAND).filter((d) => !(d in DOMAIN_TO_BRAND))
    expect(lpOnly.length).toBeGreaterThan(0)
    for (const d of lpOnly) expect(domains).not.toContain(d)
  })

  it('lower-cases the domains it is given', () => {
    expect(discoveryTargets([{ name: 'X', domains: ['Example.COM'] }])).toEqual([{ brand: 'X', domain: 'example.com' }])
  })
})

describe('call sizing', () => {
  it('asks for up to 200 keywords a site at 16 units a row', () => {
    expect(ROWS_PER_CALL).toBe(200)
    expect(UNITS_PER_ROW).toBe(16)
    expect(WORST_CASE_CALL_UNITS).toBe(ROWS_PER_CALL * UNITS_PER_ROW)
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
  const CTX = { cycle: '2026-11-05', brand: 'SpinsUp', domain: 'spinsup.com' } as const
  const ROW = {
    keyword: 'spinsup login', keyword_country: 'au', best_position: 3, best_position_url: 'https://spinsup.com/login',
    volume: 900, last_update: '2026-11-01T10:00:00Z', best_position_kind: 'organic',
  }

  it("takes each row's country from Ahrefs, upper-cased, whatever the country", () => {
    const rows = mapOrganicKeywords({ keywords: [{ ...ROW, keyword_country: 'no' }, { ...ROW, keyword: 'spinsup app' }] }, CTX)
    expect(rows.map((r) => [r.keyword, r.country])).toEqual([['spinsup login', 'NO'], ['spinsup app', 'AU']])
  })

  it('collapses duplicates per country, not across countries', () => {
    const rows = mapOrganicKeywords({ keywords: [
      { ...ROW, keyword: 'Rooster Bet', keyword_country: 'it', best_position: 5 },
      { ...ROW, keyword: 'rooster  bet', keyword_country: 'it', best_position: 2 },
      { ...ROW, keyword: 'rooster bet', keyword_country: 'au', best_position: 7 },
    ] }, CTX)
    expect(rows.map((r) => [r.country, r.position]).sort()).toEqual([['AU', 7], ['IT', 2]])
  })

  it('skips a row whose country is null or blank, keeping the rest', () => {
    const rows = mapOrganicKeywords({ keywords: [
      { ...ROW, keyword: 'a', keyword_country: null }, { ...ROW, keyword: 'b', keyword_country: '' }, ROW,
    ] }, CTX)
    expect(rows.map((r) => r.keyword)).toEqual(['spinsup login'])
  })

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
  const { keyword_country: _countryOmitted, ...rowWithoutCountry } = ROW
  it.each([
    ['no keywords array', {}],
    ['keywords that are not an array', { keywords: 'x' }],
    ['no body at all', null],
    ['a row without best_position', { keywords: [rowWithoutPosition] }],
    ['a row without volume', { keywords: [rowWithoutVolume] }],
    ['a row without keyword_country', { keywords: [rowWithoutCountry] }],
    ['a position that is not a number', { keywords: [{ ...ROW, best_position: '3' }] }],
  ])('throws on %s', (_label, body) => {
    expect(() => mapOrganicKeywords(body, CTX)).toThrow(/unexpected organic-keywords response for spinsup\.com$/)
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
