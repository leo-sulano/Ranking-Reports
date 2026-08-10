import { describe, it, expect } from 'vitest'
import {
  canonicalDomain, positionToString, changeToString, checkedAtDate,
  normalizeCountry, reduceLatest, normalizeRows, type ApiRow,
} from './sitesNormalize'

/** A valid row with sane defaults; override only what a test cares about. */
function row(over: Partial<ApiRow> = {}): ApiRow {
  return {
    domain: 'rooster.bet',
    keyword: 'rooster bet',
    country: 'AU',
    language: 'en',
    position: 3,
    previous_position: 5,
    change: 2,
    url_found: 'https://www.rooster.bet/en-AU',
    checked_at: '2026-08-04 19:39:12',
    project_id: 0,
    ...over,
  }
}

describe('positionToString', () => {
  it('treats 0 as NR — the API uses 0, not null, for "not ranking"', () => {
    expect(positionToString(0)).toBe('NR')
  })
  it('treats null, empty and negatives as NR', () => {
    expect(positionToString(null)).toBe('NR')
    expect(positionToString('')).toBe('NR')
    expect(positionToString(-1)).toBe('NR')
    expect(positionToString('junk')).toBe('NR')
  })
  it('passes ranked positions through as strings', () => {
    expect(positionToString(1)).toBe('1')
    expect(positionToString('12')).toBe('12')
  })
})

describe('changeToString', () => {
  it('signs a positive change and leaves negatives signed', () => {
    expect(changeToString(2)).toBe('+2')
    expect(changeToString(-3)).toBe('-3')
  })
  it('renders no movement as 0 and a missing change as empty', () => {
    expect(changeToString(0)).toBe('0')
    expect(changeToString(null)).toBe('')
    expect(changeToString('junk')).toBe('')
  })
})

describe('canonicalDomain', () => {
  it('lowercases and strips a leading www.', () => {
    expect(canonicalDomain('WWW.Rooster.BET')).toBe('rooster.bet')
    expect(canonicalDomain('  Spinjo.io ')).toBe('spinjo.io')
  })
})

describe('checkedAtDate', () => {
  it('takes the date part of both the space and ISO forms', () => {
    expect(checkedAtDate('2026-08-04 19:39:12')).toBe('2026-08-04')
    expect(checkedAtDate('2026-08-04T19:39:12Z')).toBe('2026-08-04')
  })
  it('returns empty for missing or unparseable values', () => {
    expect(checkedAtDate('')).toBe('')
    expect(checkedAtDate(null)).toBe('')
    expect(checkedAtDate('soon')).toBe('')
  })
})

describe('normalizeCountry', () => {
  it('maps through COUNTRY_LABELS', () => {
    expect(normalizeCountry('AU')).toBe('AU')
    expect(normalizeCountry('Germany')).toBe('DE')
  })
  it('keeps an unmapped value rather than dropping it, uppercased', () => {
    expect(normalizeCountry('fr')).toBe('FR')
  })
})

describe('reduceLatest', () => {
  it('keeps the newest row per (domain, keyword, country)', () => {
    const out = reduceLatest([
      row({ position: 1, checked_at: '2026-07-29 10:00:00' }),
      row({ position: 9, checked_at: '2026-08-04 10:00:00' }),
      row({ position: 4, checked_at: '2026-07-15 10:00:00' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].position).toBe(9)
  })

  it('compares ISO and space-separated timestamps chronologically', () => {
    const out = reduceLatest([
      row({ position: 1, checked_at: '2026-08-04T23:00:00Z' }),
      row({ position: 2, checked_at: '2026-08-04 09:00:00' }),
    ])
    expect(out[0].position).toBe(1)
  })

  it('does not merge rows that differ by country', () => {
    expect(reduceLatest([row({ country: 'AU' }), row({ country: 'CA' })])).toHaveLength(2)
  })
})

describe('normalizeRows', () => {
  it('drops unknown domains and tallies them busiest-first', () => {
    const { records, unknownDomains } = normalizeRows([
      row(),
      row({ domain: 'cazeus.vip',  keyword: 'a' }),
      row({ domain: 'cazeus.vip',  keyword: 'b' }),
      row({ domain: 'alfcasino.digital', keyword: 'c' }),
    ])
    expect(records).toHaveLength(1)
    expect(unknownDomains).toEqual([
      { domain: 'cazeus.vip', count: 2 },
      { domain: 'alfcasino.digital', count: 1 },
    ])
  })

  it('keeps project-18 rows on Rooster domains — they fill keys project 0 did not check', () => {
    const { records } = normalizeRows([
      row({ domain: 'roosters.bet', project_id: 18, keyword: 'roosterbet' }),
    ])
    expect(records).toHaveLength(1)
    expect(records[0].domain).toBe('roosters.bet')
  })

  it('dates the snapshot from the newest KEPT row, ignoring foreign domains', () => {
    const { rawDate } = normalizeRows([
      row({ checked_at: '2026-07-29 10:00:00' }),
      row({ domain: 'rooster.bet', keyword: 'other', checked_at: '2026-08-04 10:00:00' }),
      row({ domain: 'cazeus.vip', keyword: 'x', checked_at: '2026-09-01 10:00:00' }),
    ])
    expect(rawDate).toBe('2026-08-04')
  })

  it('leaves an undated row undated rather than stamping it with the batch date', () => {
    const { records, rawDate } = normalizeRows([
      row({ keyword: 'dated',   checked_at: '2026-08-04 10:00:00' }),
      row({ keyword: 'undated', checked_at: '' }),
    ])
    expect(rawDate).toBe('2026-08-04')
    expect(records.find((r) => r.keyword === 'undated')!.date).toBe('')
  })

  it('produces a RankingRecord the storage layer accepts', () => {
    const { records } = normalizeRows([row({ position: 0, previous_position: 1, change: -1 })])
    expect(records[0]).toEqual({
      domain: 'rooster.bet',
      keyword: 'rooster bet',
      country: 'AU',
      position: 'NR',
      previous: '1',
      change: '-1',
      date: '2026-08-04',
      searchVolume: '',
      affiliateUrl: '',
      globalSearchVolume: '',
    })
  })

  it('returns empty results and no date for an all-foreign batch', () => {
    const { records, rawDate, unknownDomains } = normalizeRows([row({ domain: 'cazeus.vip' })])
    expect(records).toEqual([])
    expect(rawDate).toBe('')
    expect(unknownDomains).toHaveLength(1)
  })
})
