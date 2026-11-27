import type { GscView } from '../lib/gscView'

const TABS: { view: GscView; label: string }[] = [
  { view: 'rankings', label: 'Rankings (Ahrefs)' },
  { view: 'google', label: 'Real keywords (Google)' },
]

/** The two views of a BP Sites brand page. Switching is the parent's job (it edits ?view=). */
export function BrandTabs({ view, onChange }: { view: GscView; onChange: (v: GscView) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 pt-3 sm:px-7">
      {TABS.map((t) => {
        const active = t.view === view
        return (
          <button
            key={t.view}
            role="tab"
            aria-selected={active}
            onClick={() => !active && onChange(t.view)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors ${
              active
                ? 'border-[var(--ink)] text-[var(--ink)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
