// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { nrLabelFor } from './nrLabel'

const PAGE_1 = {
  text:  'Not on page 1',
  title: "Ahrefs saves Google's first page for each search; this site wasn't on it.",
}

describe('nrLabelFor', () => {
  // Ahrefs Rank Tracker saves only Google's first page (median 9 organic
  // results, never past 25 in a 70-page sample), so its "not ranking" means
  // "not on page 1". The BP weeks from Nov 3, 2026 come from Ahrefs.
  it("says 'Not on page 1' for BP weeks from the first Ahrefs week on", () => {
    expect(nrLabelFor({ rawDate: '2026-11-03', category: 'bp-sites' })).toEqual(PAGE_1)
    expect(nrLabelFor({ rawDate: '2026-11-24', category: 'bp-sites' })).toEqual(PAGE_1)
  })

  it("keeps 'Not in top 100' for BP weeks checked before Ahrefs", () => {
    expect(nrLabelFor({ rawDate: '2026-10-27', category: 'bp-sites' })).toEqual({ text: 'Not in top 100' })
  })

  it("keeps 'Not in top 100' for LP Sites, whatever the date", () => {
    expect(nrLabelFor({ rawDate: '2026-11-24', category: 'lp-sites' })).toEqual({ text: 'Not in top 100' })
  })
})
