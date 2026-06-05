import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps'
import { BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, brandToSlug } from '../lib/brands'
import { parsePosition, parseChange } from '../lib/parser'
import type { RankingRecord, RROutletContext } from '../types'

const TRACK_BUCKETS: Array<{ label: string; key: string; test: (p: number | 'NR' | null) => boolean }> = [
  { label: '1–3',    key: 'top3',  test: (p) => typeof p === 'number' && p >= 1  && p <= 3  },
  { label: '4–10',   key: 'top10', test: (p) => typeof p === 'number' && p >= 4  && p <= 10 },
  { label: '11–20',  key: 'r11',   test: (p) => typeof p === 'number' && p >= 11 && p <= 20 },
  { label: '21–30',  key: 'r21',   test: (p) => typeof p === 'number' && p >= 21 && p <= 30 },
  { label: '31–40',  key: 'r31',   test: (p) => typeof p === 'number' && p >= 31 && p <= 40 },
  { label: '41–50',  key: 'r41',   test: (p) => typeof p === 'number' && p >= 41 && p <= 50 },
  { label: '51–60',  key: 'r51',   test: (p) => typeof p === 'number' && p >= 51 && p <= 60 },
  { label: '61–70',  key: 'r61',   test: (p) => typeof p === 'number' && p >= 61 && p <= 70 },
  { label: '71–80',  key: 'r71',   test: (p) => typeof p === 'number' && p >= 71 && p <= 80 },
  { label: '81–90',  key: 'r81',   test: (p) => typeof p === 'number' && p >= 81 && p <= 90 },
  { label: '91–100', key: 'r91',   test: (p) => typeof p === 'number' && p >= 91 && p <= 100},
  { label: 'NR',     key: 'nr',    test: (p) => p === 'NR'                                  },
]

const DOT_COLOR: Record<string, string> = {
  top3:  '#059669',
  top10: '#34D399',
  r11:   '#F59E0B', r21: '#F59E0B', r31: '#F59E0B', r41: '#F59E0B',
  r51:   '#F59E0B', r61: '#F59E0B', r71: '#F59E0B', r81: '#F59E0B', r91: '#F59E0B',
  nr:    '#1A1A1A',
}


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
      <div className="px-6 py-5 space-y-4">

        {/* ── Hero metric cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4" style={{ animation: 'fadeUp 0.35s ease both' }}>

          {/* Keywords — solid black (top band of flag) */}
          <div className="relative rounded-xl px-6 py-5 overflow-hidden bg-[#0A0A0A]">
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 bg-white" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2.5">Keywords</div>
            <div className="font-display text-[38px] font-[600] text-white tabular-nums leading-none">
              {totals.keywords.toLocaleString()}
            </div>
          </div>

          {/* Records — German red (middle band) */}
          <div className="relative rounded-xl px-6 py-5 overflow-hidden" style={{ background: '#CC0000' }}>
            <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 bg-white" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60 mb-2.5">Records</div>
            <div className="font-display text-[38px] font-[600] text-white tabular-nums leading-none">
              {totals.records.toLocaleString()}
            </div>
          </div>

          {/* Brands — gold-accented light card */}
          <div className="rounded-xl overflow-hidden bg-white border border-[#E5E4DF] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="h-[3px] bg-[#FFCC00]" />
            <div className="px-6 py-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#ABABAA] mb-2.5">Brands</div>
              <div className="font-display text-[38px] font-[600] text-[#0A0A0A] tabular-nums leading-none">
                {totals.brands}
              </div>
            </div>
          </div>

          {/* Countries — gold-accented light card */}
          <div className="rounded-xl overflow-hidden bg-white border border-[#E5E4DF] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <div className="h-[3px] bg-[#FFCC00]" />
            <div className="px-6 py-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#ABABAA] mb-2.5">Countries</div>
              <div className="font-display text-[38px] font-[600] text-[#0A0A0A] tabular-nums leading-none">
                {totals.countries}
              </div>
            </div>
          </div>
        </div>

        {/* ── SERP Distribution + Leaderboard + Movers ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_2fr_1fr] gap-4">

          {/* SERP Distribution */}
          <section
            className="bg-white rounded-2xl border border-[#E5E4DF] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col"
            style={{ animation: 'fadeUp 0.35s ease 0.08s both' }}
          >
            <SectionHeader title="SERP Distribution" subtitle="Position frequency · current snapshot" />
            <div className="px-5 pt-5 pb-4 flex flex-col flex-1">
              <SerpLineChart buckets={buckets} />
              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-[#F0EFEA] flex-wrap">
                {([
                  { color: '#059669', label: '1–3'         },
                  { color: '#34D399', label: '4–10'        },
                  { color: '#F59E0B', label: '11–100'      },
                  { color: '#0A0A0A', label: 'Not ranking' },
                ] as const).map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[11px] text-[#8A8A85]">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

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
                    return (
                      <tr
                        key={row.brand.name}
                        onClick={() => navigate(`/bp-sites/${brandToSlug(row.brand.name)}`)}
                        className="border-b border-[#F8F7F2] hover:bg-[#FAF9F4] cursor-pointer transition-colors group"
                        style={{ animation: `fadeUp 0.35s ease ${0.12 + i * 0.025}s both` }}
                      >
                        <td className="pl-5 pr-2 py-0 font-mono text-[11px] text-[#ABABAA] tabular-nums">
                          {i < 3 ? MEDALS[i] : String(i + 1).padStart(2, '0')}
                        </td>
                        <td className="px-3 py-0">
                          <div className="flex items-center gap-2.5">
                            <div className="w-[3px] h-7 rounded-full shrink-0" style={{ background: row.brand.color }} />
                            <span className="text-[13px] font-semibold truncate" style={{ color: row.brand.color }}>
                              {row.brand.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-0 text-right font-mono text-[13px] tabular-nums font-medium text-[#0A0A0A]">
                          {row.p1 || <span className="text-[#D8D7D2]">—</span>}
                        </td>
                        <td className="px-3 py-0 text-right font-mono text-[13px] tabular-nums font-semibold text-[#CC0000]">
                          {row.t3 || <span className="text-[#D8D7D2]">—</span>}
                        </td>
                        <td className="px-3 py-0 text-right font-mono text-[13px] tabular-nums font-semibold text-[#E86600]">
                          {row.t10 || <span className="text-[#D8D7D2]">—</span>}
                        </td>
                        <td className="px-3 py-0 text-right font-mono text-[12px] tabular-nums text-[#8A8A85]">
                          {row.total}
                        </td>
                        <td className="pl-3 pr-5 py-0">
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

        {/* ── Country + Navigate ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          <section
            className="bg-white rounded-2xl border border-[#E5E4DF] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden relative"
            style={{ animation: 'fadeUp 0.35s ease 0.16s both' }}
          >
            <SectionHeader title="Country Coverage" subtitle="Record volume by territory" />
            <div className="absolute inset-0 top-[57px]">
              <CountryMap data={countryBars} />
            </div>
          </section>

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
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function SerpLineChart({ buckets }: { buckets: { key: string; label: string; count: number; pct: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 300, height: 160 })
  const [tooltip, setTooltip] = useState<{ x: number; y: number; count: number; label: string } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDims({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { width, height } = dims
  const N = buckets.length
  const PAD_TOP = 24
  const PAD_BOTTOM = 20
  const chartH = height - PAD_TOP - PAD_BOTTOM
  const colW = width / N

  const points = buckets.map((b, i) => ({
    x: colW * i + colW / 2,
    y: PAD_TOP + (1 - b.pct) * chartH,
    color: DOT_COLOR[b.key] ?? '#F59E0B',
    count: b.count,
    label: b.label,
  }))

  return (
    <div ref={containerRef} className="relative flex-1 min-h-[120px]">
      <svg width="100%" height="100%">
        <defs>
          {points.slice(0, -1).map((p, i) => (
            <linearGradient
              key={i}
              id={`seg-${i}`}
              x1={p.x} y1={p.y}
              x2={points[i + 1].x} y2={points[i + 1].y}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor={p.color} />
              <stop offset="100%" stopColor={points[i + 1].color} />
            </linearGradient>
          ))}
        </defs>

        {/* Gray background columns */}
        {points.map((p, i) => (
          <rect
            key={i}
            x={colW * i + 2} y={PAD_TOP}
            width={colW - 4} height={chartH}
            rx={6} fill="#F0F0EE"
          />
        ))}

        {/* Gradient line segments */}
        {points.slice(0, -1).map((p, i) => (
          <line
            key={i}
            x1={p.x} y1={p.y}
            x2={points[i + 1].x} y2={points[i + 1].y}
            stroke={`url(#seg-${i})`}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}

        {/* Dots + count labels + x-axis labels */}
        {points.map((p, i) => (
          <g key={i}>
            {p.count > 0 && (
              <text
                x={p.x} y={p.y - 8}
                textAnchor="middle"
                fontSize={9} fill="#9CA3AF"
                fontFamily="ui-monospace,monospace"
              >
                {p.count}
              </text>
            )}
            <circle
              cx={p.x} cy={p.y} r={4} fill={p.color}
              style={{ cursor: p.count > 0 ? 'pointer' : 'default' }}
              onMouseEnter={p.count > 0 ? () => setTooltip({ x: p.x, y: p.y, count: p.count, label: p.label }) : undefined}
              onMouseLeave={p.count > 0 ? () => setTooltip(null) : undefined}
            />
            <text
              x={p.x} y={height - 4}
              textAnchor="middle"
              fontSize={8} fill="#ABABAA"
              fontFamily="ui-sans-serif,sans-serif"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>

      {tooltip && tooltip.count > 0 && (
        <div
          className="pointer-events-none absolute z-10 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white shadow-lg whitespace-nowrap"
          style={{
            left: tooltip.x,
            top: tooltip.y - 40,
            transform: tooltip.x > width / 2 ? 'translateX(-100%) translateX(-6px)' : 'translateX(6px)',
            background: '#0A0A0A',
          }}
        >
          {tooltip.count} keywords on {tooltip.label === 'NR' ? 'Not Ranking' : `Page ${tooltip.label}`}
        </div>
      )}
    </div>
  )
}

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
          return (
            <li
              key={`${m.brand}-${m.record.keyword}-${m.record.country}-${i}`}
              className="flex items-center gap-2.5 px-2.5 py-0 rounded-xl hover:bg-[#FAF9F4] transition-colors"
            >
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: brand?.color ?? '#ABABAA' }} />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-[#0A0A0A] truncate leading-snug">{m.record.keyword}</div>
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

// ISO alpha-2 → numeric code (world-atlas uses numeric codes)
const ALPHA2_TO_NUMERIC: Record<string, string> = {
  AU: '036', CA: '124', DE: '276', IT: '380', NZ: '554',
  GB: '826', US: '840', FR: '250', ES: '724', NL: '528',
  BE: '056', AT: '040', CH: '756', SE: '752', NO: '578',
  DK: '208', FI: '246', PL: '616', CZ: '203', PT: '620',
  IE: '372', BR: '076', MX: '484', AR: '032', JP: '392',
  KR: '410', IN: '356', SG: '702', ZA: '710', NG: '566',
}

const ALPHA2_TO_NAME: Record<string, string> = {
  AU: 'Australia', CA: 'Canada', DE: 'Germany', IT: 'Italy', NZ: 'New Zealand',
  GB: 'United Kingdom', US: 'United States', FR: 'France', ES: 'Spain', NL: 'Netherlands',
  BE: 'Belgium', AT: 'Austria', CH: 'Switzerland', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', PL: 'Poland', CZ: 'Czech Republic', PT: 'Portugal',
  IE: 'Ireland', BR: 'Brazil', MX: 'Mexico', AR: 'Argentina', JP: 'Japan',
  KR: 'South Korea', IN: 'India', SG: 'Singapore', ZA: 'South Africa', NG: 'Nigeria',
}

// Flag-representative colors per country (fallback palette for unknown countries)
const FLAG_COLORS: Record<string, string> = {
  AU: '#0033A0', // Australia   — blue field
  CA: '#D80621', // Canada      — maple leaf red
  DE: '#FFCE00', // Germany     — gold stripe
  IT: '#009246', // Italy       — green stripe
  NZ: '#00247D', // New Zealand — dark blue field
  GB: '#012169', // UK          — Union Jack blue
  US: '#B22234', // USA         — red stripes
  FR: '#0055A4', // France      — blue
  ES: '#AA151B', // Spain       — red
  NL: '#AE1C28', // Netherlands — red
  JP: '#BC002D', // Japan       — red circle
  BR: '#009C3B', // Brazil      — green
  IN: '#FF9933', // India       — saffron
  ZA: '#007A4D', // South Africa— green
  SE: '#006AA7', // Sweden      — blue
  NO: '#EF2B2D', // Norway      — red
  BE: '#FAE042', // Belgium     — yellow
  CH: '#FF0000', // Switzerland — red
  PL: '#DC143C', // Poland      — red
  AT: '#ED2939', // Austria     — red
}
const FLAG_PALETTE = ['#CC0000','#F59E0B','#10B981','#38BDF8','#8B5CF6','#EC4899','#F97316','#14B8A6']

function CountryMap({ data }: { data: { country: string; count: number; pct: number }[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; count: number; color: string } | null>(null)
  const [zoom, setZoom]       = useState(1)
  const [center, setCenter]   = useState<[number, number]>([10, 10])

  const colorByAlpha2 = useMemo(() => {
    const m: Record<string, string> = {}
    data.forEach((d, i) => {
      const code = d.country.toUpperCase()
      m[code] = FLAG_COLORS[code] ?? FLAG_PALETTE[i % FLAG_PALETTE.length]
    })
    return m
  }, [data])

  const byNumeric = useMemo(() => {
    const m: Record<string, { count: number; alpha2: string }> = {}
    for (const d of data) {
      const num = ALPHA2_TO_NUMERIC[d.country.toUpperCase()]
      if (num) m[num] = { count: d.count, alpha2: d.country.toUpperCase() }
    }
    return m
  }, [data])

  function fillColor(numericId: string): string {
    const entry = byNumeric[numericId]
    if (!entry) return '#EBEBEA'
    return colorByAlpha2[entry.alpha2] ?? '#EBEBEA'
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Zoom controls */}
      <div className="absolute top-2 right-3 z-10 flex flex-col gap-1">
        <button
          onClick={() => setZoom((z) => Math.min(z * 1.6, 12))}
          className="w-6 h-6 rounded-md bg-white border border-[#E5E4DF] text-[#0A0A0A] text-[13px] font-semibold flex items-center justify-center shadow-sm hover:bg-[#F5F4EF] transition-colors leading-none"
        >+</button>
        <button
          onClick={() => { setZoom((z) => Math.max(z / 1.6, 1)); if (zoom / 1.6 <= 1) setCenter([10, 10]) }}
          className="w-6 h-6 rounded-md bg-white border border-[#E5E4DF] text-[#0A0A0A] text-[13px] font-semibold flex items-center justify-center shadow-sm hover:bg-[#F5F4EF] transition-colors leading-none"
        >−</button>
      </div>
      <div className="flex-1 min-h-0">
        <ComposableMap
          projection="geoNaturalEarth1"
          style={{ width: '100%', height: '100%' }}
          projectionConfig={{ scale: 140, center: [10, 10] }}
        >
          <ZoomableGroup
            zoom={zoom}
            center={center}
            minZoom={1}
            maxZoom={12}
            onMoveEnd={({ zoom: z, coordinates }) => { setZoom(z); setCenter(coordinates as [number, number]) }}
          >
            <Geographies geography="/countries-110m.json">
              {({ geographies }) =>
                geographies.map((geo) => {
                  const id = geo.id as string
                  const entry = byNumeric[id]
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={fillColor(id)}
                      stroke="#FFFFFF"
                      strokeWidth={0.4}
                      style={{
                        default: { outline: 'none', cursor: entry ? 'pointer' : 'default' },
                        hover:   { outline: 'none', opacity: entry ? 0.75 : 1, cursor: entry ? 'pointer' : 'default' },
                        pressed: { outline: 'none' },
                      }}
                      onMouseEnter={(e) => {
                        if (!entry) return
                        const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect()
                        const svgEl = (e.target as SVGElement).closest('.w-full')!.getBoundingClientRect()
                        setTooltip({
                          x: e.clientX - svgEl.left,
                          y: e.clientY - svgEl.top,
                          name: ALPHA2_TO_NAME[entry.alpha2] ?? entry.alpha2,
                          count: entry.count,
                          color: colorByAlpha2[entry.alpha2],
                        })
                      }}
                      onMouseMove={(e) => {
                        if (!entry) return
                        const svgEl = (e.target as SVGElement).closest('.w-full')!.getBoundingClientRect()
                        setTooltip((prev) => prev ? { ...prev, x: e.clientX - svgEl.left, y: e.clientY - svgEl.top } : null)
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  )
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>
      </div>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white shadow-lg whitespace-nowrap"
          style={{
            left: tooltip.x + 10,
            top:  tooltip.y - 36,
            background: tooltip.color,
          }}
        >
          {tooltip.name}
          <span className="ml-1.5 font-normal opacity-80">{tooltip.count.toLocaleString()} records</span>
        </div>
      )}
      {data.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap px-5 pb-4 pt-1 border-t border-[#F5F4EF]">
          {data.map((d) => (
            <div key={d.country} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: colorByAlpha2[d.country.toUpperCase()] }}
              />
              <span className="font-mono text-[11px] font-semibold text-[#0A0A0A]">{d.country}</span>
              <span className="font-mono text-[11px] text-[#ABABAA]">{d.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
