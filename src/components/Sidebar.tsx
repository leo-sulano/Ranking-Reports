import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { BRANDS, brandToSlug } from '../lib/brands'

const PAGES: Array<{ path: string; label: string; icon: ReactNode }> = [
  { path: '/', label: 'Home', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )},
  { path: '/bp-sites', label: 'BP Sites', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  )},
  { path: '/lp-sites', label: 'LP Sites', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="9" y1="21" x2="9" y2="9"/>
    </svg>
  )},
  { path: '/ftds', label: 'FTDs', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  )},
  { path: '/ask-ai', label: 'Ask AI', icon: (
    <Sparkles size={18} />
  )},
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
  const isLPSitesRoute = location.pathname.startsWith('/lp-sites')
  const hasBrandList   = isBPSitesRoute || isLPSitesRoute

  const isActivePath = (p: string) =>
    p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)

  const labelCls = 'whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150'

  return (
    <div className="w-[64px] shrink-0 h-screen relative z-30">
      <aside
        className="group absolute top-0 left-0 bottom-0 w-[64px] hover:w-[240px] flex flex-col overflow-hidden transition-[width] duration-200 ease-out"
        style={{
          background: '#13121F',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 0 0 0 transparent',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '8px 0 32px rgba(0,0,0,0.4)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 0 transparent' }}
      >
        {/* Logo */}
        <div
          className="px-3 pt-5 pb-4 shrink-0 flex items-center gap-3"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div
            className="w-9 h-9 flex items-center justify-center rounded-lg text-white font-display text-[13px] tracking-wider shrink-0"
            style={{ background: 'linear-gradient(135deg, #FF2D8D, #7B2FE8)' }}
          >
            RR
          </div>
          <div className={labelCls}>
            <div className="font-display text-[14px] tracking-widest text-white leading-none">
              RANKING REPORTS
            </div>
            <div className="text-[9px] text-white/35 uppercase tracking-[0.12em] mt-1">
              Rooster Partners
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav
          className="px-2 pt-3 pb-3 space-y-0.5 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          {PAGES.map((p) => {
            const active = isActivePath(p.path)
            return (
              <button
                key={p.path}
                onClick={() => navigate(p.path)}
                title={p.label}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-all relative"
                style={active ? {
                  background: 'linear-gradient(90deg, rgba(255,45,141,0.15), rgba(123,47,232,0.15))',
                  borderLeft: '2px solid #FF2D8D',
                  paddingLeft: '10px',
                } : {}}
                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = '' }}
              >
                <span className="w-[18px] flex items-center justify-center shrink-0" style={{ color: active ? '#FF2D8D' : 'rgba(255,255,255,0.35)' }}>
                  {p.icon}
                </span>
                <span className={`text-[12px] font-semibold ${labelCls}`} style={{ color: active ? 'white' : 'rgba(255,255,255,0.55)' }}>
                  {p.label}
                </span>
              </button>
            )
          })}
        </nav>

        {/* Brand sub-list */}
        {hasBrandList ? (
          <div className={`flex-1 flex flex-col min-h-0 ${labelCls}`}>
            <div className="flex items-center gap-2 px-5 pt-4 pb-2 shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30 whitespace-nowrap">
                {isBPSitesRoute ? 'BP Sites' : 'LP Sites'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
              {BRANDS.map((brand) => {
                const activeSlug = isBPSitesRoute
                  ? (location.pathname.startsWith('/bp-sites/') ? location.pathname.slice('/bp-sites/'.length).split('/')[0] : null)
                  : (location.pathname.startsWith('/lp-sites/') ? location.pathname.slice('/lp-sites/'.length).split('/')[0] : null)
                const isActive = activeSlug === brandToSlug(brand.name)
                return (
                  <button
                    key={brand.name}
                    onClick={() => {
                      navigate(isBPSitesRoute
                        ? `/bp-sites/${brandToSlug(brand.name)}`
                        : `/lp-sites/${brandToSlug(brand.name)}`)
                    }}
                    className="flex items-center w-full px-3 py-2 rounded-lg text-left transition-all"
                    style={isActive ? { background: 'rgba(255,255,255,0.08)' } : {}}
                    onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    <div className="text-[12px] font-semibold text-white/75 truncate whitespace-nowrap">
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
        <div className="p-2 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={onOpenUpload}
            title="Import Data"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white text-[12px] font-bold transition-all hover:opacity-90 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #FF2D8D 0%, #7B2FE8 100%)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className={labelCls}>Import Data</span>
          </button>
          {uploadDate && (
            <p className={`text-center text-[10px] text-white/25 font-mono mt-2 ${labelCls}`}>
              Updated: {uploadDate}
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}
