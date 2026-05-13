import type { Snapshot } from '../types'

interface Props {
  snapshots: Snapshot[]
  activeId: string | null  // null = latest
  onSelect: (id: string) => void
}

export function SnapshotTabs({ snapshots, activeId, onSelect }: Props) {
  if (snapshots.length === 0) return null

  // Latest is first in the array
  const effectiveId = activeId ?? snapshots[0]?.id

  return (
    <div className="flex items-center gap-1 px-7 pb-3 shrink-0 overflow-x-auto">
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] mr-2 shrink-0">
        Snapshot
      </span>

      {snapshots.map((snap, idx) => {
        const isActive = snap.id === effectiveId
        const isLatest = idx === 0
        return (
          <button
            key={snap.id}
            onClick={() => onSelect(snap.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-mono border transition-all shrink-0 ${
              isActive
                ? 'bg-[#F1F5F9] border-[#CBD5E1] text-[#0F172A]'
                : 'bg-white border-[#E2E8F0] text-[#64748B] hover:border-[#CBD5E1] hover:text-[#475569]'
            }`}
          >
            {snap.displayDate}
            {isLatest && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-1 py-0.5 rounded bg-[#F59E0B] text-black">
                LATEST
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
