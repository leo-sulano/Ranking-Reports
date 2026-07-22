import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import { BRANDS, BRAND_LOGO_COLORS } from '../lib/brands'
import { usePinnedGroups } from '../lib/usePinnedGroups'
import { EditableCell } from './EditableCell'
import { PinButton } from './PinButton'
import type { FtdRecord, FtdRecordPatch, FtdTotals, BrandStags, WriteGate } from '../types'

const TABLE_BORDER = '#B0B7BD'
const STICKY_BG    = '#FFFFFF'
const STAGS_BG     = '#F1F5F9'
const SUBHEAD_BG   = '#F8FAFC'

// TOTALS column group — mirrors the source sheet's green "Totals" block.
// Fixed column width so the sticky left offsets are deterministic.
const TOTALS_COL_W      = 58
const TOTALS_HEADER_BG  = '#16A34A'
const TOTALS_SUBHEAD_BG = '#D9EDDF'
const TOTALS_CELL_BG    = '#EAF6EF' // solid (not alpha) — sticky cells overlay scrolled content

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
  writeGate: WriteGate
}

export function FtdMatrixTable({ records, totals, stags, onEditRecord, onEditStags, summaryLabel = 'TOTAL', visibleMetric = null, writeGate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const monthColRef = useRef<HTMLTableCellElement>(null)
  const [scrolled, setScrolled] = useState(false)
  // Measured MONTH column width — the TOTALS group's sticky offsets start here.
  const [monthW, setMonthW] = useState(90)
  // User-pinned brand groups — frozen right after the TOTALS group.
  const [pinnedBrands, togglePin] = usePinnedGroups('ftd-matrix')

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      const atLeft  = el.scrollLeft <= 0
      const atRight = el.scrollLeft >= el.scrollWidth - el.clientWidth
      if ((e.deltaY < 0 && atLeft) || (e.deltaY > 0 && atRight)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    const onScroll = () => setScrolled(el.scrollLeft > 0)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // Re-measure the MONTH column after each render — its width drives the
  // sticky left offsets of the TOTALS group and any pinned brand groups.
  useEffect(() => {
    const monthEl = monthColRef.current
    if (monthEl) setMonthW(monthEl.offsetWidth)
  })

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

  // ── All-brand totals per month / year / grand — the TOTALS column group ──
  // Monthly conversion is the blended FTD ÷ REG of that month's totals;
  // year and grand conversions average the monthly blended ratios, matching
  // both the source sheet and the stat cards' "All Years" arithmetic.
  const monthTotals = useMemo(() => {
    const map = new Map<string, { reg: number; ftd: number }>()
    for (const r of records) {
      const t = map.get(r.yearMonth) ?? { reg: 0, ftd: 0 }
      t.reg += r.reg
      t.ftd += r.ftd
      map.set(r.yearMonth, t)
    }
    return map
  }, [records])

  const yearTotals = useMemo(() => {
    const map = new Map<string, { reg: number; ftd: number; convValues: number[] }>()
    for (const [year, yearMonths] of monthsByYear) {
      const agg = { reg: 0, ftd: 0, convValues: [] as number[] }
      for (const ym of yearMonths) {
        const t = monthTotals.get(ym)
        if (!t) continue
        agg.reg += t.reg
        agg.ftd += t.ftd
        const r = rawRatio(t.reg, t.ftd)
        if (r != null) agg.convValues.push(r)
      }
      map.set(year, agg)
    }
    return map
  }, [monthsByYear, monthTotals])

  const grandTotals = useMemo(() => {
    let reg = 0, ftd = 0
    const convValues: number[] = []
    for (const t of monthTotals.values()) {
      reg += t.reg
      ftd += t.ftd
      const r = rawRatio(t.reg, t.ftd)
      if (r != null) convValues.push(r)
    }
    return { reg, ftd, conv: averagePct(convValues) }
  }, [monthTotals])

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
  const totalCols = 1 + colsPerBrand + BRANDS.length * colsPerBrand // month + totals + brands
  const YEAR_ROW_BG = '#EDF0F4'

  // Sticky TOTALS body cells for one row. Pass null values to render the
  // group blank (expanded year rows, matching the blank brand cells).
  const totalsCells = (
    reg: number | null,
    ftd: number | null,
    conv: number | null,
    fontClass: string,
    borderBottom: string,
  ) => activeMetrics.map(({ key }, i) => (
    <td
      key={`totals-${key}`}
      className={`px-2 py-1.5 text-center font-mono ${fontClass}`}
      style={{
        position: 'sticky',
        left: monthW + i * TOTALS_COL_W,
        zIndex: 5,
        width: TOTALS_COL_W, minWidth: TOTALS_COL_W, maxWidth: TOTALS_COL_W,
        background: TOTALS_CELL_BG,
        borderLeft: border, borderRight: border, borderBottom,
        boxShadow: scrolled && pinnedCount === 0 && i === colsPerBrand - 1 ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
      }}
    >
      {key === 'reg' ? (reg ?? '') : key === 'ftd' ? (ftd ?? '') : formatPct(conv)}
    </td>
  ))

  // ── Pinned brand groups — frozen right after TOTALS, in pin order ────────
  const orderedBrands = useMemo(() => {
    const pinned = pinnedBrands
      .map((n) => BRANDS.find((b) => b.name === n))
      .filter((b): b is (typeof BRANDS)[number] => b != null)
    return [...pinned, ...BRANDS.filter((b) => !pinnedBrands.includes(b.name))]
  }, [pinnedBrands])
  const pinnedCount = orderedBrands.filter((b) => pinnedBrands.includes(b.name)).length
  const pinnedStart = monthW + colsPerBrand * TOTALS_COL_W
  const mIdx = (k: FtdMetric) => activeMetrics.findIndex((m) => m.key === k)

  // Sticky style for a pinned brand's cell; {} when the brand isn't pinned.
  // brandPos is the brand's index in orderedBrands (pinned brands sort first).
  const pinStyle = (brandPos: number, colIdx: number, z: number): CSSProperties =>
    brandPos < pinnedCount
      ? {
          position: 'sticky',
          left: pinnedStart + (brandPos * colsPerBrand + colIdx) * TOTALS_COL_W,
          zIndex: z,
          width: TOTALS_COL_W, minWidth: TOTALS_COL_W, maxWidth: TOTALS_COL_W,
          boxShadow: scrolled && brandPos === pinnedCount - 1 && colIdx === colsPerBrand - 1
            ? '4px 0 8px -2px rgba(0,0,0,0.18)'
            : undefined,
        }
      : {}

  // Group-header (colSpan) variant of pinStyle.
  const pinHeaderStyle = (brandPos: number): CSSProperties =>
    brandPos < pinnedCount
      ? {
          left: pinnedStart + brandPos * colsPerBrand * TOTALS_COL_W,
          zIndex: 7,
          minWidth: colsPerBrand * TOTALS_COL_W,
          boxShadow: scrolled && brandPos === pinnedCount - 1 ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
        }
      : {}

  // Alpha brand tints turn transparent over scrolled content — pinned cells
  // need an opaque equivalent (tint composited over white).
  const cellBg = (brandPos: number, tint: string): CSSProperties =>
    brandPos < pinnedCount
      ? { backgroundColor: '#FFFFFF', backgroundImage: `linear-gradient(${tint}, ${tint})` }
      : { background: tint }

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-xl border" style={{ borderColor: TABLE_BORDER, background: '#fff', color: '#0F172A' }}>
      <table
        className="w-max min-w-full"
        style={{ borderCollapse: 'collapse', fontSize: '12px' }}
      >
        <thead>
          <tr>
            <th
              ref={monthColRef}
              rowSpan={3}
              className="sticky left-0 top-0 z-[7] px-3 py-2 text-left align-bottom whitespace-nowrap"
              style={{
                background: STICKY_BG,
                borderRight: border,
                borderBottom: border,
                minWidth: 90,
              }}
            >
              MONTH
            </th>
            <th
              colSpan={colsPerBrand}
              rowSpan={2}
              className="sticky top-0 z-[7] px-2 py-1.5 text-center align-middle text-[11px] font-bold uppercase tracking-wide text-white whitespace-nowrap"
              style={{
                left: monthW,
                background: TOTALS_HEADER_BG,
                borderLeft: border, borderRight: border, borderBottom: border,
                boxShadow: scrolled && pinnedCount === 0 ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
              }}
            >
              Totals
            </th>
            {orderedBrands.map((b, bi) => (
              <th
                key={b.name}
                colSpan={colsPerBrand}
                className="sticky top-0 z-[6] px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-white whitespace-nowrap"
                style={{ background: BRAND_LOGO_COLORS[b.name] ?? b.color, borderLeft: border, borderRight: border, ...pinHeaderStyle(bi) }}
              >
                <span className="inline-flex items-center gap-1">
                  {b.abbr}
                  <PinButton pinned={bi < pinnedCount} onToggle={() => togglePin(b.name)} />
                </span>
              </th>
            ))}
          </tr>

          <tr>
            {orderedBrands.map((b, bi) => (
              <th
                key={b.name}
                colSpan={colsPerBrand}
                className="sticky top-[29px] z-[6] px-2 py-1 text-center text-[10px] font-mono"
                style={{ background: STAGS_BG, borderLeft: border, borderRight: border, borderBottom: border, ...pinHeaderStyle(bi) }}
              >
                <EditableCell
                  value={stagsMap.get(b.name) ?? ''}
                  onSave={(next) => onEditStags(b.name, next)}
                  placeholder="—"
                  title={writeGate.title ?? `Edit ${b.name} Stags`}
                  disabled={writeGate.editDisabled}
                />
              </th>
            ))}
          </tr>

          <tr>
            {activeMetrics.map(({ key, label }, i) => (
              <th
                key={`totals-${key}`}
                className="sticky top-[52px] z-[7] px-2 py-1 text-center text-[12px] font-bold whitespace-nowrap"
                style={{
                  left: monthW + i * TOTALS_COL_W,
                  width: TOTALS_COL_W, minWidth: TOTALS_COL_W, maxWidth: TOTALS_COL_W,
                  background: TOTALS_SUBHEAD_BG,
                  borderLeft: border, borderRight: border, borderBottom: border,
                  boxShadow: scrolled && pinnedCount === 0 && i === colsPerBrand - 1 ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
                }}
              >
                {label}
              </th>
            ))}
            {orderedBrands.map((b, bi) => (
              <Fragment key={b.name}>
                {activeMetrics.map(({ key, label }, mi) => (
                  <th
                    key={`${b.name}-${key}`}
                    className="sticky top-[52px] z-[6] px-2 py-1 text-center text-[12px] font-bold whitespace-nowrap"
                    style={{ background: SUBHEAD_BG, borderLeft: border, borderRight: border, borderBottom: border, ...pinStyle(bi, mi, 7) }}
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
                style={{
                  background: SUBHEAD_BG,
                  borderRight: border,
                  borderBottom: `2px solid ${TABLE_BORDER}`,
                }}
              >
                {summaryLabel}
              </td>

              {totalsCells(grandTotals.reg, grandTotals.ftd, grandTotals.conv, 'font-bold', `2px solid ${TABLE_BORDER}`)}

              {orderedBrands.map((b, bi) => {
                const bt = summary.perBrand[b.name]
                const tint = brandTint(BRAND_LOGO_COLORS[b.name] ?? b.color)
                return (
                  <Fragment key={b.name}>
                    {activeMetrics.map(({ key }, mi) => (
                      <td
                        key={key}
                        className="px-2 py-1.5 text-center font-mono font-bold"
                        style={{ ...cellBg(bi, tint), borderLeft: border, borderRight: border, borderBottom: `2px solid ${TABLE_BORDER}`, ...pinStyle(bi, mi, 5) }}
                      >
                        {key === 'reg' ? bt.reg : key === 'ftd' ? bt.ftd : formatPct(averagePct(bt.convValues))}
                      </td>
                    ))}
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
                    style={{
                      background: YEAR_ROW_BG,
                      borderRight: border,
                      borderBottom: border,
                    }}
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

                  {(() => {
                    const yt = yearTotals.get(year)
                    return totalsCells(
                      expanded ? null : (yt?.reg ?? 0),
                      expanded ? null : (yt?.ftd ?? 0),
                      expanded ? null : averagePct(yt?.convValues ?? []),
                      'font-semibold',
                      border,
                    )
                  })()}

                  {orderedBrands.map((b, bi) => {
                    const bt = yearAgg[b.name]
                    const tint = brandTint(BRAND_LOGO_COLORS[b.name] ?? b.color)
                    return (
                      <Fragment key={b.name}>
                        {activeMetrics.map(({ key }, mi) => (
                          <td
                            key={key}
                            className="px-2 py-1.5 text-center font-mono font-semibold"
                            style={{ ...cellBg(bi, tint), borderLeft: border, borderRight: border, borderBottom: border, ...pinStyle(bi, mi, 5) }}
                          >
                            {expanded ? '' : key === 'reg' ? bt.reg : key === 'ftd' ? bt.ftd : formatPct(averagePct(bt.convValues))}
                          </td>
                        ))}
                      </Fragment>
                    )
                  })}
                </tr>

                {expanded && yearMonths.map((ym) => (
                  <tr key={ym}>
                    <td
                      className="sticky left-0 z-[5] px-3 py-2 pl-7 font-semibold whitespace-nowrap"
                      style={{
                        background: STICKY_BG,
                        borderRight: border,
                        borderBottom: border,
                      }}
                    >
                      {formatMonthLabel(ym)}
                    </td>

                    {(() => {
                      const mt = monthTotals.get(ym) ?? { reg: 0, ftd: 0 }
                      return totalsCells(mt.reg, mt.ftd, ratioPct(mt.reg, mt.ftd), 'font-semibold', border)
                    })()}

                    {orderedBrands.map((b, bi) => {
                      const rec = recordMap.get(`${b.name}|${ym}`)
                      const tint = brandTint(BRAND_LOGO_COLORS[b.name] ?? b.color)
                      return (
                        <Fragment key={b.name}>
                          {activeKeys.has('reg') && (
                            <td className="px-2 py-1.5 text-center" style={{ ...cellBg(bi, tint), borderLeft: border, borderRight: border, borderBottom: border, ...pinStyle(bi, mIdx('reg'), 5) }}>
                              <EditableCell
                                value={rec?.reg != null ? String(rec.reg) : ''}
                                onSave={(next) => {
                                  const reg = parseIntSafe(next)
                                  return onEditRecord(b.name, ym, { reg, conversionPct: ratioPct(reg, rec?.ftd ?? 0) })
                                }}
                                placeholder="—"
                                title={writeGate.title ?? `Edit ${b.name} REG`}
                                disabled={writeGate.editDisabled}
                                dimWhenDisabled={false}
                              />
                            </td>
                          )}
                          {activeKeys.has('ftd') && (
                            <td className="px-2 py-1.5 text-center" style={{ ...cellBg(bi, tint), borderLeft: border, borderRight: border, borderBottom: border, ...pinStyle(bi, mIdx('ftd'), 5) }}>
                              <EditableCell
                                value={rec?.ftd != null ? String(rec.ftd) : ''}
                                onSave={(next) => {
                                  const ftd = parseIntSafe(next)
                                  return onEditRecord(b.name, ym, { ftd, conversionPct: ratioPct(rec?.reg ?? 0, ftd) })
                                }}
                                placeholder="—"
                                title={writeGate.title ?? `Edit ${b.name} FTD`}
                                disabled={writeGate.editDisabled}
                                dimWhenDisabled={false}
                              />
                            </td>
                          )}
                          {activeKeys.has('conv') && (
                            <td className="px-2 py-1.5 text-center" style={{ ...cellBg(bi, tint), borderLeft: border, borderRight: border, borderBottom: border, ...pinStyle(bi, mIdx('conv'), 5) }} title="Conversion % = FTD ÷ REG × 100, calculated automatically">
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
