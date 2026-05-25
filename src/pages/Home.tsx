import { useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, brandToSlug } from '../lib/brands'
import { parsePosition, parseChange } from '../lib/parser'
import type { RankingRecord, RROutletContext } from '../types'

// ─── Tier definitions ─────────────────────────────────────────────────────────

const TRACK_BUCKETS: Array<{ label: string; key: string; test: (p: number | 'NR' | null) => boolean; tier: 'p1' | 'top3' | 'top10' | 'page2' | 'nr' }> = [
  { label: '1',     key: 'p1',    test: (p) => p === 1,                                    tier: 'p1'    },
  { label: '2',     key: 'p2',    test: (p) => p === 2,                                    tier: 'top3'  },
  { label: '3',     key: 'p3',    test: (p) => p === 3,                                    tier: 'top3'  },
  { label: '4',     key: 'p4',    test: (p) => p === 4,                                    tier: 'top10' },
  { label: '5',     key: 'p5',    test: (p) => p === 5,                                    tier: 'top10' },
  { label: '6',     key: 'p6',    test: (p) => p === 6,                                    tier: 'top10' },
  { label: '7',     key: 'p7',    test: (p) => p === 7,                                    tier: 'top10' },
  { label: '8',     key: 'p8',    test: (p) => p === 8,                                    tier: 'top10' },
  { label: '9',     key: 'p9',    test: (p) => p === 9,                                    tier: 'top10' },
  { label: '10',    key: 'p10',   test: (p) => p === 10,                                   tier: 'top10' },
  { label: '11–100',key: 'page2', test: (p) => typeof p === 'number' && p >= 11,           tier: 'page2' },
  { label: 'NR',    key: 'nr',    test: (p) => p === 'NR',                                 tier: 'nr'    },
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

  if (!latestSnapshot) {
    return (
      <div className="flex-1 overflow-auto flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-[#F3F4F6] flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
              <path d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/>
            </svg>
          </div>
          <h2 className="text-[15px] font-semibold text-[#111827] mb-1">No data yet</h2>
          <p className="text-[13px] text-[#6B7280] mb-5 max-w-[260px]">Import a ranking export to get started.</p>
          <button
            onClick={ctx.onOpenUpload}
            className="px-4 py-2 bg-[#111827] text-white text-[13px] font-medium rounded-lg hover:bg-[#1F2937] transition-colors"
          >
            Import data
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-[#F9FAFB]">
      <div className="px-6 py-6 max-w-[1400px] mx-auto">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section
          className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden mb-5"
          style={{ animation: 'fadeUp 0.3s ease both' }}
        >
          <div className="flex items-center justify-between px-6 py-3 border-b border-[#E5E7EB]">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF]">
              Rooster Partners
            </span>
            <div className="flex items-center gap-3 text-[12px] text-[#6B7280]">
              <span>
                Latest: <span className="text-[#111827] font-semibold">{latestSnapshot.displayDate}</span>
              </span>
              <span className="text-[#E5E7EB]">·</span>
              <span>{totals.snapshots} snapshots</span>
            </div>
          </div>

          <div className="grid grid-cols-4 divide-x divide-[#E5E7EB]">
            <HeroMetric label="Keywords"  value={totals.keywords}  />
            <HeroMetric label="Brands"    value={totals.brands}    />
            <HeroMetric label="Countries" value={totals.countries} />
            <HeroMetric label="Records"   value={totals.records}   />
          </div>

          <div className="px-6 py-4 border-t border-[#E5E7EB] bg-[#F9FAFB]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF]">
                Page-1 Occupancy
              </span>
              <span className="text-[22px] font-bold text-[#111827] tabular-nums leading-none">
                {page1Pct}
                <span className="text-[13px] text-[#9CA3AF] font-normal ml-0.5">%</span>
              </span>
            </div>
            <div className="h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-[#111827]"
                style={{ width: `${page1Pct}%`, transition: 'width 1s ease' }}
              />
            </div>
            <div className="flex items-center gap-5 mt-2.5">
              {([
                { label: 'P1',     value: tier.p1,    color: '#111827' },
                { label: 'Top-3',  value: tier.top3,  color: '#F59E0B' },
                { label: 'Top-10', value: tier.top10, color: '#10B981' },
                { label: '11–100', value: tier.page2, color: '#6366F1' },
                { label: 'NR',     value: tier.nr,    color: '#EF4444' },
              ] as const).map((t) => (
                <div key={t.label} className="flex items-baseline gap-1">
                  <span className="text-[13px] font-bold tabular-nums" style={{ color: t.color }}>{t.value}</span>
                  <span className="text-[11px] text-[#9CA3AF]">{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── SERP Distribution ────────────────────────────────────────────── */}
        <section
          className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden mb-5"
          style={{ animation: 'fadeUp 0.3s ease 0.05s both' }}
        >
          <SectionHeader title="SERP Distribution" subtitle="Position frequency · current snapshot" />

          <div className="px-6 py-5">
            <div className="flex gap-1 items-end h-[140px]">
              {buckets.map((b, i) => (
                <div
                  key={b.key}
                  className="flex-1 flex flex-col items-center gap-1.5 h-full"
                  style={{ animation: `fadeUp 0.4s ease ${0.1 + i * 0.03}s both` }}
                >
                  <span className="text-[11px] text-[#9CA3AF] tabular-nums">{b.count || ''}</span>
                  <div className="relative w-full flex-1 bg-[#F3F4F6] rounded-md overflow-hidden">
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-md transition-all duration-700"
                      style={{
                        height: `${Math.max(b.pct * 100, b.count > 0 ? 6 : 0)}%`,
                        background: POSITION_COLOR[b.key],
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-[#9CA3AF]">{b.label}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 mt-4">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-[#10B981]" />
                <span className="text-[11px] text-[#6B7280]">Page 1 (1–10)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B]" />
                <span className="text-[11px] text-[#6B7280]">11–100</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-[#EF4444]" />
                <span className="text-[11px] text-[#6B7280]">Not ranking</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Leaderboard + Movers ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5 mb-5">

          {/* Brand Leaderboard */}
          <section
            className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden"
            style={{ animation: 'fadeUp 0.3s ease 0.1s both' }}
          >
            <SectionHeader title="Brand Leaderboard" subtitle="Ranked by Top-10 keyword count" />

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#E5E7EB]">
                    <th className="pl-5 pr-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] w-10">#</th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Brand</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">P1</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[#F59E0B]">Top-3</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[#10B981]">Top-10</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Total</th>
                    <th className="pl-3 pr-5 py-2.5 w-[100px] text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-[12px] text-[#9CA3AF]">
                        No brand data in current snapshot.
                      </td>
                    </tr>
                  )}
                  {leaderboard.map((row, i) => {
                    const maxT10 = leaderboard[0].t10 || 1
                    const share  = row.t10 / maxT10
                    return (
                      <tr
                        key={row.brand.name}
                        onClick={() => navigate(`/bp-sites/${brandToSlug(row.brand.name)}`)}
                        className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB] cursor-pointer transition-colors"
                        style={{ animation: `fadeUp 0.3s ease ${0.12 + i * 0.03}s both` }}
                      >
                        <td className="pl-5 pr-3 py-3 text-[12px] text-[#9CA3AF] tabular-nums font-medium">
                          {String(i + 1).padStart(2, '0')}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-[3px] h-8 rounded-full shrink-0"
                              style={{ background: row.brand.color }}
                            />
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-[#111827] truncate leading-tight">{row.brand.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums text-[#111827]">
                          {row.p1 || <span className="text-[#D1D5DB]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums text-[#F59E0B]">
                          {row.t3 || <span className="text-[#D1D5DB]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums text-[#10B981]">
                          {row.t10 || <span className="text-[#D1D5DB]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right text-[12px] tabular-nums text-[#6B7280]">
                          {row.total}
                        </td>
                        <td className="pl-3 pr-5 py-3">
                          <div className="h-1 bg-[#F3F4F6] rounded-full overflow-hidden">
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
            className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden"
            style={{ animation: 'fadeUp 0.3s ease 0.12s both' }}
          >
            <SectionHeader title="Top Movers" subtitle="vs. previous snapshot" />

            <div className="px-5 pb-5 pt-3 space-y-4">
              <MoverGroup
                label="Climbers"
                tint="#10B981"
                bgTint="#F0FDF4"
                borderTint="#BBF7D0"
                rows={movers.climbers}
                empty="No upward movement."
                sign="+"
              />
              <div className="h-px bg-[#F3F4F6]" />
              <MoverGroup
                label="Droppers"
                tint="#EF4444"
                bgTint="#FEF2F2"
                borderTint="#FECACA"
                rows={movers.droppers}
                empty="No downward movement."
                sign=""
              />
            </div>
          </section>
        </div>

        {/* ── Country + Navigate ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-5">

          <section
            className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden"
            style={{ animation: 'fadeUp 0.3s ease 0.15s both' }}
          >
            <SectionHeader title="Country Coverage" subtitle="Record volume by territory" />
            <div className="px-5 pb-5 pt-3 space-y-3">
              {countryBars.length === 0 && (
                <p className="text-[12px] text-[#9CA3AF]">No country data.</p>
              )}
              {countryBars.map((c) => (
                <div key={c.country} className="flex items-center gap-3">
                  <span className="text-[13px] font-semibold text-[#111827] w-10 shrink-0">{c.country}</span>
                  <div className="flex-1 h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#6366F1] transition-all duration-700"
                      style={{ width: `${c.pct * 100}%` }}
                    />
                  </div>
                  <span className="text-[12px] tabular-nums text-[#6B7280] w-10 text-right">{c.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section
            className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden"
            style={{ animation: 'fadeUp 0.3s ease 0.17s both' }}
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

function HeroMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-6 py-5">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-[#9CA3AF] mb-2">{label}</div>
      <div className="text-[40px] font-bold tabular-nums text-[#111827] leading-none">
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-5 py-4 border-b border-[#E5E7EB]">
      <h2 className="text-[14px] font-semibold text-[#111827] leading-none">{title}</h2>
      <p className="text-[11px] text-[#9CA3AF] mt-1">{subtitle}</p>
    </div>
  )
}

function MoverGroup({
  label, tint, bgTint, borderTint, rows, empty, sign,
}: {
  label: string
  tint: string
  bgTint: string
  borderTint: string
  rows: { record: RankingRecord; delta: number; brand: string }[]
  empty: string
  sign: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: tint }}>{label}</span>
        <div className="flex-1 h-px bg-[#F3F4F6]" />
      </div>
      {rows.length === 0 && (
        <p className="text-[12px] text-[#9CA3AF] px-1">{empty}</p>
      )}
      <ul className="space-y-0.5">
        {rows.map((m, i) => {
          const brand = BRAND_BY_NAME[m.brand]
          return (
            <li
              key={`${m.brand}-${m.record.keyword}-${m.record.country}-${i}`}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[#F9FAFB] transition-colors"
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: brand?.color ?? '#9CA3AF' }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#111827] truncate leading-tight">{m.record.keyword}</div>
                <div className="text-[11px] text-[#9CA3AF] truncate mt-0.5">
                  {m.brand} · {m.record.country} · pos {m.record.position}
                </div>
              </div>
              <span
                className="text-[12px] font-semibold tabular-nums px-2 py-0.5 rounded-md shrink-0"
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
      className="group text-left p-4 rounded-lg border transition-all duration-150 hover:shadow-sm"
      style={{
        background:   highlight ? '#FEFCE8' : '#FFFFFF',
        borderColor:  highlight ? '#FDE68A' : '#E5E7EB',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-[#111827] leading-tight">{label}</span>
        <span className="text-[#9CA3AF] text-[14px] transition-transform group-hover:translate-x-0.5 shrink-0">→</span>
      </div>
      <div className="text-[11px] text-[#9CA3AF] mt-1">{hint}</div>
    </button>
  )
}
