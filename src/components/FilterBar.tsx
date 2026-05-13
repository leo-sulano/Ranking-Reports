import { COUNTRY_LABELS } from '../lib/brands'

interface Props {
  countries: string[]
  domains: string[]
  activeCountries: string[]
  activeDomains: string[]
  kwFilter: string
  brandColor: string
  onToggleCountry: (c: string) => void
  onToggleDomain: (d: string) => void
  onKwFilter: (v: string) => void
}

export function FilterBar({
  countries,
  domains,
  activeCountries,
  activeDomains,
  kwFilter,
  brandColor,
  onToggleCountry,
  onToggleDomain,
  onKwFilter,
}: Props) {
  return (
    <div className="flex items-center gap-1.5 px-7 pb-3.5 shrink-0 flex-wrap">
      {/* Country filter */}
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] mr-1">
        Countries
      </span>
      {countries.map((c) => {
        const active = activeCountries.includes(c)
        return (
          <button
            key={c}
            onClick={() => onToggleCountry(c)}
            title={c}
            className="px-3 py-1 rounded-full text-[12px] font-mono border transition-all"
            style={
              active
                ? { background: brandColor, color: '#000', borderColor: 'transparent', fontWeight: 700 }
                : { background: 'transparent', color: '#64748B', borderColor: '#1C2B3A' }
            }
          >
            {COUNTRY_LABELS[c] ?? c}
          </button>
        )
      })}

      <div className="w-px h-5 bg-[#1C2B3A] mx-1" />

      {/* Domain filter — each chip shows/hides the domain's column group */}
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] mr-1">
        Domains
      </span>
      {domains.map((d) => {
        const active = activeDomains.includes(d)
        return (
          <button
            key={d}
            onClick={() => onToggleDomain(d)}
            title={d}
            className={`px-3 py-1 rounded-full text-[11px] font-mono border transition-all max-w-[200px] truncate ${
              active
                ? 'bg-[#111928] text-[#E2E8F0] border-[#243548]'
                : 'bg-transparent text-[#64748B] border-[#1C2B3A] hover:border-[#243548] hover:text-[#94A3B8]'
            }`}
          >
            {d}
          </button>
        )
      })}

      <div className="w-px h-5 bg-[#1C2B3A] mx-1" />

      {/* Keyword search */}
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
          onChange={(e) => onKwFilter(e.target.value)}
          placeholder="Search keywords…"
          className="pl-7 pr-3 py-1 bg-[#111928] border border-[#1C2B3A] rounded-full text-[12px] text-[#E2E8F0] outline-none w-44 placeholder:text-[#64748B] focus:border-[#243548] transition-colors"
        />
      </div>
    </div>
  )
}
