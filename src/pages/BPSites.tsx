import { Fragment, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Brand, RankingRecord, Snapshot } from '../types'
import { BRANDS, BRAND_BY_NAME, COUNTRY_LABELS } from '../lib/brands'
import type { RROutletContext } from './RankingReports'
import { PosBadge } from '../components/PosBadge'

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

// keyword → domain → country → record
type Lookup = Record<string, Record<string, Record<string, RankingRecord>>>

// ─── Entry ────────────────────────────────────────────────────────────────────

export function BPSites() {
  const { snapshots, bpFilterBrand, onSelectBPBrand } = useOutletContext<RROutletContext>()
  const activeBrand = bpFilterBrand ? BRAND_BY_NAME[bpFilterBrand] ?? null : null

  if (activeBrand) {
    return (
      <BrandView
        brand={activeBrand}
        snapshots={snapshots}
        onBack={() => onSelectBPBrand(null)}
      />
    )
  }

  return <BrandGrid snapshots={snapshots} onSelect={(b) => onSelectBPBrand(b.name)} />
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
        {BRANDS.map((brand, idx) => {
          const domainSet = new Set(brand.domains.map((d) => d.toLowerCase()))
          const hasData = snapshots.some((s) =>
            s.records.some((r) => domainSet.has(r.domain.toLowerCase())),
          )

          return (
            <button
              key={brand.name}
              onClick={() => onSelect(brand)}
              className="bg-[#0D1421] border border-[#1C2B3A] rounded-[10px] p-5 text-left cursor-pointer relative overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:border-[#243548] hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
              style={{ animationDelay: `${idx * 40}ms`, animation: 'fadeUp 0.25s ease both' }}
            >
              <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[10px]" style={{ background: brand.color }} />

              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-[10px] flex items-center justify-center font-display text-[14px] text-black shrink-0"
                  style={{ background: brand.color }}
                >
                  {brand.abbr}
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-bold text-[#E2E8F0]">{brand.name}</div>
                  <div className="text-[11px]  text-[#64748B]">{brand.mainDomain}</div>
                </div>
                {hasData && (
                  <span
                    className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: brand.color + '20', color: brand.color }}
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
                      borderColor: d.toLowerCase() === brand.mainDomain.toLowerCase() ? brand.color + '50' : '#1C2B3A',
                      background: d.toLowerCase() === brand.mainDomain.toLowerCase() ? brand.color + '0D' : '#07090F',
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ color: d.toLowerCase() === brand.mainDomain.toLowerCase() ? brand.color : '#374151', flexShrink: 0 }}>
                      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <span
                      className="text-[11px]  truncate"
                      style={{ color: d.toLowerCase() === brand.mainDomain.toLowerCase() ? '#E2E8F0' : '#64748B' }}
                    >
                      {d}
                    </span>
                    {d.toLowerCase() === brand.mainDomain.toLowerCase() && (
                      <span
                        className="ml-auto text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: brand.color + '30', color: brand.color }}
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
}: {
  brand: Brand
  snapshots: Snapshot[]
  onBack: () => void
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

  // Per-snapshot records, filtered to this brand only
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

  // Sorted keyword list across every snapshot for this brand
  const keywords = useMemo(() => {
    const seen = new Set<string>()
    const labels: Record<string, string> = {}
    for (const snap of brandSnapshots) {
      for (const r of snap.records) {
        const kl = r.keyword.toLowerCase()
        if (!seen.has(kl)) { seen.add(kl); labels[kl] = r.keyword }
      }
    }
    return Object.keys(labels).sort().map((kl) => ({ key: kl, label: labels[kl] }))
  }, [brandSnapshots])

  // Per-snapshot lookup table. Country is normalized to a 2-letter code so
  // records that arrived from earlier uploads with full names ("Australia")
  // still match the COUNTRY_ORDER axis ("AU").
  const lookupBySnapshot = useMemo(() => {
    const map: Record<string, Lookup> = {}
    for (const snap of brandSnapshots) {
      const lookup: Lookup = {}
      for (const r of snap.records) {
        const kk = r.keyword.toLowerCase()
        const dk = r.domain.toLowerCase()
        const ck = COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()
        if (!lookup[kk]) lookup[kk] = {}
        if (!lookup[kk][dk]) lookup[kk][dk] = {}
        lookup[kk][dk][ck] = r
      }
      map[snap.id] = lookup
    }
    return map
  }, [brandSnapshots])

  const mainColCount = 1 /* GSV */ + COUNTRY_ORDER.length * 3 /* country + SV + AFF */
  const bpColCount   = COUNTRY_ORDER.length

  return (
    <div className="flex-1 overflow-auto px-7 pb-7 pt-5">

      {/* Back + brand header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] text-[#64748B] hover:text-[#94A3B8] transition-colors mr-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          All brands
        </button>

        <div>
          <h1 className="font-display text-[20px] tracking-wider text-[#E2E8F0] leading-none">{brand.name}</h1>
          <p className="text-[11px]  text-[#64748B] mt-0.5">{brand.mainDomain}</p>
        </div>
      </div>

      {brandSnapshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <p className="text-[14px] text-[#64748B] max-w-sm leading-relaxed">
            No ranking data for {brand.name} yet. Import a data export to populate this view.
          </p>
        </div>
      ) : (
        <>
          <div className="text-[11px]  text-[#64748B] mb-3">
            {brandSnapshots.length} snapshot{brandSnapshots.length !== 1 ? 's' : ''}
            {' · '}{keywords.length} keyword{keywords.length !== 1 ? 's' : ''}
            {' · '}{brand.domains.length} website{brand.domains.length !== 1 ? 's' : ''}
            {' (1 main + ' + bpDomains.length + ' BP)'}
          </div>

          <div className="flex flex-col gap-7">
            {brandSnapshots.map((snap) => {
              const lookup = lookupBySnapshot[snap.id]
              const borderStyle = `1px solid ${TABLE_BORDER}`
              return (
                <div
                  key={snap.id}
                  className="bg-white rounded-[6px] overflow-hidden text-black"
                  style={{ border: borderStyle }}
                >

                  {/* Date band */}
                  <div
                    className="px-4 py-2 text-[13px] font-bold flex items-center"
                    style={{ background: DATE_BAND_BG, color: DATE_BAND_FG }}
                  >
                    {snap.displayDate}
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
                          {COUNTRY_ORDER.map((c, ci) => (
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
                                {COUNTRY_ORDER.map((c, ci) => (
                                  <th
                                    key={`bp-sub-${bp}-${c}`}
                                    className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.1em]"
                                    style={{
                                      background: palette.headerBg,
                                      color: HEADER_FG,
                                      borderLeft: ci === 0 ? borderStyle : borderStyle,
                                      borderRight: ci === COUNTRY_ORDER.length - 1 ? borderStyle : undefined,
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
                            {COUNTRY_ORDER.map((c, ci) => {
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
                              return COUNTRY_ORDER.map((c, ci) => {
                                const rec = lookup?.[kw]?.[dk]?.[c]
                                return (
                                  <td
                                    key={`bp-cell-${kw}-${bp}-${c}`}
                                    className="px-2 py-1.5 text-center align-middle"
                                    style={{
                                      background: palette.cellBg,
                                      borderLeft: ci === 0 ? borderStyle : borderStyle,
                                      borderRight: ci === COUNTRY_ORDER.length - 1 ? borderStyle : undefined,
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
            })}
          </div>
        </>
      )}
    </div>
  )
}
