import { Fragment, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Brand, RankingRecord, Snapshot } from '../types'
import { BRANDS, BRAND_BY_NAME } from '../lib/brands'
import type { RROutletContext } from './RankingReports'
import { PosBadge } from '../components/PosBadge'

const COUNTRY_ORDER = ['AU', 'CA', 'DE', 'IT', 'NZ']

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
                  <div className="text-[11px] font-mono text-[#64748B]">{brand.mainDomain}</div>
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
                      className="text-[11px] font-mono truncate"
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

  // Per-snapshot lookup table
  const lookupBySnapshot = useMemo(() => {
    const map: Record<string, Lookup> = {}
    for (const snap of brandSnapshots) {
      const lookup: Lookup = {}
      for (const r of snap.records) {
        const kk = r.keyword.toLowerCase()
        const dk = r.domain.toLowerCase()
        if (!lookup[kk]) lookup[kk] = {}
        if (!lookup[kk][dk]) lookup[kk][dk] = {}
        lookup[kk][dk][r.country.toUpperCase()] = r
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
          className="flex items-center gap-1.5 text-[12px] text-[#64748B] hover:text-[#94A3B8] transition-colors mr-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          All brands
        </button>

        <div
          className="w-10 h-10 rounded-[10px] flex items-center justify-center font-display text-[14px] text-black shrink-0"
          style={{ background: brand.color }}
        >
          {brand.abbr}
        </div>
        <div>
          <h1 className="font-display text-[20px] tracking-wider text-[#E2E8F0] leading-none">{brand.name}</h1>
          <p className="text-[11px] font-mono text-[#64748B] mt-0.5">{brand.mainDomain}</p>
        </div>
      </div>

      {brandSnapshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <div
            className="w-14 h-14 rounded-[14px] flex items-center justify-center font-display text-[18px] text-black opacity-40"
            style={{ background: brand.color }}
          >
            {brand.abbr}
          </div>
          <p className="text-[14px] text-[#64748B] max-w-sm leading-relaxed">
            No ranking data for {brand.name} yet. Import a data export to populate this view.
          </p>
        </div>
      ) : (
        <>
          <div className="text-[11px] font-mono text-[#64748B] mb-3">
            {brandSnapshots.length} snapshot{brandSnapshots.length !== 1 ? 's' : ''}
            {' · '}{keywords.length} keyword{keywords.length !== 1 ? 's' : ''}
            {' · '}{brand.domains.length} website{brand.domains.length !== 1 ? 's' : ''}
            {' (1 main + ' + bpDomains.length + ' BP)'}
          </div>

          <div className="flex flex-col gap-7">
            {brandSnapshots.map((snap, snapIdx) => {
              const lookup = lookupBySnapshot[snap.id]
              return (
                <div key={snap.id} className="bg-[#0D1421] border border-[#1C2B3A] rounded-[10px] overflow-hidden">

                  {/* Date band */}
                  <div
                    className="px-4 py-2.5 text-[13px] font-display tracking-wider font-bold flex items-center"
                    style={{
                      background: `${brand.color}18`,
                      color: brand.color,
                      borderLeft: `3px solid ${brand.color}`,
                    }}
                  >
                    {snap.displayDate}
                    {snapIdx === 0 && (
                      <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-[#F59E0B] text-black font-bold">
                        LATEST
                      </span>
                    )}
                  </div>

                  {/* Horizontal matrix */}
                  <div className="overflow-x-auto">
                    <table className="border-collapse text-[12px] w-max min-w-full">

                      {/* Block-header row: MAIN + BP labels with domain */}
                      <thead>
                        <tr className="bg-[#111928]">
                          <th
                            rowSpan={2}
                            className="sticky left-0 z-10 text-left px-3 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#64748B] border-b border-r border-[#1C2B3A] whitespace-nowrap bg-[#111928]"
                            style={{ minWidth: 180 }}
                          >
                            Keyword
                          </th>
                          <th
                            colSpan={mainColCount}
                            className="px-3 py-2 text-center text-[11px] font-bold border-b border-r border-[#1C2B3A] whitespace-nowrap"
                            style={{ background: `${brand.color}18`, color: brand.color }}
                          >
                            MAIN SITE — <span className="font-mono text-[11px]">{brand.mainDomain}</span>
                          </th>
                          {bpDomains.map((bp) => (
                            <th
                              key={`bp-h-${bp}`}
                              colSpan={bpColCount}
                              className="px-3 py-2 text-center text-[11px] font-bold border-b border-r border-[#1C2B3A] whitespace-nowrap text-[#94A3B8] bg-[#0A0F1A]"
                            >
                              BP SITE — <span className="font-mono text-[11px]">{bp}</span>
                            </th>
                          ))}
                        </tr>

                        {/* Country / spec sub-header */}
                        <tr className="bg-[#0A0F1A]">
                          <th
                            className="px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#64748B] border-b border-r border-[#1C2B3A]"
                          >
                            GSV
                          </th>
                          {COUNTRY_ORDER.map((c, ci) => (
                            <Fragment key={`main-${c}`}>
                              <th
                                className={`px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.1em] border-b border-[#1C2B3A] ${ci === 0 ? '' : 'border-l border-[#1C2B3A]'}`}
                                style={{ color: brand.color }}
                              >
                                {c}
                              </th>
                              <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#64748B] border-b border-[#1C2B3A]">
                                SV
                              </th>
                              <th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#64748B] border-b border-r border-[#1C2B3A]">
                                AFF
                              </th>
                            </Fragment>
                          ))}
                          {bpDomains.map((bp) => (
                            <Fragment key={`bp-sub-${bp}`}>
                              {COUNTRY_ORDER.map((c, ci) => (
                                <th
                                  key={`bp-sub-${bp}-${c}`}
                                  className={`px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#94A3B8] border-b border-[#1C2B3A] ${ci === 0 ? 'border-l border-[#1C2B3A]' : ''} ${ci === COUNTRY_ORDER.length - 1 ? 'border-r border-[#1C2B3A]' : ''}`}
                                >
                                  {c}
                                </th>
                              ))}
                            </Fragment>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {keywords.map(({ key: kw, label }, kwIdx) => {
                          const rowBg = kwIdx % 2 === 0 ? '#0A0F1A' : '#0D1421'
                          return (
                            <tr key={kw} style={{ background: rowBg }} className="border-b border-[#1C2B3A] hover:bg-[#151F30] group">

                              {/* Keyword (sticky) */}
                              <td
                                className="sticky left-0 z-[5] px-3 py-2 font-semibold text-[#E2E8F0] whitespace-nowrap border-r border-[#1C2B3A] group-hover:bg-[#151F30]"
                                style={{ background: rowBg }}
                              >
                                {label}
                              </td>

                              {/* MAIN block */}
                              <td className="px-2 py-1.5 text-center align-middle text-[10px] text-[#1C2B3A] font-mono border-r border-[#1C2B3A]">
                                –
                              </td>
                              {COUNTRY_ORDER.map((c, ci) => {
                                const rec = lookup?.[kw]?.[mainDomain]?.[c]
                                return (
                                  <Fragment key={`main-cell-${kw}-${c}`}>
                                    <td
                                      className={`px-2 py-1.5 text-center align-middle ${ci === 0 ? '' : 'border-l border-[#1C2B3A]'}`}
                                      style={{ background: `${brand.color}06` }}
                                    >
                                      {rec ? <PosBadge record={rec} /> : <span className="text-[#1C2B3A] font-mono text-[10px]">–</span>}
                                    </td>
                                    <td className="px-2 py-1.5 text-center text-[10px] text-[#1C2B3A] font-mono">–</td>
                                    <td className="px-2 py-1.5 text-center text-[10px] text-[#1C2B3A] font-mono border-r border-[#1C2B3A]">–</td>
                                  </Fragment>
                                )
                              })}

                              {/* BP blocks */}
                              {bpDomains.map((bp) => {
                                const dk = bp.toLowerCase()
                                return COUNTRY_ORDER.map((c, ci) => {
                                  const rec = lookup?.[kw]?.[dk]?.[c]
                                  return (
                                    <td
                                      key={`bp-cell-${kw}-${bp}-${c}`}
                                      className={`px-2 py-1.5 text-center align-middle ${ci === 0 ? 'border-l border-[#1C2B3A]' : ''} ${ci === COUNTRY_ORDER.length - 1 ? 'border-r border-[#1C2B3A]' : ''}`}
                                    >
                                      {rec ? <PosBadge record={rec} /> : <span className="text-[#1C2B3A] font-mono text-[10px]">–</span>}
                                    </td>
                                  )
                                })
                              })}
                            </tr>
                          )
                        })}
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
