import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Brand, RankingRecord, RROutletContext, Snapshot } from '../types'
import { BRANDS, BRAND_BY_NAME, COUNTRY_LABELS } from '../lib/brands'
import { PosBadge } from '../components/PosBadge'
import { StatsRow } from '../components/StatsRow'
import { parsePosition, parseChange } from '../lib/parser'
import { ChevronDown, Check, CalendarDays } from 'lucide-react'

const COUNTRY_ORDER = ['AU', 'CA', 'DE', 'IT', 'NZ']

// ─── Color palette (Google Sheets standard "light *3*" tier for cells) ───────
//
// Cell colors are the Sheets "light * 3" tier the user specified; headers use
// the matching "light * 1" tier so the same hue reads bolder on the header.

const MAIN_HEADER_BG = '#B4A7D6'   // light purple 2 (softer)
const MAIN_CELL_BG   = '#D9D2E9'   // light purple 3 — country position cells
const MAIN_AUX_BG    = '#CFE2F3'   // light cornflower-blue 3 — GSV / SV / AFF

const BP_PALETTE: Array<{ headerBg: string; cellBg: string }> = [
  { headerBg: '#CCCCCC', cellBg: '#D9D9D9' }, // BP #1 — light grey 2 / 3
  { headerBg: '#FFD966', cellBg: '#FFECB2' }, // BP #2 — light yellow 2 / 3
  { headerBg: '#93C47D', cellBg: '#D9EAD3' }, // BP #3 — light green 2 / 3
  { headerBg: '#C27BA0', cellBg: '#EAD1DC' }, // BP #4 — light magenta 2 / 3
]

const DATE_BAND_BG  = '#5894CD'
const DATE_BAND_FG  = '#FFFFFF'
const HEADER_FG     = '#000000'   // black reads better on the softer pastel headers
const TABLE_BORDER  = '#B0B7BD'
const STICKY_KW_BG  = '#FFFFFF'

// Grid-only color overrides — sampled from each brand's logo so the cards on
// the BP Sites overview match brand identity. Scoped here intentionally; the
// global brand.color (used by Home stats, badges, etc.) is unchanged.
const GRID_BRAND_COLORS: Record<string, string> = {
  'Lucky 7even': '#C026D3', // magenta from "Lucky" lettering
  'RoosterBet':  '#DC2626', // red accent
  'LuckyVibe':   '#0F766E', // dark teal gradient
  'SpinsUp':     '#EC4899', // neon pink
  'Spinjo':      '#1E40AF', // royal blue
  'FortunePLay': '#CA8A04', // gold on dark
  'RocketSpin':  '#1F2937', // black w/ red star (using the black)
  'PlayMojo':    '#38BDF8', // light sky blue
  'Rollero':     '#B8860B', // dark gold/crown
}

// keyword → domain → country → record
type Lookup = Record<string, Record<string, Record<string, RankingRecord>>>

// ─── Entry ────────────────────────────────────────────────────────────────────

export function BPSites() {
  const ctx = useOutletContext<RROutletContext>()
  const { snapshots, bpFilterBrand, onSelectBPBrand, onDeleteSnapshot } = ctx
  const bpSnapshots = useMemo(
    () => snapshots.filter((s) => s.category === 'bp-sites'),
    [snapshots],
  )
  const activeBrand = bpFilterBrand ? BRAND_BY_NAME[bpFilterBrand] ?? null : null

  if (activeBrand) {
    return (
      <BrandView
        brand={activeBrand}
        snapshots={bpSnapshots}
        onBack={() => onSelectBPBrand(null)}
        onDeleteSnapshot={onDeleteSnapshot}
      />
    )
  }

  return <BrandGrid snapshots={bpSnapshots} onSelect={(b) => onSelectBPBrand(b.name)} />
}

// ─── Brand Grid (unchanged from prior) ────────────────────────────────────────

function BrandGrid({
  snapshots,
  onSelect,
}: {
  snapshots: Snapshot[]
  onSelect: (b: Brand) => void
}) {
  return (
    <div className="flex-1 overflow-auto px-7 pb-7 pt-5">
      <div className="grid grid-cols-3 gap-3.5">
        {BRANDS.map((brand, idx) => {
          const domainSet = new Set(brand.domains.map((d) => d.toLowerCase()))
          const hasData = snapshots.some((s) =>
            s.records.some((r) => domainSet.has(r.domain.toLowerCase())),
          )
          const c = GRID_BRAND_COLORS[brand.name] ?? brand.color

          return (
            <button
              key={brand.name}
              onClick={() => onSelect(brand)}
              className="bg-white border border-[#E2E8F0] rounded-[10px] p-5 text-left cursor-pointer relative overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:border-[#CBD5E1] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
              style={{ animationDelay: `${idx * 40}ms`, animation: 'fadeUp 0.25s ease both' }}
            >
              <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[10px]" style={{ background: c }} />

              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-[10px] flex items-center justify-center font-display text-[14px] text-white shrink-0"
                  style={{ background: c }}
                >
                  {brand.abbr}
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-bold text-[#0F172A]">{brand.name}</div>
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
                {brand.domains.map((d) => (
                  <div
                    key={d}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border"
                    style={{
                      borderColor: d.toLowerCase() === brand.mainDomain.toLowerCase() ? c + '60' : '#E2E8F0',
                      background: d.toLowerCase() === brand.mainDomain.toLowerCase() ? c + '14' : '#F8FAFC',
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ color: d.toLowerCase() === brand.mainDomain.toLowerCase() ? c : '#94A3B8', flexShrink: 0 }}>
                      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <span
                      className="text-[11px]  truncate"
                      style={{ color: d.toLowerCase() === brand.mainDomain.toLowerCase() ? '#0F172A' : '#64748B' }}
                    >
                      {d}
                    </span>
                    {d.toLowerCase() === brand.mainDomain.toLowerCase() && (
                      <span
                        className="ml-auto text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: c + '30', color: c }}
                      >
                        MAIN
                      </span>
                    )}
                  </div>
                ))}
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
  onBack,
  onDeleteSnapshot,
}: {
  brand: Brand
  snapshots: Snapshot[]
  onBack: () => void
  onDeleteSnapshot: (id: string) => void
}) {
  const brandDomainSet = useMemo(
    () => new Set(brand.domains.map((d) => d.toLowerCase())),
    [brand],
  )

  const mainDomain = brand.mainDomain.toLowerCase()
  const bpDomains  = useMemo(
    () => brand.domains.filter((d) => d.toLowerCase() !== mainDomain),
    [brand, mainDomain],
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
  const [activeCountries, setActiveCountries] = useState<string[]>(COUNTRY_ORDER)
  const [kwFilter, setKwFilter] = useState('')

  // Stats-date filter: 'all' resolves to the latest snapshot; otherwise the
  // selected snapshot id.
  const [statsFilter, setStatsFilter] = useState<string>('all')
  const statsSnap = useMemo(() => {
    if (statsFilter === 'all') return latestSnap
    return brandSnapshots.find((s) => s.id === statsFilter) ?? latestSnap
  }, [statsFilter, brandSnapshots, latestSnap])

  const toggleCountry = (c: string) => {
    setActiveCountries((prev) => {
      if (prev.includes(c) && prev.length === 1) return prev
      return prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    })
  }

  // Stats for the selected stats-date snapshot
  const stats = useMemo(() => {
    const recs = statsSnap?.records ?? []
    return {
      total:      recs.length,
      top3:       recs.filter((r) => { const p = parsePosition(r.position); return typeof p === 'number' && p <= 3 }).length,
      improved:   recs.filter((r) => (parseChange(r.change) ?? 0) > 0).length,
      dropped:    recs.filter((r) => (parseChange(r.change) ?? 0) < 0).length,
      notRanking: recs.filter((r) => parsePosition(r.position) === 'NR').length,
    }
  }, [statsSnap])

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
    return Object.keys(labels).filter((kl) => !filter || kl.includes(filter) || labels[kl].toLowerCase().includes(filter)).length
  }, [latestSnap, kwFilter])

  // Country columns honor the chip filter, but preserve canonical order
  const visibleCountries = COUNTRY_ORDER.filter((c) => activeCountries.includes(c))

  return (
    <>
      {/* Back + brand header */}
      <div className="flex items-center gap-3 px-7 pt-5 pb-3 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] text-[#64748B] hover:text-[#475569] transition-colors mr-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          All brands
        </button>

        <h1 className="font-display text-[20px] tracking-wider text-[#0F172A] leading-none">{brand.name}</h1>

        {brandSnapshots.length > 0 && (
          <div className="ml-auto">
            <StatsDateFilter
              value={statsFilter}
              snapshots={brandSnapshots}
              onChange={setStatsFilter}
            />
          </div>
        )}
      </div>

      {brandSnapshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center gap-4 px-7 pb-7">
          <p className="text-[14px] text-[#64748B] max-w-sm leading-relaxed">
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
          />

          {/* Inline filter bar — countries + keyword search (no domain chips
              since BP Sites lays every domain out as a matrix column) */}
          <div className="flex items-center gap-1.5 px-7 pb-3.5 shrink-0 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] mr-1">
              Countries
            </span>
            {COUNTRY_ORDER.map((c) => {
              const active = activeCountries.includes(c)
              return (
                <button
                  key={c}
                  onClick={() => toggleCountry(c)}
                  className="px-3 py-1 rounded-full text-[12px] font-mono border transition-all"
                  style={
                    active
                      ? { background: '#CBD5E1', color: '#0F172A', borderColor: 'transparent', fontWeight: 700 }
                      : { background: 'white', color: '#475569', borderColor: '#E2E8F0' }
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
                onChange={(e) => setKwFilter(e.target.value)}
                placeholder="Search keywords…"
                className="pl-7 pr-3 py-1 bg-[#F1F5F9] border border-[#E2E8F0] rounded-full text-[12px] text-[#0F172A] outline-none w-44 placeholder:text-[#64748B] focus:border-[#CBD5E1] transition-colors"
              />
            </div>

            <div className="ml-auto text-[11px] font-mono text-[#64748B]">
              {brandSnapshots.length} date{brandSnapshots.length !== 1 ? 's' : ''} · {latestKeywordCount} keyword{latestKeywordCount !== 1 ? 's' : ''} in latest · {brand.domains.length} site{brand.domains.length !== 1 ? 's' : ''}
              {' (1 main + ' + bpDomains.length + ' BP)'}
            </div>
          </div>

          {/* Stacked matrices — one table per uploaded date, newest first */}
          <div className="flex-1 overflow-auto px-7 pb-7 flex flex-col gap-6">
            {brandSnapshots.map((snap) => (
              <SnapshotMatrix
                key={snap.id}
                snapshot={snap}
                brand={brand}
                mainDomain={mainDomain}
                bpDomains={bpDomains}
                visibleCountries={visibleCountries}
                kwFilter={kwFilter}
                onDelete={onDeleteSnapshot}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ─── StatsDateFilter — small dropdown that scopes the StatsRow to a date ─────

function StatsDateFilter({
  value,
  snapshots,
  onChange,
}: {
  value: string                 // 'all' or snapshot id
  snapshots: Snapshot[]         // already filtered to brand snapshots (newest first)
  onChange: (next: string) => void
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
      <span className="absolute -top-4 left-0 text-[9px] uppercase tracking-[0.1em] font-semibold text-[#64748B]">
        Stats date
      </span>

      {/* Combobox: shows the selected label when closed, becomes a search
          input when open. No separate search bar inside the dropdown. */}
      <div
        onClick={() => { if (!open) setOpen(true) }}
        className={`flex items-center gap-2 bg-white border rounded-md pl-2.5 pr-2 py-1.5 text-[12px] text-[#0F172A] transition-colors cursor-text ${
          open ? 'border-[#0F172A]' : 'border-[#CBD5E1] hover:border-[#0F172A]'
        }`}
      >
        <CalendarDays size={13} strokeWidth={2.25} className="text-[#64748B] shrink-0" />
        {open ? (
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={label}
            aria-label="Search dates"
            className="bg-transparent outline-none flex-1 min-w-0 text-[12px] text-[#0F172A] placeholder:text-[#94A3B8] font-medium"
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
            className={`text-[#64748B] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1.5 bg-white border border-[#E2E8F0] rounded-md shadow-[0_12px_32px_rgba(15,23,42,0.12)] overflow-hidden z-20 min-w-[220px] animate-[modalIn_0.12s_ease]"
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
              <div className="border-t border-[#E2E8F0]" />
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
              <p className="px-3 py-3 text-[11px] text-[#94A3B8] text-center">
                No dates match “{query}”.
              </p>
            )}
          </div>
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
        selected ? 'bg-[#0F172A] text-white' : 'text-[#0F172A] hover:bg-[#F1F5F9]'
      }`}
    >
      <span className="font-medium">{label}</span>
      {selected && <Check size={13} strokeWidth={2.5} />}
    </button>
  )
}

// ─── SnapshotMatrix — one date's matrix table ─────────────────────────────────

function SnapshotMatrix({
  snapshot,
  brand,
  mainDomain,
  bpDomains,
  visibleCountries,
  kwFilter,
  onDelete,
}: {
  snapshot: Snapshot
  brand: Brand
  mainDomain: string
  bpDomains: string[]
  visibleCountries: string[]
  kwFilter: string
  onDelete: (id: string) => void
}) {
  const borderStyle = `1px solid ${TABLE_BORDER}`
  const mainColCount = 1 /* GSV */ + visibleCountries.length * 3 /* country + SV + AFF */
  const bpColCount   = visibleCountries.length

  // Sorted keyword list for this snapshot, with kw search applied
  const keywords = useMemo(() => {
    const seen = new Set<string>()
    const labels: Record<string, string> = {}
    for (const r of snapshot.records) {
      const kl = r.keyword.toLowerCase()
      if (!seen.has(kl)) { seen.add(kl); labels[kl] = r.keyword }
    }
    const filter = kwFilter.trim().toLowerCase()
    return Object.keys(labels)
      .filter((kl) => !filter || kl.includes(filter) || labels[kl].toLowerCase().includes(filter))
      .sort()
      .map((kl) => ({ key: kl, label: labels[kl] }))
  }, [snapshot, kwFilter])

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
      className="bg-white rounded-[6px] overflow-hidden text-black shrink-0"
      style={{ border: borderStyle }}
    >
      {/* Date band */}
      <div
        className="px-4 py-2 text-[13px] font-bold flex items-center justify-between"
        style={{ background: DATE_BAND_BG, color: DATE_BAND_FG }}
      >
        <span>{snapshot.displayDate}</span>
        <button
          onClick={() => onDelete(snapshot.id)}
          className="text-[11px] font-normal px-2 py-0.5 rounded hover:bg-[rgba(0,0,0,0.2)] transition-colors"
          title={`Delete snapshot for ${snapshot.displayDate}`}
        >
          ✕ Delete
        </button>
      </div>

      {/* Horizontal matrix */}
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px] w-max min-w-full">

          {/* Row 1 — Block label row (MAIN / BP per block) */}
          <thead>
            <tr>
              <th
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
              <th
                colSpan={mainColCount}
                className="px-3 py-2 text-center text-[11px] font-bold whitespace-nowrap"
                style={{
                  background: MAIN_HEADER_BG,
                  color: HEADER_FG,
                  borderRight: borderStyle,
                  borderBottom: borderStyle,
                }}
              >
                MAIN — <span className="">{brand.mainDomain}</span>
              </th>
              {bpDomains.map((bp, bpIdx) => {
                const palette = BP_PALETTE[bpIdx % BP_PALETTE.length]
                return (
                  <th
                    key={`bp-h-${bp}`}
                    colSpan={bpColCount}
                    className="px-3 py-2 text-center text-[11px] font-bold whitespace-nowrap"
                    style={{
                      background: palette.headerBg,
                      color: HEADER_FG,
                      borderRight: borderStyle,
                      borderBottom: borderStyle,
                    }}
                  >
                    BP — <span className="">{bp}</span>
                  </th>
                )
              })}
            </tr>

            {/* Row 2 — Country / spec sub-header */}
            <tr>
              <th
                className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em]"
                style={{
                  background: MAIN_HEADER_BG,
                  color: HEADER_FG,
                  borderRight: borderStyle,
                  borderBottom: borderStyle,
                }}
              >
                GSV
              </th>
              {visibleCountries.map((c, ci) => (
                <Fragment key={`main-sub-${c}`}>
                  <th
                    className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em]"
                    style={{
                      background: MAIN_HEADER_BG,
                      color: HEADER_FG,
                      borderLeft: ci === 0 ? undefined : borderStyle,
                      borderBottom: borderStyle,
                    }}
                  >
                    {c}
                  </th>
                  <th
                    className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em]"
                    style={{
                      background: MAIN_HEADER_BG,
                      color: HEADER_FG,
                      borderBottom: borderStyle,
                    }}
                  >
                    SV
                  </th>
                  <th
                    className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em]"
                    style={{
                      background: MAIN_HEADER_BG,
                      color: HEADER_FG,
                      borderRight: borderStyle,
                      borderBottom: borderStyle,
                    }}
                  >
                    AFF
                  </th>
                </Fragment>
              ))}
              {bpDomains.map((bp, bpIdx) => {
                const palette = BP_PALETTE[bpIdx % BP_PALETTE.length]
                return (
                  <Fragment key={`bp-sub-${bp}`}>
                    {visibleCountries.map((c, ci) => (
                      <th
                        key={`bp-sub-${bp}-${c}`}
                        className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em]"
                        style={{
                          background: palette.headerBg,
                          color: HEADER_FG,
                          borderLeft: ci === 0 ? borderStyle : borderStyle,
                          borderRight: ci === visibleCountries.length - 1 ? borderStyle : undefined,
                          borderBottom: borderStyle,
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

                {/* Keyword (sticky) */}
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

                {/* MAIN — GSV */}
                <td
                  className="px-2 py-1.5 text-center align-middle text-[11px] "
                  style={{
                    background: MAIN_AUX_BG,
                    color: '#6B7280',
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                  }}
                >
                  –
                </td>

                {/* MAIN — per-country triplets (country / SV / AFF) */}
                {visibleCountries.map((c, ci) => {
                  const rec = lookup?.[kw]?.[mainDomain]?.[c]
                  return (
                    <Fragment key={`main-cell-${kw}-${c}`}>
                      <td
                        className="px-2 py-1.5 text-center align-middle"
                        style={{
                          background: MAIN_CELL_BG,
                          borderLeft: ci === 0 ? undefined : borderStyle,
                          borderBottom: borderStyle,
                        }}
                      >
                        {rec ? <PosBadge record={rec} /> : <span className="text-[#6B7280] text-[11px]">–</span>}
                      </td>
                      <td
                        className="px-2 py-1.5 text-center text-[11px] "
                        style={{
                          background: MAIN_AUX_BG,
                          color: '#6B7280',
                          borderBottom: borderStyle,
                        }}
                      >
                        –
                      </td>
                      <td
                        className="px-2 py-1.5 text-center text-[11px] "
                        style={{
                          background: MAIN_AUX_BG,
                          color: '#6B7280',
                          borderRight: borderStyle,
                          borderBottom: borderStyle,
                        }}
                      >
                        –
                      </td>
                    </Fragment>
                  )
                })}

                {/* BP blocks */}
                {bpDomains.map((bp, bpIdx) => {
                  const dk = bp.toLowerCase()
                  const palette = BP_PALETTE[bpIdx % BP_PALETTE.length]
                  return visibleCountries.map((c, ci) => {
                    const rec = lookup?.[kw]?.[dk]?.[c]
                    return (
                      <td
                        key={`bp-cell-${kw}-${bp}-${c}`}
                        className="px-2 py-1.5 text-center align-middle"
                        style={{
                          background: palette.cellBg,
                          borderLeft: ci === 0 ? borderStyle : borderStyle,
                          borderRight: ci === visibleCountries.length - 1 ? borderStyle : undefined,
                          borderBottom: borderStyle,
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
