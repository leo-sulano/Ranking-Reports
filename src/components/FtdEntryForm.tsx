import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { BRANDS } from '../lib/brands'
import { ratioPct } from './FtdMatrixTable'
import type { FtdRecord, FtdRecordPatch, FtdTotals, WriteGate } from '../types'

interface BrandInputs {
  reg: string
  ftd: string
}

function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function emptyInputs(): BrandInputs {
  return { reg: '', ftd: '' }
}

function toNum(raw: string): number {
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : 0
}

function toPct(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

function formatPct(v: number | null): string {
  return v == null ? '—' : `${v}%`
}

interface Props {
  records: FtdRecord[]
  totals:  FtdTotals[]
  onEditRecord: (brand: string, yearMonth: string, patch: FtdRecordPatch) => Promise<void>
  onEditTotals: (yearMonth: string, conversionPct: number | null) => Promise<void>
  onClose: () => void
  writeGate: WriteGate
}

export function FtdEntryForm({ records, totals, onEditRecord, onEditTotals, onClose, writeGate }: Props) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [values, setValues] = useState<Record<string, BrandInputs>>(() => {
    const init: Record<string, BrandInputs> = {}
    for (const b of BRANDS) init[b.name] = emptyInputs()
    return init
  })
  const [totalsConv, setTotalsConv] = useState('')
  const [saving, setSaving] = useState(false)

  function loadMonth(ym: string) {
    setYearMonth(ym)
    const next: Record<string, BrandInputs> = {}
    for (const b of BRANDS) {
      const rec = records.find((r) => r.brand === b.name && r.yearMonth === ym)
      next[b.name] = rec
        ? { reg: String(rec.reg), ftd: String(rec.ftd) }
        : emptyInputs()
    }
    setValues(next)
    const totalsRow = totals.find((t) => t.yearMonth === ym)
    setTotalsConv(totalsRow?.conversionPct != null ? String(totalsRow.conversionPct) : '')
  }

  const computedTotals = useMemo(() => {
    let reg = 0
    let ftd = 0
    for (const b of BRANDS) {
      reg += toNum(values[b.name]?.reg ?? '')
      ftd += toNum(values[b.name]?.ftd ?? '')
    }
    return { reg, ftd }
  }, [values])

  async function handleSubmit() {
    setSaving(true)
    try {
      for (const b of BRANDS) {
        const v = values[b.name]
        if (v.reg.trim() === '' && v.ftd.trim() === '') continue
        const reg = toNum(v.reg)
        const ftd = toNum(v.ftd)
        await onEditRecord(b.name, yearMonth, { reg, ftd, conversionPct: ratioPct(reg, ftd) })
      }
      await onEditTotals(yearMonth, toPct(totalsConv))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-md z-50 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white border border-[#E2E8F0] rounded-[14px] w-[640px] max-w-[95vw] max-h-[85vh] overflow-hidden shadow-[0_40px_80px_rgba(15,23,42,0.18)] flex flex-col animate-[modalIn_0.2s_ease]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E2E8F0] shrink-0">
          <h2 className="font-display text-[18px] tracking-wider text-[#0F172A] leading-none">
            Add / Edit Month
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center bg-[#F1F5F9] border border-[#E2E8F0] rounded-md text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1] transition-all"
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B] mb-1.5">
              Month
            </label>
            <input
              type="month"
              value={yearMonth}
              onChange={(e) => loadMonth(e.target.value)}
              className="border border-[#CBD5E1] rounded-md px-3 py-2 text-[13px] text-[#0F172A] outline-none focus:border-[#0F172A]"
            />
          </div>

          <div className="border border-[#E2E8F0] rounded-md overflow-hidden">
            <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wide text-[#64748B]">
              <span>Brand</span><span className="text-center">REG</span><span className="text-center">FTD</span><span className="text-center">Conv%</span>
            </div>
            <div className="divide-y divide-[#F1F5F9] max-h-[280px] overflow-y-auto">
              {BRANDS.map((b) => (
                <div key={b.name} className="grid grid-cols-4 gap-2 px-3 py-1.5 items-center">
                  <span className="text-[12px] font-semibold text-[#0F172A] truncate">{b.name}</span>
                  <input
                    type="number"
                    value={values[b.name]?.reg ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [b.name]: { ...v[b.name], reg: e.target.value } }))}
                    className="border border-[#E2E8F0] rounded px-2 py-1 text-[12px] text-center outline-none focus:border-[#0F172A]"
                  />
                  <input
                    type="number"
                    value={values[b.name]?.ftd ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [b.name]: { ...v[b.name], ftd: e.target.value } }))}
                    className="border border-[#E2E8F0] rounded px-2 py-1 text-[12px] text-center outline-none focus:border-[#0F172A]"
                  />
                  <span
                    className="text-[12px] text-center font-mono text-[#64748B]"
                    title="Conversion % = FTD ÷ REG × 100, calculated automatically"
                  >
                    {formatPct(ratioPct(toNum(values[b.name]?.reg ?? ''), toNum(values[b.name]?.ftd ?? '')))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 items-center border border-[#E2E8F0] rounded-md px-3 py-2 bg-[#F8FAFC]">
            <span className="text-[12px] font-bold text-[#0F172A]">Totals</span>
            <span className="text-[12px] text-center font-mono text-[#64748B]">{computedTotals.reg}</span>
            <span className="text-[12px] text-center font-mono text-[#64748B]">{computedTotals.ftd}</span>
            <input
              type="number"
              value={totalsConv}
              onChange={(e) => setTotalsConv(e.target.value)}
              placeholder="Conv%"
              className="border border-[#CBD5E1] rounded px-2 py-1 text-[12px] text-center outline-none focus:border-[#0F172A]"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#E2E8F0] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-[13px] font-semibold text-[#64748B] hover:text-[#0F172A] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || writeGate.disabled}
            title={writeGate.title}
            className="px-4 py-2 rounded-md text-[13px] font-bold text-white bg-[#0F172A] hover:bg-[#1E293B] disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Month'}
          </button>
        </div>
      </div>
    </div>
  )
}
