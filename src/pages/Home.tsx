import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, brandToSlug } from '../lib/brands'
import { parsePosition, parseChange } from '../lib/parser'
import type { Brand, RankingRecord, RROutletContext } from '../types'

type ModalTier = 'p1' | 'top3' | 'top10'

function brandOfDomain(domain: string): string | undefined {
  return DOMAIN_TO_BRAND[domain.toLowerCase()]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Home() {
  const ctx = useOutletContext<RROutletContext>()
  const navigate = useNavigate()

  const [kwModal, setKwModal] = useState<{
    brand: Brand
    tier: ModalTier
    records: RankingRecord[]
  } | null>(null)

  const [metricModal, setMetricModal] = useState<'keywords' | 'brands' | 'countries' | null>(null)

  useEffect(() => {
    if (!kwModal && !metricModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setKwModal(null); setMetricModal(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kwModal, metricModal])

  const latestSnapshot = ctx.snapshots.find((s) => s.category === 'bp-sites') ?? ctx.snapshots[0]
  const records: RankingRecord[] = latestSnapshot?.records ?? []

  const totals = useMemo(() => {
    const keywords  = new Set(records.map((r) => r.keyword.toLowerCase()))
    const countries = new Set(records.map((r) => r.country))
    const brandSet  = new Set<string>()
    for (const r of records) {
      const b = brandOfDomain(r.domain)
      if (b) brandSet.add(b)
    }
    return {
      records:   records.length,
      keywords:  keywords.size,
      brands:    brandSet.size,
      countries: countries.size,
      snapshots: ctx.snapshots.length,
    }
  }, [records, ctx.snapshots])

  const tier = useMemo(() => {
    let p1 = 0, top3 = 0, top10 = 0, page2 = 0, nr = 0
    for (const r of records) {
      const p = parsePosition(r.position)
      if (p === 1) { p1 += 1; top3 += 1; top10 += 1 }
      else if (p === 2 || p === 3) { top3 += 1; top10 += 1 }
      else if (typeof p === 'number' && p >= 4 && p <= 10) { top10 += 1 }
      else if (typeof p === 'number' && p >= 11) { page2 += 1 }
      else if (p === 'NR') { nr += 1 }
    }
    return { p1, top3, top10, page2, nr }
  }, [records])

  const page1Pct = totals.records ? Math.round((tier.top10 / totals.records) * 100) : 0

  const metricDetails = useMemo(() => {
    const kwMap    = new Map<string, number>()
    const ctyMap   = new Map<string, number>()
    const brandMap = new Map<string, { brand: Brand; count: number }>()
    for (const r of records) {
      const kw = r.keyword
      kwMap.set(kw, (kwMap.get(kw) ?? 0) + 1)
      ctyMap.set(r.country, (ctyMap.get(r.country) ?? 0) + 1)
      const bName = brandOfDomain(r.domain)
      if (bName) {
        const brand = BRAND_BY_NAME[bName]
        if (brand) brandMap.set(bName, { brand, count: (brandMap.get(bName)?.count ?? 0) + 1 })
      }
    }
    return {
      keywords:  [...kwMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kw, count]) => ({ kw, count })),
      countries: [...ctyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([country, count]) => ({ country, count })),
      brands:    [...brandMap.values()].sort((a, b) => b.count - a.count),
    }
  }, [records])

  const leaderboard = useMemo(() => {
    // Only use bp-sites snapshots (mirrors what BP Sites page shows) sorted newest-first
    const bpSnaps = ctx.snapshots
      .filter((s) => s.category === 'bp-sites')
      .sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime())

    function computeRows(snaps: typeof bpSnaps) {
      return BRANDS.map((brand) => {
        const main = brand.mainDomain.toLowerCase()
        // Exclude main domain — BP Sites stats only count BP partner domains
        const bpSet = new Set(
          brand.domains.filter((d) => d.toLowerCase() !== main).map((d) => d.toLowerCase())
        )
        // Use the most recent bp-sites snapshot that has records for this brand
        let own: RankingRecord[] = []
        for (const snap of snaps) {
          const found = snap.records.filter((r) => bpSet.has(r.domain.toLowerCase()))
          if (found.length > 0) { own = found; break }
        }
        let p1 = 0, t3 = 0, t10 = 0
        for (const r of own) {
          const p = parsePosition(r.position)
          if (p === 1) { p1 += 1; t3 += 1; t10 += 1 }
          else if (p === 2 || p === 3) { t3 += 1; t10 += 1 }
          else if (typeof p === 'number' && p >= 4 && p <= 10) { t10 += 1 }
        }
        return { brand, total: own.length, p1, t3, t10, records: own }
      })
        .filter((row) => row.total > 0)
        .sort((a, b) => b.t10 - a.t10 || b.total - a.total)
    }

    const current = computeRows(bpSnaps)

    // Build previous rank map by recomputing without the newest snapshot
    const prevRankMap = new Map<string, number>()
    if (bpSnaps.length >= 2) {
      computeRows(bpSnaps.slice(1)).forEach((row, i) => {
        prevRankMap.set(row.brand.name, i + 1)
      })
    }

    return current.map((row, i) => {
      const prevRank = prevRankMap.get(row.brand.name)
      const rankChange = prevRank !== undefined ? prevRank - (i + 1) : null
      const cvg = row.total > 0 ? Math.round((row.t10 / row.total) * 100) : 0
      return { ...row, rankChange, cvg }
    })
  }, [ctx.snapshots])

  const movers = useMemo(() => {
    type Mover = { record: RankingRecord; delta: number; brand: string }
    const list: Mover[] = []
    for (const r of records) {
      const d = parseChange(r.change)
      if (d === null || d === 0) continue
      const b = brandOfDomain(r.domain) ?? '—'
      list.push({ record: r, delta: d, brand: b })
    }
    const climbers = list.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3)
    const droppers = list.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3)
    return { climbers, droppers }
  }, [records])

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!latestSnapshot) {
    return (
      <div className="flex-1 overflow-auto flex items-center justify-center bg-[#F7F7F5]">
        <div className="text-center max-w-[280px]" style={{ animation: 'fadeUp 0.4s ease both' }}>
          <div className="w-16 h-16 rounded-2xl bg-white border border-[#E5E4DF] shadow-sm flex items-center justify-center mx-auto mb-5">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D0D0CA" strokeWidth="1.5">
              <path d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/>
            </svg>
          </div>
          <h2 className="font-display text-[18px] font-[700] text-[#0A0A0A] mb-2">No data yet</h2>
          <p className="text-[13px] text-[#ABABAA] mb-6 leading-relaxed">Import a ranking snapshot to begin tracking positions across brands.</p>
          <button
            onClick={ctx.onOpenUpload}
            className="px-5 py-1.5 bg-[#CC0000] text-white text-[13px] font-semibold rounded-xl hover:bg-[#AA0000] transition-all active:scale-95"
          >
            Import data
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-[#F7F7F5]">
      <div className="px-3 sm:px-6 py-4 sm:py-5 space-y-4">

        {/* ── Hero metric cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4" style={{ animation: 'fadeUp 0.35s ease both' }}>

          {/* Keywords — solid black (top band of flag) */}
          <div
            className="relative rounded-xl px-4 sm:px-6 py-4 sm:py-5 overflow-hidden bg-[#0A0A0A] cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all duration-150 select-none"
            onClick={() => setMetricModal('keywords')}
          >
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 bg-white" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">Keywords</div>
            <div className="font-display text-[28px] sm:text-[38px] font-[600] text-white tabular-nums leading-none">
              {totals.keywords.toLocaleString()}
            </div>
            <div className="absolute bottom-3 right-4 text-white/20 text-[11px] font-medium">View list →</div>
          </div>

          {/* Brands — red card */}
          <div
            className="relative rounded-xl px-4 sm:px-6 py-4 sm:py-5 overflow-hidden cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all duration-150 select-none"
            style={{ background: '#CC0000' }}
            onClick={() => setMetricModal('brands')}
          >
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 bg-white" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60 mb-2">Brands</div>
            <div className="font-display text-[28px] sm:text-[38px] font-[600] text-white tabular-nums leading-none">
              {totals.brands}
            </div>
            <div className="absolute bottom-3 right-4 text-white/30 text-[11px] font-medium">View list →</div>
          </div>

          {/* Countries — #ffcc00 card */}
          <div
            className="relative rounded-xl px-4 sm:px-6 py-4 sm:py-5 overflow-hidden cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all duration-150 select-none"
            style={{ background: '#ffcc00' }}
            onClick={() => setMetricModal('countries')}
          >
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 bg-black" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-black/50 mb-2">Countries</div>
            <div className="font-display text-[28px] sm:text-[38px] font-[600] text-[#0A0A0A] tabular-nums leading-none">
              {totals.countries}
            </div>
            <div className="absolute bottom-3 right-4 text-black/20 text-[11px] font-medium">View list →</div>
          </div>
        </div>

        {/* ── Leaderboard + Movers ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">

          {/* Brand Leaderboard */}
          <section
            className="bg-white rounded-2xl border border-[#E5E4DF] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden"
            style={{ animation: 'fadeUp 0.35s ease 0.1s both' }}
          >
            <SectionHeader title="Brand Leaderboard" subtitle="Ranked by Top-10 keyword count" />
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#F5F4EF]">
                    <th className="pl-5 pr-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ABABAA] w-10">#</th>
                    <th className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ABABAA]">Brand</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ABABAA]">P1</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#CC0000]">Top-3</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#E86600]">Top-10</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ABABAA]">CVG%</th>
                    <th className="pl-3 pr-5 py-1.5 w-[96px] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ABABAA]">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-[12px] text-[#ABABAA]">
                        No brand data in current snapshot.
                      </td>
                    </tr>
                  )}
                  {leaderboard.map((row, i) => {
                    const maxT10 = leaderboard[0].t10 || 1
                    const share  = row.t10 / maxT10
                    const MEDALS = ['🥇', '🥈', '🥉']
                    const brandUrl = `/bp-sites/${brandToSlug(row.brand.name)}`
                    return (
                      <tr
                        key={row.brand.name}
                        className="border-b border-[#F8F7F2] hover:bg-[#FAF9F4] transition-colors group"
                        style={{ animation: `fadeUp 0.35s ease ${0.12 + i * 0.025}s both` }}
                      >
                        <td
                          className="pl-5 pr-2 py-0 cursor-pointer"
                          onClick={() => navigate(brandUrl)}
                        >
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[11px] text-[#ABABAA] tabular-nums">
                              {i < 3 ? MEDALS[i] : String(i + 1).padStart(2, '0')}
                            </span>
                            {row.rankChange === null || row.rankChange === 0 ? (
                              <span className="font-mono text-[9px] text-[#D0CFC9]">—</span>
                            ) : row.rankChange > 0 ? (
                              <span className="font-mono text-[9px] font-semibold text-[#1A7A3A]">↑{row.rankChange}</span>
                            ) : (
                              <span className="font-mono text-[9px] font-semibold text-[#CC0000]">↓{Math.abs(row.rankChange)}</span>
                            )}
                          </div>
                        </td>
                        <td
                          className="px-3 py-0 cursor-pointer"
                          onClick={() => navigate(brandUrl)}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-[3px] h-7 rounded-full shrink-0" style={{ background: row.brand.color }} />
                            <span className="text-[13px] font-medium truncate group-hover:underline text-[#0A0A0A]">
                              {row.brand.name}
                            </span>
                          </div>
                        </td>
                        <td
                          className="px-3 py-0 text-right font-mono text-[13px] tabular-nums font-medium text-[#0A0A0A] cursor-pointer hover:text-[#1E40AF] hover:underline"
                          onClick={() => row.p1 > 0 && setKwModal({ brand: row.brand, tier: 'p1', records: row.records })}
                          title={row.p1 > 0 ? 'View P1 keywords' : undefined}
                        >
                          {row.p1 || <span className="text-[#D8D7D2] no-underline">—</span>}
                        </td>
                        <td
                          className="px-3 py-0 text-right font-mono text-[13px] tabular-nums font-medium text-[#CC0000] cursor-pointer hover:text-[#991b1b] hover:underline"
                          onClick={() => row.t3 > 0 && setKwModal({ brand: row.brand, tier: 'top3', records: row.records })}
                          title={row.t3 > 0 ? 'View Top-3 keywords' : undefined}
                        >
                          {row.t3 || <span className="text-[#D8D7D2] no-underline">—</span>}
                        </td>
                        <td
                          className="px-3 py-0 text-right font-mono text-[13px] tabular-nums font-medium text-[#E86600] cursor-pointer hover:text-[#9a3412] hover:underline"
                          onClick={() => row.t10 > 0 && setKwModal({ brand: row.brand, tier: 'top10', records: row.records })}
                          title={row.t10 > 0 ? 'View Top-10 keywords' : undefined}
                        >
                          {row.t10 || <span className="text-[#D8D7D2] no-underline">—</span>}
                        </td>
                        <td
                          className="px-3 py-0 text-right font-mono text-[12px] tabular-nums text-[#8A8A85] cursor-pointer hover:text-[#0A0A0A] hover:underline"
                          onClick={() => navigate(brandUrl)}
                          title={`${row.t10} of ${row.total} keywords in Top-10`}
                        >
                          {row.cvg}%
                        </td>
                        <td
                          className="pl-3 pr-5 py-0 cursor-pointer"
                          onClick={() => navigate(brandUrl)}
                        >
                          <div className="h-[3px] bg-[#F0EFEA] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${share * 100}%`, background: row.brand.color }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Top Movers */}
          <section
            className="bg-white rounded-2xl border border-[#E5E4DF] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden"
            style={{ animation: 'fadeUp 0.35s ease 0.13s both' }}
          >
            <SectionHeader title="Top Movers" subtitle="vs. previous snapshot" />
            <div className="px-5 py-4 space-y-4">
              <MoverGroup
                label="Climbers"
                tint="#1A7A3A"
                bgTint="#F0FAF4"
                borderTint="#BBE8CC"
                rows={movers.climbers}
                empty="No upward movement."
              />
              <div className="h-px bg-[#F0EFEA]" />
              <MoverGroup
                label="Droppers"
                tint="#CC0000"
                bgTint="#FFF5F5"
                borderTint="#FFCCCC"
                rows={movers.droppers}
                empty="No downward movement."
              />
            </div>
          </section>

        </div>

        {/* ── Navigate ─────────────────────────────────────────────────────── */}
        <section
          className="bg-white rounded-2xl border border-[#E5E4DF] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden"
          style={{ animation: 'fadeUp 0.35s ease 0.18s both' }}
        >
          <SectionHeader title="Navigate" subtitle="Jump into a workspace" />
          <div className="grid grid-cols-2 gap-3 p-5">
            <NavCard label="BP Sites"    hint="Brand × keyword matrix"  onClick={() => navigate('/bp-sites')} />
            <NavCard label="FTDs"        hint="First-time depositors"   onClick={() => navigate('/ftds')} />
            <NavCard label="Import Data" hint="Upload an XLSX snapshot" onClick={ctx.onOpenUpload} highlight />
          </div>
        </section>

      </div>

      {kwModal && (
        <KeywordModal
          brand={kwModal.brand}
          tier={kwModal.tier}
          records={kwModal.records}
          onClose={() => setKwModal(null)}
        />
      )}

      {metricModal && (
        <MetricModal
          type={metricModal}
          details={metricDetails}
          onClose={() => setMetricModal(null)}
        />
      )}
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-[#F5F4EF]">
      {/* Mini German flag — 3 horizontal bands */}
      <div className="flex flex-col w-[3px] h-[15px] rounded-sm overflow-hidden shrink-0">
        <div className="flex-1 bg-[#0A0A0A]" />
        <div className="flex-1 bg-[#CC0000]" />
        <div className="flex-1 bg-[#FFCC00]" />
      </div>
      <div>
        <h2 className="text-[13px] font-[600] text-[#0A0A0A] leading-none">{title}</h2>
        <p className="text-[10px] text-[#ABABAA] mt-0.5">{subtitle}</p>
      </div>
    </div>
  )
}

function MoverGroup({
  label, tint, bgTint, borderTint, rows, empty,
}: {
  label: string
  tint: string
  bgTint: string
  borderTint: string
  rows: { record: RankingRecord; delta: number; brand: string }[]
  empty: string
}) {
  const navigate = useNavigate()
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: tint }}>{label}</span>
        <div className="flex-1 h-px bg-[#F0EFEA]" />
      </div>
      {rows.length === 0 && (
        <p className="text-[12px] text-[#ABABAA] px-1">{empty}</p>
      )}
      <ul className="space-y-0.5">
        {rows.map((m, i) => {
          const brand = BRAND_BY_NAME[m.brand]
          const url = `/bp-sites/${brandToSlug(m.brand)}?kw=${encodeURIComponent(m.record.keyword)}`
          return (
            <li
              key={`${m.brand}-${m.record.keyword}-${m.record.country}-${i}`}
              onClick={() => navigate(url)}
              className="flex items-center gap-2.5 px-2.5 py-0 rounded-xl hover:bg-[#FAF9F4] transition-colors cursor-pointer"
            >
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: brand?.color ?? '#ABABAA' }} />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-[#0A0A0A] truncate leading-snug hover:underline">{m.record.keyword}</div>
                <div className="font-mono text-[10px] text-[#ABABAA] truncate mt-0.5">
                  {m.brand} · {m.record.country} · pos {m.record.position}
                </div>
              </div>
              <span
                className="font-mono text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-lg shrink-0"
                style={{ color: tint, background: bgTint, border: `1px solid ${borderTint}` }}
              >
                {m.delta > 0 ? `+${m.delta}` : m.delta}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NavCard({
  label, hint, onClick, highlight,
}: { label: string; hint: string; onClick: () => void; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="group text-left p-4 rounded-xl border transition-all duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.07)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none"
      style={{
        background:  highlight ? '#FFFDE6' : '#FAFAF7',
        borderColor: highlight ? '#FFCC00' : '#E5E4DF',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-[#0A0A0A] leading-tight">{label}</span>
        <span className="text-[#ABABAA] text-[13px] transition-transform duration-150 group-hover:translate-x-0.5 shrink-0">→</span>
      </div>
      <div className="text-[11px] text-[#ABABAA] mt-1.5">{hint}</div>
    </button>
  )
}

const TIER_LIMIT: Record<ModalTier, number> = { p1: 1, top3: 3, top10: 10 }
const TIER_LABEL: Record<ModalTier, string>  = { p1: 'P1', top3: 'Top-3', top10: 'Top-10' }
const TIER_RANGE: Record<ModalTier, string>  = { p1: 'Position 1', top3: 'Positions 1–3', top10: 'Positions 1–10' }
const TIER_DESC:  Record<ModalTier, string>  = {
  p1:    'Keywords holding the #1 spot — maximum visibility and click-through potential.',
  top3:  'High-intent keywords ranking in the top 3 positions — prime real estate on the SERP.',
  top10: 'Page-1 keywords with strong search presence across tracked markets.',
}

function KeywordModal({
  brand, tier, records, onClose,
}: {
  brand: Brand
  tier: ModalTier
  records: RankingRecord[]
  onClose: () => void
}) {
  const limit = TIER_LIMIT[tier]
  const filtered = records.filter((r) => {
    const p = parsePosition(r.position)
    return typeof p === 'number' && p >= 1 && p <= limit
  })

  // Group by domain → keyword → [{country, pos}]
  type KwEntry = { country: string; pos: number }
  const domainMap = new Map<string, Map<string, KwEntry[]>>()
  for (const r of filtered) {
    const pos = parsePosition(r.position) as number
    if (!domainMap.has(r.domain)) domainMap.set(r.domain, new Map())
    const kwMap = domainMap.get(r.domain)!
    if (!kwMap.has(r.keyword)) kwMap.set(r.keyword, [])
    kwMap.get(r.keyword)!.push({ country: r.country, pos })
  }

  const domainGroups = [...domainMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, kwMap]) => {
      const keywords = [...kwMap.entries()]
        .map(([keyword, entries]) => ({
          keyword,
          entries: [...entries].sort((a, b) => a.pos - b.pos || a.country.localeCompare(b.country)),
        }))
        .sort((a, b) => {
          const bestA = Math.min(...a.entries.map((e) => e.pos))
          const bestB = Math.min(...b.entries.map((e) => e.pos))
          return bestA - bestB || a.keyword.localeCompare(b.keyword)
        })
      const totalKw = keywords.length
      return { domain, keywords, totalKw }
    })

  function tierBadgeStyle() {
    if (limit === 1)  return { bg: '#FFF3CD', color: '#92400E' }
    if (limit <= 3)   return { bg: '#FFF0F0', color: '#CC0000' }
    return                   { bg: '#FFF4EC', color: '#E86600' }
  }
  const headerBadge = tierBadgeStyle()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,10,10,0.45)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[580px] flex flex-col overflow-hidden"
        style={{ maxHeight: '80vh', animation: 'fadeUp 0.2s ease both' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#F5F4EF] shrink-0">
          <div className="w-[3px] h-7 rounded-full shrink-0" style={{ background: brand.color }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-bold" style={{ color: brand.color }}>
                {brand.name}
              </span>
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: headerBadge.bg, color: headerBadge.color }}
              >
                {TIER_LABEL[tier]}
              </span>
              <span className="text-[11px] text-[#ABABAA]">{filtered.length} keywords</span>
            </div>
            <p className="text-[11px] text-[#ABABAA] mt-0.5">{TIER_RANGE[tier]}</p>
            <p className="text-[11px] text-[#8A8A85] mt-1 leading-snug">{TIER_DESC[tier]}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[18px] leading-none text-[#ABABAA] hover:bg-[#F5F4EF] hover:text-[#0A0A0A] transition-colors shrink-0"
          >
            ×
          </button>
        </div>

        {/* Grouped content */}
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-5">
          {domainGroups.length === 0 ? (
            <p className="text-[12px] text-[#ABABAA] text-center py-10">No keywords found.</p>
          ) : (
            domainGroups.map((group) => (
              <div key={group.domain}>
                {/* Domain header */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: brand.color }} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#0A0A0A]">
                    {group.domain}
                  </span>
                  <span className="ml-auto text-[10px] text-[#ABABAA]">{group.totalKw} kw</span>
                </div>
                {/* Keyword rows */}
                <div className="divide-y divide-[#F3F2EE]">
                  {group.keywords.map(({ keyword, entries }) => (
                    <div
                      key={keyword}
                      className="flex items-center justify-between gap-4 py-2 hover:bg-[#FAF9F5] -mx-1 px-1 rounded transition-colors"
                    >
                      <span className="text-[12px] text-[#1A1A1A]">{keyword}</span>
                      <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
                        {entries.map(({ country, pos }) => (
                          <span
                            key={`${country}-${pos}`}
                            className="inline-flex items-center gap-0.5 font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: '#D6EFE7', color: '#0D5C42' }}
                          >
                            {country} <span className="opacity-70">#</span>{pos}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

type MetricDetails = {
  keywords:  { kw: string; count: number }[]
  countries: { country: string; count: number }[]
  brands:    { brand: Brand; count: number }[]
}

const METRIC_META = {
  keywords:  { title: 'Keywords',  subtitle: 'All tracked keywords', color: '#0A0A0A', light: false },
  brands:    { title: 'Brands',    subtitle: 'Active brands in snapshot', color: '#CC0000', light: false },
  countries: { title: 'Countries', subtitle: 'Markets in snapshot', color: '#FFCC00', light: true },
}

function MetricModal({
  type, details, onClose,
}: {
  type: 'keywords' | 'brands' | 'countries'
  details: MetricDetails
  onClose: () => void
}) {
  const meta = METRIC_META[type]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,10,10,0.45)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[460px] flex flex-col overflow-hidden"
        style={{ maxHeight: '80vh', animation: 'fadeUp 0.2s ease both' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#F5F4EF] shrink-0">
          <div className="w-[3px] h-7 rounded-full shrink-0" style={{ background: meta.color }} />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-[#0A0A0A]">{meta.title}</div>
            <div className="text-[11px] text-[#ABABAA] mt-0.5">{meta.subtitle}</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[18px] leading-none text-[#ABABAA] hover:bg-[#F5F4EF] hover:text-[#0A0A0A] transition-colors shrink-0"
          >×</button>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 px-5 py-3">
          {type === 'keywords' && (
            <div className="divide-y divide-[#F3F2EE]">
              {details.keywords.map(({ kw, count }) => (
                <div key={kw} className="flex items-center justify-between gap-4 py-2">
                  <span className="text-[13px] text-[#1A1A1A]">{kw}</span>
                  <span className="font-mono text-[11px] text-[#ABABAA] shrink-0">{count} record{count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          )}

          {type === 'brands' && (
            <div className="divide-y divide-[#F3F2EE]">
              {details.brands.map(({ brand, count }) => (
                <div key={brand.name} className="flex items-center gap-3 py-2.5">
                  <div className="w-[3px] h-6 rounded-full shrink-0" style={{ background: brand.color }} />
                  <span className="text-[13px] font-medium text-[#0A0A0A] flex-1">{brand.name}</span>
                  <span className="font-mono text-[11px] text-[#ABABAA] shrink-0">{count} records</span>
                </div>
              ))}
            </div>
          )}

          {type === 'countries' && (
            <div className="divide-y divide-[#F3F2EE]">
              {details.countries.map(({ country, count }) => (
                <div key={country} className="flex items-center justify-between gap-4 py-2">
                  <span className="text-[13px] font-medium text-[#0A0A0A]">{country}</span>
                  <span className="font-mono text-[11px] text-[#ABABAA] shrink-0">{count} records</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

