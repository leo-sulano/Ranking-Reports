// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  canonicalDomain, countOlderChecks, normalizeExports,
  type OpenSeoCell, type OpenSeoExport, type OpenSeoKeyword, type OpenSeoMarket,
} from './sitesNormalize.js'
// The sync uses the parser's normalizer rather than its own — the two must not
// diverge, because applyCarryForward byte-compares the country it produces.
import { normalizeCountry } from './brands.js'
import {
  bpDomainOf, cycleDate, hostOf, normalizeAhrefs, SyncDataError,
  type AhrefsKeywordRow, type AhrefsProject,
} from './sitesNormalize.js'

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

// ── Ahrefs Rank Tracker ──────────────────────────────────────────────────────

const NOV3  = '2026-11-03T10:45:56Z'
const OCT27 = '2026-10-27T10:42:38Z'
type Slot = [url: string | null, position: number | null, prev: number | null]

/** One keyword row: `slots` are the target first, then the competitors in project order. */
function row(keyword: string, country: string, slots: Slot[], opts: Partial<AhrefsKeywordRow> = {}): AhrefsKeywordRow {
  return {
    keyword, country, language: country === 'DE' ? 'de' : country === 'IT' ? 'it' : 'en',
    serp_updated: NOV3, serp_updated_prev: OCT27,
    competitors_list: slots.map(([url, position, position_prev]) => ({ url, position, position_prev })),
    ...opts,
  }
}
const project = (projectId: number, target: string, competitors: string[], rows: AhrefsKeywordRow[]): AhrefsProject =>
  ({ projectId, name: `Project ${projectId}`, target, competitors, rows })
const at = <T extends { domain: string }>(records: T[], domain: string) => records.find((r) => r.domain === domain)

describe('hostOf / bpDomainOf', () => {
  it('reads a bare host or a full URL, without www.', () => {
    expect(hostOf('rooster.bet/')).toBe('rooster.bet')
    expect(hostOf('https://www.SpinsUp.com/en-CA')).toBe('spinsup.com')
    expect(hostOf(null)).toBe('')
  })
  it('maps a host to its BP domain, subdomains included, and nothing else', () => {
    expect(bpDomainOf('rooster.bet')).toBe('rooster.bet')
    expect(bpDomainOf('au.spinsup.com')).toBe('spinsup.com')
    expect(bpDomainOf('luckyvibe.net')).toBe('')   // an LP domain
    expect(bpDomainOf('example.com')).toBe('')
  })
})

describe('cycleDate', () => {
  const d = (date: string) => ({ date })
  it('is the weekly update day, not a later re-check', () => {
    expect(cycleDate([d('2026-11-03'), d('2026-11-03'), d('2026-11-04'), d('2026-11-08')])).toBe('2026-11-03')
  })
  it('counts only the 7 days up to the newest check', () => {
    // Mid-Tuesday: last week's rows still outnumber this week's.
    expect(cycleDate([d('2026-10-27'), d('2026-10-27'), d('2026-10-27'), d('2026-11-03')])).toBe('2026-11-03')
  })
  it('gives a tie to the later date and ignores undated records', () => {
    expect(cycleDate([d('2026-11-03'), d('2026-11-04'), d('')])).toBe('2026-11-04')
    expect(cycleDate([])).toBe('')
  })
})

describe('normalizeAhrefs', () => {
  it("turns every slot of a checked row into its domain's record", () => {
    const { records, rawDate, unknownDomains } = normalizeAhrefs([project(1, 'spinsupcasino.com/',
      ['spinsup.com/', 'spinsup.io/', 'casinospinsup.com/'], [row('spins up casino', 'NZ', [
        ['https://spinsupcasino.com/', 14, null],
        ['https://www.spinsup.com/', 1, 1],
        ['https://spinsup.io/', 17, 20],
        [null, null, null],
      ])])])
    expect(rawDate).toBe('2026-11-03')
    expect(unknownDomains).toEqual([])
    expect(records).toHaveLength(4)
    expect(at(records, 'spinsupcasino.com')).toEqual({
      domain: 'spinsupcasino.com', keyword: 'spins up casino', country: 'NZ', position: '14', previous: 'NR',
      change: '', date: '2026-11-03', searchVolume: '', affiliateUrl: '', globalSearchVolume: '',
    })
    expect(at(records, 'spinsup.com')).toMatchObject({ position: '1', previous: '1', change: '0' })
    expect(at(records, 'spinsup.io')).toMatchObject({ position: '17', previous: '20', change: '+3' })
    // An empty slot is NR for that slot's domain, never a missing row.
    expect(at(records, 'casinospinsup.com')).toMatchObject({ position: 'NR', previous: 'NR', change: '' })
  })

  it('makes no record for a keyword Ahrefs has not checked', () => {
    const result = normalizeAhrefs([project(1, 'spinsup.io/', [], [
      row('spinsup', 'AU', [[null, null, null]], { serp_updated: null, serp_updated_prev: null })])])
    expect(result).toEqual({ records: [], unknownDomains: [], rawDate: '' })
  })

  it('leaves Previous blank unless the previous check is from an earlier day', () => {
    const sameDay = normalizeAhrefs([project(1, 'spinsup.io/', [], [row('spinsup', 'AU',
      [['https://spinsup.io/', 2, 5]], { serp_updated: OCT27, serp_updated_prev: '2026-10-27T08:00:00Z' })])])
    expect(sameDay.records[0]).toMatchObject({ position: '2', previous: '', change: '' })
    const never = normalizeAhrefs([project(1, 'spinsup.io/', [], [row('spinsup', 'AU',
      [['https://spinsup.io/', 2, null]], { serp_updated_prev: null })])])
    expect(never.records[0]).toMatchObject({ previous: '', change: '' })
  })

  it('treats a zero or negative position as NR', () => {
    const { records } = normalizeAhrefs([project(1, 'spinsup.io/', [], [row('spinsup', 'AU', [['https://spinsup.io/', 0, null]])])])
    expect(records[0].position).toBe('NR')
  })

  it("stops when a ranked URL sits in another domain's slot", () => {
    const swapped = [project(1, 'spinsupcasino.com/', ['spinsup.com/', 'spinsup.io/'], [row('spinsup', 'AU', [
      [null, null, null], ['https://spinsup.io/', 3, 3], [null, null, null]])])]
    expect(() => normalizeAhrefs(swapped)).toThrow(SyncDataError)
    expect(() => normalizeAhrefs(swapped)).toThrow(
      `Ahrefs listed spinsup.io in spinsup.com's slot in "Project 1" — the competitor order changed, so nothing was saved`)
  })

  it('stops when a row has a different number of positions than the project has sites', () => {
    expect(() => normalizeAhrefs([project(1, 'spinsup.io/', ['spinsup.com/'], [row('spinsup', 'AU', [[null, null, null]])])]))
      .toThrow('Ahrefs returned 1 positions for 2 sites in "Project 1" — nothing was saved')
  })

  it("prefers a site's own project, then the best same-day position", () => {
    const { records } = normalizeAhrefs([
      project(1, 'roostersbet.com/', ['rooster.bet/'], [row('roosterbet casino', 'AU', [
        ['https://roostersbet.com/', 1, null], [null, null, null]])]),
      project(2, 'roosters.bet/', ['roostersbet.com/', 'rooster.bet/'], [row('roosterbet casino', 'AU', [
        [null, null, null], [null, null, null], ['https://rooster.bet/', 1, null]])]),
    ])
    expect(at(records, 'roostersbet.com')?.position).toBe('1')   // its own project says 1; project 2 says NR
    expect(at(records, 'rooster.bet')?.position).toBe('1')       // competitor-only: the best of NR and 1
    expect(at(records, 'roosters.bet')?.position).toBe('NR')
  })

  it("keeps a site's own project number even when another project saw it higher that day", () => {
    const { records } = normalizeAhrefs([
      project(1, 'roostersbet.com/', [], [row('roosterbet casino', 'AU', [['https://roostersbet.com/', 7, null]])]),
      project(2, 'roosters.bet/', ['roostersbet.com/'], [row('roosterbet casino', 'AU',
        [[null, null, null], ['https://roostersbet.com/', 2, null]])]),
    ])
    expect(at(records, 'roostersbet.com')?.position).toBe('7')
  })

  it('takes the newer check when two projects checked on different days', () => {
    const { records } = normalizeAhrefs([
      project(1, 'roostersbet.com/', [], [row('roosterbet casino', 'AU', [['https://roostersbet.com/', 1, null]])]),
      project(2, 'roosters.bet/', ['roostersbet.com/'], [row('roosterbet casino', 'AU',
        [[null, null, null], ['https://roostersbet.com/', 5, null]], { serp_updated: '2026-11-04T09:00:00Z' })]),
    ])
    expect(at(records, 'roostersbet.com')).toMatchObject({ position: '5', date: '2026-11-04' })
  })

  it("keeps only the target brand's domains and lists the unknown ones", () => {
    const { records, unknownDomains } = normalizeAhrefs([project(3, 'spinsup.io/',
      ['rooster.bet/', 'spinjo.de/', 'luckyvibe.net/'], [row('spinsup', 'AU', [
        ['https://spinsup.io/', 2, 2], ['https://rooster.bet/', 3, 3],
        ['https://spinjo.de/', 4, 4], ['https://luckyvibe.net/', 5, 5]])])])
    expect(records.map((r) => r.domain)).toEqual(['spinsup.io'])
    // rooster.bet is another brand's BP site. luckyvibe.net is a known LP site, so it is not listed.
    expect(unknownDomains).toEqual([{ domain: 'rooster.bet', count: 1 }, { domain: 'spinjo.de', count: 1 }])
  })

  it('ignores a project whose target is not a BP domain', () => {
    expect(normalizeAhrefs([project(4, 'trybet.ca/', ['rooster.bet/'], [row('trybet', 'CA',
      [['https://trybet.ca/', 1, 1], ['https://rooster.bet/', 2, 2]])])]))
      .toEqual({ records: [], unknownDomains: [], rawDate: '' })
  })

  it("keeps the market's main language when a keyword is tracked in two", () => {
    const { records } = normalizeAhrefs([project(1, 'spinsup.io/', [], [
      row('spinsup', 'CA', [['https://spinsup.io/', 9, 9]], { language: 'fr' }),
      row('spinsup', 'CA', [['https://spinsup.io/', 2, 2]]),
    ])])
    expect(records).toHaveLength(1)
    expect(records[0].position).toBe('2')
  })

  it('normalizes the country the way uploads do', () => {
    const { records } = normalizeAhrefs([project(1, 'spinsup.io/', [], [row('spinsup', 'au', [['https://spinsup.io/', 2, 2]])])])
    expect(records[0].country).toBe('AU')
  })
})
