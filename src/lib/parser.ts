import * as XLSX from 'xlsx'
import type { RankingRecord } from '../types'
import { DOMAIN_TO_BRAND, COUNTRY_LABELS } from './brands'

export interface UnknownDomain {
  domain: string
  count:  number
}

export interface ParsedSnapshot {
  rawDate: string                 // 'yyyy-MM-dd'
  records: RankingRecord[]
}

export interface ParseResult {
  snapshots:      ParsedSnapshot[]
  unknownDomains: UnknownDomain[]
}

// Legacy matrix-format sheets. Each one is a per-brand sheet in the old Google
// Sheets layout (stacked snapshots, domain row + country header at the top).
// NOVADREAMS is intentionally NOT here — that brand isn't registered yet.
const MATRIX_BRAND_SHEETS = new Set([
  'LUCKY7', 'LUCKYVIBE', 'ROOSTERBET', 'SPINSUP', 'SPINJO',
  'FORTUNEPLAY', 'ROCKETSPIN', 'PLAYMOJO', 'ROLLERO',
])

export function parseXlsx(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })

  // Auto-detect matrix layout: if any sheet name matches a known per-brand
  // tab, treat the workbook as the legacy stacked format.
  const matrixSheets = wb.SheetNames.filter((n) => MATRIX_BRAND_SHEETS.has(n.toUpperCase()))
  if (matrixSheets.length > 0) {
    return parseMatrixWorkbook(wb, matrixSheets)
  }

  // Flat single-sheet format (current upload format).
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  })
  const flat = parseRows(rows as (string | number | Date)[][])
  // The flat format has one date per upload — derive it from the records.
  const rawDate = extractSnapshotDate(flat.records)
  return {
    snapshots:      flat.records.length > 0 ? [{ rawDate, records: flat.records }] : [],
    unknownDomains: flat.unknownDomains,
  }
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

interface FlatParseResult {
  records:        RankingRecord[]
  unknownDomains: UnknownDomain[]
}

function parseRows(rows: (string | number | Date)[][]): FlatParseResult {
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

// Format raw date string "5/20/2026" → "May 20, 2026"
export function formatDisplayDate(raw: string): string {
  if (!raw) return 'Unknown Date'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  // YYYY-MM-DD literals: build a local Date so toLocaleDateString doesn't
  // shift the displayed day across the UTC boundary (e.g. UTC- zones would
  // otherwise show the previous day for a "2026-05-13" ISO date).
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return d.toLocaleDateString('en-US', opts)
  }
  const d = new Date(raw)
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', opts)
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

// ─── Carry-forward of "sticky" fields ──────────────────────────────────────────
// GSV / SV / AFF rarely change week-to-week; newer ranking exports often leave
// them blank. Walk snapshots oldest → newest within a category and inherit any
// empty searchVolume / affiliateUrl / globalSearchVolume from the most recent
// prior snapshot's record with the same key. Mutates records in place.
//
// Keying:
//   SV / AFF — per (domain, keyword, country)
//   GSV      — per keyword (denormalized onto every record for that keyword)
//
// Imported as: import { applyCarryForward } from './parser' — see storage.ts
// for the call site.
export function applyCarryForward(
  // Use the public Snapshot shape from this module's consumers. Typed loosely
  // here to avoid a circular import on src/types.
  snapshots: Array<{ category?: string; rawDate: string; records: RankingRecord[] }>,
): void {
  // Group by category — values shouldn't bleed across categories.
  const byCat = new Map<string, typeof snapshots>()
  for (const s of snapshots) {
    const cat = s.category ?? ''
    const arr = byCat.get(cat) ?? []
    arr.push(s)
    byCat.set(cat, arr)
  }

  for (const arr of byCat.values()) {
    const asc = [...arr].sort((a, b) =>
      a.rawDate < b.rawDate ? -1 : a.rawDate > b.rawDate ? 1 : 0,
    )
    const sv  = new Map<string, string>()
    const aff = new Map<string, string>()
    const gsv = new Map<string, string>()

    for (const snap of asc) {
      for (const r of snap.records) {
        const k  = `${r.domain.toLowerCase()}|${r.keyword.toLowerCase()}|${r.country}`
        const kw = r.keyword.toLowerCase()

        if (!r.searchVolume       && sv.has(k))   r.searchVolume       = sv.get(k)
        if (!r.affiliateUrl       && aff.has(k))  r.affiliateUrl       = aff.get(k)
        if (!r.globalSearchVolume && gsv.has(kw)) r.globalSearchVolume = gsv.get(kw)

        if (r.searchVolume)        sv.set(k, r.searchVolume)
        if (r.affiliateUrl)        aff.set(k, r.affiliateUrl)
        if (r.globalSearchVolume)  gsv.set(kw, r.globalSearchVolume)
      }
    }
  }
}

// ─── Matrix-format parser (legacy per-brand stacked sheets) ────────────────────
// File shape (one sheet per brand: LUCKY7, LUCKYVIBE, …):
//   Row 0  — column header. Cols 3+ alternate AU/SV/AFF/CA/SV/AFF/… for domain 1,
//            then plain AU/CA/DE/IT/NZ blocks for domains 2..5.
//   Row 1  — domain at the FIRST column of each block (sparse).
//   Row 2  — first date marker in col B ("05/13/26").
//   Row 3  — country sub-header (skip).
//   Rows 4+ — keyword in col B; per-(domain,country) position cells across cols.
//   Then the date / sub-header / keyword block repeats down the sheet for every
//   snapshot.

const COUNTRY_CODES = new Set(['AU', 'CA', 'DE', 'IT', 'NZ'])

interface ColRole { country: string; domain: string; type: 'POS' | 'SV' | 'AFF' }

function extractDomain(raw: unknown): string {
  // Domain cells sometimes carry a trailing note on a second line (e.g.
  // "lucky7evencasino.org\n\nhttps://lucky7evencasino.org"). Take the first
  // whitespace-delimited token.
  return String(raw ?? '').split(/[\s\n\r]/)[0].trim().toLowerCase()
}

function parseMatrixDate(raw: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw.trim())
  if (!m) return ''
  const mm = parseInt(m[1], 10)
  const dd = parseInt(m[2], 10)
  let   yy = parseInt(m[3], 10)
  if (yy < 100) yy += 2000
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return ''
  return `${yy.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`
}

// Parse a position cell that may carry change info: "4 ⇓ (1)", "3 ⇑ (7)",
// or a bare value like "1" / "Not in top 100".
// ⇑ = ranking improved (current pos lower number, previous was higher);
// ⇓ = ranking dropped  (current pos higher number, previous was lower).
function parseMatrixPositionCell(cell: string): { position: string; change: string; previous: string } {
  const s = cell.trim()
  if (!s) return { position: '', change: '', previous: '' }

  const m = /^(.+?)\s*([⇑⇓↑↓])\s*\(\s*(\d+)\s*\)\s*$/.exec(s)
  if (!m) return { position: s, change: '', previous: '' }

  const posPart = m[1].trim()
  const arrow   = m[2]
  const delta   = parseInt(m[3], 10)
  const signed  = (arrow === '⇑' || arrow === '↑') ? delta : -delta
  const posNum  = parseInt(posPart, 10)
  // previous = current + signedDelta (works for both arrows; see derivation
  // in the parser doc — for ⇓ signed is negative, so previous < current).
  const previous = !isNaN(posNum) ? `${posNum + signed}` : ''
  return { position: posPart, change: `${signed}`, previous }
}

function parseMatrixWorkbook(
  wb: XLSX.WorkBook,
  matrixSheetNames: string[],
): ParseResult {
  // Group records by rawDate across all brand sheets → one ParsedSnapshot per date.
  const byDate = new Map<string, Map<string, RankingRecord>>()
  const unknownByKey = new Map<string, { domain: string; count: number }>()

  const upsertRecord = (
    rawDate: string,
    rec: RankingRecord,
    patch: Partial<Pick<RankingRecord, 'position' | 'previous' | 'change' | 'searchVolume' | 'affiliateUrl' | 'globalSearchVolume'>>,
  ) => {
    let bucket = byDate.get(rawDate)
    if (!bucket) { bucket = new Map(); byDate.set(rawDate, bucket) }
    const k = `${rec.domain.toLowerCase()}|${rec.keyword.toLowerCase()}|${rec.country}`
    const existing = bucket.get(k)
    if (existing) {
      Object.assign(existing, patch)
    } else {
      bucket.set(k, { ...rec, ...patch })
    }
  }

  // GSV is per-keyword (col 2). Stamp it on every record for the keyword in
  // this snapshot at the end of each section.
  const stampGsv = (rawDate: string, keyword: string, gsv: string) => {
    if (!gsv) return
    const bucket = byDate.get(rawDate)
    if (!bucket) return
    const kwLc = keyword.toLowerCase()
    bucket.forEach((rec) => {
      if (rec.keyword.toLowerCase() === kwLc) rec.globalSearchVolume = gsv
    })
  }

  for (const sheetName of matrixSheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(ws, {
      header: 1,
      defval: '',
      raw:    false,
    }) as (string | number | Date)[][]
    if (rows.length < 4) continue

    // Build column → role map from rows 0 & 1.
    const header0 = rows[0].map((c) => String(c ?? '').trim().toUpperCase())
    const header1 = rows[1].map((c) => extractDomain(c))

    // Scan header0 left-to-right tracking the current country + current domain.
    const colMap = new Map<number, ColRole>()
    let curCountry = ''
    let curDomain  = ''
    for (let c = 0; c < header0.length; c++) {
      const cell = header0[c]
      const dom1 = header1[c]
      if (dom1) curDomain = dom1
      if (COUNTRY_CODES.has(cell)) {
        curCountry = cell
        if (curDomain) colMap.set(c, { country: cell, domain: curDomain, type: 'POS' })
      } else if (cell === 'SV' && curCountry && curDomain) {
        colMap.set(c, { country: curCountry, domain: curDomain, type: 'SV' })
      } else if (cell === 'AFF' && curCountry && curDomain) {
        colMap.set(c, { country: curCountry, domain: curDomain, type: 'AFF' })
      }
    }

    if (colMap.size === 0) continue

    // Validate domains in this sheet up front (count unknowns once per sheet,
    // not once per row × column).
    const distinctDomains = new Set<string>()
    colMap.forEach((v) => distinctDomains.add(v.domain))
    for (const d of distinctDomains) {
      if (!DOMAIN_TO_BRAND[d]) {
        const e = unknownByKey.get(d)
        if (e) e.count++
        else unknownByKey.set(d, { domain: d, count: 1 })
      }
    }

    // Find all date-marker rows (col B = MM/DD/YY).
    const dateRows: Array<{ row: number; rawDate: string }> = []
    for (let r = 0; r < rows.length; r++) {
      const colB = String(rows[r]?.[1] ?? '').trim()
      const iso  = parseMatrixDate(colB)
      if (iso) dateRows.push({ row: r, rawDate: iso })
    }
    if (dateRows.length === 0) continue

    for (let i = 0; i < dateRows.length; i++) {
      const { row: startRow, rawDate } = dateRows[i]
      const endRow = i + 1 < dateRows.length ? dateRows[i + 1].row : rows.length

      // Skip the date row itself and any immediately-following sub-header rows
      // whose col B is "Country" / "Domain" / empty.
      for (let r = startRow + 1; r < endRow; r++) {
        const row = rows[r]
        const keyword = String(row?.[1] ?? '').trim()
        if (!keyword) continue
        const kwLc = keyword.toLowerCase()
        if (kwLc === 'country' || kwLc === 'domain' || kwLc === 'keyword') continue

        // Capture global search volume from col 2 (always 'GSV' in row 0).
        const gsvCell = String(row?.[2] ?? '').trim()

        // Walk the column map and apply each cell's value to its
        // (domain, country, keyword) record.
        colMap.forEach((role, c) => {
          if (!DOMAIN_TO_BRAND[role.domain]) return
          const cell = String(row?.[c] ?? '').trim()
          if (!cell) return

          const base: RankingRecord = {
            domain:   role.domain,
            keyword,
            country:  role.country,
            position: '',
            previous: '',
            change:   '',
            date:     rawDate,
          }

          if (role.type === 'POS') {
            const parsed = parseMatrixPositionCell(cell)
            upsertRecord(rawDate, base, {
              position:           parsed.position,
              previous:           parsed.previous,
              change:             parsed.change,
              globalSearchVolume: gsvCell,
            })
          } else if (role.type === 'SV') {
            upsertRecord(rawDate, base, { searchVolume: cell, globalSearchVolume: gsvCell })
          } else if (role.type === 'AFF') {
            upsertRecord(rawDate, base, { affiliateUrl: cell, globalSearchVolume: gsvCell })
          }
        })

        // Records for keywords that only appeared in BP-domain columns won't
        // have GSV stamped on them via the patch above (BP-block cells live in
        // POS-only columns, which fall through here too — so we'd stamp them).
        // Belt-and-braces: stamp every record for this keyword in this snapshot.
        if (gsvCell) stampGsv(rawDate, keyword, gsvCell)
      }
    }
  }

  // Drop records that have no position AND no SV AND no AFF (empty rows that
  // only carried whitespace).
  const snapshots: ParsedSnapshot[] = []
  for (const [rawDate, bucket] of byDate) {
    const records = Array.from(bucket.values()).filter(
      (r) => r.position || r.searchVolume || r.affiliateUrl,
    )
    if (records.length > 0) snapshots.push({ rawDate, records })
  }
  // Newest first.
  snapshots.sort((a, b) => (a.rawDate < b.rawDate ? 1 : a.rawDate > b.rawDate ? -1 : 0))

  const unknownDomains = Array.from(unknownByKey.values()).sort((a, b) => b.count - a.count)
  return { snapshots, unknownDomains }
}
