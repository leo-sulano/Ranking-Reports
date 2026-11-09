// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UploadSummary } from './UploadSummary'
import type { RankingRecord } from '../types'

const rec = (keyword: string, date: string): RankingRecord => ({
  domain: 'rooster.bet', keyword, country: 'AU', position: '1', previous: '', change: '', date,
})

/** The sync summary's visible text, without markup. */
function syncSummaryText(records: RankingRecord[]): string {
  const html = renderToStaticMarkup(createElement(UploadSummary, {
    data: { displayDate: 'Nov 3, 2026', records, unknownDomains: [], source: 'sync' },
    onClose: () => {},
  }))
  return html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'")
}

describe('UploadSummary (sync)', () => {
  it('does not call the weekly update stale because one keyword was re-checked later', () => {
    const text = syncSummaryText([
      rec('a', '2026-11-03'), rec('b', '2026-11-03'), rec('c', '2026-11-03'), rec('d', '2026-11-08'),
    ])
    expect(text).not.toContain('kept an earlier check')
  })

  it("counts rows from before Ahrefs' latest weekly update", () => {
    const text = syncSummaryText([rec('a', '2026-11-03'), rec('b', '2026-11-03'), rec('c', '2026-10-27')])
    expect(text).toContain("1 record kept an earlier check — Ahrefs' latest weekly update did not cover it.")
  })
})
