import { useLocation } from 'react-router-dom'
import type { Brand, RankingRecord } from '../types'

interface Props {
  brands: Brand[]
  records: RankingRecord[]
  activeBrand: string | null
  uploadDate: string | null
  onSelectBrand: (name: string) => void
  onSelectOverview: () => void
  onOpenUpload: () => void
  activeBPBrand: string | null
  onSelectBPBrand: (name: string | null) => void
}

function countBrandRecords(brand: Brand, records: RankingRecord[]): number {
  const set = new Set(brand.domains.map((d) => d.toLowerCase()))
  return records.filter((r) => set.has(r.domain.toLowerCase())).length
}

export function Sidebar({
  brands,
  records,
  activeBrand,
  uploadDate,
  onSelectBrand,
  onSelectOverview,
  onOpenUpload,
  activeBPBrand,
  onSelectBPBrand,
}: Props) {
  const location = useLocation()
  const isRankingRoute = location.pathname.startsWith('/ranking-reports')
  const isBPSitesRoute = location.pathname.startsWith('/bp-sites')

  return (
    <aside className="flex flex-col w-[220px] min-w-[220px] h-screen bg-[#0D1421] border-r border-[#1C2B3A] overflow-hidden relative z-10">

      {/* Logo */}
      <div className="px-5 pt-5 pb-4 border-b border-[#1C2B3A] shrink-0">
        <div className="font-display text-[18px] tracking-widest text-[#F59E0B] leading-none">
          BP SITES NAV
        </div>
        <div className="text-[10px] text-[#64748B] uppercase tracking-[0.12em] mt-1">
          Rooster Partners
        </div>
      </div>

      {isBPSitesRoute && (
        <>
          <div className="flex items-center gap-2 px-5 pt-4 pb-2 shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
              BP Sites
            </span>
          </div>

          <button
            onClick={() => onSelectBPBrand(null)}
            className={`flex items-center gap-2.5 mx-2.5 mb-0.5 px-2.5 py-2 rounded-md text-left transition-colors relative ${
              activeBPBrand === null
                ? 'bg-[#111928] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-sm before:bg-[#F59E0B]'
                : 'hover:bg-[#151F30]'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-[#1C2B3A] flex items-center justify-center text-[#F59E0B] text-sm shrink-0">
              ⊞
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-[#E2E8F0]">All Brands</div>
              <div className="text-[10px] text-[#64748B] font-mono">{brands.length} brands</div>
            </div>
          </button>

          <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
            {brands.map((brand) => {
              const isActive = activeBPBrand === brand.name
              return (
                <button
                  key={brand.name}
                  onClick={() => onSelectBPBrand(brand.name)}
                  className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors relative ${
                    isActive ? 'bg-[#111928]' : 'hover:bg-[#151F30]'
                  }`}
                >
                  {isActive && (
                    <span
                      className="absolute left-0 top-1 bottom-1 w-0.5 rounded-sm"
                      style={{ background: brand.color }}
                    />
                  )}
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center font-display text-[11px] text-black shrink-0"
                    style={{ background: brand.color, opacity: isActive ? 1 : 0.85 }}
                  >
                    {brand.abbr}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-[#E2E8F0] truncate">{brand.name}</div>
                    <div className="text-[10px] text-[#64748B] font-mono truncate">{brand.mainDomain}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* ── Ranking Reports brand list ──────────────────────────── */}
      {isRankingRoute && (
        <>
          <div className="flex items-center gap-2 px-5 pt-4 pb-2 shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
              Ranking Reports
            </span>
          </div>

          <button
            onClick={onSelectOverview}
            className={`flex items-center gap-2.5 mx-2.5 mb-0.5 px-2.5 py-2 rounded-md text-left transition-colors relative ${
              activeBrand === null
                ? 'bg-[#111928] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-sm before:bg-[#F59E0B]'
                : 'hover:bg-[#151F30]'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-[#1C2B3A] flex items-center justify-center text-[#F59E0B] text-sm shrink-0">
              ⊞
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-[#E2E8F0]">Overview</div>
              <div className="text-[10px] text-[#64748B] font-mono">All brands</div>
            </div>
          </button>

          <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
            {brands.map((brand) => {
              const isActive = activeBrand === brand.name
              const count = countBrandRecords(brand, records)
              return (
                <button
                  key={brand.name}
                  onClick={() => onSelectBrand(brand.name)}
                  className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors relative ${
                    isActive ? 'bg-[#111928]' : 'hover:bg-[#151F30]'
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-sm" style={{ background: brand.color }} />
                  )}
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center font-display text-[11px] text-black shrink-0"
                    style={{ background: brand.color, opacity: isActive ? 1 : 0.85 }}
                  >
                    {brand.abbr}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-[#E2E8F0] truncate">{brand.name}</div>
                    <div className="text-[10px] text-[#64748B] font-mono truncate">{brand.mainDomain}</div>
                  </div>
                  {count > 0 && (
                    <span className="text-[10px] font-mono text-[#64748B] bg-[#07090F] border border-[#1C2B3A] px-1.5 py-0.5 rounded-full shrink-0">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Spacer for non-ranking routes */}
      {!isRankingRoute && !isBPSitesRoute && <div className="flex-1" />}

      {/* Footer */}
      <div className="p-3 border-t border-[#1C2B3A] shrink-0">
        <button
          onClick={onOpenUpload}
          className="w-full flex items-center justify-center gap-2 px-3.5 py-2 bg-[#F59E0B] text-black rounded-md text-[13px] font-bold transition-colors hover:bg-[#FBB03B] active:scale-95"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import Data
        </button>
        {uploadDate && (
          <p className="text-center text-[10px] text-[#64748B] font-mono mt-2">
            Updated: {uploadDate}
          </p>
        )}
      </div>
    </aside>
  )
}
