import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { BRANDS, BRAND_LOGO_COLORS } from '../lib/brands'
import { EditableCell } from './EditableCell'
import type { FtdRecord, FtdRecordPatch, FtdTotals, BrandStags } from '../types'

const TABLE_BORDER = '#B0B7BD'
const STICKY_BG    = '#FFFFFF'
const STAGS_BG     = '#F1F5F9'
const SUBHEAD_BG   = '#F8FAFC'

export type FtdMetric = 'reg' | 'ftd' | 'conv'

const ALL_METRICS: Array<{ key: FtdMetric; label: string }> = [
  { key: 'reg',  label: 'REG' },
  { key: 'ftd',  label: 'FTD' },
  { key: 'conv', label: 'CONV%' },
]

export function formatMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const date = new Date(y, m - 1, 1)
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  return `${month} '${String(y).slice(2)}`
}

function parseIntSafe(raw: string): number {
  const n = parseInt(raw.replace(/[^0-9-]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

function formatPct(v: number | null): string {
  return v == null ? '' : `${v}%`
}

// Matches the source sheet's own aggregate formula — a plain average of
// each included month's Conversion % value (e.g. =AVERAGE(D4:D38)), not a
// blended FTD÷REG calculation. Blank/null months are skipped, same as
// Sheets' AVERAGE ignoring empty cells.
export function averagePct(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => v != null)
  if (nums.length === 0) return null
  return Math.round(nums.reduce((s, v) => s + v, 0) / nums.length)
}

// Unrounded FTD ÷ REG × 100 — feed this into averagePct() so rounding only
// happens once, at final display, instead of compounding across an
// average-of-already-rounded-values (which can drift a point or two off
// the sheet's own arithmetic).
export function rawRatio(reg: number, ftd: number): number | null {
  return reg > 0 ? (ftd / reg) * 100 : null
}

// A single month's displayed Conversion % is always FTD ÷ REG × 100 —
// never a manually entered value.
export function ratioPct(reg: number, ftd: number): number | null {
  const r = rawRatio(reg, ftd)
  return r == null ? null : Math.round(r)
}

// Same hex+alpha tint pattern BPSites uses for its domain quick-link
// buttons (e.g. background:"#C026D314") — a light, near-white wash of the
// brand's own color, not a hardcoded gray.
function brandTint(color: string): string {
  return `${color}14`
}

function aggregateByBrand(recs: FtdRecord[]): Record<string, { reg: number; ftd: number; convValues: number[] }> {
  const perBrand: Record<string, { reg: number; ftd: number; convValues: number[] }> = {}
  for (const b of BRANDS) perBrand[b.name] = { reg: 0, ftd: 0, convValues: [] }
  for (const r of recs) {
    perBrand[r.brand].reg += r.reg
    perBrand[r.brand].ftd += r.ftd
    const pct = rawRatio(r.reg, r.ftd)
    if (pct != null) perBrand[r.brand].convValues.push(pct)
  }
  return perBrand
}

interface Props {
  records: FtdRecord[]
  totals:  FtdTotals[]
  stags:   BrandStags[]
  onEditRecord: (brand: string, yearMonth: string, patch: FtdRecordPatch) => Promise<void>
  onEditStags:  (brand: string, stags: string) => Promise<void>
  summaryLabel?: string
  visibleMetric?: FtdMetric | null
}

export function FtdMatrixTable({ records, totals, stags, onEditRecord, onEditStags, summaryLabel = 'TOTAL', visibleMetric = null }: Props) {
  const recordMap = useMemo(() => {
    const map = new Map<string, FtdRecord>()
    for (const r of records) map.set(`${r.brand}|${r.yearMonth}`, r)
    return map
  }, [records])

  const stagsMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of stags) map.set(s.brand, s.stags)
    return map
  }, [stags])

  const months = useMemo(() => {
    const set = new Set<string>()
    records.forEach((r) => set.add(r.yearMonth))
    totals.forEach((t) => set.add(t.yearMonth))
    return Array.from(set).sort().reverse()
  }, [records, totals])

  const summary = useMemo(() => ({ perBrand: aggregateByBrand(records) }), [records])

  // Months grouped by year, in the same descending order as `months` —
  // Map preserves insertion order, and `months` is already sorted newest
  // first, so years come out newest first too.
  const monthsByYear = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const m of months) {
      const y = m.slice(0, 4)
      if (!map.has(y)) map.set(y, [])
      map.get(y)!.push(m)
    }
    return map
  }, [months])

  const yearAggregates = useMemo(() => {
    const map = new Map<string, Record<string, { reg: number; ftd: number; convValues: number[] }>>()
    for (const [year, yearMonths] of monthsByYear) {
      const yearSet = new Set(yearMonths)
      map.set(year, aggregateByBrand(records.filter((r) => yearSet.has(r.yearMonth))))
    }
    return map
  }, [monthsByYear, records])

  const yearsList = useMemo(() => Array.from(monthsByYear.keys()), [monthsByYear])

  // Collapsed by default, except the most recent year — re-expands the
  // newest year whenever the visible year set changes in a way that drops
  // whatever was expanded (e.g. the period filter jumps to a different
  // year), but otherwise leaves the user's manual expand/collapse choices
  // alone.
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => new Set(yearsList[0] ? [yearsList[0]] : []))
  useEffect(() => {
    setExpandedYears((prev) => {
      if (yearsList.some((y) => prev.has(y))) return prev
      return new Set(yearsList[0] ? [yearsList[0]] : [])
    })
  }, [yearsList])

  const toggleYear = (year: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  const activeMetrics = visibleMetric ? ALL_METRICS.filter((m) => m.key === visibleMetric) : ALL_METRICS
  const activeKeys = new Set(activeMetrics.map((m) => m.key))
  const colsPerBrand = activeMetrics.length

  const border = `1px solid ${TABLE_BORDER}`
  const totalCols = 1 + BRANDS.length * colsPerBrand // month + brands(colsPerBrand each)
  const YEAR_ROW_BG = '#EDF0F4'

  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: TABLE_BORDER, background: '#fff' }}>
      <table className="w-max min-w-full" style={{ borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr>
            <th
              rowSpan={3}
              className="sticky left-0 top-0 z-[7] px-3 py-2 text-left align-bottom whitespace-nowrap"
              style={{ background: STICKY_BG, borderRight: border, borderBottom: border, minWidth: 90 }}
            >
              MONTH
            </th>
            {BRANDS.map((b) => (
              <th
                key={b.name}
                colSpan={colsPerBrand}
                className="sticky top-0 z-[6] px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-white whitespace-nowrap"
                style={{ background: BRAND_LOGO_COLORS[b.name] ?? b.color, borderLeft: border, borderRight: border }}
              >
                {b.abbr}
              </th>
            ))}
          </tr>

          <tr>
            {BRANDS.map((b) => (
              <th
                key={b.name}
                colSpan={colsPerBrand}
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
            {BRANDS.map((b) => (
              <Fragment key={b.name}>
                {activeMetrics.map(({ key, label }) => (
                  <th
                    key={`${b.name}-${key}`}
                    className="sticky top-[52px] z-[6] px-2 py-1 text-center text-[12px] font-bold whitespace-nowrap"
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

          {months.length > 1 && (
            <tr style={{ background: SUBHEAD_BG }}>
              <td
                className="sticky left-0 z-[5] px-3 py-2 font-bold whitespace-nowrap"
                style={{ background: SUBHEAD_BG, borderRight: border, borderBottom: `2px solid ${TABLE_BORDER}` }}
              >
                {summaryLabel}
              </td>

              {BRANDS.map((b) => {
                const bt = summary.perBrand[b.name]
                const tint = brandTint(BRAND_LOGO_COLORS[b.name] ?? b.color)
                return (
                  <Fragment key={b.name}>
                    {activeKeys.has('reg') && (
                      <td className="px-2 py-1.5 text-center font-mono font-bold" style={{ background: tint, borderLeft: border, borderRight: border, borderBottom: `2px solid ${TABLE_BORDER}` }}>
                        {bt.reg}
                      </td>
                    )}
                    {activeKeys.has('ftd') && (
                      <td className="px-2 py-1.5 text-center font-mono font-bold" style={{ background: tint, borderLeft: border, borderRight: border, borderBottom: `2px solid ${TABLE_BORDER}` }}>
                        {bt.ftd}
                      </td>
                    )}
                    {activeKeys.has('conv') && (
                      <td className="px-2 py-1.5 text-center font-mono font-bold" style={{ background: tint, borderLeft: border, borderRight: border, borderBottom: `2px solid ${TABLE_BORDER}` }}>
                        {formatPct(averagePct(bt.convValues))}
                      </td>
                    )}
                  </Fragment>
                )
              })}
            </tr>
          )}

          {Array.from(monthsByYear.entries()).map(([year, yearMonths]) => {
            const expanded = expandedYears.has(year)
            const yearAgg = yearAggregates.get(year)!
            return (
              <Fragment key={year}>
                <tr onClick={() => toggleYear(year)} className="cursor-pointer">
                  <td
                    className="sticky left-0 z-[5] px-3 py-2 font-bold whitespace-nowrap"
                    style={{ background: YEAR_ROW_BG, borderRight: border, borderBottom: border }}
                  >
                    <div className="flex items-center gap-1.5">
                      <ChevronRight
                        size={12}
                        strokeWidth={2.5}
                        className={`text-[#64748B] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
                      />
                      {year}
                    </div>
                  </td>

                  {BRANDS.map((b) => {
                    const bt = yearAgg[b.name]
                    const tint = brandTint(BRAND_LOGO_COLORS[b.name] ?? b.color)
                    return (
                      <Fragment key={b.name}>
                        {activeKeys.has('reg') && (
                          <td className="px-2 py-1.5 text-center font-mono font-semibold" style={{ background: tint, borderLeft: border, borderRight: border, borderBottom: border }}>
                            {expanded ? '' : bt.reg}
                          </td>
                        )}
                        {activeKeys.has('ftd') && (
                          <td className="px-2 py-1.5 text-center font-mono font-semibold" style={{ background: tint, borderLeft: border, borderRight: border, borderBottom: border }}>
                            {expanded ? '' : bt.ftd}
                          </td>
                        )}
                        {activeKeys.has('conv') && (
                          <td className="px-2 py-1.5 text-center font-mono font-semibold" style={{ background: tint, borderLeft: border, borderRight: border, borderBottom: border }}>
                            {expanded ? '' : formatPct(averagePct(bt.convValues))}
                          </td>
                        )}
                      </Fragment>
                    )
                  })}
                </tr>

                {expanded && yearMonths.map((ym) => (
                  <tr key={ym}>
                    <td
                      className="sticky left-0 z-[5] px-3 py-2 pl-7 font-semibold whitespace-nowrap"
                      style={{ background: STICKY_BG, borderRight: border, borderBottom: border }}
                    >
                      {formatMonthLabel(ym)}
                    </td>

                    {BRANDS.map((b) => {
                      const rec = recordMap.get(`${b.name}|${ym}`)
                      const tint = brandTint(BRAND_LOGO_COLORS[b.name] ?? b.color)
                      return (
                        <Fragment key={b.name}>
                          {activeKeys.has('reg') && (
                            <td className="px-2 py-1.5 text-center" style={{ background: tint, borderLeft: border, borderRight: border, borderBottom: border }}>
                              <EditableCell
                                value={rec?.reg != null ? String(rec.reg) : ''}
                                onSave={(next) => {
                                  const reg = parseIntSafe(next)
                                  return onEditRecord(b.name, ym, { reg, conversionPct: ratioPct(reg, rec?.ftd ?? 0) })
                                }}
                                placeholder="—"
                                title={`Edit ${b.name} REG`}
                              />
                            </td>
                          )}
                          {activeKeys.has('ftd') && (
                            <td className="px-2 py-1.5 text-center" style={{ background: tint, borderLeft: border, borderRight: border, borderBottom: border }}>
                              <EditableCell
                                value={rec?.ftd != null ? String(rec.ftd) : ''}
                                onSave={(next) => {
                                  const ftd = parseIntSafe(next)
                                  return onEditRecord(b.name, ym, { ftd, conversionPct: ratioPct(rec?.reg ?? 0, ftd) })
                                }}
                                placeholder="—"
                                title={`Edit ${b.name} FTD`}
                              />
                            </td>
                          )}
                          {activeKeys.has('conv') && (
                            <td className="px-2 py-1.5 text-center" style={{ background: tint, borderLeft: border, borderRight: border, borderBottom: border }} title="Conversion % = FTD ÷ REG × 100, calculated automatically">
                              {rec ? (
                                formatPct(ratioPct(rec.reg, rec.ftd)) || <span className="opacity-30">—</span>
                              ) : (
                                <span className="opacity-30">—</span>
                              )}
                            </td>
                          )}
                        </Fragment>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
