import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AiIcon } from './Assistant/AiIcon'
import { ChevronsLeft, ChevronsRight, CircleHelp, DollarSign, History, Users } from 'lucide-react'
import { BRANDS, brandToSlug } from '../lib/brands'
import type { WriteGate } from '../types'

const PAGES: Array<{ path: string; label: string; icon: ReactNode; activePath?: string }> = [
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
  { path: '/ftds', label: 'Reg & FTD Metrics', icon: (
    <DollarSign size={18} />
  )},
  { path: '/ask-ai', label: 'Ask AI', icon: (
    <AiIcon size={18} />
  )},
  { path: '/how-it-works', label: 'How It Works', icon: (
    <CircleHelp size={18} />
  )},
  { path: '/log', label: 'Activity Log', icon: (
    <History size={18} />
  )},
]

const ADMIN_PAGE: { path: string; label: string; icon: ReactNode; activePath?: string } =
  { path: '/admin/users', label: 'Users', icon: <Users size={18} /> }

interface Props {
  uploadDate: string | null
  onOpenUpload: () => void
  activeBPBrand: string | null
  onSelectBPBrand: (name: string | null) => void
  mobileOpen?: boolean
  onMobileClose?: () => void
  isAdmin: boolean
  writeGate: WriteGate
  expanded: boolean
  onToggleExpanded: () => void
}

export function Sidebar({
  uploadDate,
  onOpenUpload,
  activeBPBrand,
  onSelectBPBrand,
  mobileOpen = false,
  onMobileClose,
  isAdmin,
  writeGate,
  expanded,
  onToggleExpanded,
}: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const isBPSitesRoute = location.pathname.startsWith('/bp-sites')
  const isLPSitesRoute = location.pathname.startsWith('/lp-sites')
  const hasBrandList   = isBPSitesRoute || isLPSitesRoute
  const pages = isAdmin ? [...PAGES, ADMIN_PAGE] : PAGES

  const isActivePath = (p: string) =>
    p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)

  // Close drawer on route change
  useEffect(() => { onMobileClose?.() }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  function SidebarInner({ isMobile }: { isMobile: boolean }) {
    const labelCls = isMobile || expanded
      ? 'whitespace-nowrap transition-opacity duration-150'
      : 'whitespace-nowrap opacity-0 transition-opacity duration-150'

    return (
      <aside
        className={
          isMobile
            ? 'flex flex-col bg-[var(--surface)] h-full w-[240px] border-r border-[var(--border-2)] overflow-hidden'
            : 'flex flex-col bg-[var(--surface)] h-full w-full border-r border-[var(--border-2)] overflow-hidden'
        }
      >
        {/* Logo */}
        <div className="px-3 pt-5 pb-4 border-b border-[var(--border-3)] shrink-0 flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#1e2a6e] text-white font-display text-[13px] tracking-wider shrink-0">
            RR
          </div>
          <div className={labelCls}>
            <div className="font-display text-[14px] tracking-widest text-[var(--navy-text)] leading-none">
              RANKING REPORTS
            </div>
            <div className="text-[9px] text-[var(--muted-3)] uppercase tracking-[0.12em] mt-1">
              Rooster Partners
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="px-2 pt-3 pb-3 border-b border-[var(--border-3)] space-y-0.5 shrink-0">
          {pages.map((p) => {
            const active = isActivePath(p.activePath ?? p.path)
            return (
              <button
                key={p.path}
                onClick={() => navigate(p.path)}
                title={p.label}
                className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors relative ${
                  active ? 'bg-[var(--active-tint)]' : 'hover:bg-[var(--hover)]'
                }`}
                style={active ? { borderLeft: '2px solid #1c9fe0', paddingLeft: '10px' } : {}}
              >
                <span
                  className="w-[18px] flex items-center justify-center shrink-0"
                  style={{ color: active ? '#1c9fe0' : 'var(--muted-3)' }}
                >
                  {p.icon}
                </span>
                <span
                  className={`text-[12px] font-semibold text-glow ${labelCls} ${active ? 'text-[var(--navy-text)]' : 'text-[var(--text-2)]'}`}
                >
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-3)] whitespace-nowrap">
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
                    className={`flex items-center w-full px-3 py-2 rounded-lg text-left transition-colors ${
                      isActive ? 'bg-[var(--hover)]' : 'hover:bg-[var(--hover)]'
                    }`}
                  >
                    <div className="text-[12px] font-semibold text-glow text-[var(--navy-text)] truncate whitespace-nowrap">
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
        <div className="p-2 border-t border-[var(--border-3)] shrink-0">
          <button
            onClick={onOpenUpload}
            title={writeGate.title ?? 'Import Data'}
            disabled={writeGate.disabled}
            className="w-full flex items-center gap-3 px-3 py-2 bg-[#1e2a6e] text-white rounded-lg text-[12px] font-bold transition-all hover:bg-[#136a99] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-glow-light"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className={labelCls}>Import Data</span>
          </button>
          {uploadDate && (
            <p className={`text-center text-[10px] text-[var(--muted-3)] font-mono mt-2 ${labelCls}`}>
              Updated: {uploadDate}
            </p>
          )}
        </div>
      </aside>
    )
  }

  return (
    <>
      {/* Desktop — width drives the flex layout so content shifts with it */}
      <div
        className={`hidden sm:block shrink-0 h-screen relative z-30 transition-[width] duration-200 ease-out ${
          expanded ? 'w-[240px]' : 'w-[64px]'
        }`}
      >
        <SidebarInner isMobile={false} />
        <button
          onClick={onToggleExpanded}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className="absolute -right-3 top-7 w-6 h-6 flex items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--border-2)] text-[var(--text-2)] shadow-sm hover:text-[var(--navy-text)] hover:border-[#1c9fe0] transition-colors"
        >
          {expanded ? <ChevronsLeft size={13} /> : <ChevronsRight size={13} />}
        </button>
      </div>

      {/* Mobile drawer + backdrop */}
      <div
        className={`sm:hidden fixed inset-0 bg-black/40 z-[39] transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onMobileClose}
      />
      <div
        className={`sm:hidden fixed top-0 left-0 bottom-0 z-40 shadow-[8px_0_32px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarInner isMobile={true} />
      </div>
    </>
  )
}
