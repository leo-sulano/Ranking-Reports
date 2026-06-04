import { useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, brandToSlug } from '../lib/brands'
import { parsePosition, parseChange } from '../lib/parser'
import type { RankingRecord, RROutletContext } from '../types'

// ─── Tier definitions ─────────────────────────────────────────────────────────

const TRACK_BUCKETS: Array<{ label: string; key: string; test: (p: number | 'NR' | null) => boolean; tier: 'p1' | 'top3' | 'top10' | 'page2' | 'nr' }> = [
  { label: '1',      key: 'p1',    test: (p) => p === 1,                                   tier: 'p1'    },
  { label: '2',      key: 'p2',    test: (p) => p === 2,                                   tier: 'top3'  },
  { label: '3',      key: 'p3',    test: (p) => p === 3,                                   tier: 'top3'  },
  { label: '4',      key: 'p4',    test: (p) => p === 4,                                   tier: 'top10' },
  { label: '5',      key: 'p5',    test: (p) => p === 5,                                   tier: 'top10' },
  { label: '6',      key: 'p6',    test: (p) => p === 6,                                   tier: 'top10' },
  { label: '7',      key: 'p7',    test: (p) => p === 7,                                   tier: 'top10' },
  { label: '8',      key: 'p8',    test: (p) => p === 8,                                   tier: 'top10' },
  { label: '9',      key: 'p9',    test: (p) => p === 9,                                   tier: 'top10' },
  { label: '10',     key: 'p10',   test: (p) => p === 10,                                  tier: 'top10' },
  { label: '11–100', key: 'page2', test: (p) => typeof p === 'number' && p >= 11,          tier: 'page2' },
  { label: 'NR',     key: 'nr',    test: (p) => p === 'NR',                                tier: 'nr'    },
]

const POSITION_COLOR: Record<string, string> = {
  p1:    '#047857',
  p2:    '#059669',
  p3:    '#10B981',
  p4:    '#16A34A',
  p5:    '#22C55E',
  p6:    '#4ADE80',
  p7:    '#65A30D',
  p8:    '#84CC16',
  p9:    '#A3E635',
  p10:   '#BEF264',
  page2: '#F59E0B',
  nr:    '#EF4444',
}

function brandOfDomain(domain: string): string | undefined {
  return DOMAIN_TO_BRAND[domain.toLowerCase()]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Home() {
  const ctx = useOutletContext<RROutletContext>()
  const navigate = useNavigate()

  const latestSnapshot = ctx.snapshots[0]
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

  const buckets = useMemo(() => {
    const counts = TRACK_BUCKETS.map((b) => ({ ...b, count: 0 }))
    for (const r of records) {
      const p = parsePosition(r.position)
      for (const b of counts) {
        if (b.test(p)) { b.count += 1; break }
      }
    }
    const max = Math.max(1, ...counts.map((b) => b.count))
    return counts.map((b) => ({ ...b, pct: b.count / max }))
  }, [records])

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
    return BRANDS.map((brand) => {
      const set = new Set(brand.domains.map((d) => d.toLowerCase()))
      const own = records.filter((r) => set.has(r.domain.toLowerCase()))
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
  }, [records])

  const movers = useMemo(() => {
    type Mover = { record: RankingRecord; delta: number; brand: string }
    const list: Mover[] = []
    for (const r of records) {
      const d = parseChange(r.change)
      if (d === null || d === 0) continue
      const b = brandOfDomain(r.domain) ?? '—'
      list.push({ record: r, delta: d, brand: b })
    }
    const climbers = list.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 6)
    const droppers = list.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 6)
    return { climbers, droppers }
  }, [records])

  const countryBars = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of records) {
      const c = r.country.toUpperCase()
      counts[c] = (counts[c] ?? 0) + 1
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const max = Math.max(1, ...entries.map(([, n]) => n))
    return entries.map(([c, n]) => ({ country: c, count: n, pct: n / max }))
  }, [records])

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!latestSnapshot) {
    return (
      <div className="flex-1 overflow-auto flex items-center justify-center bg-[#F8F8F6]">
        <div className="text-center max-w-[280px]" style={{ animation: 'fadeUp 0.4s ease both' }}>
          <div className="w-16 h-16 rounded-2xl bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] border border-[#E8E8E3] flex items-center justify-center mx-auto mb-5">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C0BFB9" strokeWidth="1.5">
              <path d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/>
            </svg>
          </div>
          <h2 className="font-display text-[18px] font-[700] text-[#0D0D0B] mb-2">No data yet</h2>
          <p className="text-[13px] text-[#9B9B96] mb-6 leading-relaxed">Import a ranking snapshot to begin tracking positions across brands.</p>
          <button
            onClick={ctx.onOpenUpload}
            className="px-5 py-2.5 bg-[#0D0D0B] text-white text-[13px] font-semibold rounded-xl hover:bg-[#1A1A16] transition-all active:scale-95"
          >
            Import data
          </button>
        </div>
      </div>
    )
  }

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto bg-[#F8F8F6]">
      <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-4">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section
          className="bg-white rounded-2xl border border-[#E8E8E3] shadow-[0_1px_6px_rgba(0,0,0,0.04)] overflow-hidden"
          style={{ animation: 'fadeUp 0.35s ease both' }}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-[#F2F2EE]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C0BFB9]">
              Rooster Partners
            </span>
            <div className="flex items-center gap-3 font-mono text-[11px] text-[#9B9B96]">
              <span>
                Latest: <span className="text-[#0D0D0B] font-semibold">{latestSnapshot.displayDate}</span>
              </span>
              <span className="text-[#DEDED9]">·</span>
              <span>{totals.snapshots} snapshots</span>
            </div>
          </div>

          {/* Big metrics */}
          <div className="grid grid-cols-4 divide-x divide-[#F2F2EE]">
            {([
              { label: 'Keywords',  value: totals.keywords  },
              { label: 'Brands',    value: totals.brands    },
              { label: 'Countries', value: totals.countries },
              { label: 'Records',   value: totals.records   },
            ] as const).map(({ label, value }) => (
              <div key={label} className="px-7 py-6">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#C0BFB9] mb-3">{label}</div>
                <div className="font-display text-[52px] font-[800] text-[#0D0D0B] tabular-nums leading-none">
                  {value.toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {/* Page-1 occupancy bar */}
          <div className="px-7 py-4 border-t border-[#F2F2EE] bg-[#FAFAF8]">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#C0BFB9]">
                Page-1 Occupancy
              </span>
              <span className="font-display text-[32px] font-[800] text-[#0D0D0B] tabular-nums leading-none">
                {page1Pct}<span className="font-display text-[15px] text-[#C0BFB9] font-[400] ml-0.5">%</span>
              </span>
            </div>
            <div className="h-[5px] bg-[#EDEDEA] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${page1Pct}%`,
                  background: 'linear-gradient(90deg, #1A56DB 0%, #7C3AED 100%)',
                  transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </div>
            <div className="flex items-center gap-6 mt-3">
              {([
                { label: 'P1',     value: tier.p1,    color: '#0FAA6A' },
                { label: 'Top-3',  value: tier.top3,  color: '#E8900A' },
                { label: 'Top-10', value: tier.top10, color: '#1A56DB' },
                { label: '11–100', value: tier.page2, color: '#7C3AED' },
                { label: 'NR',     value: tier.nr,    color: '#D93025' },
              ] as const).map((t) => (
                <div key={t.label} className="flex items-baseline gap-1.5">
                  <span
                    className="font-display text-[18px] font-[700] tabular-nums leading-none"
                    style={{ color: t.color }}
                  >
                    {t.value.toLocaleString()}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[#C0BFB9]">{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SERP Distribution ────────────────────────────────────────────── */}
        <section
          className="bg-white rounded-2xl border border-[#E8E8E3] shadow-[0_1px_6px_rgba(0,0,0,0.04)] overflow-hidden"
          style={{ animation: 'fadeUp 0.35s ease 0.06s both' }}
        >
          <SectionHeader title="SERP Distribution" subtitle="Position frequency · current snapshot" />
          <div className="px-6 py-5">
            <div className="flex gap-1.5 items-end h-[160px]">
              {buckets.map((b, i) => (
                <div
                  key={b.key}
                  className="flex-1 flex flex-col items-center gap-1.5 h-full"
                  style={{ animation: `fadeUp 0.45s ease ${0.12 + i * 0.025}s both` }}
                >
                  <span className="font-mono text-[10px] text-[#C0BFB9] tabular-nums leading-none">
                    {b.count || ''}
                  </span>
                  <div className="relative w-full flex-1 bg-[#F5F5F2] rounded-lg overflow-hidden">
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-lg transition-all duration-700"
                      style={{
                        height: `${Math.max(b.pct * 100, b.count > 0 ? 5 : 0)}%`,
                        background: POSITION_COLOR[b.key],
                        opacity: 0.88,
                      }}
                    />
                  </div>
                  <span className="font-mono text-[9px] text-[#C0BFB9]">{b.label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-5 mt-4 pt-4 border-t border-[#F2F2EE]">
              {([
                { color: '#10B981', label: 'Page 1 (1–10)' },
                { color: '#F59E0B', label: '11–100'        },
                { color: '#EF4444', label: 'Not ranking'   },
              ] as const).map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[11px] text-[#9B9B96]">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Leaderboard + Movers ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">

          {/* Brand Leaderboard */}
          <section
            className="bg-white rounded-2xl border border-[#E8E8E3] shadow-[0_1px_6px_rgba(0,0,0,0.04)] overflow-hidden"
            style={{ animation: 'fadeUp 0.35s ease 0.1s both' }}
          >
            <SectionHeader title="Brand Leaderboard" subtitle="Ranked by Top-10 keyword count" />
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#F5F5F2]">
                    <th className="pl-5 pr-2 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C0BFB9] w-10">#</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C0BFB9]">Brand</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C0BFB9]">P1</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#E8900A]">Top-3</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#1A56DB]">Top-10</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C0BFB9]">Total</th>
                    <th className="pl-3 pr-5 py-2.5 w-[96px] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C0BFB9]">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-[12px] text-[#C0BFB9]">
                        No brand data in current snapshot.
                      </td>
                    </tr>
                  )}
                  {leaderboard.map((row, i) => {
                    const maxT10 = leaderboard[0].t10 || 1
                    const share  = row.t10 / maxT10
                    const MEDALS = ['🥇', '🥈', '🥉']
                    return (
                      <tr
                        key={row.brand.name}
                        onClick={() => navigate(`/bp-sites/${brandToSlug(row.brand.name)}`)}
                        className="border-b border-[#F8F8F5] hover:bg-[#FAFAF8] cursor-pointer transition-colors group"
                        style={{ animation: `fadeUp 0.35s ease ${0.12 + i * 0.025}s both` }}
                      >
                        <td className="pl-5 pr-2 py-3 font-mono text-[11px] text-[#C0BFB9] tabular-nums">
                          {i < 3 ? MEDALS[i] : String(i + 1).padStart(2, '0')}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-[3px] h-7 rounded-full shrink-0"
                              style={{ background: row.brand.color }}
                            />
                            <span className="text-[13px] font-semibold text-[#0D0D0B] group-hover:text-[#1A56DB] transition-colors truncate">
                              {row.brand.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums text-[#0D0D0B] font-medium">
                          {row.p1 || <span className="text-[#DEDED9]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums font-semibold" style={{ color: '#E8900A' }}>
                          {row.t3 || <span className="text-[#DEDED9]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums font-semibold" style={{ color: '#1A56DB' }}>
                          {row.t10 || <span className="text-[#DEDED9]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[12px] tabular-nums text-[#9B9B96]">
                          {row.total}
                        </td>
                        <td className="pl-3 pr-5 py-3">
                          <div className="h-[3px] bg-[#F0F0EC] rounded-full overflow-hidden">
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
            className="bg-white rounded-2xl border border-[#E8E8E3] shadow-[0_1px_6px_rgba(0,0,0,0.04)] overflow-hidden"
            style={{ animation: 'fadeUp 0.35s ease 0.13s both' }}
          >
            <SectionHeader title="Top Movers" subtitle="vs. previous snapshot" />
            <div className="px-5 py-4 space-y-4">
              <MoverGroup
                label="Climbers"
                tint="#0FAA6A"
                bgTint="#F0FDF7"
                borderTint="#A7F3D0"
                rows={movers.climbers}
                empty="No upward movement."
              />
              <div className="h-px bg-[#F2F2EE]" />
              <MoverGroup
                label="Droppers"
                tint="#D93025"
                bgTint="#FEF2F2"
                borderTint="#FECACA"
                rows={movers.droppers}
                empty="No downward movement."
              />
            </div>
          </section>
        </div>

        {/* ── Country + Navigate ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">

          <section
            className="bg-white rounded-2xl border border-[#E8E8E3] shadow-[0_1px_6px_rgba(0,0,0,0.04)] overflow-hidden"
            style={{ animation: 'fadeUp 0.35s ease 0.16s both' }}
          >
            <SectionHeader title="Country Coverage" subtitle="Record volume by territory" />
            <div className="px-5 pb-5 pt-3 space-y-3">
              {countryBars.length === 0 && (
                <p className="text-[12px] text-[#C0BFB9]">No country data.</p>
              )}
              {countryBars.map((c) => (
                <div key={c.country} className="flex items-center gap-3">
                  <span className="font-mono text-[11px] font-semibold text-[#0D0D0B] w-9 shrink-0 tabular-nums">{c.country}</span>
                  <div className="flex-1 h-[4px] bg-[#F5F5F2] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${c.pct * 100}%`,
                        background: 'linear-gradient(90deg, #1A56DB, #7C3AED)',
                      }}
                    />
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-[#9B9B96] w-9 text-right">{c.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section
            className="bg-white rounded-2xl border border-[#E8E8E3] shadow-[0_1px_6px_rgba(0,0,0,0.04)] overflow-hidden"
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
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-[#F5F5F2]">
      <div
        className="w-[3px] h-4 rounded-full shrink-0"
        style={{ background: 'linear-gradient(180deg, #1A56DB, #7C3AED)' }}
      />
      <div>
        <h2 className="text-[13px] font-[600] text-[#0D0D0B] leading-none">{title}</h2>
        <p className="text-[10px] text-[#C0BFB9] mt-0.5">{subtitle}</p>
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
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: tint }}>{label}</span>
        <div className="flex-1 h-px bg-[#F2F2EE]" />
      </div>
      {rows.length === 0 && (
        <p className="text-[12px] text-[#C0BFB9] px-1">{empty}</p>
      )}
      <ul className="space-y-0.5">
        {rows.map((m, i) => {
          const brand = BRAND_BY_NAME[m.brand]
          return (
            <li
              key={`${m.brand}-${m.record.keyword}-${m.record.country}-${i}`}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-[#FAFAF8] transition-colors"
            >
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: brand?.color ?? '#C0BFB9' }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-[#0D0D0B] truncate leading-snug">{m.record.keyword}</div>
                <div className="font-mono text-[10px] text-[#9B9B96] truncate mt-0.5">
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
        background:  highlight ? '#FFFBEB' : '#FAFAF8',
        borderColor: highlight ? '#FDE68A' : '#EDEDEA',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-[#0D0D0B] leading-tight">{label}</span>
        <span className="text-[#C0BFB9] text-[13px] transition-transform duration-150 group-hover:translate-x-0.5 shrink-0">→</span>
      </div>
      <div className="text-[11px] text-[#9B9B96] mt-1.5">{hint}</div>
    </button>
  )
}
