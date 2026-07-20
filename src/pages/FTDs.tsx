import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { FtdMatrixTable, blendedPct } from '../components/FtdMatrixTable'
import { FtdEntryForm } from '../components/FtdEntryForm'
import { loadFtdData, upsertFtdRecord, upsertFtdTotals, upsertBrandStags } from '../lib/ftdStorage'
import { parseFtdXlsx } from '../lib/ftdParser'
import type { FtdRecord, FtdRecordPatch, FtdTotals, BrandStags, RROutletContext } from '../types'

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

// Same visual pattern as StatsRow.tsx's StatCard (accent bar, uppercase
// label, font-display value, sub text) — these aren't click-to-filter,
// just a static summary, so there's no active/onClick state.
function FtdStatCard({ label, value, accent, sub }: { label: string; value: number | string; accent: string; sub: string }) {
  return (
    <div
      className="rounded-[10px] px-3 sm:px-4 py-2.5 flex flex-col gap-1 relative overflow-hidden"
      style={{ background: 'white', border: '1px solid #E2E8F0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-[10px]" style={{ background: accent }} />
      <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B] truncate">
        {label}
      </div>
      <div className="font-display text-[22px] sm:text-[32px] leading-none" style={{ color: accent }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-[9px] sm:text-[10px] text-[#64748B] truncate">{sub}</div>
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
  const [importing,      setImporting]      = useState(false)
  const [importSkipped,  setImportSkipped]  = useState<string[]>([])
  const [yearFilter, setYearFilter] = useState('all')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const years = useMemo(() => {
    const set = new Set<string>()
    records.forEach((r) => set.add(r.yearMonth.slice(0, 4)))
    totals.forEach((t) => set.add(t.yearMonth.slice(0, 4)))
    return Array.from(set).sort().reverse()
  }, [records, totals])

  const filteredRecords = useMemo(
    () => (yearFilter === 'all' ? records : records.filter((r) => r.yearMonth.startsWith(yearFilter))),
    [records, yearFilter],
  )
  const filteredTotals = useMemo(
    () => (yearFilter === 'all' ? totals : totals.filter((t) => t.yearMonth.startsWith(yearFilter))),
    [totals, yearFilter],
  )

  const cardStats = useMemo(() => {
    const totalReg = filteredRecords.reduce((s, r) => s + r.reg, 0)
    const totalFtd = filteredRecords.reduce((s, r) => s + r.ftd, 0)
    return { totalReg, totalFtd, conversionPct: blendedPct(totalReg, totalFtd) }
  }, [filteredRecords])

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

  const handleImportFile = useCallback(async (file: File) => {
    setImporting(true)
    setImportSkipped([])
    try {
      const buf = await file.arrayBuffer()
      const { records: parsedRecords, totals: parsedTotals, stags: parsedStags, skipped } = parseFtdXlsx(buf)

      for (const r of parsedRecords) {
        await upsertFtdRecord(r.brand, r.yearMonth, { reg: r.reg, ftd: r.ftd, conversionPct: r.conversionPct })
      }
      for (const t of parsedTotals) {
        await upsertFtdTotals(t.yearMonth, t.conversionPct)
      }
      for (const s of parsedStags) {
        await upsertBrandStags(s.brand, s.stags)
      }

      const fresh = await loadFtdData()
      setRecords(fresh.records)
      setTotals(fresh.totals)
      setStags(fresh.stags)
      setImportSkipped(skipped)
    } catch (err) {
      addToast(`Import failed: ${formatError(err)}`, 'error')
    } finally {
      setImporting(false)
    }
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
      <div className="grid grid-cols-3 gap-[5px] max-w-xl mb-4">
        <FtdStatCard label="Total REG"   value={cardStats.totalReg}   accent="#0F172A" sub="registrations" />
        <FtdStatCard label="Total FTD"   value={cardStats.totalFtd}   accent="#10B981" sub="deposits" />
        <FtdStatCard
          label="Conversion %"
          value={cardStats.conversionPct == null ? '—' : `${cardStats.conversionPct}%`}
          accent="#8B5CF6"
          sub="blended rate"
        />
      </div>

      <div className="flex items-center justify-between gap-2 mb-4">
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="px-3 py-2 rounded-md text-[12px] font-semibold text-[#0F172A] border border-[#CBD5E1] outline-none focus:border-[#0F172A] bg-white"
        >
          <option value="all">All Years</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = '' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="px-4 py-2 rounded-md text-[12px] font-bold text-[#0F172A] border border-[#CBD5E1] hover:border-[#0F172A] disabled:opacity-50 transition-colors"
          >
            {importing ? 'Importing…' : 'Import History'}
          </button>
          <button
            onClick={() => setShowEntryForm(true)}
            className="px-4 py-2 rounded-md text-[12px] font-bold text-white bg-[#0F172A] hover:bg-[#1E293B] transition-colors"
          >
            + Add / Edit Month
          </button>
        </div>
      </div>

      {importSkipped.length > 0 && (
        <div className="mb-4 px-4 py-2.5 rounded-md bg-[rgba(244,63,94,0.08)] border border-[rgba(244,63,94,0.3)] text-[12px] text-[#F43F5E]">
          Skipped {importSkipped.length} row{importSkipped.length !== 1 ? 's' : ''} during import:
          <ul className="list-disc list-inside mt-1">
            {importSkipped.slice(0, 5).map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      <FtdMatrixTable
        records={filteredRecords}
        totals={filteredTotals}
        stags={stags}
        onEditRecord={handleEditRecord}
        onEditStags={handleEditStags}
        summaryLabel={yearFilter === 'all' ? 'ALL-TIME' : `${yearFilter} TOTAL`}
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
