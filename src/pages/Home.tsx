import { useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND } from '../lib/brands'
import { parsePosition, parseChange } from '../lib/parser'
import type { RankingRecord, RROutletContext } from '../types'

// ─── Tier definitions ─────────────────────────────────────────────────────────
//
// Page-1 buckets are P1, Top-3, Top-10. Page-2-onwards is collapsed into a
// single "11-100" bucket plus "NR" (not ranking) so the track stays readable.

const TRACK_BUCKETS: Array<{ label: string; key: string; test: (p: number | 'NR' | null) => boolean; tier: 'p1' | 'top3' | 'top10' | 'page2' | 'nr' }> = [
  { label: '1',  key: 'p1',  test: (p) => p === 1,                    tier: 'p1'    },
  { label: '2',  key: 'p2',  test: (p) => p === 2,                    tier: 'top3'  },
  { label: '3',  key: 'p3',  test: (p) => p === 3,                    tier: 'top3'  },
  { label: '4',  key: 'p4',  test: (p) => p === 4,                    tier: 'top10' },
  { label: '5',  key: 'p5',  test: (p) => p === 5,                    tier: 'top10' },
  { label: '6',  key: 'p6',  test: (p) => p === 6,                    tier: 'top10' },
  { label: '7',  key: 'p7',  test: (p) => p === 7,                    tier: 'top10' },
  { label: '8',  key: 'p8',  test: (p) => p === 8,                    tier: 'top10' },
  { label: '9',  key: 'p9',  test: (p) => p === 9,                    tier: 'top10' },
  { label: '10', key: 'p10', test: (p) => p === 10,                   tier: 'top10' },
  { label: '11–100', key: 'page2', test: (p) => typeof p === 'number' && p >= 11, tier: 'page2' },
  { label: 'NR', key: 'nr',  test: (p) => p === 'NR',                 tier: 'nr'    },
]

const TIER_COLOR: Record<'p1' | 'top3' | 'top10' | 'page2' | 'nr', string> = {
  p1:     '#0F172A',
  top3:   '#FBBF24',
  top10:  '#10B981',
  page2:  '#3B82F6',
  nr:     '#94A3B8',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function brandOfDomain(domain: string): string | undefined {
  return DOMAIN_TO_BRAND[domain.toLowerCase()]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Home() {
  const ctx = useOutletContext<RROutletContext>()
  const navigate = useNavigate()

  const latestSnapshot = ctx.snapshots[0]
  const records: RankingRecord[] = latestSnapshot?.records ?? []

  // ── Top-line totals ─────────────────────────────────────────────────────
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

  // ── SERP distribution buckets ───────────────────────────────────────────
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

  // ── Tier rollups ────────────────────────────────────────────────────────
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

  // ── Per-brand leaderboard ───────────────────────────────────────────────
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

  // ── Movers (compared to "previous" column) ──────────────────────────────
  const movers = useMemo(() => {
    type Mover = { record: RankingRecord; delta: number; brand: string }
    const list: Mover[] = []
    for (const r of records) {
      const d = parseChange(r.change)
      if (d === null || d === 0) continue
      const b = brandOfDomain(r.domain) ?? '—'
      list.push({ record: r, delta: d, brand: b })
    }
    // Note: change column convention here treats positive number as climbing
    // upward (better position). If your sheet uses the opposite sign, flip.
    const climbers = list
      .filter((m) => m.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 6)
    const droppers = list
      .filter((m) => m.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 6)
    return { climbers, droppers }
  }, [records])

  // ── Country distribution ────────────────────────────────────────────────
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

  // ─── Empty state ──────────────────────────────────────────────────────
  if (!latestSnapshot) {
    return (
      <div className="flex-1 overflow-auto px-7 pb-7 pt-5">
        <div className="flex flex-col items-center justify-center py-32 gap-5 text-center">
          <div className="font-display text-[88px] tracking-[0.15em] text-[#CBD5E1] leading-none">SERP</div>
          <div className="font-display text-[22px] tracking-[0.2em] text-[#0F172A]">NO DATA STREAM</div>
          <p className="text-[12px] text-[#64748B] max-w-sm font-mono">
            Import a ranking export to wake the terminal.
          </p>
          <button
            onClick={ctx.onOpenUpload}
            className="mt-4 px-5 py-2 bg-[#0F172A] text-white rounded-md text-[12px] font-bold tracking-wider hover:bg-[#1E293B]"
          >
            IMPORT DATA →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto relative">

      {/* Subtle horizontal-rule texture for visual rhythm on the light surface */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.06] mix-blend-multiply"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, #94A3B8 0px, #94A3B8 1px, transparent 1px, transparent 5px)',
        }}
      />

      <div className="relative z-[1] px-7 pb-12 pt-6 max-w-[1600px] mx-auto">

        {/* ─── HERO BAND ─────────────────────────────────────────────────── */}
        <section
          className="relative overflow-hidden rounded-[14px] border border-[#E2E8F0] bg-gradient-to-b from-white to-[#F8FAFC] mb-8 shadow-sm"
          style={{ animation: 'fadeUp 0.4s ease both' }}
        >
          {/* Top status strip */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#10B981]" />
              </span>
              <span className="font-mono text-[10px] tracking-[0.2em] text-[#10B981]">LIVE</span>
              <span className="font-mono text-[10px] tracking-[0.16em] text-[#64748B] ml-2">
                RANKING.REPORTS // ROOSTER PARTNERS
              </span>
            </div>
            <div className="flex items-center gap-4 font-mono text-[10px] tracking-[0.14em] text-[#64748B]">
              <span>SNAPSHOT: <span className="text-[#0F172A]">{latestSnapshot.displayDate}</span></span>
              <span>SERIES: <span className="text-[#0F172A]">{totals.snapshots}</span></span>
            </div>
          </div>

          {/* Big numeric readouts */}
          <div className="grid grid-cols-4 divide-x divide-[#E2E8F0]">
            <HeroMetric label="KEYWORDS"  value={totals.keywords}  accent="#E2E8F0" />
            <HeroMetric label="BRANDS"    value={totals.brands}    accent="#0F172A" />
            <HeroMetric label="COUNTRIES" value={totals.countries} accent="#10B981" />
            <HeroMetric label="RECORDS"   value={totals.records}   accent="#3B82F6" suffix="rows" />
          </div>

          {/* Page-1 progress bar */}
          <div className="px-6 py-4 border-t border-[#E2E8F0] bg-[#F8FAFC]">
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-mono text-[10px] tracking-[0.2em] text-[#64748B]">PAGE-1 OCCUPANCY</span>
              <span className="font-display text-[26px] tracking-wider text-[#0F172A] leading-none">
                {page1Pct}<span className="text-[14px] text-[#64748B] ml-0.5">%</span>
              </span>
            </div>
            <div className="h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#0F172A] via-[#FBBF24] to-[#10B981]"
                style={{ width: `${page1Pct}%`, transition: 'width 1s ease' }}
              />
            </div>
            <div className="flex justify-between mt-2 font-mono text-[10px] tracking-wider text-[#94A3B8]">
              <span><span className="text-[#0F172A]">{tier.p1}</span> @ P1</span>
              <span><span className="text-[#FBBF24]">{tier.top3}</span> Top-3</span>
              <span><span className="text-[#10B981]">{tier.top10}</span> Top-10</span>
              <span><span className="text-[#3B82F6]">{tier.page2}</span> 11–100</span>
              <span><span className="text-[#475569]">{tier.nr}</span> NR</span>
            </div>
          </div>
        </section>

        {/* ─── SERP DISTRIBUTION TRACK ───────────────────────────────────── */}
        <section
          className="rounded-[14px] border border-[#E2E8F0] bg-white mb-8 overflow-hidden"
          style={{ animation: 'fadeUp 0.5s ease 0.1s both' }}
        >
          <SectionHeader title="SERP Distribution" subtitle="Position frequency · current snapshot" />

          <div className="px-6 pb-6 pt-2">
            {/* Page-1 / Page-2 labels */}
            <div className="grid grid-cols-12 gap-2 mb-2 px-1">
              <div className="col-span-10 flex items-center gap-2">
                <div className="h-px flex-1 bg-[#E2E8F0]" />
                <span className="font-mono text-[9px] tracking-[0.2em] text-[#0F172A]">PAGE 1</span>
                <div className="h-px flex-1 bg-[#E2E8F0]" />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <div className="h-px flex-1 bg-[#E2E8F0]" />
                <span className="font-mono text-[9px] tracking-[0.2em] text-[#94A3B8]">BEYOND</span>
                <div className="h-px flex-1 bg-[#E2E8F0]" />
              </div>
            </div>

            {/* Bars */}
            <div className="grid grid-cols-12 gap-2 items-end h-[160px]">
              {buckets.map((b, i) => (
                <div
                  key={b.key}
                  className="relative flex flex-col items-center group"
                  style={{ animation: `fadeUp 0.5s ease ${0.15 + i * 0.04}s both` }}
                >
                  <span className="font-mono text-[11px] tabular-nums text-[#0F172A] mb-1">{b.count}</span>
                  <div className="relative w-full h-full bg-[#E2E8F0] rounded-sm overflow-hidden">
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-sm"
                      style={{
                        height: `${Math.max(b.pct * 100, b.count > 0 ? 4 : 0)}%`,
                        background: `linear-gradient(180deg, ${TIER_COLOR[b.tier]}, ${TIER_COLOR[b.tier]}88)`,
                        boxShadow: `0 0 12px ${TIER_COLOR[b.tier]}40, inset 0 1px 0 ${TIER_COLOR[b.tier]}cc`,
                      }}
                    />
                    {/* Horizontal scan lines inside the bar */}
                    <div
                      className="absolute inset-0 pointer-events-none opacity-30"
                      style={{
                        backgroundImage: 'repeating-linear-gradient(0deg, transparent 0, transparent 6px, rgba(0,0,0,0.4) 6px, rgba(0,0,0,0.4) 7px)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* X-axis labels */}
            <div className="grid grid-cols-12 gap-2 mt-2">
              {buckets.map((b) => (
                <div key={b.key} className="text-center font-mono text-[10px] tracking-wider text-[#64748B]">
                  {b.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── TWO-COLUMN: LEADERBOARD + MOVERS ──────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 mb-8">

          {/* Brand Leaderboard */}
          <section
            className="rounded-[14px] border border-[#E2E8F0] bg-white overflow-hidden"
            style={{ animation: 'fadeUp 0.5s ease 0.2s both' }}
          >
            <SectionHeader title="Brand Leaderboard" subtitle="Ranked by Top-10 keyword count" />

            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                    <th className="px-5 py-2.5 font-mono text-[10px] tracking-[0.16em] text-[#64748B]">#</th>
                    <th className="px-3 py-2.5 font-mono text-[10px] tracking-[0.16em] text-[#64748B]">Brand</th>
                    <th className="px-3 py-2.5 text-right font-mono text-[10px] tracking-[0.16em] text-[#0F172A]">P1</th>
                    <th className="px-3 py-2.5 text-right font-mono text-[10px] tracking-[0.16em] text-[#FBBF24]">Top-3</th>
                    <th className="px-3 py-2.5 text-right font-mono text-[10px] tracking-[0.16em] text-[#10B981]">Top-10</th>
                    <th className="px-3 py-2.5 text-right font-mono text-[10px] tracking-[0.16em] text-[#64748B]">Total</th>
                    <th className="px-5 py-2.5 font-mono text-[10px] tracking-[0.16em] text-[#64748B]">SHARE</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.length === 0 && (
                    <tr><td colSpan={7} className="px-5 py-6 text-center text-[11px] font-mono text-[#94A3B8]">No brand data in current snapshot.</td></tr>
                  )}
                  {leaderboard.map((row, i) => {
                    const maxT10 = leaderboard[0].t10 || 1
                    const share = row.t10 / maxT10
                    return (
                      <tr
                        key={row.brand.name}
                        onClick={() => { ctx.onSelectBPBrand(row.brand.name); navigate('/bp-sites') }}
                        className="border-b border-[#F1F5F9] hover:bg-[#F1F5F9] cursor-pointer transition-colors group"
                        style={{ animation: `fadeUp 0.4s ease ${0.25 + i * 0.04}s both` }}
                      >
                        <td className="pl-5 pr-2 py-2.5 font-mono text-[11px] text-[#64748B] tabular-nums w-12">
                          {String(i + 1).padStart(2, '0')}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="inline-block w-1 h-7 rounded-sm"
                              style={{ background: row.brand.color }}
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-[#0F172A] truncate">{row.brand.name}</div>
                              <div className="font-mono text-[10px] text-[#64748B] truncate">{row.brand.mainDomain}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#0F172A]">{row.p1 || '·'}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#FBBF24]">{row.t3 || '·'}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#10B981]">{row.t10 || '·'}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#475569]">{row.total}</td>
                        <td className="pl-3 pr-5 py-2.5 w-[120px]">
                          <div className="h-1 bg-[#E2E8F0] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${share * 100}%`, background: row.brand.color, transition: 'width 0.8s ease' }}
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
            className="rounded-[14px] border border-[#E2E8F0] bg-white overflow-hidden"
            style={{ animation: 'fadeUp 0.5s ease 0.25s both' }}
          >
            <SectionHeader title="Top Movers" subtitle="vs. previous snapshot" />

            <div className="px-5 pb-5 pt-2 space-y-4">

              <MoverColumn
                heading="CLIMBERS"
                tint="#10B981"
                arrow="↑"
                rows={movers.climbers}
                empty="No upward movement."
              />

              <div className="h-px bg-[#E2E8F0]" />

              <MoverColumn
                heading="DROPPERS"
                tint="#EF4444"
                arrow="↓"
                rows={movers.droppers}
                empty="No downward movement."
              />
            </div>
          </section>
        </div>

        {/* ─── COUNTRY DISTRIBUTION + QUICK NAV ──────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">

          <section
            className="rounded-[14px] border border-[#E2E8F0] bg-white overflow-hidden"
            style={{ animation: 'fadeUp 0.5s ease 0.3s both' }}
          >
            <SectionHeader title="Country Coverage" subtitle="Record volume by territory" />

            <div className="px-5 pb-5 pt-2 space-y-2.5">
              {countryBars.length === 0 && (
                <p className="text-[11px] font-mono text-[#94A3B8] px-1">No country data.</p>
              )}
              {countryBars.map((c) => (
                <div key={c.country} className="flex items-center gap-3">
                  <div className="w-10 font-display tracking-widest text-[15px] text-[#0F172A]">{c.country}</div>
                  <div className="flex-1 h-2 bg-[#E2E8F0] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#3B82F6] to-[#10B981] rounded-full"
                      style={{ width: `${c.pct * 100}%`, transition: 'width 0.8s ease' }}
                    />
                  </div>
                  <div className="w-12 text-right font-mono text-[11px] tabular-nums text-[#475569]">{c.count}</div>
                </div>
              ))}
            </div>
          </section>

          <section
            className="rounded-[14px] border border-[#E2E8F0] bg-gradient-to-br from-white to-[#F1F5F9] overflow-hidden shadow-sm"
            style={{ animation: 'fadeUp 0.5s ease 0.35s both' }}
          >
            <SectionHeader title="Navigate" subtitle="Jump into a workspace" />

            <div className="grid grid-cols-2 gap-2.5 p-5">
              <QuickLink label="BP Sites"     hint="Brand × keyword matrix"    onClick={() => navigate('/bp-sites')} accent="#0F172A" />
              <QuickLink label="GMB"          hint="Google My Business"         onClick={() => navigate('/gmb')} accent="#EF4444" />
              <QuickLink label="FTDs"         hint="First-time depositors"      onClick={() => navigate('/ftds')} accent="#8B5CF6" />
              <QuickLink label="Import Data"  hint="Upload an XLSX snapshot"    onClick={ctx.onOpenUpload} accent="#FBBF24" filled />
            </div>
          </section>
        </div>

        {/* Footer signature */}
        <div className="mt-10 flex items-center justify-between font-mono text-[10px] tracking-[0.2em] text-[#CBD5E1]">
          <span>END OF FEED ▎</span>
          <span>// {new Date().toISOString().slice(0, 10).replace(/-/g, '.')} //</span>
        </div>
      </div>
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function HeroMetric({
  label, value, accent, suffix,
}: { label: string; value: number; accent: string; suffix?: string }) {
  return (
    <div className="px-6 py-7 relative">
      <div className="font-mono text-[10px] tracking-[0.22em] text-[#64748B] mb-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display tracking-wider leading-none text-[64px]" style={{ color: accent }}>
          {value.toLocaleString()}
        </span>
        {suffix && <span className="font-mono text-[10px] tracking-widest text-[#94A3B8] uppercase">{suffix}</span>}
      </div>
      {/* Decorative corner ticks */}
      <span className="absolute top-2 right-3 font-mono text-[9px] tracking-widest text-[#CBD5E1]">◇</span>
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-end justify-between px-6 py-3 border-b border-[#E2E8F0]">
      <div>
        <h2 className="font-display text-[18px] tracking-[0.16em] text-[#0F172A] leading-none">{title}</h2>
        <p className="font-mono text-[10px] tracking-[0.16em] text-[#64748B] mt-1.5">{subtitle}</p>
      </div>
      <span className="font-mono text-[10px] tracking-widest text-[#CBD5E1]">▎▎▎</span>
    </div>
  )
}

function MoverColumn({
  heading, tint, arrow, rows, empty,
}: {
  heading: string
  tint: string
  arrow: string
  rows: { record: RankingRecord; delta: number; brand: string }[]
  empty: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span style={{ color: tint }} className="font-mono text-[14px] leading-none">{arrow}</span>
        <span className="font-mono text-[10px] tracking-[0.22em]" style={{ color: tint }}>{heading}</span>
        <div className="flex-1 h-px" style={{ background: `${tint}33` }} />
      </div>
      {rows.length === 0 && (
        <p className="text-[11px] font-mono text-[#94A3B8] pl-1">{empty}</p>
      )}
      <ul className="space-y-1">
        {rows.map((m, i) => {
          const brand = BRAND_BY_NAME[m.brand]
          return (
            <li
              key={`${m.brand}-${m.record.keyword}-${m.record.country}-${i}`}
              className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-md hover:bg-[#F1F5F9] transition-colors"
            >
              <span
                className="inline-block w-1 h-5 rounded-sm shrink-0"
                style={{ background: brand?.color ?? '#94A3B8' }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-[#0F172A] truncate">{m.record.keyword}</div>
                <div className="font-mono text-[10px] text-[#64748B] truncate">
                  {m.brand} · {m.record.country} · pos {m.record.position}
                </div>
              </div>
              <span
                className="font-mono text-[11px] tabular-nums font-bold px-2 py-0.5 rounded"
                style={{ color: tint, background: `${tint}1A`, border: `1px solid ${tint}40` }}
              >
                {m.delta > 0 ? '+' : ''}{m.delta}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function QuickLink({
  label, hint, onClick, accent, filled,
}: { label: string; hint: string; onClick: () => void; accent: string; filled?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="group text-left p-3.5 rounded-lg border transition-all duration-150 hover:-translate-y-0.5"
      style={{
        background: filled ? accent : '#FFFFFF',
        borderColor: filled ? accent : '#E2E8F0',
        color: filled ? '#0B0F1A' : '#0F172A',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className="font-display text-[15px] tracking-[0.12em]"
          style={{ color: filled ? '#0B0F1A' : '#0F172A' }}
        >
          {label.toUpperCase()}
        </span>
        <span
          className="font-mono text-[14px] transition-transform group-hover:translate-x-0.5"
          style={{ color: filled ? '#0B0F1A' : accent }}
        >
          →
        </span>
      </div>
      <div
        className="font-mono text-[10px] tracking-[0.1em]"
        style={{ color: filled ? '#0B0F1A99' : '#64748B' }}
      >
        {hint}
      </div>
    </button>
  )
}
