// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  canonicalDomain, countOlderChecks, normalizeExports,
  type OpenSeoCell, type OpenSeoExport, type OpenSeoKeyword, type OpenSeoMarket,
} from './sitesNormalize.js'
// The sync uses the parser's normalizer rather than its own — the two must not
// diverge, because applyCarryForward byte-compares the country it produces.
import { normalizeCountry } from './brands.js'

const AU: OpenSeoMarket = { locationCode: 2036, countryCode: 'AU', locationName: null }
const CA: OpenSeoMarket = { locationCode: 2124, countryCode: 'CA', locationName: null }

/**
 * One market's cells across `weeks`: positions[i] is the result for weeks[i].
 * `undefined` means that run never checked the keyword, so it gets no cell —
 * exactly how OpenSEO's export marks "not checked".
 */
function series(weeks: string[], positions: Array<number | null | undefined>): Record<string, OpenSeoCell> {
  const cells: Record<string, OpenSeoCell> = {}
  positions.forEach((position, i) => {
    // previous/status are OpenSEO's own view; the normalizer must not need them.
    if (position !== undefined) cells[weeks[i]] = { position, previous: null, status: 'new' }
  })
  return cells
}

function kw(keyword: string, cells: OpenSeoKeyword['cells']): OpenSeoKeyword {
  return { keyword, cells }
}

function exportFor(
  domain: string,
  weeks: string[],
  keywords: OpenSeoKeyword[],
  markets: OpenSeoMarket[] = [AU, CA],
): OpenSeoExport {
  return { domain, weeks, markets, keywords }
}

const W1 = '2026-10-20'
const W2 = '2026-10-27'
const W3 = '2026-11-03'

describe('canonicalDomain', () => {
  it('lowercases and strips a leading www.', () => {
    expect(canonicalDomain('WWW.Rooster.BET')).toBe('rooster.bet')
    expect(canonicalDomain('  Spinjo.io ')).toBe('spinjo.io')
  })
})

describe('normalizeCountry (shared with the xlsx parser)', () => {
  it('maps through COUNTRY_LABELS', () => {
    expect(normalizeCountry('AU')).toBe('AU')
    expect(normalizeCountry('Germany')).toBe('DE')
  })
  it('keeps an unmapped value rather than dropping it, uppercased', () => {
    expect(normalizeCountry('fr')).toBe('FR')
  })
  it('folds case on full country names, as an uploaded file would', () => {
    // Carry-forward keys on this string without case-folding it, so a
    // mismatch would split synced and uploaded rows into two countries.
    expect(normalizeCountry('australia')).toBe('AU')
    expect(normalizeCountry('new zealand')).toBe('NZ')
  })
  it('tolerates null/undefined', () => {
    expect(normalizeCountry(null)).toBe('')
    expect(normalizeCountry(undefined)).toBe('')
    expect(normalizeCountry('  ')).toBe('')
  })
})

describe('normalizeExports', () => {
  it('takes each keyword × market from its newest checked week', () => {
    const weeks = [W2, W3]
    const { records, rawDate } = normalizeExports([
      exportFor('rooster.bet', weeks, [
        kw('rooster bet', { '2036': series(weeks, [4, 2]), '2124': series(weeks, [6, undefined]) }),
      ]),
    ])
    const au = records.find((r) => r.country === 'AU')!
    const ca = records.find((r) => r.country === 'CA')!
    expect(au).toMatchObject({ position: '2', date: W3 })
    expect(ca).toMatchObject({ position: '6', date: W2 })
    expect(rawDate).toBe(W3)
  })

  it('never turns an unchecked week into NR', () => {
    const weeks = [W3]
    const { records } = normalizeExports([
      exportFor('rooster.bet', weeks, [
        // AU checked and not found; CA never checked in the window.
        kw('rooster bet', { '2036': series(weeks, [null]), '2124': {} }),
      ]),
    ])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ country: 'AU', position: 'NR' })
  })

  it('previous is the previous checked week, NR when that check found nothing, blank when there is none', () => {
    const three = [W1, W2, W3]
    const two = [W2, W3]
    const pick = (positions: Array<number | null | undefined>, weeks: string[]) =>
      normalizeExports([
        exportFor('rooster.bet', weeks, [kw('rooster bet', { '2036': series(weeks, positions) })]),
      ]).records[0]

    expect(pick([5, null, 3], three)).toMatchObject({ position: '3', previous: 'NR', change: '' })
    expect(pick([7, 4], two)).toMatchObject({ position: '4', previous: '7', change: '+3' })
    expect(pick([4, 9], two)).toMatchObject({ position: '9', previous: '4', change: '-5' })
    expect(pick([6, 6], two)).toMatchObject({ position: '6', previous: '6', change: '0' })
    expect(pick([8, undefined, 2], three)).toMatchObject({ position: '2', previous: '8', change: '+6' })
    expect(pick([3, null], two)).toMatchObject({ position: 'NR', previous: '3', change: '' })
    expect(pick([undefined, 2], two)).toMatchObject({ position: '2', previous: '', change: '' })
  })

  it('maps markets to dashboard country codes and skips city-only or unlabelled markets', () => {
    const weeks = [W3]
    // A city tracker carries its country's location code (OpenSEO stores
    // Auckland under NZ's 2554); with no national NZ tracker it is not a
    // country ranking, so it is skipped.
    const auckland: OpenSeoMarket = { locationCode: 2554, countryCode: 'NZ', locationName: 'Auckland,New Zealand' }
    const unlabelled: OpenSeoMarket = { locationCode: 9999, countryCode: null, locationName: null }
    const { records } = normalizeExports([
      exportFor(
        'rooster.bet',
        weeks,
        [kw('rooster bet', {
          '2036': series(weeks, [1]),
          '2554': series(weeks, [2]),
          '9999': series(weeks, [3]),
        })],
        [AU, auckland, unlabelled],
      ),
    ])
    expect(records.map((r) => [r.country, r.position])).toEqual([['AU', '1']])
  })

  it('refuses a city tracker that shares its national market, rather than report its ranks as national', () => {
    // OpenSEO's export keys cells by location code, and a city tracker uses
    // the same code as the national one — the two are merged and
    // indistinguishable, so any record from that code could be either.
    const sydney: OpenSeoMarket = { locationCode: 2036, countryCode: 'AU', locationName: 'Sydney,New South Wales,Australia' }
    expect(() =>
      normalizeExports([
        exportFor('rooster.bet', [W3], [kw('rooster bet', { '2036': series([W3], [41]) })], [AU, sydney]),
      ]),
    ).toThrow(/rooster\.bet.*Sydney/)
  })

  it('keeps only BP domains, canonicalised', () => {
    const weeks = [W3]
    const cells = { '2036': series(weeks, [1]) }
    const { records, unknownDomains } = normalizeExports([
      exportFor('WWW.Rooster.bet', weeks, [kw('rooster bet', cells)]),
      exportFor('example.com', weeks, [kw('example', cells)]),
    ])
    expect(records.map((r) => r.domain)).toEqual(['rooster.bet'])
    expect(unknownDomains).toEqual([{ domain: 'example.com', count: 1 }])
  })

  it('collapses a domain listed twice to one row per keyword and country, newer check wins', () => {
    const newer = exportFor('rooster.bet', [W3], [kw('Rooster Bet', { '2036': series([W3], [5]) })])
    const older = exportFor('www.rooster.bet', [W2], [kw('rooster bet', { '2036': series([W2], [9]) })])
    // Whichever order the two listings arrive in.
    for (const batch of [[newer, older], [older, newer]]) {
      const { records } = normalizeExports(batch)
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ domain: 'rooster.bet', position: '5', date: W3 })
    }
  })

  it('returns no records for an empty export', () => {
    const { records, rawDate, unknownDomains } = normalizeExports([exportFor('rooster.bet', [], [])])
    expect(records).toEqual([])
    expect(rawDate).toBe('')
    expect(unknownDomains).toEqual([])
  })

  it('produces a RankingRecord the storage layer accepts', () => {
    const weeks = [W2, W3]
    const { records } = normalizeExports([
      exportFor('rooster.bet', weeks, [kw(' rooster bet ', { '2036': series(weeks, [1, null]) })]),
    ])
    expect(records).toEqual([{
      domain:             'rooster.bet',
      keyword:            'rooster bet',
      country:            'AU',
      position:           'NR',
      previous:           '1',
      change:             '',
      date:               W3,
      searchVolume:       '',
      affiliateUrl:       '',
      globalSearchVolume: '',
    }])
  })
})

describe('countOlderChecks', () => {
  it('counts records dated before the snapshot date', () => {
    const records = [{ date: W3 }, { date: W2 }, { date: '' }]
    expect(countOlderChecks(records, W3)).toBe(1)
  })
})
