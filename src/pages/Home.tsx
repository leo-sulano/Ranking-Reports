import { useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, brandToSlug } from '../lib/brands'
import { parsePosition, parseChange } from '../lib/parser'
import type { RankingRecord, RROutletContext } from '../types'

// ─── Tier definitions ─────────────────────────────────────────────────────────

const TRACK_BUCKETS: Array<{ label: string; key: string; test: (p: number | 'NR' | null) => boolean }> = [
  { label: '1',      key: 'p1',    test: (p) => p === 1                                    },
  { label: '2',      key: 'p2',    test: (p) => p === 2                                    },
  { label: '3',      key: 'p3',    test: (p) => p === 3                                    },
  { label: '4',      key: 'p4',    test: (p) => p === 4                                    },
  { label: '5',      key: 'p5',    test: (p) => p === 5                                    },
  { label: '6',      key: 'p6',    test: (p) => p === 6                                    },
  { label: '7',      key: 'p7',    test: (p) => p === 7                                    },
  { label: '8',      key: 'p8',    test: (p) => p === 8                                    },
  { label: '9',      key: 'p9',    test: (p) => p === 9                                    },
  { label: '10',     key: 'p10',   test: (p) => p === 10                                   },
  { label: '11–100', key: 'page2', test: (p) => typeof p === 'number' && p >= 11           },
  { label: 'NR',     key: 'nr',    test: (p) => p === 'NR'                                 },
]

// Cyberpunk palette: cyan → violet → pink for positions, amber for page2, hot-pink for NR
const POSITION_COLOR: Record<string, string> = {
  p1:    '#00E5FF',
  p2:    '#22D3EE',
  p3:    '#38BDF8',
  p4:    '#60A5FA',
  p5:    '#818CF8',
  p6:    '#A78BFA',
  p7:    '#C084FC',
  p8:    '#E879F9',
  p9:    '#F472B6',
  p10:   '#FB7185',
  page2: '#FFB74D',
  nr:    '#FF2D8D',
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
      <div className="flex-1 overflow-auto flex items-center justify-center bg-[#0F0E17]">
        <div className="text-center max-w-[280px]" style={{ animation: 'fadeUp 0.4s ease both' }}>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5">
              <path d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/>
            </svg>
          </div>
          <h2 className="font-display text-[18px] font-[700] text-white mb-2">No data yet</h2>
          <p className="text-[13px] text-white/40 mb-6 leading-relaxed">Import a ranking snapshot to begin tracking positions across brands.</p>
          <button
            onClick={ctx.onOpenUpload}
            className="px-5 py-2.5 text-white text-[13px] font-semibold rounded-xl transition-all hover:opacity-90 active:scale-95"
            style={{ background: 'linear-gradient(135deg, #FF2D8D, #7B2FE8)' }}
          >
            Import data
          </button>
        </div>
      </div>
    )
  }

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto bg-[#0F0E17]">
      <div className="px-6 py-5 space-y-4">

        {/* ── Metric cards row ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4" style={{ animation: 'fadeUp 0.35s ease both' }}>

          {/* Keywords — pink→purple gradient */}
          <div className="relative rounded-2xl p-7 overflow-hidden" style={{ background: 'linear-gradient(135deg, #FF2D8D 0%, #7B2FE8 100%)' }}>
            <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }} />
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70 mb-4">Keywords</div>
            <div className="font-display text-[60px] font-[800] text-white tabular-nums leading-none">
              {totals.keywords.toLocaleString()}
            </div>
          </div>

          {/* Records — cyan→blue gradient */}
          <div className="relative rounded-2xl p-7 overflow-hidden" style={{ background: 'linear-gradient(135deg, #00E5FF 0%, #2B6CF8 100%)' }}>
            <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }} />
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70 mb-4">Records</div>
            <div className="font-display text-[60px] font-[800] text-white tabular-nums leading-none">
              {totals.records.toLocaleString()}
            </div>
          </div>

          {/* Brands — dark card */}
          <div
            className="rounded-2xl p-7"
            style={{ background: '#1A1929', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35 mb-4">Brands</div>
            <div className="font-display text-[60px] font-[800] text-white tabular-nums leading-none">
              {totals.brands}
            </div>
          </div>

          {/* Countries — dark card */}
          <div
            className="rounded-2xl p-7"
            style={{ background: '#1A1929', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35 mb-4">Countries</div>
            <div className="font-display text-[60px] font-[800] text-white tabular-nums leading-none">
              {totals.countries}
            </div>
          </div>
        </div>

        {/* ── Page-1 Occupancy ──────────────────────────────────────────────── */}
        <section
          className="rounded-2xl px-8 py-5"
          style={{ background: '#1A1929', border: '1px solid rgba(255,255,255,0.07)', animation: 'fadeUp 0.35s ease 0.04s both' }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Page-1 Occupancy</span>
              <span className="ml-4 font-mono text-[11px] text-white/25">
                Latest: <span className="text-white/50">{latestSnapshot.displayDate}</span>
                <span className="mx-2 text-white/15">·</span>
                {totals.snapshots} snapshots
              </span>
            </div>
            <span className="font-display text-[36px] font-[800] text-white tabular-nums leading-none">
              {page1Pct}<span className="font-display text-[16px] text-white/30 font-[400] ml-0.5">%</span>
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${page1Pct}%`,
                background: 'linear-gradient(90deg, #FF2D8D 0%, #7B2FE8 50%, #00E5FF 100%)',
                transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 0 12px rgba(255,45,141,0.5)',
              }}
            />
          </div>
          <div className="flex items-center gap-7 mt-3">
            {([
              { label: 'P1',     value: tier.p1,    color: '#00E5FF' },
              { label: 'Top-3',  value: tier.top3,  color: '#A78BFA' },
              { label: 'Top-10', value: tier.top10, color: '#818CF8' },
              { label: '11–100', value: tier.page2, color: '#FFB74D' },
              { label: 'NR',     value: tier.nr,    color: '#FF2D8D' },
            ] as const).map((t) => (
              <div key={t.label} className="flex items-baseline gap-2">
                <span className="font-display text-[20px] font-[700] tabular-nums leading-none" style={{ color: t.color }}>
                  {t.value.toLocaleString()}
                </span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-white/30">{t.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── SERP Distribution ────────────────────────────────────────────── */}
        <section
          className="rounded-2xl overflow-hidden"
          style={{ background: '#1A1929', border: '1px solid rgba(255,255,255,0.07)', animation: 'fadeUp 0.35s ease 0.08s both' }}
        >
          <SectionHeader title="SERP Distribution" subtitle="Position frequency · current snapshot" />
          <div className="px-7 py-5">
            <div className="flex gap-2 items-end h-[200px]">
              {buckets.map((b, i) => (
                <div
                  key={b.key}
                  className="flex-1 flex flex-col items-center gap-1.5 h-full"
                  style={{ animation: `fadeUp 0.45s ease ${0.12 + i * 0.025}s both` }}
                >
                  <span className="font-mono text-[10px] tabular-nums leading-none" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {b.count || ''}
                  </span>
                  <div className="relative w-full flex-1 rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-lg transition-all duration-700"
                      style={{
                        height: `${Math.max(b.pct * 100, b.count > 0 ? 5 : 0)}%`,
                        background: POSITION_COLOR[b.key],
                        opacity: 0.85,
                        boxShadow: b.count > 0 ? `0 0 12px ${POSITION_COLOR[b.key]}50` : 'none',
                      }}
                    />
                  </div>
                  <span className="font-mono text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{b.label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-5 mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {([
                { color: '#00E5FF', label: 'Page 1 (1–10)' },
                { color: '#FFB74D', label: '11–100'        },
                { color: '#FF2D8D', label: 'Not ranking'   },
              ] as const).map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                  <span className="text-[11px] text-white/40">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Leaderboard + Movers ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">

          {/* Brand Leaderboard */}
          <section
            className="rounded-2xl overflow-hidden"
            style={{ background: '#1A1929', border: '1px solid rgba(255,255,255,0.07)', animation: 'fadeUp 0.35s ease 0.1s both' }}
          >
            <SectionHeader title="Brand Leaderboard" subtitle="Ranked by Top-10 keyword count" />
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <th className="pl-5 pr-2 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] w-10" style={{ color: 'rgba(255,255,255,0.25)' }}>#</th>
                    <th className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgba(255,255,255,0.25)' }}>Brand</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgba(255,255,255,0.25)' }}>P1</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: '#FFB74D' }}>Top-3</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: '#00E5FF' }}>Top-10</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgba(255,255,255,0.25)' }}>Total</th>
                    <th className="pl-3 pr-5 py-2.5 w-[96px] text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgba(255,255,255,0.25)' }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
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
                        className="cursor-pointer transition-colors group"
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
                      >
                        <td className="pl-5 pr-2 py-3 font-mono text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          {i < 3 ? MEDALS[i] : String(i + 1).padStart(2, '0')}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-[3px] h-7 rounded-full shrink-0" style={{ background: row.brand.color, boxShadow: `0 0 8px ${row.brand.color}80` }} />
                            <span className="text-[13px] font-semibold text-white/80 group-hover:text-white transition-colors truncate">
                              {row.brand.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums font-medium text-white/70">
                          {row.p1 || <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums font-semibold" style={{ color: '#FFB74D' }}>
                          {row.t3 || <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums font-semibold" style={{ color: '#00E5FF' }}>
                          {row.t10 || <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[12px] tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          {row.total}
                        </td>
                        <td className="pl-3 pr-5 py-3">
                          <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${share * 100}%`,
                                background: row.brand.color,
                                boxShadow: `0 0 6px ${row.brand.color}80`,
                              }}
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
            className="rounded-2xl overflow-hidden"
            style={{ background: '#1A1929', border: '1px solid rgba(255,255,255,0.07)', animation: 'fadeUp 0.35s ease 0.13s both' }}
          >
            <SectionHeader title="Top Movers" subtitle="vs. previous snapshot" />
            <div className="px-5 py-4 space-y-4">
              <MoverGroup
                label="Climbers"
                tint="#00E599"
                bgTint="rgba(0,229,153,0.1)"
                borderTint="rgba(0,229,153,0.25)"
                rows={movers.climbers}
                empty="No upward movement."
              />
              <div className="h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
              <MoverGroup
                label="Droppers"
                tint="#FF2D8D"
                bgTint="rgba(255,45,141,0.1)"
                borderTint="rgba(255,45,141,0.25)"
                rows={movers.droppers}
                empty="No downward movement."
              />
            </div>
          </section>
        </div>

        {/* ── Country + Navigate ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          <section
            className="rounded-2xl overflow-hidden"
            style={{ background: '#1A1929', border: '1px solid rgba(255,255,255,0.07)', animation: 'fadeUp 0.35s ease 0.16s both' }}
          >
            <SectionHeader title="Country Coverage" subtitle="Record volume by territory" />
            <div className="px-5 pb-5 pt-3 space-y-3">
              {countryBars.length === 0 && (
                <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.2)' }}>No country data.</p>
              )}
              {countryBars.map((c) => (
                <div key={c.country} className="flex items-center gap-3">
                  <span className="font-mono text-[11px] font-semibold text-white/70 w-9 shrink-0 tabular-nums">{c.country}</span>
                  <div className="flex-1 h-[4px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${c.pct * 100}%`,
                        background: 'linear-gradient(90deg, #FF2D8D, #7B2FE8)',
                        boxShadow: '0 0 6px rgba(255,45,141,0.4)',
                      }}
                    />
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-white/35 w-9 text-right">{c.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section
            className="rounded-2xl overflow-hidden"
            style={{ background: '#1A1929', border: '1px solid rgba(255,255,255,0.07)', animation: 'fadeUp 0.35s ease 0.18s both' }}
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
    <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div
        className="w-[3px] h-4 rounded-full shrink-0"
        style={{ background: 'linear-gradient(180deg, #FF2D8D, #7B2FE8)' }}
      />
      <div>
        <h2 className="text-[13px] font-[600] text-white leading-none">{title}</h2>
        <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>{subtitle}</p>
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
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
      </div>
      {rows.length === 0 && (
        <p className="text-[12px] px-1" style={{ color: 'rgba(255,255,255,0.2)' }}>{empty}</p>
      )}
      <ul className="space-y-0.5">
        {rows.map((m, i) => {
          const brand = BRAND_BY_NAME[m.brand]
          return (
            <li
              key={`${m.brand}-${m.record.keyword}-${m.record.country}-${i}`}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors"
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: brand?.color ?? 'rgba(255,255,255,0.25)', boxShadow: `0 0 4px ${brand?.color ?? 'rgba(255,255,255,0.25)'}` }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-white/80 truncate leading-snug">{m.record.keyword}</div>
                <div className="font-mono text-[10px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
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
      className="group text-left p-4 rounded-xl transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
      style={{
        background:  highlight ? 'linear-gradient(135deg, rgba(255,45,141,0.15), rgba(123,47,232,0.15))' : 'rgba(255,255,255,0.04)',
        border:      highlight ? '1px solid rgba(255,45,141,0.3)' : '1px solid rgba(255,255,255,0.07)',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = highlight ? '0 0 20px rgba(255,45,141,0.2)' : '0 0 20px rgba(123,47,232,0.15)'
        el.style.borderColor = highlight ? 'rgba(255,45,141,0.5)' : 'rgba(255,255,255,0.15)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = ''
        el.style.borderColor = highlight ? 'rgba(255,45,141,0.3)' : 'rgba(255,255,255,0.07)'
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-white/80 leading-tight">{label}</span>
        <span className="text-[13px] transition-transform duration-150 group-hover:translate-x-0.5 shrink-0" style={{ color: 'rgba(255,255,255,0.25)' }}>→</span>
      </div>
      <div className="text-[11px] mt-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>{hint}</div>
    </button>
  )
}
