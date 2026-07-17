import * as XLSX from 'xlsx'
import { BRANDS } from './brands'
import type { FtdRecord, FtdTotals, BrandStags } from '../types'

export interface FtdParseResult {
  records: FtdRecord[]
  totals:  FtdTotals[]
  stags:   BrandStags[]
  skipped: string[]
}

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

// Parses labels like "Aug '23", "Aug 23", or "August 2023" into 'YYYY-MM'.
function parseMonthLabel(raw: string): string | null {
  const trimmed = raw.trim()
  const m = trimmed.match(/^([A-Za-z]{3,})\.?\s*'?(\d{2,4})$/)
  if (!m) return null
  const monthKey = m[1].slice(0, 3).toLowerCase()
  const monthIdx = MONTH_ABBR[monthKey]
  if (monthIdx == null) return null
  let year = parseInt(m[2], 10)
  if (year < 100) year += 2000
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`
}

function cellText(row: unknown[] | undefined, col: number): string {
  const v = row?.[col]
  return v == null ? '' : String(v).trim()
}

function cellNumber(row: unknown[] | undefined, col: number): number | null {
  const v = row?.[col]
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Google Sheets exports percentages either as a fraction (0.23) or as a
// plain number (23) depending on cell formatting — normalize to 0-100.
function normalizePct(n: number | null): number | null {
  if (n == null) return null
  return n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10
}

const ABBR_TO_BRAND: Record<string, string> = Object.fromEntries(
  BRANDS.map((b) => [b.abbr.toUpperCase(), b.name]),
)

export function parseFtdXlsx(buffer: ArrayBuffer): FtdParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })

  // Row 0: group labels ("Totals", brand abbreviations) at each group's
  // leftmost column. Row 1: Stags reference values. Row 2: REG/FTD/Conv%
  // sub-headers. Row 3+: one row per month, month label in column 0.
  const groupRow  = rows[0] ?? []
  const stagsRow  = rows[1] ?? []
  const dataStart = 3

  const groups: Array<{ startCol: number; brand: string | 'totals' }> = []
  for (let col = 1; col < groupRow.length; col++) {
    const label = cellText(groupRow, col)
    if (!label) continue
    if (label.toLowerCase() === 'totals') {
      groups.push({ startCol: col, brand: 'totals' })
    } else if (ABBR_TO_BRAND[label.toUpperCase()]) {
      groups.push({ startCol: col, brand: ABBR_TO_BRAND[label.toUpperCase()] })
    }
  }

  const stags: BrandStags[] = []
  for (const g of groups) {
    if (g.brand === 'totals') continue
    const stagsValue = cellText(stagsRow, g.startCol)
    if (stagsValue) stags.push({ brand: g.brand, stags: stagsValue })
  }

  const totalsGroup = groups.find((g) => g.brand === 'totals')
  const records: FtdRecord[] = []
  const totals: FtdTotals[] = []
  const skipped: string[] = []

  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue
    const monthLabel = cellText(row, 0)
    if (!monthLabel) continue
    const yearMonth = parseMonthLabel(monthLabel)
    if (!yearMonth) {
      skipped.push(`Row ${r + 1}: unrecognized month "${monthLabel}"`)
      continue
    }

    for (const g of groups) {
      if (g.brand === 'totals') continue
      const reg  = cellNumber(row, g.startCol)
      const ftd  = cellNumber(row, g.startCol + 1)
      const conv = normalizePct(cellNumber(row, g.startCol + 2))
      if (reg == null && ftd == null && conv == null) continue
      records.push({
        brand: g.brand,
        yearMonth,
        reg: reg ?? 0,
        ftd: ftd ?? 0,
        conversionPct: conv,
      })
    }

    if (totalsGroup) {
      const totalsConv = normalizePct(cellNumber(row, totalsGroup.startCol + 2))
      if (totalsConv != null) totals.push({ yearMonth, conversionPct: totalsConv })
    }
  }

  return { records, totals, stags, skipped }
}
