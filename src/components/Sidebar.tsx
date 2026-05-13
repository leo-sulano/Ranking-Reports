import { useLocation, useNavigate } from 'react-router-dom'
import { BRANDS } from '../lib/brands'

const PAGES: Array<{ path: string; label: string; icon: string }> = [
  { path: '/',                label: 'Home',     icon: '⌂' },
  { path: '/bp-sites',        label: 'BP Sites', icon: '◫' },
  { path: '/screenshots',     label: 'Screens',  icon: '▢' },
  { path: '/gmb',             label: 'GMB',      icon: '◉' },
  { path: '/ftds',            label: 'FTDs',     icon: '◇' },
]

interface Props {
  uploadDate: string | null
  onOpenUpload: () => void
  activeBPBrand: string | null
  onSelectBPBrand: (name: string | null) => void
}

export function Sidebar({
  uploadDate,
  onOpenUpload,
  activeBPBrand,
  onSelectBPBrand,
}: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const isBPSitesRoute = location.pathname.startsWith('/bp-sites')

  const isActivePath = (p: string) =>
    p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)

  return (
    <aside className="flex flex-col w-[220px] min-w-[220px] h-screen bg-[#0D1421] border-r border-[#1C2B3A] overflow-hidden relative z-10">

      {/* Logo */}
      <div className="px-5 pt-5 pb-4 border-b border-[#1C2B3A] shrink-0">
        <div className="font-display text-[18px] tracking-widest text-[#F59E0B] leading-none">
          RANKING REPORTS
        </div>
        <div className="text-[10px] text-[#64748B] uppercase tracking-[0.12em] mt-1">
          Rooster Partners
        </div>
      </div>

      {/* Global page nav — always visible */}
      <nav className="px-2.5 pt-3 pb-3 border-b border-[#1C2B3A] space-y-0.5 shrink-0">
        {PAGES.map((p) => {
          const active = isActivePath(p.path)
          return (
            <button
              key={p.path}
              onClick={() => navigate(p.path)}
              className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-left transition-colors relative ${
                active
                  ? 'bg-[#111928] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-sm before:bg-[#F59E0B]'
                  : 'hover:bg-[#151F30]'
              }`}
            >
              <span
                className={`w-5 text-center text-[12px] ${active ? 'text-[#F59E0B]' : 'text-[#475569]'}`}
              >
                {p.icon}
              </span>
              <span className={`text-[12px] font-semibold ${active ? 'text-[#E2E8F0]' : 'text-[#94A3B8]'}`}>
                {p.label}
              </span>
            </button>
          )
        })}
      </nav>

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

          <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
            {BRANDS.map((brand) => {
              const isActive = activeBPBrand === brand.name
              return (
                <button
                  key={brand.name}
                  onClick={() => onSelectBPBrand(brand.name)}
                  className={`flex items-center w-full px-3 py-2 rounded-md text-left transition-colors ${
                    isActive ? 'bg-[#111928]' : 'hover:bg-[#151F30]'
                  }`}
                >
                  <div className="text-[12px] font-semibold text-[#E2E8F0] truncate">{brand.name}</div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Spacer for non-BP routes */}
      {!isBPSitesRoute && <div className="flex-1" />}

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
