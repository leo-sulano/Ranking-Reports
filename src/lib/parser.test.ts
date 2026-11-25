// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseXlsx } from './parser'

/** A flat, single-sheet upload built from rows (header first). */
function workbook(rows: string[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('parseXlsx — retired sites', () => {
  // Re-uploading a week replaces its stored snapshot: dropping a retired
  // site's rows here would delete its history. The pages hide them instead.
  it('keeps the rows of a retired site and does not report it as unknown', () => {
    const result = parseXlsx(workbook([
      ['Domain', 'Keyword', 'Country', 'Position', 'Date'],
      ['roosters.bet', 'rooster casino', 'AU', '2', '2026-11-03'],
      ['casinoroosters.com', 'rooster casino', 'AU', '6', '2026-11-03'],
      ['example.com', 'rooster casino', 'AU', '9', '2026-11-03'],
    ]))
    expect(result.snapshots[0].records.map((r) => r.domain)).toEqual(['roosters.bet', 'casinoroosters.com'])
    expect(result.unknownDomains.map((u) => u.domain)).toEqual(['example.com'])
  })
})
