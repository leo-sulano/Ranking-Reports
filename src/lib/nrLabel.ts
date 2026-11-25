/**
 * What a "not ranking" (NR) cell says. Ahrefs Rank Tracker saves only Google's
 * first page for each search (a 2026-11-24 sample of 70 saved pages: median 9
 * organic results, never past 25), so for the BP weeks that come from Ahrefs,
 * NR means "not on page 1", not "not in the top 100". Older BP weeks (OpenSEO,
 * the Ranks API) and LP Sites (uploads) keep their old wording.
 * Design: docs/superpowers/specs/2026-11-25-all-countries-keywords-design.md
 */

/** The first BP week from Ahrefs: Nov 3, 2026 was replaced with Ahrefs data at the switch (PR #31). */
export const AHREFS_FIRST_WEEK = '2026-11-03'

export interface NrLabel {
  text:   string
  title?: string
}

const TOP_100: NrLabel = { text: 'Not in top 100' }
const PAGE_1: NrLabel = {
  text:  'Not on page 1',
  title: "Ahrefs saves Google's first page for each search; this site wasn't on it.",
}

export function nrLabelFor(snapshot: { rawDate: string; category?: string }): NrLabel {
  return snapshot.category === 'bp-sites' && snapshot.rawDate >= AHREFS_FIRST_WEEK ? PAGE_1 : TOP_100
}
