import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { BRANDS, COUNTRY_LABELS } from '../lib/brands'
import { parsePosition } from '../lib/parser'
import { PosBadge } from '../components/PosBadge'
import type { Brand, RankingRecord, RROutletContext, Snapshot } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const COUNTRY_ORDER = ['AU', 'CA', 'DE', 'IT', 'NZ'] as const
type CountryCode = typeof COUNTRY_ORDER[number]

const COUNTRY_NAMES: Record<CountryCode, string> = {
  AU: 'Australia',
  CA: 'Canada',
  DE: 'Germany',
  IT: 'Italy',
  NZ: 'New Zealand',
}

const MAIN_HEADER_BG = '#B4A7D6'
const MAIN_CELL_BG   = '#D9D2E9'
const TABLE_BORDER   = '#B0B7BD'
const STICKY_KW_BG   = '#FFFFFF'
const DATE_BAND_BG   = '#5894CD'
const DATE_BAND_FG   = '#FFFFFF'
const HEADER_FG      = '#000000'

// Same palette as BPSites — BP partner domains
const BP_PALETTE: Array<{ headerBg: string; cellBg: string }> = [
  { headerBg: '#CCCCCC', cellBg: '#D9D9D9' },
  { headerBg: '#FFD966', cellBg: '#FFECB2' },
  { headerBg: '#93C47D', cellBg: '#D9EAD3' },
  { headerBg: '#C27BA0', cellBg: '#EAD1DC' },
]

// Visually distinct palette for LP domains (cyan/orange/cornflower/lightblue)
const LP_PALETTE: Array<{ headerBg: string; cellBg: string }> = [
  { headerBg: '#76A5AF', cellBg: '#D0E0E3' },
  { headerBg: '#E69138', cellBg: '#F9CB9C' },
  { headerBg: '#6FA8DC', cellBg: '#C9DAF8' },
  { headerBg: '#A4C2F4', cellBg: '#D9E1F2' },
  { headerBg: '#76A5AF', cellBg: '#D0E0E3' },
  { headerBg: '#E69138', cellBg: '#F9CB9C' },
  { headerBg: '#6FA8DC', cellBg: '#C9DAF8' },
  { headerBg: '#A4C2F4', cellBg: '#D9E1F2' },
  { headerBg: '#76A5AF', cellBg: '#D0E0E3' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

// keyword.toLowerCase() → domain.toLowerCase() → record
type DomainLookup = Record<string, Record<string, RankingRecord>>

function filterByCountry(records: RankingRecord[], code: string): RankingRecord[] {
  return records.filter(
    (r) => (COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()) === code,
  )
}

function buildDomainLookup(records: RankingRecord[]): DomainLookup {
  const map: DomainLookup = {}
  for (const r of records) {
    const kk = r.keyword.toLowerCase()
    const dk = r.domain.toLowerCase()
    if (!map[kk]) map[kk] = {}
    map[kk][dk] = r
  }
  return map
}

function latestSnap(snapshots: Snapshot[], category: string): Snapshot | null {
  const hits = snapshots
    .filter((s) => s.category === category)
    .sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime())
  return hits[0] ?? null
}

function prevSnap(snapshots: Snapshot[], category: string): Snapshot | null {
  const hits = snapshots
    .filter((s) => s.category === category)
    .sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime())
  return hits[1] ?? null
}

// ─── Entry ────────────────────────────────────────────────────────────────────

export function Countries() {
  const { code = 'au' } = useParams<{ code: string }>()
  return <CountriesPage key={code} />
}

function CountriesPage() {
  const ctx = useOutletContext<RROutletContext>()
  const { code = 'au' } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [kwFilter, setKwFilter] = useState('')

  const countryCode = code.toUpperCase() as CountryCode
  const isValid = (COUNTRY_ORDER as readonly string[]).includes(countryCode)

  useEffect(() => {
    if (!isValid) navigate('/countries/au', { replace: true })
  }, [isValid, navigate])

  const bpSnap  = useMemo(() => latestSnap(ctx.snapshots, 'bp-sites'), [ctx.snapshots])
  const prevBp  = useMemo(() => prevSnap(ctx.snapshots,   'bp-sites'), [ctx.snapshots])
  const lpSnap  = useMemo(() => latestSnap(ctx.snapshots, 'lp-sites'), [ctx.snapshots])
  const prevLp  = useMemo(() => prevSnap(ctx.snapshots,   'lp-sites'), [ctx.snapshots])

  const bpRecs     = useMemo(() => filterByCountry(bpSnap?.records ?? [], countryCode), [bpSnap, countryCode])
  const lpRecs     = useMemo(() => filterByCountry(lpSnap?.records ?? [], countryCode), [lpSnap, countryCode])
  const prevBpRecs = useMemo(() => filterByCountry(prevBp?.records ?? [], countryCode), [prevBp, countryCode])
  const prevLpRecs = useMemo(() => filterByCountry(prevLp?.records ?? [], countryCode), [prevLp, countryCode])

  if (!isValid) return null

  const noData = bpRecs.length === 0 && lpRecs.length === 0
  const countryName = COUNTRY_NAMES[countryCode]

  return (
    <div
      className="flex-1 flex flex-col min-h-0"
    >
      {/* ── Page header ── */}
      <div className="px-3 sm:px-7 pt-4 sm:pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="font-display text-[20px] tracking-wider text-[#0F172A] leading-none">
            {countryName}
          </h1>
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#F1F5F9] text-[#64748B] select-none">
            {countryCode}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Country chips */}
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] mr-1">Countries</span>
          {COUNTRY_ORDER.map((c) => (
            <button
              key={c}
              onClick={() => navigate(`/countries/${c.toLowerCase()}`)}
              className="px-3 py-1 rounded-full text-[12px] font-sans border transition-all"
              style={
                c === countryCode
                  ? { background: '#CBD5E1', color: '#0F172A', borderColor: 'transparent', fontWeight: 700 }
                  : { background: 'white', color: '#475569', borderColor: '#E2E8F0' }
              }
            >
              {c}
            </button>
          ))}

          {/* Keyword search */}
          <div className="ml-auto relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#64748B]"
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={kwFilter}
              onChange={(e) => setKwFilter(e.target.value)}
              placeholder="Search keywords…"
              className="pl-7 pr-3 py-1 bg-[#F1F5F9] border border-[#E2E8F0] rounded-full text-[12px] text-[#0F172A] outline-none w-36 sm:w-44 placeholder:text-[#64748B] focus:border-[#CBD5E1] transition-colors"
            />
          </div>
        </div>
      </div>

      {/* ── Brand tables ── */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-7 pb-7 space-y-6">
        {noData ? (
          <div className="flex items-center justify-center h-40 text-[#94A3B8] text-[14px]">
            No data for {countryCode} — upload a snapshot to get started.
          </div>
        ) : (
          BRANDS.map((brand) => {
            const bpDomSet = new Set(brand.domains.map((d) => d.toLowerCase()))
            const lpDomSet = new Set((brand.lpDomains ?? []).map((d) => d.toLowerCase()))
            const brandBpRecs     = bpRecs.filter((r) => bpDomSet.has(r.domain.toLowerCase()))
            const brandLpRecs     = lpRecs.filter((r) => lpDomSet.has(r.domain.toLowerCase()))
            const brandPrevBpRecs = prevBpRecs.filter((r) => bpDomSet.has(r.domain.toLowerCase()))
            const brandPrevLpRecs = prevLpRecs.filter((r) => lpDomSet.has(r.domain.toLowerCase()))

            if (brandBpRecs.length === 0 && brandLpRecs.length === 0) return null

            return (
              <CountryBrandTable
                key={brand.name}
                brand={brand}
                bpRecords={brandBpRecs}
                lpRecords={brandLpRecs}
                prevBpRecords={brandPrevBpRecs}
                prevLpRecords={brandPrevLpRecs}
                kwFilter={kwFilter}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── CountryBrandTable ────────────────────────────────────────────────────────

function CountryBrandTable({
  brand,
  bpRecords,
  lpRecords,
  prevBpRecords,
  prevLpRecords,
  kwFilter,
}: {
  brand: Brand
  bpRecords: RankingRecord[]
  lpRecords: RankingRecord[]
  prevBpRecords: RankingRecord[]
  prevLpRecords: RankingRecord[]
  kwFilter: string
}) {
  const scrollRef     = useRef<HTMLDivElement>(null)
  const kwColRef      = useRef<HTMLTableCellElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [scrollRightPad, setScrollRightPad] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setScrolled(el.scrollLeft > 4)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const scrollEl = scrollRef.current
    const kwEl     = kwColRef.current
    if (!scrollEl || !kwEl) return
    const rows   = scrollEl.querySelectorAll('thead tr')
    const lastTh = rows.length >= 2
      ? (rows[1].querySelector('th:last-child') as HTMLElement | null)
      : null
    if (!lastTh) return
    const pad = Math.max(0, scrollEl.clientWidth - kwEl.offsetWidth - lastTh.offsetWidth)
    setScrollRightPad(prev => prev === pad ? prev : pad)
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

  const bpLookup     = useMemo(() => buildDomainLookup(bpRecords),     [bpRecords])
  const lpLookup     = useMemo(() => buildDomainLookup(lpRecords),     [lpRecords])
  const prevBpLookup = useMemo(() => buildDomainLookup(prevBpRecords), [prevBpRecords])
  const prevLpLookup = useMemo(() => buildDomainLookup(prevLpRecords), [prevLpRecords])
  const hasPrev    = prevBpRecords.length > 0 || prevLpRecords.length > 0

  // Columns: only domains that have at least 1 record for this country
  const activeBpDomainSet = useMemo(() => new Set(bpRecords.map((r) => r.domain.toLowerCase())), [bpRecords])
  const activeLpDomainSet = useMemo(() => new Set(lpRecords.map((r) => r.domain.toLowerCase())), [lpRecords])

  const mainDomain    = brand.mainDomain.toLowerCase()
  const showMain      = activeBpDomainSet.has(mainDomain)
  const activeBpDoms  = brand.domains
    .filter((d) => d.toLowerCase() !== mainDomain && activeBpDomainSet.has(d.toLowerCase()))
  const activeLpDoms  = (brand.lpDomains ?? [])
    .filter((d) => activeLpDomainSet.has(d.toLowerCase()))

  // Keywords: union of all keywords from bp + lp records, filtered by kwFilter
  const keywords = useMemo(() => {
    const seen: Record<string, string> = {}
    for (const r of [...bpRecords, ...lpRecords]) {
      const kl = r.keyword.toLowerCase()
      if (!seen[kl]) seen[kl] = r.keyword
    }
    const filter = kwFilter.trim().toLowerCase()
    return Object.keys(seen)
      .filter((kl) => !filter || kl.includes(filter) || seen[kl].toLowerCase().includes(filter))
      .sort()
      .map((kl) => ({ key: kl, label: seen[kl] }))
  }, [bpRecords, lpRecords, kwFilter])

  if (keywords.length === 0) return null

  const borderStyle = `1px solid ${TABLE_BORDER}`

  const totalDoms = (showMain ? 1 : 0) + activeBpDoms.length + activeLpDoms.length

  return (
    <div className="rounded-xl overflow-hidden shadow-lg" style={{ border: borderStyle }}>
      {/* Brand header band */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 shrink-0"
        style={{ background: DATE_BAND_BG, color: DATE_BAND_FG }}
      >
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: brand.color }} />
        <span className="font-bold text-[13px] tracking-wide">{brand.name}</span>
        <span className="ml-auto font-mono text-[11px] opacity-70">
          {keywords.length} kw · {totalDoms} domain{totalDoms !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Scrollable table */}
      <div ref={scrollRef} className="overflow-x-auto" style={{ background: '#fff' }}>
        <table
          className="border-collapse text-[12px] w-max min-w-full"
          style={scrollRightPad > 0 ? { marginRight: scrollRightPad } : undefined}
        >
          <thead>
            {/* Row 1 — group labels */}
            <tr>
              <th
                ref={kwColRef}
                rowSpan={2}
                className="sticky left-0 z-[6] px-3 py-2 text-left align-bottom whitespace-nowrap"
                style={{
                  background: STICKY_KW_BG,
                  borderRight: borderStyle,
                  borderBottom: borderStyle,
                  color: HEADER_FG,
                  minWidth: 160,
                  boxShadow: scrolled ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
                }}
              >
                KEYWORD
              </th>

              {showMain && (
                <th
                  className="px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{
                    background: MAIN_HEADER_BG,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                  }}
                >
                  MAIN
                </th>
              )}

              {activeBpDoms.length > 0 && (
                <th
                  colSpan={activeBpDoms.length}
                  className="px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{
                    background: BP_PALETTE[0].headerBg,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: borderStyle,
                    borderBottom: 'none',
                  }}
                >
                  BP Sites
                </th>
              )}

              {activeLpDoms.length > 0 && (
                <th
                  colSpan={activeLpDoms.length}
                  className="px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{
                    background: LP_PALETTE[0].headerBg,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: borderStyle,
                    borderBottom: 'none',
                  }}
                >
                  LP Sites
                </th>
              )}

            </tr>

            {/* Row 2 — domain names */}
            <tr>
              {showMain && (
                <th
                  className="px-2 py-1 text-center text-[10px] font-semibold whitespace-nowrap"
                  style={{
                    background: MAIN_HEADER_BG,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                    maxWidth: 140,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {brand.mainDomain}
                </th>
              )}

              {activeBpDoms.map((d, i) => (
                <th
                  key={d}
                  className="px-2 py-1 text-center text-[10px] font-semibold whitespace-nowrap"
                  style={{
                    background: BP_PALETTE[i % BP_PALETTE.length].headerBg,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: i === activeBpDoms.length - 1 ? borderStyle : undefined,
                    borderBottom: borderStyle,
                    maxWidth: 140,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {d}
                </th>
              ))}

              {activeLpDoms.map((d, i) => (
                <th
                  key={d}
                  className="px-2 py-1 text-center text-[10px] font-semibold whitespace-nowrap"
                  style={{
                    background: LP_PALETTE[i % LP_PALETTE.length].headerBg,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: i === activeLpDoms.length - 1 ? borderStyle : undefined,
                    borderBottom: borderStyle,
                    maxWidth: 140,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {d}
                </th>
              ))}

            </tr>
          </thead>

          <tbody>
            {keywords.map(({ key: kw, label }) => (
              <tr key={kw}>
                {/* Sticky keyword cell */}
                <td
                  className="sticky left-0 z-[5] px-3 py-2 font-semibold whitespace-nowrap"
                  style={{
                    background: STICKY_KW_BG,
                    color: '#000',
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                    boxShadow: scrolled ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
                  }}
                >
                  {label}
                </td>

                {/* MAIN cell */}
                {showMain && (() => {
                  const rec    = bpLookup[kw]?.[mainDomain]
                  const prevPos = hasPrev ? parsePosition(prevBpLookup[kw]?.[mainDomain]?.position ?? '') : undefined
                  return (
                    <td
                      key={`main-${kw}`}
                      className="px-2 py-1.5 text-center align-middle min-w-[100px]"
                      style={{
                        background: MAIN_CELL_BG,
                        borderLeft: borderStyle,
                        borderRight: borderStyle,
                        borderBottom: borderStyle,
                      }}
                    >
                      {rec
                        ? <PosBadge record={rec} crossSnapPrevPos={prevPos} />
                        : <span className="text-[#6B7280] text-[11px]">–</span>}
                    </td>
                  )
                })()}

                {/* BP cells */}
                {activeBpDoms.map((d, i) => {
                  const dk     = d.toLowerCase()
                  const rec    = bpLookup[kw]?.[dk]
                  const prevPos = hasPrev ? parsePosition(prevBpLookup[kw]?.[dk]?.position ?? '') : undefined
                  return (
                    <td
                      key={`bp-${kw}-${d}`}
                      className="px-2 py-1.5 text-center align-middle min-w-[100px]"
                      style={{
                        background: BP_PALETTE[i % BP_PALETTE.length].cellBg,
                        borderLeft: borderStyle,
                        borderRight: i === activeBpDoms.length - 1 ? borderStyle : undefined,
                        borderBottom: borderStyle,
                      }}
                    >
                      {rec
                        ? <PosBadge record={rec} crossSnapPrevPos={prevPos} />
                        : <span className="text-[#6B7280] text-[11px]">–</span>}
                    </td>
                  )
                })}

                {/* LP cells */}
                {activeLpDoms.map((d, i) => {
                  const dk     = d.toLowerCase()
                  const rec    = lpLookup[kw]?.[dk]
                  const prevPos = hasPrev ? parsePosition(prevLpLookup[kw]?.[dk]?.position ?? '') : undefined
                  return (
                    <td
                      key={`lp-${kw}-${d}`}
                      className="px-2 py-1.5 text-center align-middle min-w-[100px]"
                      style={{
                        background: LP_PALETTE[i % LP_PALETTE.length].cellBg,
                        borderLeft: borderStyle,
                        borderRight: i === activeLpDoms.length - 1 ? borderStyle : undefined,
                        borderBottom: borderStyle,
                      }}
                    >
                      {rec
                        ? <PosBadge record={rec} crossSnapPrevPos={prevPos} />
                        : <span className="text-[#6B7280] text-[11px]">–</span>}
                    </td>
                  )
                })}

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
