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
      <div className="grid grid-cols-3 gap-3 mb-4 max-w-xl">
        <div className="bg-white border border-[#E2E8F0] rounded-[10px] p-4">
          <div className="text-[10px] uppercase tracking-wide text-[#64748B] font-semibold mb-1">Total REG</div>
          <div className="text-[22px] font-bold text-[#0F172A] font-mono">{cardStats.totalReg.toLocaleString()}</div>
        </div>
        <div className="bg-white border border-[#E2E8F0] rounded-[10px] p-4">
          <div className="text-[10px] uppercase tracking-wide text-[#64748B] font-semibold mb-1">Total FTD</div>
          <div className="text-[22px] font-bold text-[#0F172A] font-mono">{cardStats.totalFtd.toLocaleString()}</div>
        </div>
        <div className="bg-white border border-[#E2E8F0] rounded-[10px] p-4">
          <div className="text-[10px] uppercase tracking-wide text-[#64748B] font-semibold mb-1">Conversion %</div>
          <div className="text-[22px] font-bold text-[#0F172A] font-mono">
            {cardStats.conversionPct == null ? '—' : `${cardStats.conversionPct}%`}
          </div>
        </div>
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
