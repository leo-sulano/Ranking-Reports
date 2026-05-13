import type { Snapshot } from '../types'

export interface DuplicateWarningData {
  existing: Snapshot
}

interface Props {
  data: DuplicateWarningData
  onClose: () => void
  onDelete: () => void
}

export function DuplicateWarning({ data, onClose, onDelete }: Props) {
  const { existing } = data

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-md z-[60] flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white border border-[rgba(244,63,94,0.4)] rounded-[14px] w-[440px] max-w-[95vw] overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.6)] animate-[modalIn_0.2s_ease]">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-[#E2E8F0]">
          <div className="w-9 h-9 rounded-full bg-[rgba(244,63,94,0.15)] border border-[rgba(244,63,94,0.4)] flex items-center justify-center text-[#F43F5E] text-[18px] font-bold">
            !
          </div>
          <div>
            <h2 className="font-display text-[16px] tracking-wider text-[#0F172A] leading-tight">
              File already imported
            </h2>
            <p className="text-[11px] text-[#64748B] mt-0.5">
              A snapshot for this date already exists
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3">
          <p className="text-[13px] text-[#475569] leading-relaxed">
            The file you uploaded has a <code className="font-mono text-[#0F172A] bg-[#F8FAFC] px-1.5 py-0.5 rounded border border-[#E2E8F0]">Last Check</code> date that matches an existing snapshot. Duplicate uploads are not allowed.
          </p>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-md p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B]">Existing snapshot</span>
              <span className="text-[11px] font-mono text-[#F59E0B]">{existing.displayDate}</span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span className="text-[#64748B]">Records stored</span>
              <span className="font-mono text-[#0F172A]">{existing.records.length}</span>
            </div>
            <div className="flex justify-between text-[12px] mt-1">
              <span className="text-[#64748B]">Snapshot ID</span>
              <span className="font-mono text-[#64748B]">{existing.id}</span>
            </div>
          </div>

          <p className="text-[12px] text-[#64748B] leading-relaxed">
            To re-import, delete the existing snapshot first — or click <span className="text-[#F43F5E] font-semibold">Delete &amp; replace</span> below.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#E2E8F0] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-transparent border border-[#E2E8F0] text-[#475569] rounded-md text-[12px] font-semibold hover:border-[#CBD5E1] hover:text-[#0F172A] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onDelete}
            className="px-4 py-1.5 bg-[#F43F5E] text-white rounded-md text-[12px] font-bold hover:bg-[#E11D48] transition-colors"
          >
            Delete &amp; replace
          </button>
        </div>
      </div>
    </div>
  )
}
