import * as XLSX from 'xlsx'
import type { RankingRecord } from '../types'
import { DOMAIN_TO_BRAND, COUNTRY_LABELS } from './brands'

export interface UnknownDomain {
  domain: string
  count:  number
}

export interface ParseResult {
  records:        RankingRecord[]
  unknownDomains: UnknownDomain[]
}

export function parseXlsx(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  })
  return parseRows(rows as (string | number | Date)[][])
}

/**
 * Coerce a country cell to a 2-letter code:
 *   "Australia"   → "AU"
 *   "australia"   → "AU"
 *   "AU"          → "AU"
 *   "au"          → "AU"
 *   "ZZ"          → "ZZ"   (unknown → uppercased pass-through so it still
 *                            matches itself in lookups)
 */
function normalizeCountry(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''

  // Try the literal value (handles "Australia", "AU", etc.)
  const direct = COUNTRY_LABELS[s]
  if (direct) return direct

  // Try lowercased/normalized variants of full names
  const norm = s.toLowerCase().replace(/\s+/g, ' ')
  for (const [key, code] of Object.entries(COUNTRY_LABELS)) {
    if (key.toLowerCase() === norm) return code
  }

  // Already a 2-letter code in some other case? Uppercase it.
  if (s.length === 2) return s.toUpperCase()

  return s.toUpperCase()
}

// Format a JS Date as "yyyy-MM-dd" using its LOCAL components. Avoids the
// off-by-one that `toISOString().slice(0,10)` causes in positive-UTC zones,
// where local midnight is already the previous day in UTC.
function toIsoLocal(d: Date): string {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Coerce a cell to "yyyy-MM-dd". Handles:
 *   - Date objects (from cellDates:true)
 *   - Excel serial numbers (days since 1899-12-30; defensive fallback)
 *   - ISO strings, "5/20/2026", etc. — passed through after Date round-trip
 *   - empty / unrecognized → ''
 */
function normalizeDate(v: unknown): string {
  if (v == null || v === '') return ''
  if (v instanceof Date && !isNaN(v.getTime())) {
    return toIsoLocal(v)
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel serial → JS Date. 25569 = days between 1899-12-30 and 1970-01-01.
    // Serial has no timezone; the resulting Date is UTC-midnight of the day.
    const d = new Date((v - 25569) * 86400 * 1000)
    return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  if (!s) return ''
  // Already a YYYY-MM-DD literal? Trust it; don't round-trip through Date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : toIsoLocal(d)
}

function parseRows(rows: (string | number | Date)[][]): ParseResult {
  if (!rows || rows.length < 2) return { records: [], unknownDomains: [] }

  let headerIdx = 0
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i].map((c) => String(c).toLowerCase().trim())
    if (row.includes('domain') || row.includes('keyword')) {
      headerIdx = i
      break
    }
  }

  const headers = rows[headerIdx].map((c) => String(c).toLowerCase().trim())
  const colIdx = (name: string): number =>
    headers.findIndex((h) => h === name || h.startsWith(name))

  const iDomain   = colIdx('domain')
  const iKeyword  = colIdx('keyword')
  const iCountry  = colIdx('country')
  const iPosition = colIdx('position')
  const iPrev     = colIdx('previous')
  const iChange   = colIdx('change')
  const iDate     = colIdx('last check') !== -1 ? colIdx('last check') : colIdx('date')

  if (iDomain < 0 || iKeyword < 0) return { records: [], unknownDomains: [] }

  // Dedupe by (domain, keyword, country). Within a single upload, identical
  // (domain, keyword, country) rows replace each other — the LAST one wins.
  const byKey = new Map<string, RankingRecord>()
  // Track domains the file references but that aren't in the Rooster registry,
  // preserving the original casing of the first occurrence.
  const unknownByKey = new Map<string, { domain: string; count: number }>()

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    const domain  = String(row[iDomain]  ?? '').trim()
    const keyword = String(row[iKeyword] ?? '').trim()
    if (!domain || !keyword) continue
    const dk = domain.toLowerCase()
    if (!DOMAIN_TO_BRAND[dk]) {
      const existing = unknownByKey.get(dk)
      if (existing) existing.count++
      else unknownByKey.set(dk, { domain, count: 1 })
      continue
    }

    const country = iCountry >= 0 ? normalizeCountry(row[iCountry]) : ''
    const dedupeKey = `${dk}|${keyword.toLowerCase()}|${country}`

    byKey.set(dedupeKey, {
      domain,
      keyword,
      country,
      position: iPosition >= 0 ? String(row[iPosition] ?? '').trim() : '',
      previous: iPrev     >= 0 ? String(row[iPrev]     ?? '').trim() : '',
      change:   iChange   >= 0 ? String(row[iChange]   ?? '').trim() : '',
      date:     iDate     >= 0 ? normalizeDate(row[iDate]) : '',
    })
  }

  const unknownDomains = Array.from(unknownByKey.values()).sort((a, b) => b.count - a.count)
  return { records: Array.from(byKey.values()), unknownDomains }
}

// Extract the most common date value from records' date field
export function extractSnapshotDate(records: RankingRecord[]): string {
  const counts: Record<string, number> = {}
  records.forEach((r) => {
    if (r.date) counts[r.date] = (counts[r.date] ?? 0) + 1
  })
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return sorted.length > 0 ? sorted[0][0] : ''
}

// Format raw date string "5/20/2026" → "20 May 26"
export function formatDisplayDate(raw: string): string {
  if (!raw) return 'Unknown Date'
  // YYYY-MM-DD literals: build a local Date so toLocaleDateString doesn't
  // shift the displayed day across the UTC boundary (e.g. UTC- zones would
  // otherwise show the previous day for a "2026-05-13" ISO date).
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
  }
  const d = new Date(raw)
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
  }
  return raw
}

export function parsePosition(pos: string): number | 'NR' | null {
  if (!pos) return null
  const s = pos.trim().toLowerCase()
  if (s === 'not ranking' || s === 'not in top 100' || s === '-' || s === 'nr') return 'NR'
  const n = parseInt(s, 10)
  return isNaN(n) ? 'NR' : n
}

export function parseChange(chg: string): number | null {
  if (!chg) return null
  const n = parseFloat(chg.trim())
  return isNaN(n) ? null : n
}

export function countBrands(records: RankingRecord[], domainMap: Record<string, string>): number {
  const brands = new Set(records.map((r) => domainMap[r.domain.toLowerCase()]).filter(Boolean))
  return brands.size
}
