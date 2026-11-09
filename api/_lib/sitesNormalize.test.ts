// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  bpDomainOf, canonicalDomain, countOlderChecks, cycleDate, hostOf, normalizeAhrefs, SyncDataError,
  type AhrefsKeywordRow, type AhrefsProject,
} from './sitesNormalize.js'
// The sync uses the parser's normalizer rather than its own — the two must not
// diverge, because applyCarryForward byte-compares the country it produces.
import { normalizeCountry } from './brands.js'

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
