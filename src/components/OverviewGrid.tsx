import type { Brand, RankingRecord } from '../types'
import { COUNTRY_LABELS } from '../lib/brands'
import { parsePosition, parseChange } from '../lib/parser'

interface Props {
  brands: Brand[]
  records: RankingRecord[]   // from the active snapshot
  onSelectBrand: (name: string) => void
}

function brandStats(brand: Brand, records: RankingRecord[]) {
  const set = new Set(brand.domains.map((d) => d.toLowerCase()))
  const recs = records.filter((r) => set.has(r.domain.toLowerCase()))
  return {
    total:      recs.length,
    top3:       recs.filter((r) => { const p = parsePosition(r.position); return typeof p === 'number' && p <= 3 }).length,
    improved:   recs.filter((r) => (parseChange(r.change) ?? 0) > 0).length,
    notRanking: recs.filter((r) => parsePosition(r.position) === 'NR').length,
    countries:  [...new Set(recs.map((r) => r.country))],
    domains:    [...new Set(recs.map((r) => r.domain.toLowerCase()))],
  }
}

export function OverviewGrid({ brands, records, onSelectBrand }: Props) {
  if (records.length === 0) return null

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
      {brands.map((brand, idx) => {
        const stats = brandStats(brand, records)
        return (
          <div
            key={brand.name}
            onClick={() => onSelectBrand(brand.name)}
            className="bg-[#0D1421] border border-[#1C2B3A] rounded-[10px] p-5 cursor-pointer relative overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:border-[#243548] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
            style={{ animationDelay: `${idx * 40}ms`, animation: 'fadeUp 0.25s ease both' }}
          >
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[10px]" style={{ background: brand.color }} />

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-[10px] flex items-center justify-center font-display text-[15px] text-black shrink-0" style={{ background: brand.color }}>
                {brand.abbr}
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-bold text-[#E2E8F0]">{brand.name}</div>
                <div className="text-[11px] font-mono text-[#64748B]">{brand.mainDomain}</div>
              </div>
            </div>

            {stats.total === 0 ? (
              <p className="text-center py-6 text-[12px] text-[#64748B]">No data — upload to populate</p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-1.5 mb-3">
                  {[
                    { val: stats.total,      label: 'Records',  color: '#F59E0B' },
                    { val: stats.top3,       label: 'Top 3',    color: '#F59E0B' },
                    { val: stats.improved,   label: 'Improved', color: '#10B981' },
                    { val: stats.notRanking, label: 'Not Rank', color: '#64748B' },
                  ].map(({ val, label, color }) => (
                    <div key={label} className="bg-[#111928] rounded-md py-2 text-center">
                      <div className="font-display text-[22px] leading-none mb-0.5" style={{ color }}>{val}</div>
                      <div className="text-[9px] uppercase tracking-[0.08em] text-[#64748B]">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1 mb-2">
                  {stats.domains.slice(0, 5).map((d) => (
                    <span key={d} className="text-[10px] font-mono px-1.5 py-0.5 bg-[#07090F] border rounded-full"
                      style={{ borderColor: d === brand.mainDomain ? brand.color + '60' : '#1C2B3A', color: d === brand.mainDomain ? '#94A3B8' : '#64748B' }}>
                      {d}
                    </span>
                  ))}
                  {stats.domains.length > 5 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#07090F] border border-[#1C2B3A] rounded-full text-[#64748B]">+{stats.domains.length - 5}</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  {stats.countries.slice(0, 6).map((c) => (
                    <span key={c} className="text-[10px] font-mono px-1.5 py-0.5 bg-[#07090F] border border-[#1C2B3A] rounded-full text-[#64748B]">
                      {COUNTRY_LABELS[c] ?? c}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
