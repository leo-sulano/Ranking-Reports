// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  ALL_COUNTRIES, BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND, RETIRED_DOMAINS, brandCountries, isReported,
} from './brands.js'

describe('RoosterBet markets (client focus from 2026-11-25: AU, CA, IT, NZ)', () => {
  it('no longer lists casinoroosters.com as a RoosterBet site', () => {
    expect(BRAND_BY_NAME['RoosterBet'].domains).not.toContain('casinoroosters.com')
    expect(RETIRED_DOMAINS.has('casinoroosters.com')).toBe(true)
  })

  // The sync deletes and rewrites a week it replaces, and so does an xlsx
  // re-upload: a retired site must still be read in, or its stored rows go.
  it('still maps casinoroosters.com to RoosterBet, so the sync and imports keep storing it', () => {
    expect(DOMAIN_TO_BRAND['casinoroosters.com']).toBe('RoosterBet')
    expect(LP_DOMAIN_TO_BRAND['casinoroosters.com']).toBeUndefined()
  })

  it('reports RoosterBet in AU, CA, IT and NZ only, in the usual column order', () => {
    expect(brandCountries(BRAND_BY_NAME['RoosterBet'])).toEqual(['AU', 'CA', 'IT', 'NZ'])
  })

  it('leaves every other brand on all five markets', () => {
    for (const brand of BRANDS.filter((b) => b.name !== 'RoosterBet')) {
      expect(brandCountries(brand)).toEqual(['AU', 'CA', 'DE', 'IT', 'NZ'])
    }
  })
})

describe('brand config', () => {
  it("keeps each retired site out of its brand's live sites but under its brand", () => {
    for (const b of BRANDS) {
      for (const d of b.retiredDomains ?? []) {
        expect(b.domains).not.toContain(d)
        expect(DOMAIN_TO_BRAND[d]).toBe(b.name)
        expect(RETIRED_DOMAINS.has(d)).toBe(true)
      }
    }
  })

  // A typo such as 'de' or 'Germany' would silently hide a whole market.
  it('lists only known markets, in upper case', () => {
    for (const b of BRANDS) {
      for (const c of b.countries ?? []) expect(ALL_COUNTRIES).toContain(c)
    }
  })
})

describe('isReported', () => {
  it("drops a RoosterBet record outside the brand's markets, on BP and LP sites alike", () => {
    expect(isReported('rooster.bet', 'DE')).toBe(false)
    expect(isReported('Roosters.BET', 'Germany')).toBe(false)   // legacy full-name country, any case
    expect(isReported('roosterbet.club', 'DE')).toBe(false)     // an LP site
  })

  it('keeps a RoosterBet record in one of its markets', () => {
    expect(isReported('rooster.bet', 'AU')).toBe(true)
    expect(isReported('roosterbet.io', 'New Zealand')).toBe(true)
  })

  it("keeps any country for a brand that doesn't narrow its markets", () => {
    expect(isReported('spinsup.com', 'DE')).toBe(true)
    expect(isReported('spinsup.com', 'GB')).toBe(true)
  })

  it('drops a retired or unknown site', () => {
    expect(isReported('casinoroosters.com', 'AU')).toBe(false)
    expect(isReported('example.com', 'AU')).toBe(false)
  })
})
