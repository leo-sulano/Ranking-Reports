import { useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Brand, RankingRecord, Snapshot } from '../types'
import { BRANDS, COUNTRY_LABELS } from '../lib/brands'
import type { RROutletContext } from './RankingReports'
import { PosBadge } from '../components/PosBadge'

const COUNTRY_ORDER = ['AU', 'CA', 'DE', 'IT', 'NZ']
type Lookup = Record<string, Record<string, Record<string, RankingRecord>>>

// ─── Entry ────────────────────────────────────────────────────────────────────

export function BPSites() {
  const { snapshots, bpFilterBrand } = useOutletContext<RROutletContext>()
  const [activeBrand, setActiveBrand] = useState<Brand | null>(null)

  if (activeBrand) {
    return (
      <BrandView
        brand={activeBrand}
        snapshots={snapshots}
        onBack={() => setActiveBrand(null)}
      />
    )
  }

  return <BrandGrid snapshots={snapshots} onSelect={setActiveBrand} filterBrand={bpFilterBrand} />
}

// ─── Brand Grid ───────────────────────────────────────────────────────────────

function BrandGrid({
  snapshots,
  onSelect,
  filterBrand,
}: {
  snapshots: Snapshot[]
  onSelect: (b: Brand) => void
  filterBrand: string | null
}) {
  const visibleBrands = filterBrand ? BRANDS.filter((b) => b.name === filterBrand) : BRANDS

  return (
    <div className="flex-1 overflow-auto px-7 pb-7 pt-5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
        {visibleBrands.map((brand, idx) => {
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
              {/* Color bar */}
              <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[10px]" style={{ background: brand.color }} />

              {/* Header */}
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

              {/* Websites list */}
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

// ─── Brand Detail View ────────────────────────────────────────────────────────

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

  const domainsWithData = useMemo(
    () =>
      brand.domains.filter((d) =>
        brandSnapshots.some((snap) =>
          snap.records.some((r) => r.domain.toLowerCase() === d.toLowerCase()),
        ),
      ),
    [brand, brandSnapshots],
  )

  const domainCountries = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const domain of domainsWithData) {
      const seen = new Set<string>()
      for (const snap of brandSnapshots) {
        for (const r of snap.records) {
          if (r.domain.toLowerCase() === domain.toLowerCase()) seen.add(r.country)
        }
      }
      map[domain] = COUNTRY_ORDER.filter((c) => seen.has(c))
    }
    return map
  }, [domainsWithData, brandSnapshots])

  const allKeywords = useMemo(() => {
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

  const totalCols = domainsWithData.reduce((sum, d) => sum + (domainCountries[d]?.length ?? 0), 0)

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
            {' · '}{allKeywords.length} keyword{allKeywords.length !== 1 ? 's' : ''}
            {' · '}{domainsWithData.length} domain{domainsWithData.length !== 1 ? 's' : ''}
          </div>

          <div
            className="bg-[#0D1421] border border-[#1C2B3A] rounded-[10px] overflow-auto"
            style={{ maxHeight: 'calc(100vh - 230px)' }}
          >
            <table className="border-collapse text-[12px]" style={{ minWidth: `${200 + totalCols * 90}px` }}>
              <thead className="sticky top-0 z-20">
                <tr className="bg-[#0D1421]">
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-30 bg-[#0D1421] text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#64748B] border-b border-r border-[#1C2B3A] whitespace-nowrap"
                    style={{ minWidth: 200 }}
                  >
                    Keyword
                  </th>
                  {domainsWithData.map((domain) => {
                    const isMain = domain.toLowerCase() === brand.mainDomain.toLowerCase()
                    return (
                      <th
                        key={domain}
                        colSpan={domainCountries[domain]?.length ?? 1}
                        className="px-3 py-2.5 text-center text-[11px] font-semibold font-mono border-b border-l border-[#1C2B3A] whitespace-nowrap"
                        style={{
                          color: isMain ? brand.color : '#94A3B8',
                          background: isMain ? `${brand.color}12` : '#0D1421',
                          borderTop: `2px solid ${isMain ? brand.color : '#1C2B3A'}`,
                        }}
                      >
                        {domain}
                        {isMain && (
                          <span className="ml-1.5 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                            style={{ background: brand.color + '30', color: brand.color }}>
                            MAIN
                          </span>
                        )}
                      </th>
                    )
                  })}
                </tr>
                <tr className="bg-[#111928]">
                  {domainsWithData.map((domain) =>
                    (domainCountries[domain] ?? []).map((country, cIdx) => (
                      <th
                        key={`${domain}-${country}`}
                        className={`px-2 py-2 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#64748B] border-b border-[#1C2B3A] min-w-[80px] ${cIdx === 0 ? 'border-l border-[#1C2B3A]' : ''}`}
                      >
                        {COUNTRY_LABELS[country] ?? country}
                      </th>
                    )),
                  )}
                </tr>
              </thead>

              <tbody>
                {brandSnapshots.map((snap, snapIdx) => {
                  const lookup: Lookup = {}
                  for (const r of snap.records) {
                    const kk = r.keyword.toLowerCase()
                    const dk = r.domain.toLowerCase()
                    if (!lookup[kk]) lookup[kk] = {}
                    if (!lookup[kk][dk]) lookup[kk][dk] = {}
                    lookup[kk][dk][r.country] = r
                  }
                  return (
                    <>
                      <tr key={`date-${snap.id}`}>
                        <td
                          colSpan={totalCols + 1}
                          className="px-4 py-2 text-[13px] font-display tracking-wider font-bold border-b border-t border-[#1C2B3A]"
                          style={{ background: `${brand.color}18`, color: brand.color, borderLeft: `3px solid ${brand.color}` }}
                        >
                          {snap.displayDate}
                          {snapIdx === 0 && (
                            <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full bg-[#F59E0B] text-black font-bold align-middle">
                              LATEST
                            </span>
                          )}
                        </td>
                      </tr>
                      {allKeywords.map(({ key: kw, label }, kwIdx) => (
                        <tr
                          key={`${snap.id}-${kw}`}
                          className="border-b border-[#1C2B3A] transition-colors hover:bg-[#151F30] group"
                          style={{ background: kwIdx % 2 === 0 ? '#0A0F1A' : '#0D1421' }}
                        >
                          <td
                            className="sticky left-0 z-10 px-4 py-2 font-semibold text-[#E2E8F0] whitespace-nowrap border-r border-[#1C2B3A] group-hover:bg-[#151F30]"
                            style={{ background: kwIdx % 2 === 0 ? '#0A0F1A' : '#0D1421' }}
                          >
                            {label}
                          </td>
                          {domainsWithData.map((domain) =>
                            (domainCountries[domain] ?? []).map((country, cIdx) => {
                              const rec = lookup[kw]?.[domain.toLowerCase()]?.[country]
                              const isMain = domain.toLowerCase() === brand.mainDomain.toLowerCase()
                              return (
                                <td
                                  key={`${domain}-${country}`}
                                  className={`px-2 py-1.5 text-center align-middle ${cIdx === 0 ? 'border-l border-[#1C2B3A]' : ''}`}
                                  style={isMain ? { background: `${brand.color}06` } : undefined}
                                >
                                  {rec ? <PosBadge record={rec} /> : <span className="text-[#1C2B3A] font-mono text-[10px]">–</span>}
                                </td>
                              )
                            }),
                          )}
                        </tr>
                      ))}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
