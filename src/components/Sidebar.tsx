import { useLocation, useNavigate } from 'react-router-dom'
import { BRANDS } from '../lib/brands'

const PAGES: Array<{ path: string; label: string; icon: string }> = [
  { path: '/',                label: 'Home',     icon: '⌂' },
  { path: '/bp-sites',        label: 'BP Sites', icon: '◫' },
  { path: '/lp-sites',        label: 'LP Sites', icon: '◨' },
  { path: '/ftds',            label: 'FTDs',     icon: '◇' },
]

interface Props {
  uploadDate: string | null
  onOpenUpload: () => void
  activeBPBrand: string | null
  onSelectBPBrand: (name: string | null) => void
  activeLPBrand: string | null
  onSelectLPBrand: (name: string | null) => void
}

// ─── Layout ───────────────────────────────────────────────────────────────────
// Outer wrapper reserves a fixed 64px slot in the flex row so the page content
// never shifts. The inner <aside> is absolutely positioned within that slot
// and grows from 64 → 240px on hover, overlaying the content area like
// Supabase's rail. Labels, the brand sub-list, and the footer date fade in
// via group-hover so the collapsed state stays icon-only.

export function Sidebar({
  uploadDate,
  onOpenUpload,
  activeBPBrand,
  onSelectBPBrand,
  activeLPBrand,
  onSelectLPBrand,
}: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const isBPSitesRoute = location.pathname.startsWith('/bp-sites')
  const isLPSitesRoute = location.pathname.startsWith('/lp-sites')
  const hasBrandList   = isBPSitesRoute || isLPSitesRoute

  const isActivePath = (p: string) =>
    p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)

  // Reveal labels / brand list only when the rail is expanded.
  const labelCls = 'whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150'

  return (
    <div className="w-[64px] shrink-0 h-screen relative z-30">
      <aside
        className="group absolute top-0 left-0 bottom-0 w-[64px] hover:w-[240px] flex flex-col bg-white border-r border-[#E2E8F0] overflow-hidden transition-[width] duration-200 ease-out hover:shadow-[8px_0_24px_rgba(15,23,42,0.08)]"
      >
        {/* Logo — small monogram always; full lockup fades in when expanded */}
        <div className="px-3 pt-5 pb-4 border-b border-[#E2E8F0] shrink-0 flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center rounded-md bg-[#0F172A] text-white font-display text-[13px] tracking-wider shrink-0">
            RR
          </div>
          <div className={labelCls}>
            <div className="font-display text-[14px] tracking-widest text-[#0F172A] leading-none">
              RANKING REPORTS
            </div>
            <div className="text-[9px] text-[#64748B] uppercase tracking-[0.12em] mt-1">
              Rooster Partners
            </div>
          </div>
        </div>

        {/* Global page nav */}
        <nav className="px-2 pt-3 pb-3 border-b border-[#E2E8F0] space-y-0.5 shrink-0">
          {PAGES.map((p) => {
            const active = isActivePath(p.path)
            return (
              <button
                key={p.path}
                onClick={() => navigate(p.path)}
                title={p.label}
                className={`flex items-center gap-3 w-full px-3 py-2 rounded-md text-left transition-colors relative ${
                  active
                    ? 'bg-[#F1F5F9] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-sm before:bg-[#0F172A]'
                    : 'hover:bg-[#F8FAFC]'
                }`}
              >
                <span
                  className={`w-5 text-center text-[14px] shrink-0 ${active ? 'text-[#0F172A]' : 'text-[#94A3B8]'}`}
                >
                  {p.icon}
                </span>
                <span className={`text-[12px] font-semibold ${labelCls} ${active ? 'text-[#0F172A]' : 'text-[#475569]'}`}>
                  {p.label}
                </span>
              </button>
            )
          })}
        </nav>

        {/* Brand sub-list — fades in when expanded on a BP/LP route. */}
        {hasBrandList ? (
          <div className={`flex-1 flex flex-col min-h-0 ${labelCls}`}>
            <div className="flex items-center gap-2 px-5 pt-4 pb-2 shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#64748B] whitespace-nowrap">
                {isBPSitesRoute ? 'BP Sites' : 'LP Sites'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
              {BRANDS.map((brand) => {
                const activeBrand = isBPSitesRoute ? activeBPBrand : activeLPBrand
                const isActive    = activeBrand === brand.name
                const handler     = isBPSitesRoute ? onSelectBPBrand : onSelectLPBrand
                return (
                  <button
                    key={brand.name}
                    onClick={() => handler(brand.name)}
                    className={`flex items-center w-full px-3 py-2 rounded-md text-left transition-colors ${
                      isActive ? 'bg-[#F1F5F9]' : 'hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="text-[12px] font-semibold text-[#0F172A] truncate whitespace-nowrap">
                      {brand.name}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Footer */}
        <div className="p-2 border-t border-[#E2E8F0] shrink-0">
          <button
            onClick={onOpenUpload}
            title="Import Data"
            className="w-full flex items-center gap-3 px-3 py-2 bg-[#0F172A] text-white rounded-md text-[12px] font-bold transition-colors hover:bg-[#1E293B] active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className={labelCls}>Import Data</span>
          </button>
          {uploadDate && (
            <p className={`text-center text-[10px] text-[#64748B] font-mono mt-2 ${labelCls}`}>
              Updated: {uploadDate}
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}
