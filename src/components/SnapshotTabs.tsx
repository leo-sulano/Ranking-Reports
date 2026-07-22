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
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)] mr-2 shrink-0">
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
                ? 'bg-[var(--surface-3)] border-[var(--border-strong)] text-[var(--ink)]'
                : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-2)]'
            }`}
          >
            {snap.displayDate}
            {isLatest && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-1 py-0.5 rounded bg-[#CBD5E1] text-[var(--ink)]">
                LATEST
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
