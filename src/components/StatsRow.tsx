interface StatCardProps {
  label: string
  value: number | string
  accent: string
  sub: string
}

function StatCard({ label, value, accent, sub }: StatCardProps) {
  return (
    <div
      className="bg-white border border-[#E2E8F0] rounded-[10px] px-4 py-3.5 flex flex-col gap-1 relative overflow-hidden shadow-sm"
    >
      <div
        className="absolute top-0 left-0 right-0 h-[2px] rounded-t-[10px]"
        style={{ background: accent }}
      />
      <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B]">
        {label}
      </div>
      <div className="font-display text-[32px] leading-none" style={{ color: accent }}>
        {value === 0 || value === '—' ? (typeof value === 'number' ? '0' : value) : value}
      </div>
      <div className="text-[10px] text-[#64748B]">{sub}</div>
    </div>
  )
}

interface Props {
  total: number
  top3: number
  improved: number
  dropped: number
  notRanking: number
}

export function StatsRow({ total, top3, improved, dropped, notRanking }: Props) {
  return (
    <div className="grid grid-cols-5 gap-3 px-7 py-4 shrink-0">
      <StatCard label="Total Records" value={total || '—'} accent="#F59E0B" sub="tracked" />
      <StatCard label="Top 3"         value={top3}         accent="#F59E0B" sub="positions" />
      <StatCard label="Improved"      value={improved}     accent="#10B981" sub="moved up" />
      <StatCard label="Dropped"       value={dropped}      accent="#F43F5E" sub="moved down" />
      <StatCard label="Not Ranking"   value={notRanking}   accent="#64748B" sub="records" />
    </div>
  )
}
