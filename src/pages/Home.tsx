import { useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, brandToSlug } from '../lib/brands'
import { parsePosition, parseChange } from '../lib/parser'
import type { RankingRecord, RROutletContext } from '../types'

function brandOfDomain(domain: string): string | undefined {
  return DOMAIN_TO_BRAND[domain.toLowerCase()]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Home() {
  const ctx = useOutletContext<RROutletContext>()
  const navigate = useNavigate()

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

  const leaderboard = useMemo(() => {
    const sorted = [...ctx.snapshots].sort(
      (a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime()
    )
    return BRANDS.map((brand) => {
      const set = new Set(brand.domains.map((d) => d.toLowerCase()))
      // Use the most recent snapshot that contains records for this brand
      let own: RankingRecord[] = []
      for (const snap of sorted) {
        const found = snap.records.filter((r) => set.has(r.domain.toLowerCase()))
        if (found.length > 0) { own = found; break }
      }
      let p1 = 0, t3 = 0, t10 = 0
      for (const r of own) {
        const p = parsePosition(r.position)
        if (p === 1) { p1 += 1; t3 += 1; t10 += 1 }
        else if (p === 2 || p === 3) { t3 += 1; t10 += 1 }
        else if (typeof p === 'number' && p >= 4 && p <= 10) { t10 += 1 }
      }
      return { brand, total: own.length, p1, t3, t10 }
    })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.t10 - a.t10 || b.total - a.total)
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4" style={{ animation: 'fadeUp 0.35s ease both' }}>

          {/* Keywords — solid black (top band of flag) */}
          <div className="relative rounded-xl px-4 sm:px-6 py-4 sm:py-5 overflow-hidden bg-[#0A0A0A]">
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 bg-white" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">Keywords</div>
            <div className="font-display text-[28px] sm:text-[38px] font-[600] text-white tabular-nums leading-none">
              {totals.keywords.toLocaleString()}
            </div>
          </div>

          {/* Records — German red (middle band) */}
          <div className="relative rounded-xl px-4 sm:px-6 py-4 sm:py-5 overflow-hidden" style={{ background: '#CC0000' }}>
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 bg-white" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60 mb-2">Records</div>
            <div className="font-display text-[28px] sm:text-[38px] font-[600] text-white tabular-nums leading-none">
              {totals.records.toLocaleString()}
            </div>
          </div>

          {/* Brands — gold-accented light card */}
          <div className="rounded-xl overflow-hidden bg-white border border-[#E5E4DF] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="h-[3px] bg-[#FFCC00]" />
            <div className="px-4 sm:px-6 py-4 sm:py-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#ABABAA] mb-2">Brands</div>
              <div className="font-display text-[28px] sm:text-[38px] font-[600] text-[#0A0A0A] tabular-nums leading-none">
                {totals.brands}
              </div>
            </div>
          </div>

          {/* Countries — gold-accented light card */}
          <div className="rounded-xl overflow-hidden bg-white border border-[#E5E4DF] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="h-[3px] bg-[#FFCC00]" />
            <div className="px-4 sm:px-6 py-4 sm:py-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#ABABAA] mb-2">Countries</div>
              <div className="font-display text-[28px] sm:text-[38px] font-[600] text-[#0A0A0A] tabular-nums leading-none">
                {totals.countries}
              </div>
            </div>
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
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ABABAA]">Total</th>
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
                          className="pl-5 pr-2 py-0 font-mono text-[11px] text-[#ABABAA] tabular-nums cursor-pointer"
                          onClick={() => navigate(brandUrl)}
                        >
                          {i < 3 ? MEDALS[i] : String(i + 1).padStart(2, '0')}
                        </td>
                        <td
                          className="px-3 py-0 cursor-pointer"
                          onClick={() => navigate(brandUrl)}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-[3px] h-7 rounded-full shrink-0" style={{ background: row.brand.color }} />
                            <span className="text-[13px] font-semibold truncate group-hover:underline" style={{ color: row.brand.color }}>
                              {row.brand.name}
                            </span>
                          </div>
                        </td>
                        <td
                          className="px-3 py-0 text-right font-mono text-[13px] tabular-nums font-medium text-[#0A0A0A] cursor-pointer hover:text-[#1E40AF] hover:underline"
                          onClick={() => row.p1 > 0 && navigate(`${brandUrl}?pos=p1`)}
                          title={row.p1 > 0 ? 'View P1 keywords' : undefined}
                        >
                          {row.p1 || <span className="text-[#D8D7D2] no-underline">—</span>}
                        </td>
                        <td
                          className="px-3 py-0 text-right font-mono text-[13px] tabular-nums font-semibold text-[#CC0000] cursor-pointer hover:text-[#991b1b] hover:underline"
                          onClick={() => row.t3 > 0 && navigate(`${brandUrl}?pos=top3`)}
                          title={row.t3 > 0 ? 'View Top-3 keywords' : undefined}
                        >
                          {row.t3 || <span className="text-[#D8D7D2] no-underline">—</span>}
                        </td>
                        <td
                          className="px-3 py-0 text-right font-mono text-[13px] tabular-nums font-semibold text-[#E86600] cursor-pointer hover:text-[#9a3412] hover:underline"
                          onClick={() => row.t10 > 0 && navigate(`${brandUrl}?pos=top10`)}
                          title={row.t10 > 0 ? 'View Top-10 keywords' : undefined}
                        >
                          {row.t10 || <span className="text-[#D8D7D2] no-underline">—</span>}
                        </td>
                        <td
                          className="px-3 py-0 text-right font-mono text-[12px] tabular-nums text-[#8A8A85] cursor-pointer hover:text-[#0A0A0A] hover:underline"
                          onClick={() => navigate(brandUrl)}
                          title="View all keywords"
                        >
                          {row.total}
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

