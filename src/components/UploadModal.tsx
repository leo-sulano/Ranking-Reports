import { useRef, useState } from 'react'
import { parseXlsx } from '../lib/parser'
import type { RankingRecord } from '../types'

interface Props {
  onImport: (records: RankingRecord[]) => void
  onClose: () => void
}

export function UploadModal({ onImport, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          onImport(records)
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
          {/* Drop zone */}
          <div
            className={`relative border-2 border-dashed rounded-[10px] p-10 text-center cursor-pointer transition-all ${
              dragging
                ? 'border-[#F59E0B] bg-[rgba(245,158,11,0.12)] scale-[1.01]'
                : 'border-[#CBD5E1] bg-[#F1F5F9] hover:border-[#F59E0B] hover:bg-[rgba(245,158,11,0.06)]'
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
                  className="font-mono text-[10px] px-2 py-0.5 bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.4)] rounded text-[#B45309]"
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
                <div className="h-full bg-[#F59E0B] rounded-full animate-[progressPulse_1.2s_ease-in-out_infinite]" />
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
