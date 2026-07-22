import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useOutletContext, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { Brand, EditCellMatcher, EditCellPatch, RankingRecord, RROutletContext, Snapshot, SnapshotMeta } from '../types'
import { BRANDS, BRAND_BY_NAME, BRAND_BY_SLUG, BRAND_LOGO_COLORS, BRAND_FAVICONS, COUNTRY_LABELS, brandToSlug } from '../lib/brands'
import { PosBadge } from '../components/PosBadge'
import { PinButton } from '../components/PinButton'
import { usePinnedGroups } from '../lib/usePinnedGroups'
import { StatsRow, CardFilterKey } from '../components/StatsRow'
import { computeStats, parsePosition, parseChange, effectiveDelta } from '../lib/parser'
import { ChevronDown, Check, CalendarDays } from 'lucide-react'

type EditCellFn = (snapshotId: string, matcher: EditCellMatcher, patch: EditCellPatch) => Promise<void>

const COUNTRY_ORDER = ['AU', 'CA', 'DE', 'IT', 'NZ']

// ─── Color palette (Google Sheets standard "light *3*" tier for cells) ───────
//
// Cell colors are the Sheets "light * 3" tier the user specified; headers use
// the matching "light * 1" tier so the same hue reads bolder on the header.

const MAIN_HEADER_BG = '#B4A7D6'   // light purple 2 (softer)
const MAIN_CELL_BG   = '#D9D2E9'   // light purple 3 — country position cells

const BP_PALETTE: Array<{ headerBg: string; cellBg: string }> = [
  { headerBg: '#CCCCCC', cellBg: '#D9D9D9' }, // BP #1 — light grey 2 / 3
  { headerBg: '#FFD966', cellBg: '#FFECB2' }, // BP #2 — light yellow 2 / 3
  { headerBg: '#93C47D', cellBg: '#D9EAD3' }, // BP #3 — light green 2 / 3
  { headerBg: '#C27BA0', cellBg: '#EAD1DC' }, // BP #4 — light magenta 2 / 3
]

const DATE_BAND_BG  = 'var(--band-date)'
const DATE_BAND_FG  = '#FFFFFF'
const HEADER_FG     = '#000000'   // black reads better on the softer pastel headers
const TABLE_BORDER  = '#B0B7BD'
const STICKY_KW_BG  = '#FFFFFF'
// Fixed column width for pinned domain groups — sticky offsets must be
// deterministic, so pinned country columns are locked to the same 90px
// the country sub-headers already use as their min-width.
const PIN_COL_W     = 90

// keyword → domain → country → record
type Lookup = Record<string, Record<string, Record<string, RankingRecord>>>

// ─── Entry ────────────────────────────────────────────────────────────────────

export function BPSites() {
  const ctx = useOutletContext<RROutletContext>()
  const { snapshots, onEditCell } = ctx
  const { brandSlug, domainFilter } = useParams<{ brandSlug: string; domainFilter: string }>()
  const navigate = useNavigate()

  const bpSnapshots = useMemo(
    () => snapshots.filter((s) => s.category === 'bp-sites'),
    [snapshots],
  )
  const bpSnapshotMeta = useMemo(
    () => ctx.snapshotMeta.filter((m) => m.category === 'bp-sites'),
    [ctx.snapshotMeta],
  )
  const activeBrand = brandSlug ? (BRAND_BY_SLUG[brandSlug] ?? null) : null

  if (activeBrand) {
    return (
      <BrandView
        key={`${activeBrand.name}|${domainFilter ?? ''}`}
        brand={activeBrand}
        snapshots={bpSnapshots}
        snapshotMeta={bpSnapshotMeta}
        onLoadOlder={() => ctx.onLoadOlderSnapshots('bp-sites')}
        loadingOlder={ctx.loadingOlderSnapshots}
        domainFilter={domainFilter}
        onBack={() => navigate('/bp-sites')}
        onEditCell={onEditCell}
      />
    )
  }

  return (
    <BrandGrid
      snapshots={bpSnapshots}
      onSelect={(b) => navigate(`/bp-sites/${brandToSlug(b.name)}`)}
      onSelectDomain={(b, domain) => {
        const base = `/bp-sites/${brandToSlug(b.name)}`
        const isBp = b.domains.some(
          (d) => d.toLowerCase() === domain.toLowerCase() && d.toLowerCase() !== b.mainDomain.toLowerCase(),
        )
        navigate(isBp ? `${base}/${domain}` : base)
      }}
    />
  )
}

// ─── Brand Grid (unchanged from prior) ────────────────────────────────────────

function BrandGrid({
  snapshots,
  onSelect,
  onSelectDomain,
}: {
  snapshots: Snapshot[]
  onSelect: (b: Brand) => void
  onSelectDomain: (b: Brand, domain: string) => void
}) {
  return (
    <div className="flex-1 overflow-auto px-3 sm:px-7 pb-7 pt-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {BRANDS.map((brand, idx) => {
          const domainSet = new Set(brand.domains.map((d) => d.toLowerCase()))
          const hasData = snapshots.some((s) =>
            s.records.some((r) => domainSet.has(r.domain.toLowerCase())),
          )
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
                </div>
                {hasData && (
                  <span
                    className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: c + '20', color: c }}
                  >
                    Data
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1">
                {brand.domains.map((d) => {
                  const isMain = d.toLowerCase() === brand.mainDomain.toLowerCase()
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelectDomain(brand, d) }}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left w-full transition-all duration-100 group/domain"
                      style={{
                        borderColor: isMain ? c + '60' : 'var(--border)',
                        background: isMain ? c + '14' : 'var(--surface-2)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = c + '90'
                        e.currentTarget.style.background = isMain ? c + '22' : c + '0D'
                        e.currentTarget.style.boxShadow = `0 1px 6px ${c}25`
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = isMain ? c + '60' : 'var(--border)'
                        e.currentTarget.style.background = isMain ? c + '14' : 'var(--surface-2)'
                        e.currentTarget.style.boxShadow = ''
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ color: isMain ? c : 'var(--muted-2)', flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      <span
                        className="text-[11px] truncate flex-1"
                        style={{ color: isMain ? 'var(--ink)' : 'var(--muted)' }}
                      >
                        {d}
                      </span>
                      {isMain ? (
                        <span
                          className="ml-auto text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: c + '30', color: c }}
                        >
                          MAIN
                        </span>
                      ) : (
                        <svg
                          width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                          strokeLinecap="round" strokeLinejoin="round"
                          className="shrink-0 opacity-0 group-hover/domain:opacity-60 transition-opacity"
                          style={{ color: c }}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Brand Detail View — horizontal matrix per date section ───────────────────

function BrandView({
  brand,
  snapshots,
  snapshotMeta,
  onLoadOlder,
  loadingOlder,
  domainFilter,
  onBack,
  onEditCell,
}: {
  brand: Brand
  snapshots: Snapshot[]
  snapshotMeta: SnapshotMeta[]
  onLoadOlder: () => void
  loadingOlder: boolean
  domainFilter: string | undefined
  onBack: () => void
  onEditCell: EditCellFn
}) {
  // Older history not yet hydrated for this category (snapshotMeta covers
  // every date; snapshots only the currently-loaded window) — drives the
  // "load older history" affordances below. Not brand-scoped (snapshotMeta
  // has no per-brand data), so this is "more history exists", not "this
  // brand definitely has data in it".
  const oldestLoadedDate = snapshots.length > 0
    ? snapshots.reduce((min, s) => (s.rawDate < min ? s.rawDate : min), snapshots[0].rawDate)
    : null
  const unloadedOlderCount = oldestLoadedDate === null
    ? 0
    : snapshotMeta.filter((m) => m.rawDate < oldestLoadedDate).length
  const navigate = useNavigate()
  const brandDomainSet = useMemo(
    () => new Set(brand.domains.map((d) => d.toLowerCase())),
    [brand],
  )

  const mainDomain = brand.mainDomain.toLowerCase()
  const bpDomains  = useMemo(
    () => brand.domains.filter((d) => d.toLowerCase() !== mainDomain),
    [brand, mainDomain],
  )

  const [searchParams, setSearchParams] = useSearchParams()

  // Position filter from URL (?pos=p1 | top3 | top10)
  const [posFilter, setPosFilter] = useState<'p1' | 'top3' | 'top10' | 'all'>(() => {
    const p = searchParams.get('pos')
    if (p === 'p1' || p === 'top3' || p === 'top10') return p
    return 'all'
  })

  // Site filter — a set of checked domains (Main + any BP domains). Prefer the
  // ?site= query param, fall back to the :domainFilter path param used by
  // brand-grid domain links. 'all' = full set, 'none' = empty set, 'bp' =
  // legacy default (kept for old bookmarked URLs), a comma list = explicit
  // domains, missing = default (BP domains only, no Main).
  const [visibleDomains, setVisibleDomains] = useState<string[]>(() => {
    const bpLower = bpDomains.map((d) => d.toLowerCase())
    const src = searchParams.get('site') ?? domainFilter
    if (!src || src === 'bp') return bpLower
    if (src === 'all') return [mainDomain, ...bpLower]
    if (src === 'none') return []
    const parts = src.split(',').map((s) => s.trim().toLowerCase())
    const matched = [mainDomain, ...bpLower].filter((d) => parts.includes(d))
    return matched.length > 0 ? matched : bpLower
  })

  const showMain = visibleDomains.includes(mainDomain)
  const visibleBpDomains = useMemo(
    () => bpDomains.filter((d) => visibleDomains.includes(d.toLowerCase())),
    [visibleDomains, bpDomains],
  )

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

  // Most recent snapshot drives the keyword/site count chip
  const latestSnap = brandSnapshots[0] ?? null

  // Local filters — independent from Rankings page
  const [activeCountries, setActiveCountries] = useState<string[]>(() => {
    const param = searchParams.get('countries')
    if (param) {
      const parsed = param.split(',').map((c) => c.trim().toUpperCase()).filter((c) => COUNTRY_ORDER.includes(c))
      if (parsed.length > 0) return parsed
    }
    return COUNTRY_ORDER
  })
  const [kwFilter, setKwFilter] = useState(() => searchParams.get('kw') ?? '')

  // Keep kwFilter in sync when the URL kw param changes externally (e.g. modal navigation)
  const kwUrlParam = searchParams.get('kw') ?? ''
  useEffect(() => {
    setKwFilter(kwUrlParam)
  }, [kwUrlParam])

  const [kwExact, setKwExact] = useState(() => searchParams.get('exact') === '1')
  const exactUrlParam = searchParams.get('exact') === '1'
  useEffect(() => { setKwExact(exactUrlParam) }, [exactUrlParam])

  // Keep activeCountries in sync when the URL countries param changes externally (e.g. modal navigation)
  const countriesUrlParam = searchParams.get('countries') ?? ''
  useEffect(() => {
    if (countriesUrlParam) {
      const parsed = countriesUrlParam.split(',').map((c) => c.trim().toUpperCase()).filter((c) => COUNTRY_ORDER.includes(c))
      if (parsed.length > 0) { setActiveCountries(parsed); return }
    }
    setActiveCountries(COUNTRY_ORDER)
  }, [countriesUrlParam])

  const [cardFilter, setCardFilter] = useState<CardFilterKey | null>(null)
  const [modalCard, setModalCard] = useState<CardFilterKey | null>(null)
  const [showClassChart, setShowClassChart] = useState(false)
  const [showAllSnapshots, setShowAllSnapshots] = useState(false)

  // Pinned domain groups — shared across every snapshot matrix on the page,
  // persisted per brand.
  const [pinnedDomains, togglePinnedDomain] = usePinnedGroups(`bp-${brand.name}`)

  // Stats-date filter: 'all' resolves to the latest snapshot; otherwise the
  // selected snapshot id or 'month:<MonthYear>'.
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
  const [monthly, setMonthly] = useState(() => statsFilter.startsWith('month:'))
  const setMonthlyMode = (next: boolean) => {
    setMonthly(next)
    if (next || statsFilter.startsWith('month:')) handleStatsFilterChange('all')
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

  const serializeVisibleDomains = (domains: string[]): string | null => {
    const bpLower = bpDomains.map((d) => d.toLowerCase())
    const fullSet = [mainDomain, ...bpLower]
    if (domains.length === fullSet.length && fullSet.every((d) => domains.includes(d))) return 'all'
    if (domains.length === bpLower.length && bpLower.every((d) => domains.includes(d)) && !domains.includes(mainDomain)) return null
    if (domains.length === 0) return 'none'
    return domains.join(',')
  }
  const updateVisibleDomains = (next: string[]) => {
    setVisibleDomains(next)
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      const serialized = serializeVisibleDomains(next)
      if (serialized === null) p.delete('site')
      else p.set('site', serialized)
      return p
    }, { replace: true })
  }
  const handleSelectAll = () => {
    updateVisibleDomains([mainDomain, ...bpDomains.map((d) => d.toLowerCase())])
  }
  const handleToggleDomain = (domain: string) => {
    const dl = domain.toLowerCase()
    const already = visibleDomains.includes(dl)
    updateVisibleDomains(already ? visibleDomains.filter((d) => d !== dl) : [...visibleDomains, dl])
  }

  // Filtered records for the stats snapshot — reused by both computeStats and the modal.
  const statsRecords = useMemo(() => {
    const all = statsSnap?.records ?? []
    const bpSet = new Set(visibleBpDomains.map((d) => d.toLowerCase()))
    const filter = kwFilter.trim().toLowerCase()
    return all.filter((r) => {
      if (!bpSet.has(r.domain.toLowerCase())) return false
      const countryCode = COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()
      if (!activeCountries.includes(countryCode)) return false
      if (filter && (kwExact ? r.keyword.toLowerCase() !== filter : !r.keyword.toLowerCase().includes(filter))) return false
      return true
    })
  }, [statsSnap, visibleBpDomains, activeCountries, kwFilter, kwExact])

  // Previous-snapshot position map — shared by both the stats counter and the
  // modal so they use identical comparison logic.
  const prevPosMap = useMemo(() => {
    const snapIdx = statsSnap ? brandSnapshots.findIndex((s) => s.id === statsSnap.id) : -1
    const prevSnap = snapIdx >= 0 ? (brandSnapshots[snapIdx + 1] ?? null) : null
    if (!prevSnap) return null
    const map = new Map<string, number | 'NR'>()
    for (const r of prevSnap.records) {
      const pos = parsePosition(r.position)
      if (pos !== null) {
        const k = `${r.keyword.toLowerCase()}|${r.domain.toLowerCase()}|${COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()}`
        map.set(k, pos)
      }
    }
    return map
  }, [statsSnap, brandSnapshots])

  // Stats for the selected stats-date snapshot. Restricted to visible BP-site
  // rows — when a specific BP domain is selected, counts reflect that domain only.
  // Uses cross-snapshot comparison (same logic as PosBadge) so the IMPROVED /
  // DROPPED counts match exactly the green / red arrows shown in the table.
  const stats = useMemo(() => {
    const recs = statsRecords

    if (!prevPosMap) return computeStats(recs)

    let top3 = 0, improved = 0, dropped = 0, notRanking = 0, unchanged = 0
    for (const r of recs) {
      const p = parsePosition(r.position)
      const cc = COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()
      if (p === 'NR' || p === null) { notRanking++; continue }
      if (p <= 3) top3++
      const prevPos = prevPosMap.get(`${r.keyword.toLowerCase()}|${r.domain.toLowerCase()}|${cc}`) ?? null
      if (prevPos === null)                                        unchanged++
      else if (prevPos === 'NR' || (typeof prevPos === 'number' && prevPos > p)) improved++
      else if (typeof prevPos === 'number' && prevPos < p)         dropped++
      else                                                         unchanged++
    }
    return { total: recs.length, top3, improved, dropped, notRanking, unchanged }
  }, [statsRecords, prevPosMap])

  // Keyword count for the latest snapshot (filtered) — drives the summary chip
  const latestKeywordCount = useMemo(() => {
    if (!latestSnap) return 0
    const seen = new Set<string>()
    const labels: Record<string, string> = {}
    for (const r of latestSnap.records) {
      const kl = r.keyword.toLowerCase()
      if (!seen.has(kl)) { seen.add(kl); labels[kl] = r.keyword }
    }
    const filter = kwFilter.trim().toLowerCase()
    return Object.keys(labels).filter((kl) => !filter || (kwExact ? kl === filter || labels[kl].toLowerCase() === filter : kl.includes(filter) || labels[kl].toLowerCase().includes(filter))).length
  }, [latestSnap, kwFilter, kwExact])

  // Country columns honor the chip filter, but preserve canonical order
  const visibleCountries = COUNTRY_ORDER.filter((c) => activeCountries.includes(c))

  return (
    <>
      {/* Back + brand header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2 px-3 sm:px-7 pt-4 sm:pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-2">
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
        </div>

        {brandSnapshots.length > 0 && (
          <div className="sm:ml-auto">
            <StatsDateFilter
              value={statsFilter}
              snapshots={brandSnapshots}
              onChange={handleStatsFilterChange}
              monthly={monthly}
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
            No ranking data for {brand.name} yet. Import a data export to populate this view.
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
            onCardClick={(key) => { setCardFilter(key); if (key !== null) setModalCard(key) }}
          />

          {/* Filter bar — sites + countries + keyword search */}
          <div className="flex items-center gap-1.5 px-3 sm:px-7 pt-[10px] pb-[5px] shrink-0 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)] mr-1">
              Sites
            </span>
            <SiteFilter
              visibleDomains={visibleDomains}
              mainDomain={mainDomain}
              bpDomains={bpDomains}
              onSelectAll={handleSelectAll}
              onToggleDomain={handleToggleDomain}
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
                    p.delete('exact')
                    return p
                  }, { replace: true })
                }}
                placeholder="Search keywords…"
                className="pl-7 pr-3 py-1 bg-[var(--surface-3)] border border-[var(--border)] rounded-full text-[12px] text-[var(--ink)] outline-none w-36 sm:w-44 placeholder:text-[var(--muted)] focus:border-[var(--border-strong)] transition-colors"
              />
            </div>

            <div className="flex items-center gap-0.5 p-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-3)]">
              <button
                type="button"
                onClick={() => setMonthlyMode(false)}
                className={`px-3 py-1 rounded-full text-[12px] font-sans transition-all ${
                  !monthly ? 'bg-[var(--surface)] text-[var(--ink)] font-bold shadow-sm' : 'text-[var(--muted)]'
                }`}
              >
                Weekly
              </button>
              <button
                type="button"
                onClick={() => setMonthlyMode(true)}
                className={`px-3 py-1 rounded-full text-[12px] font-sans transition-all ${
                  monthly ? 'bg-[var(--surface)] text-[var(--ink)] font-bold shadow-sm' : 'text-[var(--muted)]'
                }`}
              >
                Monthly
              </button>
            </div>

            {posFilter !== 'all' && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold"
                style={{ background: 'var(--info-surface)', borderColor: 'var(--info-border)', color: 'var(--info)' }}>
                <span>
                  {posFilter === 'p1' ? 'P1 only' : posFilter === 'top3' ? 'Top-3 only' : 'Top-10 only'}
                </span>
                <button
                  onClick={() => {
                    setPosFilter('all')
                    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete('pos'); return p }, { replace: true })
                  }}
                  className="ml-0.5 hover:text-[#312E81] leading-none"
                  title="Clear position filter"
                >
                  ×
                </button>
              </div>
            )}

            <div className="hidden sm:flex items-center gap-2 ml-auto">
              <span className="text-[11px] font-mono text-[var(--muted)]">
                {brandSnapshots.length} date{brandSnapshots.length !== 1 ? 's' : ''} · {latestKeywordCount} keyword{latestKeywordCount !== 1 ? 's' : ''} in latest · {brand.domains.length} site{brand.domains.length !== 1 ? 's' : ''}
                {' (1 main + ' + bpDomains.length + ' BP)'}
              </span>
              <button
                onClick={() => setShowClassChart(true)}
                title="How keywords are classified"
                className="flex items-center gap-1 text-[10px] text-[var(--muted-2)] hover:text-[var(--text-2)] transition-colors border border-[var(--border)] hover:border-[var(--border-strong)] rounded-md px-2 py-1"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
                Guide
              </button>
            </div>
          </div>

          {/* Stacked matrices — one table per uploaded date, newest first.
              When the Stats date filter picks a specific date, narrow the
              tables to that one date too. */}
          <div className="flex-1 overflow-y-auto px-3 sm:px-7 pb-7 flex flex-col gap-6">
            {(() => {
              const allSnaps = statsFilter === 'all'
                ? brandSnapshots
                : monthKey
                  ? brandSnapshots.filter((s) => snapMonthKey(s) === monthKey)
                  : brandSnapshots.filter((s) => s.id === statsFilter)
              // When showing all dates, only render the latest snapshot initially
              // to avoid blocking the main thread with thousands of table cells.
              const visibleSnaps = (statsFilter === 'all' && !showAllSnapshots)
                ? allSnaps.slice(0, 1)
                : allSnaps
              const hiddenCount = allSnaps.length - visibleSnaps.length
              return (
                <>
                  {visibleSnaps.map((snap) => {
                    const snapIdx = brandSnapshots.findIndex((s) => s.id === snap.id)
                    const prevSnap = snapIdx >= 0 ? (brandSnapshots[snapIdx + 1] ?? null) : null
                    return (
                      <SnapshotMatrix
                        key={snap.id}
                        snapshot={snap}
                        prevSnapshot={prevSnap}
                        brand={brand}
                        mainDomain={mainDomain}
                        bpDomains={visibleBpDomains}
                        showMain={showMain}
                        visibleCountries={visibleCountries}
                        kwFilter={kwFilter}
                        kwExact={kwExact}
                        posFilter={posFilter}
                        cardFilter={cardFilter}
                        onEditCell={onEditCell}
                        isLatest={snap.id === latestSnap?.id}
                        pinnedDomains={pinnedDomains}
                        onTogglePin={togglePinnedDomain}
                      />
                    )
                  })}
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

      {showClassChart && (
        <ClassificationChartModal onClose={() => setShowClassChart(false)} />
      )}

      {modalCard !== null && (
        <StatsCardModal
          card={modalCard}
          records={statsRecords}
          prevPosMap={prevPosMap}
          brand={brand}
          onClose={() => setModalCard(null)}
          onNavigate={(path) => { setModalCard(null); setCardFilter(null); navigate(path) }}
        />
      )}
    </>
  )
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function snapMonthKey(snap: Snapshot): string {
  const [y, m] = snap.rawDate.split('-')
  return MONTH_NAMES[parseInt(m, 10) - 1] + ' ' + (y ?? '')
}

// ─── StatsDateFilter — small dropdown that scopes the StatsRow to a date ─────

function StatsDateFilter({
  value,
  snapshots,
  onChange,
  monthly,
  unloadedOlderCount,
  onLoadOlder,
  loadingOlder,
}: {
  value: string                 // 'all' or snapshot id
  snapshots: Snapshot[]         // already filtered to brand snapshots (newest first)
  onChange: (next: string) => void
  monthly: boolean              // weekly/monthly mode, owned by the parent's toolbar toggle
  unloadedOlderCount: number    // snapshots that exist in history but aren't hydrated yet
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

  // Reset query when closed; auto-focus the search input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 0)
    } else {
      setQuery('')
    }
  }, [open])

  const availableMonths = useMemo(() => {
    const seen = new Set<string>()
    const months: string[] = []
    for (const snap of snapshots) {
      const mk = snapMonthKey(snap)
      if (!seen.has(mk)) { seen.add(mk); months.push(mk) }
    }
    return months
  }, [snapshots])

  const selected = snapshots.find((s) => s.id === value)

  const allLabel = monthly
    ? 'All months'
    : snapshots[0] ? 'All · latest ' + snapshots[0].displayDate : 'All'
  const label = value === 'all'
    ? allLabel
    : value.startsWith('month:')
      ? value.slice(6)
      : monthly
        ? (selected ? snapMonthKey(selected) : 'Unknown')
        : (selected?.displayDate ?? 'Unknown date')

  const q = query.trim().toLowerCase()
  const filteredMonths = q ? availableMonths.filter((m) => m.toLowerCase().includes(q)) : availableMonths
  const showAllMonths = !q || 'all months'.includes(q)
  const filteredSnapshots = q
    ? snapshots.filter((s) => s.displayDate.toLowerCase().includes(q) || s.rawDate.toLowerCase().includes(q))
    : snapshots
  const showAllOption = !q || 'all (latest)'.includes(q) || 'latest'.includes(q)

  return (
    <div ref={ref} className="relative">
      <span className="absolute -top-4 left-0 text-[9px] uppercase tracking-[0.1em] font-semibold text-[var(--muted)]">
        Stats date
      </span>

      {/* Combobox: shows the selected label when closed, becomes a search
          input when open. No separate search bar inside the dropdown. */}
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
          <div className="max-h-[240px] overflow-y-auto">
            {monthly ? (
              <>
                {showAllMonths && (
                  <DateOption label="All months" selected={value === 'all'} onClick={() => { onChange('all'); setOpen(false) }} />
                )}
                {showAllMonths && filteredMonths.length > 0 && <div className="border-t border-[var(--border)]" />}
                {filteredMonths.map((m) => {
                  const isSelected = value === 'month:' + m
                  return (
                    <DateOption key={m} label={m} selected={isSelected} onClick={() => { onChange('month:' + m); setOpen(false) }} />
                  )
                })}
                {!showAllMonths && filteredMonths.length === 0 && (
                  <p className="px-3 py-3 text-[11px] text-[var(--muted-2)] text-center">No months match.</p>
                )}
              </>
            ) : (
              <>
                {showAllOption && (
                  <DateOption label="All (latest)" selected={value === 'all'} onClick={() => { onChange('all'); setOpen(false) }} />
                )}
                {showAllOption && filteredSnapshots.length > 0 && <div className="border-t border-[var(--border)]" />}
                {filteredSnapshots.map((s) => (
                  <DateOption key={s.id} label={s.displayDate} selected={value === s.id} onClick={() => { onChange(s.id); setOpen(false) }} />
                ))}
                {!showAllOption && filteredSnapshots.length === 0 && (
                  <p className="px-3 py-3 text-[11px] text-[var(--muted-2)] text-center">No dates match.</p>
                )}
              </>
            )}
          </div>
          {!query && unloadedOlderCount > 0 && (
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-[var(--text-2)] border-t border-[var(--border)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50 disabled:cursor-wait"
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

// ─── SiteFilter — flat checkbox list: All shortcut + Main + each BP domain ────

function SiteFilter({
  visibleDomains,
  mainDomain,
  bpDomains,
  onSelectAll,
  onToggleDomain,
}: {
  visibleDomains: string[]
  mainDomain: string
  bpDomains: string[]
  onSelectAll: () => void
  onToggleDomain: (domain: string) => void
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

  const totalCount = bpDomains.length + 1
  const isFull = visibleDomains.length === totalCount

  const label = isFull
    ? `All · ${totalCount} sites`
    : visibleDomains.length === 1
      ? visibleDomains[0]
      : visibleDomains.length === 0
        ? '0 sites'
        : `${visibleDomains.length} sites`

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
        <div className="absolute left-0 top-full mt-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-[0_12px_32px_rgba(15,23,42,0.12)] overflow-hidden z-20 min-w-[210px] animate-[modalIn_0.12s_ease]">
          {/* All — select-all shortcut, checked when every site is visible */}
          <SiteOption label="All" selected={isFull} onClick={onSelectAll} />
          <div className="border-t border-[var(--border)]" />
          {/* Main + each BP domain — independent checkbox toggles */}
          <SiteOption
            label={mainDomain}
            selected={visibleDomains.includes(mainDomain)}
            onClick={() => onToggleDomain(mainDomain)}
          />
          {bpDomains.map((d) => (
            <SiteOption
              key={d}
              label={d}
              selected={visibleDomains.includes(d.toLowerCase())}
              onClick={() => onToggleDomain(d)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SiteOption({
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
        selected ? 'bg-[#F0F9FF] text-[var(--ink)]' : 'text-[var(--ink)] hover:bg-[var(--surface-3)]'
      }`}
    >
      <span className="font-medium truncate mr-2">{label}</span>
      <div
        className={`w-[13px] h-[13px] shrink-0 rounded-[3px] border flex items-center justify-center ${
          selected ? 'bg-[var(--btn-ink)] border-[var(--ink)]' : 'border-[var(--border-strong)] bg-[var(--surface)]'
        }`}
      >
        {selected && <Check size={9} strokeWidth={3} className="text-white" />}
      </div>
    </button>
  )
}

// ─── SnapshotMatrix — one date's matrix table ─────────────────────────────────

function SnapshotMatrix({
  snapshot,
  prevSnapshot,
  brand,
  mainDomain,
  bpDomains,
  showMain,
  visibleCountries,
  kwFilter,
  kwExact,
  posFilter,
  cardFilter,
  onEditCell,
  isLatest,
  pinnedDomains,
  onTogglePin,
}: {
  snapshot: Snapshot
  prevSnapshot: Snapshot | null
  brand: Brand
  mainDomain: string
  bpDomains: string[]
  showMain: boolean
  visibleCountries: string[]
  kwFilter: string
  kwExact: boolean
  posFilter: 'p1' | 'top3' | 'top10' | 'all'
  cardFilter: CardFilterKey | null
  onEditCell: EditCellFn
  isLatest: boolean
  pinnedDomains: string[]
  onTogglePin: (domainKey: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const keywordColRef = useRef<HTMLTableCellElement>(null)
  const domainRefs = useRef<Record<string, HTMLTableCellElement | null>>({})
  const [scrolled, setScrolled] = useState(false)
  // Measured keyword-column width — pinned domain groups stick right after it.
  const [kwW, setKwW] = useState(120)

  // Stable index so each BP domain always gets the same palette colour
  // regardless of which other sites are currently selected.
  const allBpDomains = useMemo(
    () => brand.domains.filter((d) => d.toLowerCase() !== mainDomain),
    [brand, mainDomain],
  )
  const scrollToDomain = (key: string) => {
    const el = domainRefs.current[key]
    const scrollEl = scrollRef.current
    if (!el || !scrollEl) return
    const kwWidth = keywordColRef.current?.offsetWidth ?? 0
    scrollEl.scrollTo({ left: el.offsetLeft - kwWidth, behavior: 'smooth' })
  }
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
    const onScroll = () => setScrolled(el.scrollLeft > 0)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // Re-measure the keyword column after each render — its width drives the
  // sticky left offsets of pinned domain groups.
  useEffect(() => {
    const kwEl = keywordColRef.current
    if (kwEl) setKwW(kwEl.offsetWidth)
  })

  const borderStyle = `1px solid ${TABLE_BORDER}`

  // ── Domain groups, pinned ones first — pinned groups freeze beside the
  //    keyword column, mirroring the fixed TOTALS pattern on Reg & FTDs. ──
  type DomainGroup = { domain: string; dk: string; refKey: string; isMain: boolean; headerBg: string; cellBg: string }
  const groups = useMemo<DomainGroup[]>(() => {
    const list: DomainGroup[] = []
    if (showMain) {
      list.push({ domain: brand.mainDomain, dk: mainDomain, refKey: mainDomain, isMain: true, headerBg: MAIN_HEADER_BG, cellBg: MAIN_CELL_BG })
    }
    for (const bp of bpDomains) {
      const idx = allBpDomains.findIndex((d) => d.toLowerCase() === bp.toLowerCase())
      const palette = BP_PALETTE[(idx >= 0 ? idx : 0) % BP_PALETTE.length]
      list.push({ domain: bp, dk: bp.toLowerCase(), refKey: bp, isMain: false, headerBg: palette.headerBg, cellBg: palette.cellBg })
    }
    const pinnedLower = pinnedDomains.map((d) => d.toLowerCase())
    const pinned = pinnedLower.map((d) => list.find((g) => g.dk === d)).filter((g): g is DomainGroup => g != null)
    return [...pinned, ...list.filter((g) => !pinnedLower.includes(g.dk))]
  }, [showMain, brand.mainDomain, mainDomain, bpDomains, allBpDomains, pinnedDomains])
  const pinnedCount = useMemo(() => {
    const pinnedLower = pinnedDomains.map((d) => d.toLowerCase())
    return groups.filter((g) => pinnedLower.includes(g.dk)).length
  }, [groups, pinnedDomains])
  const colsPerGroup = visibleCountries.length

  // Sticky style for a pinned group's cell; {} when the group isn't pinned.
  const pinStyle = (groupPos: number, colIdx: number, z: number): CSSProperties =>
    groupPos < pinnedCount
      ? {
          position: 'sticky',
          left: kwW + (groupPos * colsPerGroup + colIdx) * PIN_COL_W,
          zIndex: z,
          width: PIN_COL_W, minWidth: PIN_COL_W, maxWidth: PIN_COL_W,
          boxShadow: scrolled && groupPos === pinnedCount - 1 && colIdx === colsPerGroup - 1
            ? '4px 0 8px -2px rgba(0,0,0,0.18)'
            : undefined,
        }
      : {}
  const pinHeaderStyle = (groupPos: number): CSSProperties =>
    groupPos < pinnedCount
      ? {
          position: 'sticky',
          left: kwW + groupPos * colsPerGroup * PIN_COL_W,
          zIndex: 6,
          maxWidth: colsPerGroup * PIN_COL_W,
        }
      : {}

  // keyword → domain → country → record for the immediately prior snapshot.
  // null when there is no older snapshot to compare against.
  const prevLookup = useMemo(() => {
    if (!prevSnapshot) return null
    const map: Lookup = {}
    for (const r of prevSnapshot.records) {
      const kk = r.keyword.toLowerCase()
      const dk = r.domain.toLowerCase()
      const ck = COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()
      if (!map[kk]) map[kk] = {}
      if (!map[kk][dk]) map[kk][dk] = {}
      map[kk][dk][ck] = r
    }
    return map
  }, [prevSnapshot])

  // Sorted keyword list for this snapshot, with kw search + position filter applied
  const keywords = useMemo(() => {
    const seen = new Set<string>()
    const labels: Record<string, string> = {}
    for (const r of snapshot.records) {
      const kl = r.keyword.toLowerCase()
      if (!seen.has(kl)) { seen.add(kl); labels[kl] = r.keyword }
    }
    const filter = kwFilter.trim().toLowerCase()
    let keys = Object.keys(labels)
      .filter((kl) => !filter || (kwExact ? kl === filter || labels[kl].toLowerCase() === filter : kl.includes(filter) || labels[kl].toLowerCase().includes(filter)))

    if (posFilter !== 'all' || cardFilter) {
      const kwRecords = new Map<string, typeof snapshot.records>()
      for (const r of snapshot.records) {
        const kl = r.keyword.toLowerCase()
        const list = kwRecords.get(kl) ?? []
        list.push(r)
        kwRecords.set(kl, list)
      }

      if (posFilter !== 'all') {
        keys = keys.filter((kl) => {
          const recs = kwRecords.get(kl) ?? []
          return recs.some((r) => {
            const p = parsePosition(r.position)
            if (posFilter === 'p1')    return p === 1
            if (posFilter === 'top3')  return typeof p === 'number' && p <= 3
            if (posFilter === 'top10') return typeof p === 'number' && p <= 10
            return true
          })
        })
      }

      if (cardFilter) {
        keys = keys.filter((kl) => {
          const recs = kwRecords.get(kl) ?? []
          return recs.some((r) => {
            const p = parsePosition(r.position)
            if (cardFilter === 'top3')       return typeof p === 'number' && p <= 3
            if (cardFilter === 'notRanking') return p === 'NR'

            if (prevLookup !== null) {
              // Cross-snapshot path — mirrors PosBadge so filter matches visual arrows
              const dk = r.domain.toLowerCase()
              const ck = COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()
              const prevRec = prevLookup[kl]?.[dk]?.[ck]
              const prevPos = parsePosition(prevRec?.position ?? '')
              if (prevPos === null) return cardFilter === 'unchanged' && typeof p === 'number'
              if (cardFilter === 'improved')  return prevPos === 'NR' || (typeof prevPos === 'number' && typeof p === 'number' && prevPos > p)
              if (cardFilter === 'dropped')   return typeof prevPos === 'number' && typeof p === 'number' && prevPos < p
              if (cardFilter === 'unchanged') return typeof p === 'number' && typeof prevPos === 'number' && prevPos === p
            }

            // Fallback: no prev snapshot, use within-file change
            const d = parseChange(r.change ?? '') ?? 0
            if (cardFilter === 'improved')   return d > 0
            if (cardFilter === 'dropped')    return d < 0
            if (cardFilter === 'unchanged')  return p !== 'NR' && d === 0
            return true
          })
        })
      }
    }

    return keys.sort().map((kl) => ({ key: kl, label: labels[kl] }))
  }, [snapshot, kwFilter, posFilter, cardFilter, prevLookup])

  // keyword → domain → country → record
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
      className="bg-[#FFFFFF] rounded-[6px] text-black shrink-0 w-full"
      style={{ border: borderStyle, overflow: 'clip' }}
    >
      {/* Date band */}
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
        <div className="ml-auto flex items-center gap-1">
          {showMain && (
            <button
              onClick={() => scrollToDomain(mainDomain)}
              className="text-[10px] font-bold px-2 py-0.5 rounded-[3px] whitespace-nowrap transition-colors"
              style={{ background: 'rgba(255,255,255,0.22)', color: DATE_BAND_FG }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.42)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.22)')}
            >
              MAIN
            </button>
          )}
          {bpDomains.map((bp, i) => (
            <button
              key={bp}
              onClick={() => scrollToDomain(bp)}
              className="text-[10px] font-bold px-2 py-0.5 rounded-[3px] whitespace-nowrap transition-colors"
              style={{ background: 'rgba(255,255,255,0.22)', color: DATE_BAND_FG }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.42)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.22)')}
            >
              BP{i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Horizontal matrix */}
      <div ref={scrollRef} className="overflow-x-auto">
        <table className="border-collapse text-[11px] w-max min-w-full">

          {/* Row 1 — Block label row (MAIN / BP per block) */}
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
                  boxShadow: scrolled && pinnedCount === 0 ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
                }}
              >
                Keyword
              </th>
              {groups.map((g, gi) => (
                <th
                  key={`grp-h-${g.dk}`}
                  ref={(el) => { domainRefs.current[g.refKey] = el }}
                  colSpan={colsPerGroup}
                  className="px-3 py-2 text-center text-[11px] font-bold whitespace-nowrap"
                  style={{
                    background: g.headerBg,
                    color: HEADER_FG,
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                    ...pinHeaderStyle(gi),
                  }}
                >
                  <span className="inline-flex items-center gap-1.5 max-w-full">
                    <span className="truncate">{g.isMain ? <>MAIN — {g.domain}</> : <>BP — {g.domain}</>}</span>
                    <PinButton pinned={gi < pinnedCount} onToggle={() => onTogglePin(g.dk)} />
                  </span>
                </th>
              ))}
            </tr>

            {/* Row 2 — Country / spec sub-header */}
            <tr>
              {groups.map((g, gi) => (
                <Fragment key={`grp-sub-${g.dk}`}>
                  {visibleCountries.map((c, ci) => (
                    <th
                      key={`grp-sub-${g.dk}-${c}`}
                      className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em] min-w-[90px]"
                      style={{
                        background: g.headerBg,
                        color: HEADER_FG,
                        borderLeft: g.isMain && ci === 0 ? undefined : borderStyle,
                        borderRight: ci === colsPerGroup - 1 ? borderStyle : undefined,
                        borderBottom: borderStyle,
                        ...pinStyle(gi, ci, 6),
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </Fragment>
              ))}
            </tr>
          </thead>

          <tbody>
            {keywords.map(({ key: kw, label }) => (
              <tr key={kw}>

                {/* Keyword (sticky) */}
                <td
                  className="sticky left-0 z-[5] px-3 py-2 font-semibold whitespace-nowrap"
                  style={{
                    background: STICKY_KW_BG,
                    color: '#000',
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                    boxShadow: scrolled && pinnedCount === 0 ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
                  }}
                >
                  {label}
                </td>

                {groups.map((g, gi) =>
                  visibleCountries.map((c, ci) => {
                    const rec = lookup?.[kw]?.[g.dk]?.[c]
                    const prevRec = prevLookup?.[kw]?.[g.dk]?.[c]
                    const crossSnapPrevPos = prevLookup !== null
                      ? parsePosition(prevRec?.position ?? '')
                      : undefined
                    return (
                      <td
                        key={`grp-cell-${kw}-${g.dk}-${c}`}
                        className={`px-2 py-1.5 text-center align-middle ${g.isMain ? 'min-w-[90px]' : ''}`}
                        style={{
                          background: g.cellBg,
                          borderLeft: g.isMain && ci === 0 ? undefined : borderStyle,
                          borderRight: ci === colsPerGroup - 1 ? borderStyle : undefined,
                          borderBottom: borderStyle,
                          ...pinStyle(gi, ci, 4),
                        }}
                      >
                        {rec ? <PosBadge record={rec} crossSnapPrevPos={crossSnapPrevPos} /> : <span className="text-[#6B7280] text-[11px]">–</span>}
                      </td>
                    )
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── StatsCardModal — keyword detail grouped by site ─────────────────────────

const CARD_MODAL_LABELS: Record<CardFilterKey, string> = {
  top3: 'Top 3 Positions',
  improved: 'Improved Keywords',
  dropped: 'Dropped Keywords',
  unchanged: 'Unchanged Keywords',
  notRanking: 'Not Ranking',
}

const CARD_MODAL_ACCENTS: Record<CardFilterKey, string> = {
  top3: '#0F172A',
  improved: 'var(--pos)',
  dropped: 'var(--neg)',
  unchanged: '#94A3B8',
  notRanking: '#64748B',
}

type ModalEntry = { keyword: string; country: string; position: string; change: string; prevPos: number | 'NR' | null }

function StatsCardModal({
  card,
  records,
  prevPosMap,
  brand,
  onClose,
  onNavigate,
}: {
  card: CardFilterKey
  records: RankingRecord[]
  prevPosMap: Map<string, number | 'NR'> | null
  brand: Brand
  onClose: () => void
  onNavigate: (path: string) => void
}) {
  const filtered = useMemo(() => {
    return records.filter((r) => {
      const p = parsePosition(r.position)
      if (card === 'top3')       return typeof p === 'number' && p <= 3
      if (card === 'notRanking') return p === 'NR'
      // NR / null records don't participate in improved/dropped/unchanged
      if (p === 'NR' || p === null) return false

      if (prevPosMap) {
        const cc = COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()
        const key = `${r.keyword.toLowerCase()}|${r.domain.toLowerCase()}|${cc}`
        const prevPos = prevPosMap.get(key) ?? null
        if (card === 'improved')  return prevPos === 'NR' || (typeof prevPos === 'number' && prevPos > p)
        if (card === 'dropped')   return typeof prevPos === 'number' && prevPos < p
        if (card === 'unchanged') return prevPos === null || (typeof prevPos === 'number' && prevPos === p)
      } else {
        const d = effectiveDelta(r.change ?? '', p)
        if (card === 'improved')  return d > 0
        if (card === 'dropped')   return d < 0
        if (card === 'unchanged') return d === 0
      }
      return false
    })
  }, [records, card, prevPosMap])

  // Group: domain → keyword_lower → ModalEntry[]
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, ModalEntry[]>>()
    for (const r of filtered) {
      if (!map.has(r.domain)) map.set(r.domain, new Map())
      const kwMap = map.get(r.domain)!
      const kl = r.keyword.toLowerCase()
      if (!kwMap.has(kl)) kwMap.set(kl, [])
      const cc = COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()
      const prevPos = prevPosMap
        ? prevPosMap.get(`${kl}|${r.domain.toLowerCase()}|${cc}`) ?? null
        : null
      kwMap.get(kl)!.push({
        keyword: r.keyword,
        country: cc,
        position: r.position,
        change: r.change ?? '',
        prevPos,
      })
    }
    return map
  }, [filtered, prevPosMap])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const accent = CARD_MODAL_ACCENTS[card]
  const label = CARD_MODAL_LABELS[card]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.55)' }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--surface)] rounded-[12px] w-full max-w-lg max-h-[80vh] flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.22)]"
        style={{ borderTop: `3px solid ${accent}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] font-semibold mb-0.5" style={{ color: accent }}>
              {label}
            </div>
            <div className="text-[13px] text-[var(--muted)]">
              {filtered.length} record{filtered.length !== 1 ? 's' : ''} · {grouped.size} site{grouped.size !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--surface-3)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors ml-4 shrink-0"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {grouped.size === 0 ? (
            <p className="text-[13px] text-[var(--muted-2)] text-center py-8">No records match this filter.</p>
          ) : (
            Array.from(grouped.entries()).map(([domain, kwMap]) => (
              <div key={domain}>
                {/* Site header */}
                <div
                  className="flex items-center gap-2 mb-2 pb-1.5 border-b border-[#F1F5F9] cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => { onNavigate(`/bp-sites/${brandToSlug(brand.name)}/${domain}`); onClose() }}
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
                  <span className="text-[12px] font-bold text-[var(--ink)] uppercase tracking-[0.05em] truncate flex-1 hover:underline">
                    {domain}
                  </span>
                  <span className="text-[10px] text-[var(--muted-2)] shrink-0">
                    {kwMap.size} kw
                  </span>
                </div>

                {/* Keyword rows */}
                <div className="flex flex-col gap-1">
                  {Array.from(kwMap.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([kwL, entries]) => {
                      const kwLabel = entries[0].keyword
                      const sorted = [...entries].sort((a, b) => {
                        const pa = parsePosition(a.position)
                        const pb = parsePosition(b.position)
                        const na = typeof pa === 'number' ? pa : 999
                        const nb = typeof pb === 'number' ? pb : 999
                        return na - nb
                      })
                      return (
                        <div
                          key={kwL}
                          className="flex items-center gap-2 py-1.5 px-2.5 rounded-[6px] hover:bg-[var(--surface-2)] transition-colors cursor-pointer group/kw"
                          onClick={() => { const countries = [...new Set(sorted.map((e) => e.country))].join(','); onNavigate(`/bp-sites/${brandToSlug(brand.name)}/${domain}?kw=${encodeURIComponent(kwLabel)}&countries=${encodeURIComponent(countries)}&exact=1`); onClose() }}
                        >
                          <span className="text-[12px] text-[#334155] flex-1 min-w-0 truncate group-hover/kw:underline">
                            {kwLabel}
                          </span>
                          <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
                            {sorted.map((entry, i) => {
                              const p = parsePosition(entry.position)
                              const prev = entry.prevPos

                              const positionNode = (() => {
                                if (prev === null) {
                                  return <span style={{ color: accent }}>{typeof p === 'number' ? `#${p}` : 'NR'}</span>
                                }
                                if (prev === p || (prev === 'NR' && p === 'NR')) {
                                  return <span style={{ color: '#000000' }}>{typeof p === 'number' ? p : 'NR'}</span>
                                }
                                const improved = p !== 'NR' && (prev === 'NR' || (typeof prev === 'number' && typeof p === 'number' && prev > p))
                                const dirColor = improved ? 'var(--pos)' : 'var(--neg)'
                                const arrow = improved ? '↑' : '↓'
                                const curDisplay = typeof p === 'number' ? p : 'NR'
                                const prevDisplay = typeof prev === 'number' ? prev : 'NR'
                                return (
                                  <>
                                    <span style={{ color: dirColor }}>{curDisplay} {arrow}</span>{' '}
                                    <span style={{ color: '#000000' }}>{prevDisplay}</span>
                                  </>
                                )
                              })()

                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap"
                                  style={{ background: accent + '18' }}
                                >
                                  <span className="font-normal" style={{ color: '#94A3B8' }}>{entry.country}</span>
                                  {positionNode}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ClassificationChartModal — explains how keyword movement is classified ───

function ChartRow({
  condition,
  badge,
  badgeColor,
  accent = 'var(--surface-2)',
  border = 'var(--border)',
}: {
  condition: React.ReactNode
  badge: string
  badgeColor: string
  accent?: string
  border?: string
}) {
  return (
    <div
      className="flex items-center gap-2.5 py-2 px-3 rounded-[8px] border text-[11px]"
      style={{ background: accent, borderColor: border }}
    >
      <span className="text-[var(--text-2)] flex-1 leading-snug">{condition}</span>
      <span
        className="px-2.5 py-[3px] rounded-full text-[10px] font-bold whitespace-nowrap shrink-0"
        style={{ background: badgeColor, color: 'var(--surface)' }}
      >
        {badge}
      </span>
    </div>
  )
}

function ClassificationChartModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.55)' }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--surface)] rounded-[12px] w-full max-w-[420px] shadow-[0_24px_64px_rgba(0,0,0,0.22)]"
        style={{ borderTop: '3px solid #0F172A' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)]">
          <span className="text-[11px] font-bold text-[var(--ink)] uppercase tracking-[0.1em]">
            Keyword Classification
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--surface-3)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-3">
          <p className="text-[11px] text-[var(--muted)]">
            Lower rank number = better position &nbsp;
            <span className="text-[var(--muted-2)]">(rank 3 is better than rank 10)</span>
          </p>

          {/* Step 1 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="w-[18px] h-[18px] rounded-full bg-[var(--btn-ink)] text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                1
              </span>
              <span className="text-[10px] font-bold text-[var(--text-2)] uppercase tracking-[0.1em]">
                Check current position
              </span>
            </div>
            <ChartRow
              condition={<>Position is <span className="font-semibold text-[var(--ink)]">"Not in top 100"</span></>}
              badge="NOT RANKED"
              badgeColor="#64748B"
            />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-[#E2E8F0]"/>
            <span className="text-[10px] text-[var(--muted-2)] shrink-0">if ranked → continue</span>
            <div className="flex-1 h-px bg-[#E2E8F0]"/>
          </div>

          {/* Step 2 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="w-[18px] h-[18px] rounded-full bg-[var(--btn-ink)] text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                2
              </span>
              <span className="text-[10px] font-bold text-[var(--text-2)] uppercase tracking-[0.1em]">
                Compare with previous snapshot
              </span>
            </div>
            <ChartRow
              condition={
                <>
                  Previous was <span className="font-semibold text-[var(--ink)]">NR</span>,
                  {' '}or previous rank# was <span className="font-semibold text-[var(--ink)]">higher</span>
                  {' '}<span className="text-[var(--muted-2)]">(e.g. 8 → 5)</span>
                </>
              }
              badge="IMPROVED ↑"
              badgeColor="var(--pos)"
              accent="var(--pos-surface)"
              border="var(--pos-border)"
            />
            <ChartRow
              condition={
                <>
                  Previous rank# was <span className="font-semibold text-[var(--ink)]">lower</span>
                  {' '}<span className="text-[var(--muted-2)]">(e.g. 5 → 8)</span>
                </>
              }
              badge="DROPPED ↓"
              badgeColor="var(--neg)"
              accent="var(--neg-surface)"
              border="var(--neg-border)"
            />
            <ChartRow
              condition={
                <>
                  Same rank# as previous,
                  {' '}or <span className="font-semibold text-[var(--ink)]">no previous data</span>
                </>
              }
              badge="UNCHANGED"
              badgeColor="var(--btn-ink)"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

