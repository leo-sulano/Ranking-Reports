import { Fragment, useMemo } from 'react'
import { BRANDS } from '../lib/brands'
import { EditableCell } from './EditableCell'
import type { FtdRecord, FtdRecordPatch, FtdTotals, BrandStags } from '../types'

const TABLE_BORDER   = '#B0B7BD'
const STICKY_BG      = '#FFFFFF'
const TOTALS_HEAD_BG = '#0F172A'
const STAGS_BG       = '#F1F5F9'
const SUBHEAD_BG     = '#F8FAFC'
const TOTALS_CELL_BG = '#F8FAFC'

const SUB_COLS = ['REG', 'FTD', 'CONV%'] as const

function formatMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const date = new Date(y, m - 1, 1)
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  return `${month} '${String(y).slice(2)}`
}

function parseIntSafe(raw: string): number {
  const n = parseInt(raw.replace(/[^0-9-]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

function parsePctSafe(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = parseFloat(trimmed.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function formatPct(v: number | null): string {
  return v == null ? '' : `${v}%`
}

interface Props {
  records: FtdRecord[]
  totals:  FtdTotals[]
  stags:   BrandStags[]
  onEditRecord: (brand: string, yearMonth: string, patch: FtdRecordPatch) => Promise<void>
  onEditTotals: (yearMonth: string, conversionPct: number | null) => Promise<void>
  onEditStags:  (brand: string, stags: string) => Promise<void>
}

export function FtdMatrixTable({ records, totals, stags, onEditRecord, onEditTotals, onEditStags }: Props) {
  const recordMap = useMemo(() => {
    const map = new Map<string, FtdRecord>()
    for (const r of records) map.set(`${r.brand}|${r.yearMonth}`, r)
    return map
  }, [records])

  const totalsMap = useMemo(() => {
    const map = new Map<string, FtdTotals>()
    for (const t of totals) map.set(t.yearMonth, t)
    return map
  }, [totals])

  const stagsMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of stags) map.set(s.brand, s.stags)
    return map
  }, [stags])

  const months = useMemo(() => {
    const set = new Set<string>()
    records.forEach((r) => set.add(r.yearMonth))
    totals.forEach((t) => set.add(t.yearMonth))
    return Array.from(set).sort()
  }, [records, totals])

  const border = `1px solid ${TABLE_BORDER}`
  const totalCols = 4 + BRANDS.length * 3 // month + totals(3) + brands(3 each)

  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: TABLE_BORDER, background: '#fff' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '100%' }}>
        <thead>
          <tr>
            <th
              rowSpan={3}
              className="sticky left-0 top-0 z-[7] px-3 py-2 text-left align-bottom whitespace-nowrap"
              style={{ background: STICKY_BG, borderRight: border, borderBottom: border, minWidth: 90 }}
            >
              MONTH
            </th>
            <th
              colSpan={3}
              className="sticky top-0 z-[6] px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-white"
              style={{ background: TOTALS_HEAD_BG, borderLeft: border, borderRight: border }}
            >
              TOTALS
            </th>
            {BRANDS.map((b) => (
              <th
                key={b.name}
                colSpan={3}
                className="sticky top-0 z-[6] px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-white whitespace-nowrap"
                style={{ background: b.color, borderLeft: border, borderRight: border }}
              >
                {b.abbr}
              </th>
            ))}
          </tr>

          <tr>
            <th
              colSpan={3}
              className="sticky top-[29px] z-[6] px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[#64748B]"
              style={{ background: STAGS_BG, borderLeft: border, borderRight: border, borderBottom: border }}
            >
              STAGS
            </th>
            {BRANDS.map((b) => (
              <th
                key={b.name}
                colSpan={3}
                className="sticky top-[29px] z-[6] px-2 py-1 text-center text-[10px] font-mono"
                style={{ background: STAGS_BG, borderLeft: border, borderRight: border, borderBottom: border }}
              >
                <EditableCell
                  value={stagsMap.get(b.name) ?? ''}
                  onSave={(next) => onEditStags(b.name, next)}
                  placeholder="—"
                  title={`Edit ${b.name} Stags`}
                />
              </th>
            ))}
          </tr>

          <tr>
            {SUB_COLS.map((label) => (
              <th
                key={`totals-${label}`}
                className="sticky top-[52px] z-[6] px-2 py-1 text-center text-[10px] font-semibold whitespace-nowrap"
                style={{ background: SUBHEAD_BG, borderLeft: border, borderRight: border, borderBottom: border }}
              >
                {label}
              </th>
            ))}
            {BRANDS.map((b) => (
              <Fragment key={b.name}>
                {SUB_COLS.map((label) => (
                  <th
                    key={`${b.name}-${label}`}
                    className="sticky top-[52px] z-[6] px-2 py-1 text-center text-[10px] font-semibold whitespace-nowrap"
                    style={{ background: SUBHEAD_BG, borderLeft: border, borderRight: border, borderBottom: border }}
                  >
                    {label}
                  </th>
                ))}
              </Fragment>
            ))}
          </tr>
        </thead>

        <tbody>
          {months.length === 0 && (
            <tr>
              <td colSpan={totalCols} className="px-4 py-10 text-center text-[#94A3B8]">
                No months tracked yet.
              </td>
            </tr>
          )}

          {months.map((ym) => {
            const brandRecs = BRANDS.map((b) => recordMap.get(`${b.name}|${ym}`))
            const sumReg = brandRecs.reduce((s, r) => s + (r?.reg ?? 0), 0)
            const sumFtd = brandRecs.reduce((s, r) => s + (r?.ftd ?? 0), 0)
            const totalsRow = totalsMap.get(ym)

            return (
              <tr key={ym}>
                <td
                  className="sticky left-0 z-[5] px-3 py-2 font-semibold whitespace-nowrap"
                  style={{ background: STICKY_BG, borderRight: border, borderBottom: border }}
                >
                  {formatMonthLabel(ym)}
                </td>

                <td className="px-2 py-1.5 text-center font-mono" style={{ background: TOTALS_CELL_BG, borderLeft: border, borderRight: border, borderBottom: border }}>
                  {sumReg}
                </td>
                <td className="px-2 py-1.5 text-center font-mono" style={{ background: TOTALS_CELL_BG, borderRight: border, borderBottom: border }}>
                  {sumFtd}
                </td>
                <td className="px-2 py-1.5 text-center" style={{ background: TOTALS_CELL_BG, borderRight: border, borderBottom: border }}>
                  <EditableCell
                    value={formatPct(totalsRow?.conversionPct ?? null)}
                    onSave={(next) => onEditTotals(ym, parsePctSafe(next))}
                    placeholder="—"
                    title="Edit Totals Conversion %"
                  />
                </td>

                {BRANDS.map((b) => {
                  const rec = recordMap.get(`${b.name}|${ym}`)
                  return (
                    <Fragment key={b.name}>
                      <td className="px-2 py-1.5 text-center" style={{ borderLeft: border, borderRight: border, borderBottom: border }}>
                        <EditableCell
                          value={rec?.reg != null ? String(rec.reg) : ''}
                          onSave={(next) => onEditRecord(b.name, ym, { reg: parseIntSafe(next) })}
                          placeholder="—"
                          title={`Edit ${b.name} REG`}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center" style={{ borderRight: border, borderBottom: border }}>
                        <EditableCell
                          value={rec?.ftd != null ? String(rec.ftd) : ''}
                          onSave={(next) => onEditRecord(b.name, ym, { ftd: parseIntSafe(next) })}
                          placeholder="—"
                          title={`Edit ${b.name} FTD`}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center" style={{ borderRight: border, borderBottom: border }}>
                        <EditableCell
                          value={formatPct(rec?.conversionPct ?? null)}
                          onSave={(next) => onEditRecord(b.name, ym, { conversionPct: parsePctSafe(next) })}
                          placeholder="—"
                          title={`Edit ${b.name} Conversion %`}
                        />
                      </td>
                    </Fragment>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
