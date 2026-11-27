import { describe, it, expect } from 'vitest'
import {
  filterRows, sortByImpressions, countriesOf, readGscParams, withView, defaultSite, reportedBpDomains, PAGE_STEP,
} from './gscView'
import { BRAND_BY_SLUG } from './brands'
import type { GscRow } from '../../api/_lib/gsc.js'

const r = (query: string, country: string, position: number, clicks: number, impressions: number): GscRow =>
  ({ query, country, position, clicks, impressions })

const ROWS = [
  r('Rooster Bet', 'AU', 3, 5, 100),
  r('casino', 'CA', 12, 1, 300),
  r('slots', 'AU', 10, 2, 100),
  r('poker', 'NZ', 40, 0, 10),
]

describe('filterRows', () => {
  it('empty countries means all', () => {
    expect(filterRows(ROWS, { countries: [], search: '', page1: false })).toHaveLength(4)
  })
  it('filters by country', () => {
    expect(filterRows(ROWS, { countries: ['AU'], search: '', page1: false }).map((x) => x.query)).toEqual(['Rooster Bet', 'slots'])
  })
  it('search is trimmed, case-insensitive substring', () => {
    expect(filterRows(ROWS, { countries: [], search: '  ROOSTER ', page1: false })).toHaveLength(1)
    expect(filterRows(ROWS, { countries: [], search: 'o', page1: false })).toHaveLength(4)
  })
  it('page1 means position <= 10', () => {
    expect(filterRows(ROWS, { countries: [], search: '', page1: true }).map((x) => x.query)).toEqual(['Rooster Bet', 'slots'])
  })
})

describe('sortByImpressions', () => {
  it('sorts by impressions, clicks, query and does not mutate', () => {
    const copy = [...ROWS]
    const out = sortByImpressions(ROWS)
    expect(out.map((x) => x.query)).toEqual(['casino', 'Rooster Bet', 'slots', 'poker'])
    expect(ROWS).toEqual(copy)
  })
})

describe('countriesOf', () => {
  it('distinct, by total impressions desc, ties by code', () => {
    expect(countriesOf(ROWS)).toEqual(['CA', 'AU', 'NZ'])
    expect(countriesOf([r('a', 'DE', 1, 0, 5), r('b', 'AU', 1, 0, 5)])).toEqual(['AU', 'DE'])
  })
})

describe('readGscParams', () => {
  it('defaults', () => {
    expect(readGscParams(new URLSearchParams(''))).toEqual({ view: 'rankings', gsite: null, days: 28 })
  })
  it('reads valid values', () => {
    expect(readGscParams(new URLSearchParams('view=google&gsite=a.com&days=90'))).toEqual({ view: 'google', gsite: 'a.com', days: 90 })
  })
  it('bad values fall back', () => {
    expect(readGscParams(new URLSearchParams('view=x&days=30&gsite='))).toEqual({ view: 'rankings', gsite: null, days: 28 })
  })
})

describe('withView', () => {
  it('only toggles view and returns a new object', () => {
    const s = new URLSearchParams('site=a.com&kw=x&pos=1')
    const g = withView(s, 'google')
    expect(g).not.toBe(s)
    expect(g.get('view')).toBe('google')
    expect(g.get('site')).toBe('a.com')
    expect(g.get('kw')).toBe('x')
    expect(g.get('pos')).toBe('1')
    expect(s.has('view')).toBe(false)
    const back = withView(g, 'rankings')
    expect(back.has('view')).toBe(false)
    expect(back.toString()).toBe('site=a.com&kw=x&pos=1')
  })
})

describe('reportedBpDomains / defaultSite', () => {
  const rb = BRAND_BY_SLUG['roosterbet']
  it('hides retired domains and puts main first', () => {
    const d = reportedBpDomains(rb)
    expect(d[0]).toBe(rb.mainDomain)
    expect(d).not.toContain('casinoroosters.com')
    expect(new Set(d).size).toBe(d.length)
  })
  it('gsite wins when reported', () => {
    const d = reportedBpDomains(rb)
    expect(defaultSite(rb, undefined, 'x.com', d[d.length - 1])).toBe(d[d.length - 1])
  })
  it('a single reported filter or site param is used', () => {
    const d = reportedBpDomains(rb)
    const other = d[1]
    expect(defaultSite(rb, other, null, null)).toBe(other)
    expect(defaultSite(rb, undefined, other, null)).toBe(other)
  })
  it('comma lists, all and retired domains fall back to main', () => {
    const d = reportedBpDomains(rb)
    expect(defaultSite(rb, undefined, `${d[0]},${d[1]}`, null)).toBe(rb.mainDomain)
    expect(defaultSite(rb, undefined, 'all', null)).toBe(rb.mainDomain)
    expect(defaultSite(rb, 'casinoroosters.com', null, 'casinoroosters.com')).toBe(rb.mainDomain)
  })
  it('?site= wins over the path filter when both are present', () => {
    const d = reportedBpDomains(rb)
    expect(defaultSite(rb, d[1], d[2], null)).toBe(d[2])
  })
  it('a ?site= comma list beats a single path filter and gives main', () => {
    const d = reportedBpDomains(rb)
    expect(defaultSite(rb, d[1], `${d[1]},${d[2]}`, null)).toBe(rb.mainDomain)
  })
  it('an unmatched ?site= opens the main domain (Rankings shows BP sites without main; the Google tab needs one site)', () => {
    const d = reportedBpDomains(rb)
    expect(defaultSite(rb, d[1], 'casinoroosters.com', null)).toBe(rb.mainDomain)
  })
  it('gsite wins over both', () => {
    const d = reportedBpDomains(rb)
    expect(defaultSite(rb, d[1], d[2], d[0])).toBe(d[0])
  })
  it('exports PAGE_STEP', () => expect(PAGE_STEP).toBe(200))
})
