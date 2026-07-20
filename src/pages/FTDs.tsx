import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Check, ChevronDown } from 'lucide-react'
import { FtdMatrixTable, averagePct, ratioPct, rawRatio, formatMonthLabel } from '../components/FtdMatrixTable'
import type { FtdMetric } from '../components/FtdMatrixTable'
import { FtdEntryForm } from '../components/FtdEntryForm'
import { loadFtdData, upsertFtdRecord, upsertFtdTotals, upsertBrandStags } from '../lib/ftdStorage'
import type { FtdRecord, FtdRecordPatch, FtdTotals, BrandStags, RROutletContext } from '../types'

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

// Same visual pattern as StatsRow.tsx's StatCard (accent bar, uppercase
// label, font-display value, sub text, active/click-to-filter state).
function FtdStatCard({
  label, value, accent, sub, active, onClick,
}: {
  label: string
  value: number | string
  accent: string
  sub: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-[10px] px-3 sm:px-4 py-2.5 flex flex-col gap-1 relative overflow-hidden ${onClick ? 'cursor-pointer select-none transition-all' : ''}`}
      style={{
        background: active ? `${accent}10` : 'white',
        border: active ? `2px solid ${accent}` : '1px solid #E2E8F0',
        boxShadow: active
          ? `0 0 0 3px ${accent}22, 0 2px 8px rgba(0,0,0,0.08)`
          : '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-[10px]" style={{ background: accent }} />
      <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B] truncate">
        {label}
      </div>
      <div className="font-display text-[22px] sm:text-[32px] leading-none" style={{ color: accent }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-[9px] sm:text-[10px] text-[#64748B] truncate">
        {active ? <span style={{ color: accent }}>● filtering</span> : sub}
      </div>
    </div>
  )
}

export function FTDs() {
  const { addToast } = useOutletContext<RROutletContext>()
  const [records, setRecords] = useState<FtdRecord[]>([])
  const [totals,  setTotals]  = useState<FtdTotals[]>([])
  const [stags,   setStags]   = useState<BrandStags[]>([])
  const [loading, setLoading] = useState(true)
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [periodFilter, setPeriodFilter] = useState('all') // 'all' | 'YYYY' | 'YYYY-MM'
  const [periodDdOpen, setPeriodDdOpen] = useState(false)
  const [activeMetric, setActiveMetric] = useState<FtdMetric | null>(null)
  const periodDdRef = useRef<HTMLDivElement>(null)

  const toggleMetric = (m: FtdMetric) => setActiveMetric((prev) => (prev === m ? null : m))

  const allMonths = useMemo(() => {
    const set = new Set<string>()
    records.forEach((r) => set.add(r.yearMonth))
    totals.forEach((t) => set.add(t.yearMonth))
    return Array.from(set).sort().reverse()
  }, [records, totals])

  const years = useMemo(() => {
    const set = new Set<string>()
    allMonths.forEach((m) => set.add(m.slice(0, 4)))
    return Array.from(set).sort().reverse()
  }, [allMonths])

  // Flat, grouped list: "All Years", then each year followed by its own
  // months (indented) — lets the one dropdown filter by year OR by a
  // single month.
  const periodOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string; indent?: boolean }> = [{ id: 'all', label: 'All Years' }]
    for (const y of years) {
      opts.push({ id: y, label: y })
      for (const m of allMonths.filter((mm) => mm.startsWith(y))) {
        opts.push({ id: m, label: formatMonthLabel(m), indent: true })
      }
    }
    return opts
  }, [years, allMonths])
  const activePeriodOption = periodOptions.find((o) => o.id === periodFilter) ?? periodOptions[0]

  // Outside-click + Escape-to-close — same pattern as every other custom
  // dropdown in this app (UploadModal's category selector, BPSites'/LPSites'
  // filter dropdowns).
  useEffect(() => {
    if (!periodDdOpen) return
    const onDown = (e: MouseEvent) => {
      if (periodDdRef.current && !periodDdRef.current.contains(e.target as Node)) setPeriodDdOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPeriodDdOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [periodDdOpen])

  const matchesPeriod = useCallback((yearMonth: string) => {
    if (periodFilter === 'all') return true
    return periodFilter.length === 4 ? yearMonth.startsWith(periodFilter) : yearMonth === periodFilter
  }, [periodFilter])

  const filteredRecords = useMemo(() => records.filter((r) => matchesPeriod(r.yearMonth)), [records, matchesPeriod])
  const filteredTotals  = useMemo(() => totals.filter((t) => matchesPeriod(t.yearMonth)),  [totals, matchesPeriod])

  const cardStats = useMemo(() => {
    const totalReg = filteredRecords.reduce((s, r) => s + r.reg, 0)
    const totalFtd = filteredRecords.reduce((s, r) => s + r.ftd, 0)

    let conversionPct: number | null
    if (periodFilter.length === 7) {
      // Filtered to one exact month: just FTD ÷ REG × 100 for that month,
      // same as every per-brand monthly cell — nothing to average across.
      conversionPct = ratioPct(totalReg, totalFtd)
    } else {
      // Filtered to a year or "All Years": matches the source sheet's
      // Totals row — AVERAGE() of each included month's own blended ratio
      // (that month's REG/FTD summed across every brand), computed fresh
      // rather than read from the separately-stored ftd_totals field,
      // which isn't guaranteed to be populated for every month.
      const monthTotals = new Map<string, { reg: number; ftd: number }>()
      for (const r of filteredRecords) {
        const t = monthTotals.get(r.yearMonth) ?? { reg: 0, ftd: 0 }
        t.reg += r.reg
        t.ftd += r.ftd
        monthTotals.set(r.yearMonth, t)
      }
      const monthlyRatios = Array.from(monthTotals.values()).map((t) => rawRatio(t.reg, t.ftd))
      conversionPct = averagePct(monthlyRatios)
    }

    return { totalReg, totalFtd, conversionPct }
  }, [filteredRecords, periodFilter])

  useEffect(() => {
    let cancelled = false
    loadFtdData()
      .then((data) => {
        if (cancelled) return
        setRecords(data.records)
        setTotals(data.totals)
        setStags(data.stags)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        addToast(`Failed to load FTD data: ${formatError(err)}`, 'error')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [addToast])

  const handleEditRecord = useCallback(async (brand: string, yearMonth: string, patch: FtdRecordPatch) => {
    try {
      await upsertFtdRecord(brand, yearMonth, patch)
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
    setRecords((prev) => {
      const idx = prev.findIndex((r) => r.brand === brand && r.yearMonth === yearMonth)
      if (idx === -1) {
        return [...prev, {
          brand,
          yearMonth,
          reg:           patch.reg ?? 0,
          ftd:           patch.ftd ?? 0,
          conversionPct: patch.conversionPct ?? null,
        }]
      }
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }, [addToast])

  const handleEditTotals = useCallback(async (yearMonth: string, conversionPct: number | null) => {
    try {
      await upsertFtdTotals(yearMonth, conversionPct)
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
    setTotals((prev) => {
      const idx = prev.findIndex((t) => t.yearMonth === yearMonth)
      if (idx === -1) return [...prev, { yearMonth, conversionPct }]
      const next = [...prev]
      next[idx] = { ...next[idx], conversionPct }
      return next
    })
  }, [addToast])

  const handleEditStags = useCallback(async (brand: string, stagsValue: string) => {
    try {
      await upsertBrandStags(brand, stagsValue)
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
    setStags((prev) => {
      const idx = prev.findIndex((s) => s.brand === brand)
      if (idx === -1) return [...prev, { brand, stags: stagsValue }]
      const next = [...prev]
      next[idx] = { ...next[idx], stags: stagsValue }
      return next
    })
  }, [addToast])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-[#94A3B8] font-mono text-[12px] tracking-wider">
        Loading FTD data…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto px-3 sm:px-7 pb-7 pt-5">
      <div className="flex justify-end mb-3">
        <div ref={periodDdRef} className="relative shrink-0">
          <div
            onClick={() => setPeriodDdOpen((v) => !v)}
            className={`flex items-center gap-2 bg-white border rounded-md pl-2.5 pr-2 py-1.5 text-[12px] text-[#0F172A] cursor-pointer transition-colors ${
              periodDdOpen ? 'border-[#0F172A]' : 'border-[#CBD5E1] hover:border-[#0F172A]'
            }`}
          >
            <span className="font-medium flex-1 min-w-0 truncate">{activePeriodOption.label}</span>
            <ChevronDown
              size={13}
              strokeWidth={2.25}
              className={`text-[#64748B] shrink-0 transition-transform duration-150 ${periodDdOpen ? 'rotate-180' : ''}`}
            />
          </div>

          {periodDdOpen && (
            <div className="absolute right-0 top-full mt-1.5 bg-white border border-[#E2E8F0] rounded-md shadow-[0_12px_32px_rgba(15,23,42,0.12)] overflow-hidden z-20 min-w-[160px] max-h-[320px] overflow-y-auto animate-[modalIn_0.12s_ease]">
              {periodOptions.map((o) => {
                const selected = o.id === periodFilter
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => { setPeriodFilter(o.id); setPeriodDdOpen(false) }}
                    className={`w-full flex items-center justify-between text-left transition-colors ${
                      o.indent ? 'pl-6 pr-3 py-1.5 text-[11px]' : 'px-3 py-2 text-[12px]'
                    } ${selected ? 'bg-[#0F172A] text-white' : 'text-[#0F172A] hover:bg-[#F1F5F9]'}`}
                  >
                    <span className={o.indent ? 'font-normal' : 'font-medium'}>{o.label}</span>
                    {selected && <Check size={13} strokeWidth={2.5} />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-[5px] mb-4">
        <FtdStatCard
          label="Total REG"
          value={cardStats.totalReg}
          accent="#0F172A"
          sub="registrations"
          active={activeMetric === 'reg'}
          onClick={() => toggleMetric('reg')}
        />
        <FtdStatCard
          label="Total FTD"
          value={cardStats.totalFtd}
          accent="#10B981"
          sub="deposits"
          active={activeMetric === 'ftd'}
          onClick={() => toggleMetric('ftd')}
        />
        <FtdStatCard
          label="Conversion %"
          value={cardStats.conversionPct == null ? '—' : `${cardStats.conversionPct}%`}
          accent="#8B5CF6"
          sub={periodFilter.length === 7 ? 'this month' : 'monthly average'}
          active={activeMetric === 'conv'}
          onClick={() => toggleMetric('conv')}
        />
      </div>

      <div className="flex items-center justify-end gap-2 mb-4">
        <button
          onClick={() => setShowEntryForm(true)}
          className="px-4 py-2 rounded-md text-[12px] font-bold text-white bg-[#0F172A] hover:bg-[#1E293B] transition-colors"
        >
          + Add / Edit Month
        </button>
      </div>

      <FtdMatrixTable
        records={filteredRecords}
        totals={filteredTotals}
        stags={stags}
        onEditRecord={handleEditRecord}
        onEditStags={handleEditStags}
        visibleMetric={activeMetric}
        summaryLabel={
          periodFilter === 'all'
            ? 'TOTAL'
            : periodFilter.length === 4
              ? `${periodFilter} TOTAL`
              : `${formatMonthLabel(periodFilter)} TOTAL`
        }
      />

      {showEntryForm && (
        <FtdEntryForm
          records={records}
          totals={totals}
          onEditRecord={handleEditRecord}
          onEditTotals={handleEditTotals}
          onClose={() => setShowEntryForm(false)}
        />
      )}
    </div>
  )
}
