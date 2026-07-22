export type CardFilterKey = 'top3' | 'improved' | 'dropped' | 'unchanged' | 'notRanking'

interface StatCardProps {
  label: string
  value: number | string
  accent: string
  sub: string
  active: boolean
  onClick: () => void
}

function StatCard({ label, value, accent, sub, active, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className="rounded-[10px] px-3 sm:px-4 py-2.5 flex flex-col gap-1 relative overflow-hidden cursor-pointer transition-all select-none"
      style={{
        // color-mix instead of hex+alpha so accent can be a CSS variable
        background: active ? `color-mix(in srgb, ${accent} 7%, transparent)` : 'var(--surface)',
        border: active ? `2px solid ${accent}` : '1px solid var(--border)',
        boxShadow: active
          ? `0 0 0 3px color-mix(in srgb, ${accent} 14%, transparent), 0 2px 8px rgba(0,0,0,0.08)`
          : '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[2px] rounded-t-[10px]"
        style={{ background: accent }}
      />
      <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.1em] font-semibold text-[var(--muted)] truncate">
        {label}
      </div>
      <div className="font-display text-[22px] sm:text-[32px] leading-none" style={{ color: accent }}>
        {value === 0 || value === '—' ? (typeof value === 'number' ? '0' : value) : value}
      </div>
      <div className="text-[9px] sm:text-[10px] text-[var(--muted)] truncate">
        {active ? <span style={{ color: accent }}>● filtering</span> : sub}
      </div>
    </div>
  )
}

interface Props {
  total: number
  top3: number
  improved: number
  dropped: number
  notRanking: number
  unchanged: number
  activeCard: CardFilterKey | null
  onCardClick: (key: CardFilterKey | null) => void
}

export function StatsRow({ top3, improved, dropped, notRanking, unchanged, activeCard, onCardClick }: Props) {
  const toggle = (key: CardFilterKey) => onCardClick(activeCard === key ? null : key)
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-[5px] px-3 sm:px-7 shrink-0">
      <StatCard label="Top 3"       value={top3}       accent="var(--ink)" sub="positions"  active={activeCard === 'top3'}       onClick={() => toggle('top3')} />
      <StatCard label="Improved"    value={improved}   accent="#10B981" sub="moved up"   active={activeCard === 'improved'}   onClick={() => toggle('improved')} />
      <StatCard label="Dropped"     value={dropped}    accent="#F43F5E" sub="moved down" active={activeCard === 'dropped'}    onClick={() => toggle('dropped')} />
      <StatCard label="Unchanged"   value={unchanged}  accent="#94A3B8" sub="flat"       active={activeCard === 'unchanged'}  onClick={() => toggle('unchanged')} />
      <StatCard label="Not Ranking" value={notRanking} accent="#64748B" sub="records"    active={activeCard === 'notRanking'} onClick={() => toggle('notRanking')} />
    </div>
  )
}
