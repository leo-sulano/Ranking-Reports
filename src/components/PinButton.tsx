import { Pin } from 'lucide-react'

// Small pin toggle used inside table column-group headers. Tilted outline
// when unpinned, upright + filled when pinned — same affordance as the
// pin controls in common spreadsheet/table UIs.
export function PinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      title={pinned ? 'Unpin — column scrolls normally' : 'Pin — freeze this column group'}
      className={`inline-flex items-center justify-center rounded p-0.5 align-middle transition-opacity ${
        pinned ? 'opacity-100' : 'opacity-40 hover:opacity-90'
      }`}
    >
      <Pin
        size={11}
        strokeWidth={2.5}
        fill={pinned ? 'currentColor' : 'none'}
        className={`transition-transform ${pinned ? '' : 'rotate-45'}`}
      />
    </button>
  )
}
