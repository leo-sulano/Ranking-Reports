import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useOutletContext, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { Brand, RROutletContext, Snapshot, SnapshotMeta } from '../types'
import { BRANDS, BRAND_BY_NAME, BRAND_BY_SLUG, BRAND_LOGO_COLORS, BRAND_FAVICONS, COUNTRY_LABELS, brandToSlug } from '../lib/brands'
import { PosBadge } from '../components/PosBadge'
import { PinButton } from '../components/PinButton'
import { usePinnedGroups } from '../lib/usePinnedGroups'
import { StatsRow, CardFilterKey } from '../components/StatsRow'
import { computeStats, parsePosition, parseChange } from '../lib/parser'
import { ChevronDown, Check, CalendarDays } from 'lucide-react'

const COUNTRY_ORDER = ['AU', 'CA', 'DE', 'IT', 'NZ']

// LP block palette — recycle the Google-Sheets pastel tier used by BP so the
// two pages feel like siblings. Each LP domain claims one block.
const LP_PALETTE: Array<{ headerBg: string; cellBg: string }> = [
  { headerBg: '#B4A7D6', cellBg: '#D9D2E9' }, // light purple 2 / 3
  { headerBg: '#CCCCCC', cellBg: '#D9D9D9' }, // light grey 2 / 3
  { headerBg: '#FFD966', cellBg: '#FFECB2' }, // light yellow 2 / 3
  { headerBg: '#93C47D', cellBg: '#D9EAD3' }, // light green 2 / 3
  { headerBg: '#C27BA0', cellBg: '#EAD1DC' }, // light magenta 2 / 3
  { headerBg: '#76A5AF', cellBg: '#D0E0E3' }, // light cyan 2 / 3
  { headerBg: '#E69138', cellBg: '#F9CB9C' }, // light orange 2 / 3
  { headerBg: '#6FA8DC', cellBg: '#C9DAF8' }, // light cornflower 2 / 3
  { headerBg: '#A4C2F4', cellBg: '#D9E1F2' }, // light blue 2 / 3
]

const DATE_BAND_BG = 'var(--band-date)'
const DATE_BAND_FG = '#FFFFFF'
const HEADER_FG    = '#000000'
const TABLE_BORDER = '#B0B7BD'
const STICKY_KW_BG = '#FFFFFF'
// Fixed column width for pinned LP blocks — sticky offsets must be
// deterministic, matching the 90px min-width the country columns use.
const PIN_COL_W    = 90

// keyword → domain → country → record
type Lookup = Record<string, Record<string, Record<string, import('../types').RankingRecord>>>

// ─── Entry ────────────────────────────────────────────────────────────────────

export function LPSites() {
  const ctx = useOutletContext<RROutletContext>()
  const { snapshots } = ctx
  const { brandSlug, domainFilter } = useParams<{ brandSlug: string; domainFilter: string }>()
  const navigate = useNavigate()

  const lpSnapshots = useMemo(
    () => snapshots.filter((s) => s.category === 'lp-sites'),
    [snapshots],
  )
  const lpSnapshotMeta = useMemo(
    () => ctx.snapshotMeta.filter((m) => m.category === 'lp-sites'),
    [ctx.snapshotMeta],
  )
  const activeBrand = brandSlug ? (BRAND_BY_SLUG[brandSlug] ?? null) : null

  if (activeBrand) {
    return (
      <BrandView
        key={activeBrand.name}
        brand={activeBrand}
        snapshots={lpSnapshots}
        snapshotMeta={lpSnapshotMeta}
        onLoadOlder={() => ctx.onLoadOlderSnapshots('lp-sites')}
        loadingOlder={ctx.loadingOlderSnapshots}
        domainFilter={domainFilter}
        onBack={() => navigate('/lp-sites')}
      />
    )
  }

  return (
    <BrandGrid
      onSelect={(b) => navigate(`/lp-sites/${brandToSlug(b.name)}`)}
      onSelectDomain={(b, domain) => navigate(`/lp-sites/${brandToSlug(b.name)}/${domain}`)}
    />
  )
}

// ─── Brand Grid — cards list LP domains (no MAIN marker) ──────────────────────

function BrandGrid({
  onSelect,
  onSelectDomain,
}: {
  onSelect: (b: Brand) => void
  onSelectDomain: (b: Brand, domain: string) => void
}) {
  return (
    <div className="flex-1 overflow-auto px-3 sm:px-7 pb-7 pt-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {BRANDS.map((brand, idx) => {
          const c = BRAND_LOGO_COLORS[brand.name] ?? brand.color

          return (
            <button
              key={brand.name}
              onClick={() => onSelect(brand)}
              className="flex flex-col justify-start bg-[var(--surface)] border border-[var(--border)] rounded-[10px] p-5 text-left cursor-pointer relative overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
              style={{ animationDelay: `${idx * 40}ms`, animation: 'fadeUp 0.25s ease both' }}
            >
              <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[10px]" style={{ background: c }} />

              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-[10px] overflow-hidden shrink-0 border"
                  style={{ borderColor: c + '30' }}
                >
                  <img
                    src={BRAND_FAVICONS[brand.name]}
                    alt={`${brand.name} favicon`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-bold text-[var(--ink)]">{brand.name}</div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">
                    {brand.lpDomains.length} landing page{brand.lpDomains.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                {brand.lpDomains.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSelectDomain(brand, d) }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left w-full bg-[var(--surface-2)] transition-all duration-100 group/domain"
                    style={{ borderColor: 'var(--border)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = c + '90'
                      e.currentTarget.style.background = c + '0D'
                      e.currentTarget.style.boxShadow = `0 1px 6px ${c}25`
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.background = 'var(--surface-2)'
                      e.currentTarget.style.boxShadow = ''
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ color: 'var(--muted-2)', flexShrink: 0 }}>
                      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <span className="text-[11px] truncate text-[var(--muted)] flex-1">{d}</span>
                    <svg
                      width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round"
                      className="shrink-0 opacity-0 group-hover/domain:opacity-60 transition-opacity"
                      style={{ color: c }}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Brand Detail View — one matrix per snapshot, LP-only blocks ──────────────

function BrandView({
  brand,
  snapshots,
  snapshotMeta,
  onLoadOlder,
  loadingOlder,
  domainFilter,
  onBack,
}: {
  brand: Brand
  snapshots: Snapshot[]
  snapshotMeta: SnapshotMeta[]
  onLoadOlder: () => void
  loadingOlder: boolean
  domainFilter: string | undefined
  onBack: () => void
}) {
  // Older history not yet hydrated for this category (snapshotMeta covers
  // every date; snapshots only the currently-loaded window).
  const oldestLoadedDate = snapshots.length > 0
    ? snapshots.reduce((min, s) => (s.rawDate < min ? s.rawDate : min), snapshots[0].rawDate)
    : null
  const unloadedOlderCount = oldestLoadedDate === null
    ? 0
    : snapshotMeta.filter((m) => m.rawDate < oldestLoadedDate).length

  const lpDomains = brand.lpDomains
  const brandDomainSet = useMemo(
    () => new Set(lpDomains.map((d) => d.toLowerCase())),
    [lpDomains],
  )

  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Resolve domainFilter — only known LP domains are valid; everything else → All
  const resolvedFilter = useMemo(() => {
    if (!domainFilter) return undefined
    if (lpDomains.some((d) => d.toLowerCase() === domainFilter.toLowerCase())) return domainFilter
    return undefined
  }, [domainFilter, lpDomains])

  const visibleLpDomains = useMemo(() => {
    if (!resolvedFilter) return lpDomains
    const match = lpDomains.find((d) => d.toLowerCase() === resolvedFilter.toLowerCase())
    return match ? [match] : lpDomains
  }, [resolvedFilter, lpDomains])

  // Snapshots that actually have data for this brand
  const brandSnapshots = useMemo(
    () =>
      snapshots
        .map((snap) => ({
          ...snap,
          records: snap.records.filter((r) => brandDomainSet.has(r.domain.toLowerCase())),
        }))
        .filter((snap) => snap.records.length > 0),
    [snapshots, brandDomainSet],
  )

  const latestSnap = brandSnapshots[0] ?? null

  const [activeCountries, setActiveCountries] = useState<string[]>(() => {
    const param = searchParams.get('countries')
    if (param) {
      const parsed = param.split(',').map((c) => c.trim().toUpperCase()).filter((c) => COUNTRY_ORDER.includes(c))
      if (parsed.length > 0) return parsed
    }
    return COUNTRY_ORDER
  })
  const [kwFilter, setKwFilter] = useState(() => searchParams.get('kw') ?? '')
  const [cardFilter, setCardFilter] = useState<CardFilterKey | null>(null)
  const [showAllSnapshots, setShowAllSnapshots] = useState(false)

  // Pinned LP blocks — shared across every snapshot matrix on the page,
  // persisted per brand.
  const [pinnedDomains, togglePinnedDomain] = usePinnedGroups(`lp-${brand.name}`)

  const [statsFilter, setStatsFilter] = useState<string>(
    () => searchParams.get('date') ?? 'all',
  )

  const handleStatsFilterChange = (next: string) => {
    setStatsFilter(next)
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'all') p.delete('date')
        else p.set('date', next)
        return p
      },
      { replace: true },
    )
  }

  const monthKey = statsFilter.startsWith('month:') ? statsFilter.slice(6) : null
  const statsSnap = useMemo(() => {
    if (monthKey) return brandSnapshots.find((s) => snapMonthKey(s) === monthKey) ?? latestSnap
    if (statsFilter === 'all') return latestSnap
    return brandSnapshots.find((s) => s.id === statsFilter) ?? latestSnap
  }, [statsFilter, monthKey, brandSnapshots, latestSnap])

  const toggleCountry = (c: string) => {
    setActiveCountries((prev) => {
      if (prev.includes(c) && prev.length === 1) return prev
      const next = prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
      setSearchParams((sp) => {
        const p = new URLSearchParams(sp)
        if (next.length === COUNTRY_ORDER.length) p.delete('countries')
        else p.set('countries', next.join(','))
        return p
      }, { replace: true })
      return next
    })
  }

  // Stats for the selected stats-date snapshot. All LP records count toward
  // the totals (no MAIN exclusion for LP). Classification lives in
  // computeStats so counters stay in lockstep with PosBadge cell coloring.
  const stats = useMemo(
    () => computeStats(statsSnap?.records ?? []),
    [statsSnap],
  )

  const latestKeywordCount = useMemo(() => {
    if (!latestSnap) return 0
    const seen = new Set<string>()
    const labels: Record<string, string> = {}
    for (const r of latestSnap.records) {
      const kl = r.keyword.toLowerCase()
      if (!seen.has(kl)) { seen.add(kl); labels[kl] = r.keyword }
    }
    const filter = kwFilter.trim().toLowerCase()
    return Object.keys(labels).filter((kl) => !filter || kl.includes(filter) || labels[kl].toLowerCase().includes(filter)).length
  }, [latestSnap, kwFilter])

  const visibleCountries = COUNTRY_ORDER.filter((c) => activeCountries.includes(c))

  return (
    <>
      <div className="flex items-center gap-3 px-7 pt-5 pb-3 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--text-2)] transition-colors mr-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          All brands
        </button>

        <h1 className="font-display text-[20px] tracking-wider text-[var(--ink)] leading-none">{brand.name}</h1>

        {brandSnapshots.length > 0 && (
          <div className="ml-auto">
            <StatsDateFilter
              value={statsFilter}
              snapshots={brandSnapshots}
              onChange={handleStatsFilterChange}
              unloadedOlderCount={unloadedOlderCount}
              onLoadOlder={onLoadOlder}
              loadingOlder={loadingOlder}
            />
          </div>
        )}
      </div>

      {brandSnapshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center gap-4 px-7 pb-7">
          <p className="text-[14px] text-[var(--muted)] max-w-sm leading-relaxed">
            No landing-page ranking data for {brand.name} yet. Import an LP Sites export to populate this view.
          </p>
        </div>
      ) : (
        <>
          <StatsRow
            total={stats.total}
            top3={stats.top3}
            improved={stats.improved}
            dropped={stats.dropped}
            notRanking={stats.notRanking}
            unchanged={stats.unchanged}
            activeCard={cardFilter}
            onCardClick={setCardFilter}
          />

          {/* Filter bar — sites + countries + keyword search */}
          <div className="flex items-center gap-1.5 px-7 pt-[10px] pb-[5px] shrink-0 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)] mr-1">
              Landing pages
            </span>
            <LPSiteFilter
              resolvedFilter={resolvedFilter}
              lpDomains={lpDomains}
              onSelect={(val) => {
                const base = `/lp-sites/${brandToSlug(brand.name)}`
                navigate(val ? `${base}/${val}` : base)
              }}
            />

            <div className="w-px h-5 bg-[#E2E8F0] mx-1" />

            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)] mr-1">
              Countries
            </span>
            {COUNTRY_ORDER.map((c) => {
              const active = activeCountries.includes(c)
              return (
                <button
                  key={c}
                  onClick={() => toggleCountry(c)}
                  className="px-3 py-1 rounded-full text-[12px] font-sans border transition-all"
                  style={
                    active
                      ? { background: 'var(--border-strong)', color: 'var(--ink)', borderColor: 'transparent', fontWeight: 700 }
                      : { background: 'var(--surface)', color: 'var(--text-2)', borderColor: 'var(--border)' }
                  }
                >
                  {c}
                </button>
              )
            })}

            <div className="w-px h-5 bg-[#E2E8F0] mx-1" />

            <div className="relative">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-40"
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={kwFilter}
                onChange={(e) => {
                  const v = e.target.value
                  setKwFilter(v)
                  setSearchParams((prev) => {
                    const p = new URLSearchParams(prev)
                    if (!v) p.delete('kw')
                    else p.set('kw', v)
                    return p
                  }, { replace: true })
                }}
                placeholder="Search keywords…"
                className="pl-7 pr-3 py-1 bg-[var(--surface-3)] border border-[var(--border)] rounded-full text-[12px] text-[var(--ink)] outline-none w-44 placeholder:text-[var(--muted)] focus:border-[var(--border-strong)] transition-colors"
              />
            </div>

            <div className="ml-auto text-[11px] font-mono text-[var(--muted)]">
              {brandSnapshots.length} date{brandSnapshots.length !== 1 ? 's' : ''} · {latestKeywordCount} keyword{latestKeywordCount !== 1 ? 's' : ''} in latest · {lpDomains.length} landing page{lpDomains.length !== 1 ? 's' : ''}
            </div>
          </div>

          <div className="flex-1 overflow-auto px-3 sm:px-7 pb-7 flex flex-col gap-6">
            {(() => {
              const allSnaps = statsFilter === 'all'
                ? brandSnapshots
                : monthKey
                  ? brandSnapshots.filter((s) => snapMonthKey(s) === monthKey)
                  : brandSnapshots.filter((s) => s.id === statsFilter)
              const visibleSnaps = (statsFilter === 'all' && !showAllSnapshots)
                ? allSnaps.slice(0, 1)
                : allSnaps
              const hiddenCount = allSnaps.length - visibleSnaps.length
              return (
                <>
                  {visibleSnaps.map((snap) => (
                    <SnapshotMatrix
                      key={snap.id}
                      snapshot={snap}
                      lpDomains={visibleLpDomains}
                      allLpDomains={lpDomains}
                      visibleCountries={visibleCountries}
                      kwFilter={kwFilter}
                      cardFilter={cardFilter}
                      isLatest={snap.id === latestSnap?.id}
                      pinnedDomains={pinnedDomains}
                      onTogglePin={togglePinnedDomain}
                    />
                  ))}
                  {hiddenCount > 0 && (
                    <button
                      onClick={() => setShowAllSnapshots(true)}
                      className="self-start flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors"
                    >
                      <ChevronDown size={14} />
                      Show {hiddenCount} older snapshot{hiddenCount !== 1 ? 's' : ''}
                    </button>
                  )}
                  {hiddenCount === 0 && statsFilter === 'all' && unloadedOlderCount > 0 && (
                    <button
                      onClick={onLoadOlder}
                      disabled={loadingOlder}
                      className="self-start flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      <ChevronDown size={14} />
                      {loadingOlder ? 'Loading…' : 'Load older snapshots from history'}
                    </button>
                  )}
                </>
              )
            })()}
          </div>
        </>
      )}
    </>
  )
}

function snapMonthKey(snap: Snapshot): string {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const [y, m] = snap.rawDate.split('-')
  return MONTH_NAMES[parseInt(m, 10) - 1] + ' ' + (y ?? '')
}

// ─── StatsDateFilter ──────────────────────────────────────────────────────────

function StatsDateFilter({
  value,
  snapshots,
  onChange,
  unloadedOlderCount,
  onLoadOlder,
  loadingOlder,
}: {
  value: string
  snapshots: Snapshot[]
  onChange: (next: string) => void
  unloadedOlderCount: number
  onLoadOlder: () => void
  loadingOlder: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 0)
    } else {
      setQuery('')
    }
  }, [open])

  const selected = snapshots.find((s) => s.id === value)
  const label = value === 'all'
    ? `All${snapshots[0] ? ` · latest ${snapshots[0].displayDate}` : ''}`
    : (selected?.displayDate ?? 'Unknown date')

  const q = query.trim().toLowerCase()
  const filteredSnapshots = q
    ? snapshots.filter((s) => s.displayDate.toLowerCase().includes(q) || s.rawDate.toLowerCase().includes(q))
    : snapshots
  const showAllOption = !q || 'all (latest)'.includes(q) || 'latest'.includes(q)

  return (
    <div ref={ref} className="relative">
      <span className="absolute -top-4 left-0 text-[9px] uppercase tracking-[0.1em] font-semibold text-[var(--muted)]">
        Stats date
      </span>

      <div
        onClick={() => { if (!open) setOpen(true) }}
        className={`flex items-center gap-2 bg-[var(--surface)] border rounded-md pl-2.5 pr-2 py-1.5 text-[12px] text-[var(--ink)] transition-colors cursor-text ${
          open ? 'border-[var(--ink)]' : 'border-[var(--border-strong)] hover:border-[var(--ink)]'
        }`}
      >
        <CalendarDays size={13} strokeWidth={2.25} className="text-[var(--muted)] shrink-0" />
        {open ? (
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={label}
            aria-label="Search dates"
            className="bg-transparent outline-none flex-1 min-w-0 text-[12px] text-[var(--ink)] placeholder:text-[var(--muted-2)] font-medium"
          />
        ) : (
          <span className="font-medium flex-1 min-w-0 truncate">{label}</span>
        )}
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
          className="shrink-0 flex items-center justify-center"
        >
          <ChevronDown
            size={13}
            strokeWidth={2.25}
            className={`text-[var(--muted)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-[0_12px_32px_rgba(15,23,42,0.12)] overflow-hidden z-20 min-w-[220px] animate-[modalIn_0.12s_ease]"
        >
          <div className="max-h-[260px] overflow-y-auto">
            {showAllOption && (
              <DateOption
                label="All (latest)"
                selected={value === 'all'}
                onClick={() => { onChange('all'); setOpen(false) }}
              />
            )}
            {showAllOption && filteredSnapshots.length > 0 && (
              <div className="border-t border-[var(--border)]" />
            )}
            {filteredSnapshots.map((s) => (
              <DateOption
                key={s.id}
                label={s.displayDate}
                selected={value === s.id}
                onClick={() => { onChange(s.id); setOpen(false) }}
              />
            ))}
            {!showAllOption && filteredSnapshots.length === 0 && (
              <p className='px-3 py-3 text-[11px] text-[var(--muted-2)] text-center'>
                No dates match “{query}”.
              </p>
            )}
          </div>
          {!query && unloadedOlderCount > 0 && (
            <button
              type='button'
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className='w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-[var(--text-2)] border-t border-[var(--border)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50 disabled:cursor-wait'
            >
              <ChevronDown size={12} />
              {loadingOlder ? 'Loading…' : 'Load older history…'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function DateOption({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2 text-[12px] text-left transition-colors ${
        selected ? 'bg-[var(--btn-ink)] text-white' : 'text-[var(--ink)] hover:bg-[var(--surface-3)]'
      }`}
    >
      <span className="font-medium">{label}</span>
      {selected && <Check size={13} strokeWidth={2.5} />}
    </button>
  )
}

// ─── LPSiteFilter — custom dropdown for LP domain selection ──────────────────

function LPSiteFilter({
  resolvedFilter,
  lpDomains,
  onSelect,
}: {
  resolvedFilter: string | undefined
  lpDomains: string[]
  onSelect: (val: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = resolvedFilter ?? `All · ${lpDomains.length} sites`

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 bg-[var(--surface)] border rounded-md pl-2.5 pr-2 py-1.5 text-[12px] text-[var(--ink)] cursor-pointer transition-colors ${
          open ? 'border-[var(--ink)]' : 'border-[var(--border-strong)] hover:border-[var(--ink)]'
        }`}
      >
        <span className="font-medium flex-1 min-w-0 truncate">{label}</span>
        <ChevronDown
          size={13}
          strokeWidth={2.25}
          className={`text-[var(--muted)] shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-[0_12px_32px_rgba(15,23,42,0.12)] overflow-hidden z-20 min-w-[200px] animate-[modalIn_0.12s_ease]">
          <LPSiteOption
            label="All"
            selected={!resolvedFilter}
            onClick={() => { onSelect(''); setOpen(false) }}
          />
          <div className="border-t border-[var(--border)]" />
          {lpDomains.map((d) => (
            <LPSiteOption
              key={d}
              label={d}
              selected={resolvedFilter === d}
              onClick={() => { onSelect(d); setOpen(false) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LPSiteOption({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2 text-[12px] text-left transition-colors ${
        selected ? 'bg-[var(--btn-ink)] text-white' : 'text-[var(--ink)] hover:bg-[var(--surface-3)]'
      }`}
    >
      <span className="font-medium truncate">{label}</span>
      {selected && <Check size={13} strokeWidth={2.5} className="shrink-0 ml-2" />}
    </button>
  )
}

// ─── SnapshotMatrix — one date's LP matrix ───────────────────────────────────

function SnapshotMatrix({
  snapshot,
  lpDomains,
  allLpDomains,
  visibleCountries,
  kwFilter,
  cardFilter,
  isLatest,
  pinnedDomains,
  onTogglePin,
}: {
  snapshot: Snapshot
  lpDomains: string[]
  allLpDomains: string[]
  visibleCountries: string[]
  kwFilter: string
  cardFilter: CardFilterKey | null
  isLatest: boolean
  pinnedDomains: string[]
  onTogglePin: (domainKey: string) => void
}) {
  const scrollRef      = useRef<HTMLDivElement>(null)
  const keywordColRef  = useRef<HTMLTableCellElement>(null)
  // Measured keyword-column width — pinned LP blocks stick right after it.
  const [kwW, setKwW] = useState(120)

  const lpPaletteIndex = (lp: string) => {
    const idx = allLpDomains.findIndex((d) => d.toLowerCase() === lp.toLowerCase())
    return (idx >= 0 ? idx : 0) % LP_PALETTE.length
  }

  useEffect(() => {
    const kwEl = keywordColRef.current
    if (kwEl) setKwW(kwEl.offsetWidth)
  })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      const atLeft  = el.scrollLeft <= 0
      const atRight = el.scrollLeft >= el.scrollWidth - el.clientWidth
      if ((e.deltaY < 0 && atLeft) || (e.deltaY > 0 && atRight)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const borderStyle = `1px solid ${TABLE_BORDER}`
  const colsPerBlock = visibleCountries.length

  // ── LP blocks, pinned ones first — pinned blocks freeze beside the
  //    keyword column. ──
  const orderedLpDomains = useMemo(() => {
    const pinnedLower = pinnedDomains.map((d) => d.toLowerCase())
    const pinned = pinnedLower
      .map((d) => lpDomains.find((lp) => lp.toLowerCase() === d))
      .filter((lp): lp is string => lp != null)
    return [...pinned, ...lpDomains.filter((lp) => !pinnedLower.includes(lp.toLowerCase()))]
  }, [lpDomains, pinnedDomains])
  const pinnedCount = useMemo(() => {
    const pinnedLower = pinnedDomains.map((d) => d.toLowerCase())
    return orderedLpDomains.filter((lp) => pinnedLower.includes(lp.toLowerCase())).length
  }, [orderedLpDomains, pinnedDomains])

  const pinStyle = (blockPos: number, colIdx: number, z: number): CSSProperties =>
    blockPos < pinnedCount
      ? {
          position: 'sticky',
          left: kwW + (blockPos * colsPerBlock + colIdx) * PIN_COL_W,
          zIndex: z,
          width: PIN_COL_W, minWidth: PIN_COL_W, maxWidth: PIN_COL_W,
        }
      : {}
  const pinHeaderStyle = (blockPos: number): CSSProperties =>
    blockPos < pinnedCount
      ? {
          position: 'sticky',
          left: kwW + blockPos * colsPerBlock * PIN_COL_W,
          zIndex: 6,
          maxWidth: colsPerBlock * PIN_COL_W,
        }
      : {}

  const keywords = useMemo(() => {
    const seen = new Set<string>()
    const labels: Record<string, string> = {}
    for (const r of snapshot.records) {
      const kl = r.keyword.toLowerCase()
      if (!seen.has(kl)) { seen.add(kl); labels[kl] = r.keyword }
    }
    const filter = kwFilter.trim().toLowerCase()
    let keys = Object.keys(labels)
      .filter((kl) => !filter || kl.includes(filter) || labels[kl].toLowerCase().includes(filter))

    if (cardFilter) {
      const kwRecords = new Map<string, typeof snapshot.records>()
      for (const r of snapshot.records) {
        const kl = r.keyword.toLowerCase()
        const list = kwRecords.get(kl) ?? []
        list.push(r)
        kwRecords.set(kl, list)
      }
      keys = keys.filter((kl) => {
        const recs = kwRecords.get(kl) ?? []
        return recs.some((r) => {
          const p = parsePosition(r.position)
          const d = parseChange(r.change ?? '') ?? 0
          if (cardFilter === 'top3')       return typeof p === 'number' && p <= 3
          if (cardFilter === 'improved')   return d > 0
          if (cardFilter === 'dropped')    return d < 0
          if (cardFilter === 'unchanged')  return p !== 'NR' && d === 0
          if (cardFilter === 'notRanking') return p === 'NR'
          return true
        })
      })
    }

    return keys.sort().map((kl) => ({ key: kl, label: labels[kl] }))
  }, [snapshot, kwFilter, cardFilter])

  const lookup = useMemo(() => {
    const map: Lookup = {}
    for (const r of snapshot.records) {
      const kk = r.keyword.toLowerCase()
      const dk = r.domain.toLowerCase()
      const ck = COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()
      if (!map[kk]) map[kk] = {}
      if (!map[kk][dk]) map[kk][dk] = {}
      map[kk][dk][ck] = r
    }
    return map
  }, [snapshot])

  return (
    <div
      className="bg-[#FFFFFF] rounded-[6px] overflow-hidden text-black shrink-0 w-full"
      style={{ border: borderStyle }}
    >
      <div
        className="px-4 py-2 text-[13px] font-bold flex items-center gap-2"
        style={{ background: DATE_BAND_BG, color: DATE_BAND_FG }}
      >
        <span>{snapshot.displayDate}</span>
        {isLatest && (
          <span
            className="text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-[2px] rounded-[3px]"
            style={{ background: '#16A34A', color: 'white' }}
          >
            Latest
          </span>
        )}
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        <table className="border-collapse text-[11px] w-max min-w-full">

          {/* Row 1 — LP domain block label */}
          <thead>
            <tr>
              <th
                ref={keywordColRef}
                rowSpan={2}
                className="sticky left-0 z-10 text-left px-3 py-2 text-[11px] font-bold uppercase tracking-[0.1em] whitespace-nowrap w-px"
                style={{
                  background: STICKY_KW_BG,
                  color: '#000',
                  borderRight: borderStyle,
                  borderBottom: borderStyle,
                }}
              >
                Keyword
              </th>
              {orderedLpDomains.map((lp, li) => {
                const palette = LP_PALETTE[lpPaletteIndex(lp)]
                return (
                  <th
                    key={`lp-h-${lp}`}
                    colSpan={colsPerBlock}
                    className="px-3 py-2 text-center text-[11px] font-bold whitespace-nowrap"
                    style={{
                      background: palette.headerBg,
                      color: HEADER_FG,
                      borderRight: borderStyle,
                      borderBottom: borderStyle,
                      ...pinHeaderStyle(li),
                    }}
                  >
                    <span className="inline-flex items-center gap-1.5 max-w-full">
                      <span className="truncate">LP — {lp}</span>
                      <PinButton pinned={li < pinnedCount} onToggle={() => onTogglePin(lp.toLowerCase())} />
                    </span>
                  </th>
                )
              })}
            </tr>

            {/* Row 2 — country sub-header */}
            <tr>
              {orderedLpDomains.map((lp, li) => {
                const palette = LP_PALETTE[lpPaletteIndex(lp)]
                return (
                  <Fragment key={`lp-sub-${lp}`}>
                    {visibleCountries.map((c, ci) => (
                      <th
                        key={`lp-sub-${lp}-${c}`}
                        className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em] min-w-[90px]"
                        style={{
                          background: palette.headerBg,
                          color: HEADER_FG,
                          borderLeft: borderStyle,
                          borderRight: ci === visibleCountries.length - 1 ? borderStyle : undefined,
                          borderBottom: borderStyle,
                          ...pinStyle(li, ci, 6),
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </Fragment>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {keywords.map(({ key: kw, label }) => (
              <tr key={kw}>
                <td
                  className="sticky left-0 z-[5] px-3 py-2 font-semibold whitespace-nowrap"
                  style={{
                    background: STICKY_KW_BG,
                    color: '#000',
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                  }}
                >
                  {label}
                </td>

                {orderedLpDomains.map((lp, li) => {
                  const dk = lp.toLowerCase()
                  const palette = LP_PALETTE[lpPaletteIndex(lp)]
                  return visibleCountries.map((c, ci) => {
                    const rec = lookup?.[kw]?.[dk]?.[c]
                    return (
                      <td
                        key={`lp-cell-${kw}-${lp}-${c}`}
                        className="px-2 py-1.5 text-center align-middle min-w-[90px]"
                        style={{
                          background: palette.cellBg,
                          borderLeft: borderStyle,
                          borderRight: ci === visibleCountries.length - 1 ? borderStyle : undefined,
                          borderBottom: borderStyle,
                          ...pinStyle(li, ci, 4),
                        }}
                      >
                        {rec ? <PosBadge record={rec} /> : <span className="text-[#6B7280] text-[11px]">–</span>}
                      </td>
                    )
                  })
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
