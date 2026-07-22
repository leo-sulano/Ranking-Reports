import type { Snapshot, WriteGate } from '../types'

export interface DuplicateWarningData {
  existing: Snapshot
}

interface Props {
  data: DuplicateWarningData
  onClose: () => void
  onDelete: () => void
  writeGate: WriteGate
}

export function DuplicateWarning({ data, onClose, onDelete, writeGate }: Props) {
  const { existing } = data

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-md z-[60] flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--surface)] border border-[var(--neg-border)] rounded-[14px] w-[440px] max-w-[95vw] overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.6)] animate-[modalIn_0.2s_ease]">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-[var(--border)]">
          <div className="w-9 h-9 rounded-full bg-[var(--neg-surface)] border border-[var(--neg-border)] flex items-center justify-center text-[var(--neg)] text-[18px] font-bold">
            !
          </div>
          <div>
            <h2 className="font-display text-[16px] tracking-wider text-[var(--ink)] leading-tight">
              File already imported
            </h2>
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              A snapshot for this date already exists
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3">
          <p className="text-[13px] text-[var(--text-2)] leading-relaxed">
            The file you uploaded has a <code className="font-mono text-[var(--ink)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded border border-[var(--border)]">Last Check</code> date that matches an existing snapshot. Duplicate uploads are not allowed.
          </p>

          <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-md p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[var(--muted)]">Existing snapshot</span>
              <span className="text-[11px] font-mono text-[var(--ink)]">{existing.displayDate}</span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span className="text-[var(--muted)]">Records stored</span>
              <span className="font-mono text-[var(--ink)]">{existing.records.length}</span>
            </div>
            <div className="flex justify-between text-[12px] mt-1">
              <span className="text-[var(--muted)]">Snapshot ID</span>
              <span className="font-mono text-[var(--muted)]">{existing.id}</span>
            </div>
          </div>

          <p className="text-[12px] text-[var(--muted)] leading-relaxed">
            To re-import, delete the existing snapshot first — or click <span className="text-[var(--neg)] font-semibold">Delete &amp; replace</span> below.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[var(--border)] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-transparent border border-[var(--border)] text-[var(--text-2)] rounded-md text-[12px] font-semibold hover:border-[var(--border-strong)] hover:text-[var(--ink)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onDelete}
            disabled={writeGate.disabled}
            title={writeGate.title}
            className="px-4 py-1.5 bg-[var(--neg)] text-white rounded-md text-[12px] font-bold hover:bg-[var(--neg)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete &amp; replace
          </button>
        </div>
      </div>
    </div>
  )
}
