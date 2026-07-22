import { useEffect, useRef, useState } from 'react'
import { parseXlsx } from '../lib/parser'
import type { UnknownDomain, ParsedSnapshot } from '../lib/parser'
import { CATEGORIES, DEFAULT_CATEGORY } from '../lib/categories'
import type { CategoryId } from '../lib/categories'
import { X, ChevronDown, Check, UploadCloud, AlertCircle, FileSpreadsheet } from 'lucide-react'

interface Props {
  onImport: (snapshots: ParsedSnapshot[], category: CategoryId, unknownDomains: UnknownDomain[]) => void
  onClose: () => void
}

export function UploadModal({ onImport, onClose }: Props) {
  const inputRef    = useRef<HTMLInputElement>(null)
  const ddRef       = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsing,  setParsing]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [category, setCategory] = useState<CategoryId>(DEFAULT_CATEGORY)
  const [ddOpen,   setDdOpen]   = useState(false)

  // Close dropdown on outside click / escape
  useEffect(() => {
    if (!ddOpen) return
    const onDown = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDdOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDdOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ddOpen])

  const handleFile = (file: File) => {
    if (!file) return
    setParsing(true)
    setError(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buf = e.target?.result as ArrayBuffer
        const { snapshots, unknownDomains } = parseXlsx(buf, category)
        if (snapshots.length === 0) {
          setError('No valid records found. For flat files: check columns match Domain, Keyword, Country, Position. For matrix files: ensure per-brand sheets are named LUCKY7, LUCKYVIBE, etc.')
          setParsing(false)
          return
        }
        setTimeout(() => {
          onImport(snapshots, category, unknownDomains)
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

  const activeCategory = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0]

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-md z-50 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[14px] w-[480px] max-w-[95vw] overflow-hidden shadow-[0_40px_80px_rgba(15,23,42,0.18)] animate-[modalIn_0.2s_ease]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[var(--btn-ink)] flex items-center justify-center">
              <FileSpreadsheet size={15} strokeWidth={2.25} className="text-white" />
            </div>
            <h2 className="font-display text-[18px] tracking-wider text-[var(--ink)] leading-none">
              Import Ranking Data
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center bg-[var(--surface-3)] border border-[var(--border)] rounded-md text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--border-strong)] transition-all"
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Category selector — custom dropdown so the highlight matches site theme */}
          <div ref={ddRef} className="relative">
            <label
              className="block text-[10px] uppercase tracking-[0.1em] font-semibold text-[var(--muted)] mb-1.5"
            >
              Category
            </label>
            <button
              type="button"
              onClick={() => setDdOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={ddOpen}
              className={`w-full flex items-center justify-between bg-[var(--surface)] border rounded-md px-3 py-2.5 text-[13px] text-[var(--ink)] outline-none transition-colors ${
                ddOpen ? 'border-[var(--ink)]' : 'border-[var(--border-strong)] hover:border-[var(--ink)]'
              }`}
            >
              <span className="font-medium">{activeCategory.label}</span>
              <ChevronDown
                size={15}
                strokeWidth={2.25}
                className={`text-[var(--muted)] transition-transform duration-150 ${ddOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {ddOpen && (
              <div
                role="listbox"
                className="absolute left-0 right-0 top-full mt-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-[0_12px_32px_rgba(15,23,42,0.12)] overflow-hidden z-10 animate-[modalIn_0.12s_ease]"
              >
                {CATEGORIES.map((c) => {
                  const selected = c.id === category
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => { setCategory(c.id); setDdOpen(false) }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-[13px] text-left transition-colors ${
                        selected
                          ? 'bg-[var(--btn-ink)] text-white'
                          : 'text-[var(--ink)] hover:bg-[var(--surface-3)]'
                      }`}
                    >
                      <span className="font-medium">{c.label}</span>
                      {selected && <Check size={14} strokeWidth={2.5} />}
                    </button>
                  )
                })}
              </div>
            )}

            <p className="text-[11px] text-[var(--muted)] mt-1.5 leading-snug">
              Data will only appear under <span className="font-semibold text-[var(--ink)]">{activeCategory.label}</span>.
            </p>
          </div>

          {/* Drop zone */}
          <div
            className={`relative border-2 border-dashed rounded-[10px] p-9 text-center cursor-pointer transition-all ${
              dragging
                ? 'border-[var(--ink)] bg-[rgba(15,23,42,0.06)] scale-[1.005]'
                : 'border-[var(--border-strong)] bg-[var(--surface-2)] hover:border-[var(--ink)] hover:bg-[var(--surface-3)]'
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
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
              <UploadCloud size={22} strokeWidth={1.75} className="text-[var(--ink)]" />
            </div>
            <p className="text-[14px] font-semibold text-[var(--ink)] mb-1">
              Drop your file here or click to browse
            </p>
            <p className="text-[12px] text-[var(--muted)]">Supports Excel and CSV formats</p>
            <span className="inline-block mt-2.5 px-2.5 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded-full font-mono text-[10px] text-[var(--muted)] tracking-wide">
              .xlsx · .xls · .csv
            </span>
          </div>

          {/* Parsing state */}
          {parsing && (
            <div className="space-y-2">
              <div className="h-[3px] bg-[var(--surface-3)] rounded-full overflow-hidden">
                <div className="h-full bg-[var(--btn-ink)] rounded-full animate-[progressPulse_1.2s_ease-in-out_infinite]" />
              </div>
              <p className="text-center text-[12px] text-[var(--muted)]">Parsing data…</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-[rgba(244,63,94,0.08)] border border-[rgba(244,63,94,0.3)] rounded-md px-3 py-2.5">
              <AlertCircle size={14} strokeWidth={2.25} className="text-[#F43F5E] shrink-0 mt-0.5" />
              <p className="text-[12px] text-[#F43F5E] leading-snug">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
