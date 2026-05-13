import { useMemo } from 'react'
import type { Brand, RankingRecord } from '../types'
import { COUNTRY_LABELS } from '../lib/brands'
import { PosBadge } from './PosBadge'

// lookup[keyword_lower][domain_lower][country] = record
type Lookup = Record<string, Record<string, Record<string, RankingRecord>>>

interface Props {
  brand: Brand
  records: RankingRecord[]       // already filtered for this brand
  activeCountries: string[]
  activeDomains: string[]
  kwFilter: string
}

function buildLookup(
  records: RankingRecord[],
  domains: Set<string>,
  countries: Set<string>,
): { lookup: Lookup; keywords: string[]; keywordLabels: Record<string, string> } {
  const lookup: Lookup = {}
  const keywordLabels: Record<string, string> = {}

  records.forEach((r) => {
    if (!domains.has(r.domain.toLowerCase())) return
    if (!countries.has(r.country)) return

    const kw = r.keyword.toLowerCase()
    keywordLabels[kw] = r.keyword   // preserve original casing
    if (!lookup[kw]) lookup[kw] = {}
    const dk = r.domain.toLowerCase()
    if (!lookup[kw][dk]) lookup[kw][dk] = {}
    lookup[kw][dk][r.country] = r
  })

  const keywords = Object.keys(lookup).sort()
  return { lookup, keywords, keywordLabels }
}

export function RankingTable({ brand, records, activeCountries, activeDomains, kwFilter }: Props) {
  const countries = useMemo(() => [...activeCountries].sort(), [activeCountries])

  const domainSet  = useMemo(() => new Set(activeDomains), [activeDomains])
  const countrySet = useMemo(() => new Set(activeCountries), [activeCountries])

  const { lookup, keywords, keywordLabels } = useMemo(
    () => buildLookup(records, domainSet, countrySet),
    [records, domainSet, countrySet],
  )

  const filteredKeywords = useMemo(() => {
    const f = kwFilter.toLowerCase().trim()
    return f ? keywords.filter((kw) => kw.includes(f)) : keywords
  }, [keywords, kwFilter])

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-4xl opacity-30 mb-4">📊</div>
        <div className="font-display text-[28px] tracking-wider text-[#94A3B8]">No Data Yet</div>
        <p className="text-[14px] text-[#64748B] mt-2 max-w-sm leading-relaxed">
          Upload your ranking data export to see positions for {brand.name}.
        </p>
      </div>
    )
  }

  // Each domain gets N country sub-columns
  const totalCols = activeDomains.length * countries.length

  return (
    <div
      className="bg-[#0D1421] border border-[#1C2B3A] rounded-[10px] overflow-auto"
      style={{ maxHeight: 'calc(100vh - 280px)' }}
    >
      <table className="border-collapse text-[12px]" style={{ minWidth: `${200 + totalCols * 90}px` }}>
        <thead className="sticky top-0 z-20">
          {/* Row 1: Domain names spanning country sub-cols */}
          <tr className="bg-[#0D1421]">
            <th
              rowSpan={2}
              className="sticky left-0 z-30 bg-[#0D1421] px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-[#64748B] border-b border-r border-[#1C2B3A] min-w-[200px] whitespace-nowrap"
            >
              Keyword
            </th>
            {activeDomains.map((domain) => (
              <th
                key={domain}
                colSpan={countries.length}
                className="px-3 py-2 text-center text-[11px] font-semibold font-mono border-b border-l border-[#1C2B3A] whitespace-nowrap"
                style={{
                  color: domain === brand.mainDomain.toLowerCase() ? brand.color : '#94A3B8',
                  background: domain === brand.mainDomain.toLowerCase()
                    ? `${brand.color}12`
                    : '#0D1421',
                }}
              >
                {domain}
                {domain === brand.mainDomain.toLowerCase() && (
                  <span
                    className="ml-1.5 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                    style={{ background: brand.color + '30', color: brand.color }}
                  >
                    MAIN
                  </span>
                )}
              </th>
            ))}
          </tr>

          {/* Row 2: Country codes */}
          <tr className="bg-[#111928]">
            {activeDomains.map((domain) =>
              countries.map((country, cIdx) => (
                <th
                  key={`${domain}-${country}`}
                  className={`px-2 py-2 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[#64748B] border-b border-[#1C2B3A] min-w-[80px] ${
                    cIdx === 0 ? 'border-l border-[#1C2B3A]' : ''
                  }`}
                >
                  {COUNTRY_LABELS[country] ?? country}
                </th>
              )),
            )}
          </tr>
        </thead>

        <tbody>
          {filteredKeywords.length === 0 && (
            <tr>
              <td
                colSpan={1 + totalCols}
                className="text-center px-4 py-8 text-[13px] text-[#64748B]"
              >
                No keywords match &ldquo;
                <strong className="text-[#94A3B8]">{kwFilter}</strong>&rdquo;
              </td>
            </tr>
          )}

          {filteredKeywords.map((kw, kwIdx) => {
            const isLast = kwIdx === filteredKeywords.length - 1
            return (
              <tr
                key={kw}
                className={`transition-colors hover:bg-[#151F30] group ${
                  !isLast ? 'border-b border-[#1C2B3A]' : ''
                }`}
              >
                {/* Sticky keyword cell */}
                <td className="sticky left-0 z-10 bg-[#0D1421] px-4 py-2.5 font-semibold text-[#E2E8F0] whitespace-nowrap border-r border-[#1C2B3A] group-hover:bg-[#151F30]">
                  {keywordLabels[kw]}
                </td>

                {/* Domain × Country cells */}
                {activeDomains.map((domain, dIdx) =>
                  countries.map((country, cIdx) => {
                    const rec = lookup[kw]?.[domain]?.[country]
                    const isFirstColOfDomain = cIdx === 0
                    return (
                      <td
                        key={`${domain}-${country}`}
                        className={`px-2 py-1.5 text-center align-middle ${
                          isFirstColOfDomain ? 'border-l border-[#1C2B3A]' : ''
                        }`}
                        style={
                          domain === brand.mainDomain.toLowerCase()
                            ? { background: `${brand.color}06` }
                            : undefined
                        }
                      >
                        {rec ? <PosBadge record={rec} /> : (
                          <span className="text-[#1C2B3A] font-mono text-[10px]">–</span>
                        )}
                      </td>
                    )
                  }),
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
