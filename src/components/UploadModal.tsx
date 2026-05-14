import { useRef, useState } from 'react'
import { parseXlsx } from '../lib/parser'
import type { RankingRecord } from '../types'
import { CATEGORIES, DEFAULT_CATEGORY } from '../lib/categories'
import type { CategoryId } from '../lib/categories'

interface Props {
  onImport: (records: RankingRecord[], category: CategoryId) => void
  onClose: () => void
}

export function UploadModal({ onImport, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<CategoryId>(DEFAULT_CATEGORY)

  const handleFile = (file: File) => {
    if (!file) return
    setParsing(true)
    setError(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buf = e.target?.result as ArrayBuffer
        const records = parseXlsx(buf)
        if (records.length === 0) {
          setError('No valid records found. Check that columns match: Domain, Keyword, Country, Position.')
          setParsing(false)
          return
        }
        setTimeout(() => {
          onImport(records, category)
        }, 200)
      } catch (err) {
        setError(`Parse error: ${err instanceof Error ? err.message : String(err)}`)
        setParsing(false)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-md z-50 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white border border-[#CBD5E1] rounded-[14px] w-[480px] max-w-[95vw] overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.6)] animate-[modalIn_0.2s_ease]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E2E8F0]">
          <h2 className="font-display text-[22px] tracking-wider text-[#0F172A]">
            Import Ranking Data
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center bg-[#F1F5F9] border border-[#E2E8F0] rounded-md text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1] transition-all text-[16px]"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Category selector */}
          <div>
            <label
              htmlFor="upload-category"
              className="block text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B] mb-1.5"
            >
              Category
            </label>
            <div className="relative">
              <select
                id="upload-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as CategoryId)}
                className="w-full appearance-none bg-white border border-[#CBD5E1] rounded-md pl-3 pr-9 py-2 text-[13px] text-[#0F172A] outline-none focus:border-[#0F172A] transition-colors cursor-pointer"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <svg
                className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-60"
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
            <p className="text-[11px] text-[#64748B] mt-1.5">
              This upload's data will only appear under {CATEGORIES.find((c) => c.id === category)?.label}.
            </p>
          </div>

          {/* Drop zone */}
          <div
            className={`relative border-2 border-dashed rounded-[10px] p-10 text-center cursor-pointer transition-all ${
              dragging
                ? 'border-[#0F172A] bg-[rgba(15,23,42,0.08)] scale-[1.01]'
                : 'border-[#CBD5E1] bg-[#F1F5F9] hover:border-[#0F172A] hover:bg-[rgba(15,23,42,0.04)]'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            <div className="text-4xl mb-3 opacity-60">📁</div>
            <p className="text-[15px] font-semibold text-[#0F172A] mb-1.5">
              Drop your file here or click to browse
            </p>
            <p className="text-[12px] text-[#64748B]">Supports Excel and CSV formats</p>
            <span className="inline-block mt-2.5 px-2.5 py-0.5 bg-white border border-[#E2E8F0] rounded-full font-mono text-[11px] text-[#64748B]">
              .xlsx / .xls / .csv
            </span>
          </div>

          {/* Expected columns */}
          <div className="bg-[#F1F5F9] border border-[#E2E8F0] rounded-md p-3">
            <p className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B] mb-2">
              Expected Columns
            </p>
            <div className="flex flex-wrap gap-1.5">
              {['Domain', 'Keyword', 'Country', 'Position'].map((c) => (
                <span
                  key={c}
                  className="font-mono text-[10px] px-2 py-0.5 bg-[rgba(15,23,42,0.06)] border border-[rgba(15,23,42,0.25)] rounded text-[#0F172A]"
                >
                  {c}
                </span>
              ))}
              {['Previous', 'Change', 'Last Check'].map((c) => (
                <span
                  key={c}
                  className="font-mono text-[10px] px-2 py-0.5 bg-white border border-[#E2E8F0] rounded text-[#475569]"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* Parsing state */}
          {parsing && (
            <div className="space-y-2">
              <div className="h-[3px] bg-[#F1F5F9] rounded-full overflow-hidden">
                <div className="h-full bg-[#0F172A] rounded-full animate-[progressPulse_1.2s_ease-in-out_infinite]" />
              </div>
              <p className="text-center text-[12px] text-[#64748B]">Parsing data…</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-[rgba(244,63,94,0.08)] border border-[rgba(244,63,94,0.3)] rounded-md px-3 py-2.5">
              <span className="text-[#F43F5E] shrink-0">⚠</span>
              <p className="text-[12px] text-[#F43F5E]">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
