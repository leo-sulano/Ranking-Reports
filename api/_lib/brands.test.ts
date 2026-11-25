// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND, RETIRED_DOMAINS, brandCountries, isReported,
} from './brands.js'

describe('RoosterBet markets (client focus from 2026-11-25: AU, CA, IT, NZ)', () => {
  it('no longer lists casinoroosters.com as a RoosterBet site', () => {
    expect(BRAND_BY_NAME['RoosterBet'].domains).not.toContain('casinoroosters.com')
    expect(DOMAIN_TO_BRAND['casinoroosters.com']).toBeUndefined()
    expect(LP_DOMAIN_TO_BRAND['casinoroosters.com']).toBeUndefined()
  })

  it('keeps casinoroosters.com on the retired list, so the sync skips it quietly', () => {
    expect(RETIRED_DOMAINS.has('casinoroosters.com')).toBe(true)
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

describe('retired domains', () => {
  it('belong to no brand', () => {
    for (const d of RETIRED_DOMAINS) {
      expect(DOMAIN_TO_BRAND[d]).toBeUndefined()
      expect(LP_DOMAIN_TO_BRAND[d]).toBeUndefined()
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
