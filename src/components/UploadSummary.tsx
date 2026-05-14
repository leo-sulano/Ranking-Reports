import { useMemo, useState } from 'react'
import type { RankingRecord, Snapshot } from '../types'
import { BRAND_BY_NAME, COUNTRY_LABELS, DOMAIN_TO_BRAND } from '../lib/brands'
import { ChevronDown, X, AlertCircle, Globe, Building2 } from 'lucide-react'

export interface UploadSummaryData {
  displayDate: string
  records: RankingRecord[]
  allSnapshots: Snapshot[]
}

interface Props {
  data: UploadSummaryData
  onClose: () => void
}

// ─── Aggregation ──────────────────────────────────────────────────────────────
//
// Build a Brand → Domain → Country count tree, plus the flat totals shown in
// the stats cards. One pass over records is enough.

interface BrandNode {
  name:    string
  total:   number
  domains: DomainNode[]
}
interface DomainNode {
  domain:    string
  total:     number
  countries: { code: string; count: number }[]
}

function aggregate(records: RankingRecord[]) {
  // brand → domain → country → count
  const tree = new Map<string, Map<string, Map<string, number>>>()
  let unknown = 0
  const countrySet = new Set<string>()
  const domainSet  = new Set<string>()

  for (const r of records) {
    const dk = r.domain.toLowerCase()
    domainSet.add(dk)
    const brand = DOMAIN_TO_BRAND[dk]
    if (!brand) { unknown++; continue }

    const country = (r.country && (COUNTRY_LABELS[r.country] ?? r.country.toUpperCase())) || '—'
    if (r.country) countrySet.add(country)

    let byDomain = tree.get(brand)
    if (!byDomain) { byDomain = new Map(); tree.set(brand, byDomain) }
    let byCountry = byDomain.get(dk)
    if (!byCountry) { byCountry = new Map(); byDomain.set(dk, byCountry) }
    byCountry.set(country, (byCountry.get(country) ?? 0) + 1)
  }

  // Sort: brands by total desc, domains by total desc, countries by canonical order
  const COUNTRY_ORDER = ['AU', 'CA', 'DE', 'IT', 'NZ']
  const orderIdx = (c: string) => {
    const i = COUNTRY_ORDER.indexOf(c)
    return i === -1 ? 999 : i
  }

  const brands: BrandNode[] = []
  for (const [brand, byDomain] of tree.entries()) {
    const domains: DomainNode[] = []
    let brandTotal = 0
    for (const [domain, byCountry] of byDomain.entries()) {
      const countries = Array.from(byCountry.entries())
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => orderIdx(a.code) - orderIdx(b.code))
      const total = countries.reduce((s, c) => s + c.count, 0)
      brandTotal += total
      domains.push({ domain, total, countries })
    }
    domains.sort((a, b) => b.total - a.total)
    brands.push({ name: brand, total: brandTotal, domains })
  }
  brands.sort((a, b) => b.total - a.total)

  return {
    brands,
    unknown,
    domainCount:  domainSet.size,
    countryCount: countrySet.size,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UploadSummary({ data, onClose }: Props) {
  const { displayDate, records, allSnapshots } = data
  const { brands, unknown, domainCount, countryCount } = useMemo(
    () => aggregate(records),
    [records],
  )

  const totalRecordsInDb   = allSnapshots.reduce((sum, s) => sum + s.records.length, 0)
  const totalSnapshotsInDb = allSnapshots.length

  // All brands expanded by default — first impression should reveal everything
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(brands.map((b) => b.name)))
  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-md z-50 flex items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white border border-[#E2E8F0] rounded-[14px] w-[600px] max-w-[95vw] max-h-[88vh] overflow-hidden shadow-[0_40px_80px_rgba(15,23,42,0.18)] animate-[modalIn_0.2s_ease] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E2E8F0] shrink-0">
          <div>
            <h2 className="font-display text-[18px] tracking-wider text-[#0F172A] leading-none">
              Import Summary
            </h2>
            <p className="text-[11px] text-[#64748B] mt-1.5">
              {displayDate} · {records.length.toLocaleString()} record{records.length !== 1 ? 's' : ''} uploaded
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center bg-[#F1F5F9] border border-[#E2E8F0] rounded-md text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1] transition-all"
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto">
          {/* Stats cards */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            <Stat label="Uploaded"  value={records.length} />
            <Stat label="Brands"    value={brands.length} />
            <Stat label="Domains"   value={domainCount} />
            <Stat label="Countries" value={countryCount} />
          </div>

          {unknown > 0 && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2 bg-[rgba(244,63,94,0.08)] border border-[rgba(244,63,94,0.3)] rounded-md">
              <AlertCircle size={13} strokeWidth={2.25} className="text-[#F43F5E] shrink-0 mt-0.5" />
              <p className="text-[12px] text-[#F43F5E] leading-snug">
                {unknown.toLocaleString()} record{unknown !== 1 ? 's' : ''} had a domain not in CONFIG and were ignored.
              </p>
            </div>
          )}

          {/* Distribution tree */}
          <div className="mb-5">
            <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B] mb-2">
              Distribution
            </div>

            {brands.length === 0 ? (
              <p className="text-[12px] text-[#64748B] py-3 text-center bg-[#F8FAFC] border border-[#E2E8F0] rounded-md">
                No matching brands in this upload.
              </p>
            ) : (
              <div className="space-y-2">
                {brands.map((b) => (
                  <BrandRow
                    key={b.name}
                    node={b}
                    open={expanded.has(b.name)}
                    onToggle={() => toggle(b.name)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* DB totals */}
          <div className="pt-4 border-t border-[#E2E8F0]">
            <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-[#64748B] mb-2">
              Database after upload
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total snapshots" value={totalSnapshotsInDb} muted />
              <Stat label="Total records"   value={totalRecordsInDb}   muted />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#E2E8F0] shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#0F172A] text-white rounded-md text-[12px] font-bold hover:bg-[#1E293B] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Stat({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-md px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.1em] text-[#64748B] mb-0.5">{label}</div>
      <div
        className="text-[20px] font-bold font-mono"
        style={{ color: muted ? '#94A3B8' : '#0F172A' }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function BrandRow({
  node,
  open,
  onToggle,
}: {
  node: BrandNode
  open: boolean
  onToggle: () => void
}) {
  const brand = BRAND_BY_NAME[node.name]
  const color = brand?.color ?? '#94A3B8'

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#F8FAFC] transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronDown
            size={14}
            strokeWidth={2.25}
            className={`text-[#64748B] shrink-0 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
          />
          <Building2 size={13} strokeWidth={2} className="shrink-0" style={{ color }} />
          <span className="text-[13px] font-semibold text-[#0F172A] truncate">{node.name}</span>
          <span className="text-[10px] font-mono text-[#64748B] shrink-0">
            {node.domains.length} site{node.domains.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-[12px] font-mono font-semibold text-[#0F172A] shrink-0">
          {node.total.toLocaleString()}
        </span>
      </button>

      {open && (
        <div className="border-t border-[#E2E8F0] bg-[#F8FAFC]">
          {node.domains.map((d, i) => (
            <DomainRow key={d.domain} node={d} divider={i > 0} />
          ))}
        </div>
      )}
    </div>
  )
}

function DomainRow({ node, divider }: { node: DomainNode; divider: boolean }) {
  return (
    <div className={`px-3 py-2 ${divider ? 'border-t border-[#E2E8F0]' : ''}`}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Globe size={11} strokeWidth={2} className="text-[#94A3B8] shrink-0" />
          <span className="font-mono text-[12px] text-[#0F172A] truncate">{node.domain}</span>
        </div>
        <span className="font-mono text-[11px] text-[#64748B] shrink-0">
          {node.total.toLocaleString()}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 pl-[18px]">
        {node.countries.map((c) => (
          <span
            key={c.code}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-[#E2E8F0] rounded font-mono text-[10px] text-[#475569]"
          >
            <span className="font-semibold text-[#0F172A]">{c.code}</span>
            <span className="text-[#94A3B8]">·</span>
            <span>{c.count.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
