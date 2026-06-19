# Countries Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/countries/:code` page that shows all keyword rankings for a specific country across all brands, combining BP and LP Sites data, with one scrollable table per brand.

**Architecture:** New `Countries.tsx` page component reads the country code from the URL, pulls the latest BP and LP snapshots from outlet context, filters records to the selected country, and renders one `CountryBrandTable` per brand. Routing, sidebar entry, and homepage modal wiring are added in parallel tasks.

**Tech Stack:** React 18, TypeScript, React Router v6, Tailwind v4, existing `PosBadge` component, `BRANDS`/`COUNTRY_LABELS` from `src/lib/brands.ts`.

## Global Constraints

- No test suite — verification is `npm run build` (zero TS errors) + manual `npm run dev` smoke test
- Tailwind v4 — no `tailwind.config.js`; all theme via CSS variables in `src/index.css`
- Dark background: `#07090F` with `#1C2B3A` grid overlay (match existing pages)
- No new dependencies
- Follow existing component patterns: `useOutletContext<RROutletContext>()`, `useMemo`, `useRef` scroll shadow
- Commit directly to `main`

---

## File Map

| File | Change |
|------|--------|
| `src/pages/Countries.tsx` | **Create** — new page + `CountryBrandTable` sub-component |
| `src/App.tsx` | **Modify** — add import + route |
| `src/components/Sidebar.tsx` | **Modify** — add nav entry + countries sub-list |
| `src/pages/Home.tsx` | **Modify** — wire country row clicks in MetricModal |

---

### Task 1: Route + Sidebar + Homepage Wiring

**Files:**
- Modify: `src/App.tsx:23-27` (imports) and `src/App.tsx:418-428` (routes)
- Modify: `src/components/Sidebar.tsx:7-11` (PAGES array) and `src/components/Sidebar.tsx:57-65` (route checks)
- Modify: `src/pages/Home.tsx` (MetricModal countries rows)

**Interfaces:**
- Produces: `/countries/au` route resolves to `<Countries />` (consumed by Task 2)
- Produces: Sidebar renders a globe icon entry linking to `/countries/au`
- Produces: Clicking AU in the homepage Countries modal navigates to `/countries/au`

- [ ] **Step 1: Add Countries import and route to App.tsx**

In `src/App.tsx`, add the import after line 27:
```tsx
import { Countries }     from './pages/Countries'
```

Add the route after the `/ask-ai` route (line 427):
```tsx
          <Route path="/countries/:code" element={<Countries />} />
```

The routes block should now read:
```tsx
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="/bp-sites"                          element={<BPSites />} />
          <Route path="/bp-sites/:brandSlug"               element={<BPSites />} />
          <Route path="/bp-sites/:brandSlug/:domainFilter" element={<BPSites />} />
          <Route path="/lp-sites"                          element={<LPSites />} />
          <Route path="/lp-sites/:brandSlug"               element={<LPSites />} />
          <Route path="/lp-sites/:brandSlug/:domainFilter" element={<LPSites />} />
          <Route path="/ftds"             element={<FTDs />} />
          <Route path="/ask-ai"           element={<AskAI />} />
          <Route path="/countries/:code"  element={<Countries />} />
        </Route>
```

- [ ] **Step 2: Add Countries nav entry to Sidebar PAGES array**

In `src/components/Sidebar.tsx`, add a new entry to the `PAGES` array after the Ask AI entry:

```tsx
  { path: '/countries/au', label: 'Countries', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  )},
```

- [ ] **Step 3: Add Countries route detection + sub-list to Sidebar**

In `src/components/Sidebar.tsx`, find these lines:
```tsx
  const isBPSitesRoute = location.pathname.startsWith('/bp-sites')
  const isLPSitesRoute = location.pathname.startsWith('/lp-sites')
  const hasBrandList   = isBPSitesRoute || isLPSitesRoute
```

Replace with:
```tsx
  const isBPSitesRoute      = location.pathname.startsWith('/bp-sites')
  const isLPSitesRoute      = location.pathname.startsWith('/lp-sites')
  const isCountriesRoute    = location.pathname.startsWith('/countries')
  const hasBrandList        = isBPSitesRoute || isLPSitesRoute || isCountriesRoute
```

Then find the `{hasBrandList ? (` block. It contains the brand sub-list for BP/LP. Add Countries sub-list as a new branch. The full `{hasBrandList ? (` block should become:

```tsx
        {hasBrandList ? (
          <div className={`flex-1 flex flex-col min-h-0 ${labelCls}`}>
            <div className="flex items-center gap-2 px-5 pt-4 pb-2 shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ABABAA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ABABAA] whitespace-nowrap">
                {isBPSitesRoute ? 'BP Sites' : isLPSitesRoute ? 'LP Sites' : 'Countries'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
              {isCountriesRoute ? (
                <>
                  {([
                    { code: 'au', label: 'Australia' },
                    { code: 'ca', label: 'Canada' },
                    { code: 'de', label: 'Germany' },
                    { code: 'it', label: 'Italy' },
                    { code: 'nz', label: 'New Zealand' },
                  ] as const).map(({ code, label }) => {
                    const isActive = location.pathname === `/countries/${code}`
                    return (
                      <button
                        key={code}
                        onClick={() => navigate(`/countries/${code}`)}
                        className={`flex items-center w-full px-3 py-2 rounded-lg text-left transition-colors ${
                          isActive ? 'bg-[#F7F7F5]' : 'hover:bg-[#F7F7F5]'
                        }`}
                      >
                        <span className="text-[11px] font-bold text-[#ABABAA] w-7 shrink-0">{code.toUpperCase()}</span>
                        <span className="text-[12px] font-semibold text-[#0A0A0A] truncate whitespace-nowrap">{label}</span>
                      </button>
                    )
                  })}
                </>
              ) : (
                BRANDS.map((brand) => {
                  const activeSlug = isBPSitesRoute
                    ? (location.pathname.startsWith('/bp-sites/') ? location.pathname.slice('/bp-sites/'.length).split('/')[0] : null)
                    : (location.pathname.startsWith('/lp-sites/') ? location.pathname.slice('/lp-sites/'.length).split('/')[0] : null)
                  const isActive = activeSlug === brandToSlug(brand.name)
                  return (
                    <button
                      key={brand.name}
                      onClick={() => {
                        navigate(isBPSitesRoute
                          ? `/bp-sites/${brandToSlug(brand.name)}`
                          : `/lp-sites/${brandToSlug(brand.name)}`)
                      }}
                      className={`flex items-center w-full px-3 py-2 rounded-lg text-left transition-colors ${
                        isActive ? 'bg-[#F7F7F5]' : 'hover:bg-[#F7F7F5]'
                      }`}
                    >
                      <div className="text-[12px] font-semibold text-[#0A0A0A] truncate whitespace-nowrap">
                        {brand.name}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}
```

- [ ] **Step 4: Wire country rows in Home.tsx MetricModal**

In `src/pages/Home.tsx`, find the `{type === 'countries' && (` block inside `MetricModal`:

```tsx
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
```

Replace with:

```tsx
          {type === 'countries' && (
            <div className="divide-y divide-[#F3F2EE]">
              {details.countries.map(({ country, count }) => (
                <div
                  key={country}
                  className="flex items-center justify-between gap-4 py-2 cursor-pointer hover:bg-[#F5F4EF] rounded-lg px-2 -mx-2 transition-colors"
                  onClick={() => onNavigate(`/countries/${country.toLowerCase()}`)}
                >
                  <span className="text-[13px] font-medium text-[#0A0A0A]">{country}</span>
                  <span className="font-mono text-[11px] text-[#ABABAA] shrink-0">{count} records</span>
                </div>
              ))}
            </div>
          )}
```

- [ ] **Step 5: Type-check**

```bash
npm run build
```

Expected: zero TypeScript errors (the `Countries` import will fail since the file doesn't exist yet — that's expected; create a stub `src/pages/Countries.tsx` first if the build error blocks you):

```tsx
// src/pages/Countries.tsx — temporary stub
export function Countries() { return <div>Countries</div> }
```

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx src/pages/Home.tsx src/pages/Countries.tsx
git commit -m "feat: add /countries/:code route, sidebar entry, and homepage modal wiring"
```

---

### Task 2: Countries.tsx Page

**Files:**
- Create: `src/pages/Countries.tsx`

**Interfaces:**
- Consumes: `useOutletContext<RROutletContext>()` — `snapshots: Snapshot[]`
- Consumes: `useParams<{ code: string }>()` — country code from URL
- Consumes: `PosBadge` from `../components/PosBadge`
- Consumes: `BRANDS`, `COUNTRY_LABELS` from `../lib/brands`
- Consumes: `parsePosition` from `../lib/parser`
- Consumes: `Brand`, `RankingRecord`, `RROutletContext`, `Snapshot` from `../types`

- [ ] **Step 1: Create Countries.tsx with constants and helpers**

Create `src/pages/Countries.tsx`:

```tsx
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { BRANDS, COUNTRY_LABELS } from '../lib/brands'
import { parsePosition } from '../lib/parser'
import { PosBadge } from '../components/PosBadge'
import type { Brand, RankingRecord, RROutletContext, Snapshot } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const COUNTRY_ORDER = ['AU', 'CA', 'DE', 'IT', 'NZ'] as const
type CountryCode = typeof COUNTRY_ORDER[number]

const COUNTRY_NAMES: Record<CountryCode, string> = {
  AU: 'Australia',
  CA: 'Canada',
  DE: 'Germany',
  IT: 'Italy',
  NZ: 'New Zealand',
}

const MAIN_HEADER_BG = '#B4A7D6'
const MAIN_CELL_BG   = '#D9D2E9'
const TABLE_BORDER   = '#B0B7BD'
const STICKY_KW_BG   = '#FFFFFF'
const DATE_BAND_BG   = '#5894CD'
const DATE_BAND_FG   = '#FFFFFF'
const HEADER_FG      = '#000000'

// Same palette as BPSites — BP partner domains
const BP_PALETTE: Array<{ headerBg: string; cellBg: string }> = [
  { headerBg: '#CCCCCC', cellBg: '#D9D9D9' },
  { headerBg: '#FFD966', cellBg: '#FFECB2' },
  { headerBg: '#93C47D', cellBg: '#D9EAD3' },
  { headerBg: '#C27BA0', cellBg: '#EAD1DC' },
]

// Visually distinct palette for LP domains (cyan/orange/cornflower/lightblue)
const LP_PALETTE: Array<{ headerBg: string; cellBg: string }> = [
  { headerBg: '#76A5AF', cellBg: '#D0E0E3' },
  { headerBg: '#E69138', cellBg: '#F9CB9C' },
  { headerBg: '#6FA8DC', cellBg: '#C9DAF8' },
  { headerBg: '#A4C2F4', cellBg: '#D9E1F2' },
  { headerBg: '#76A5AF', cellBg: '#D0E0E3' },
  { headerBg: '#E69138', cellBg: '#F9CB9C' },
  { headerBg: '#6FA8DC', cellBg: '#C9DAF8' },
  { headerBg: '#A4C2F4', cellBg: '#D9E1F2' },
  { headerBg: '#76A5AF', cellBg: '#D0E0E3' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

// keyword.toLowerCase() → domain.toLowerCase() → record
type DomainLookup = Record<string, Record<string, RankingRecord>>

function filterByCountry(records: RankingRecord[], code: string): RankingRecord[] {
  return records.filter(
    (r) => (COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()) === code,
  )
}

function buildDomainLookup(records: RankingRecord[]): DomainLookup {
  const map: DomainLookup = {}
  for (const r of records) {
    const kk = r.keyword.toLowerCase()
    const dk = r.domain.toLowerCase()
    if (!map[kk]) map[kk] = {}
    map[kk][dk] = r
  }
  return map
}

function latestSnap(snapshots: Snapshot[], category: string): Snapshot | null {
  const hits = snapshots
    .filter((s) => s.category === category)
    .sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime())
  return hits[0] ?? null
}

function prevSnap(snapshots: Snapshot[], category: string): Snapshot | null {
  const hits = snapshots
    .filter((s) => s.category === category)
    .sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime())
  return hits[1] ?? null
}

// ─── Entry ────────────────────────────────────────────────────────────────────

export function Countries() {
  const ctx = useOutletContext<RROutletContext>()
  const { code = 'au' } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [kwFilter, setKwFilter] = useState('')

  const countryCode = code.toUpperCase() as CountryCode
  const isValid = (COUNTRY_ORDER as readonly string[]).includes(countryCode)

  useEffect(() => {
    if (!isValid) navigate('/countries/au', { replace: true })
  }, [isValid, navigate])

  const bpSnap  = useMemo(() => latestSnap(ctx.snapshots, 'bp-sites'), [ctx.snapshots])
  const prevBp  = useMemo(() => prevSnap(ctx.snapshots,   'bp-sites'), [ctx.snapshots])
  const lpSnap  = useMemo(() => latestSnap(ctx.snapshots, 'lp-sites'), [ctx.snapshots])
  const prevLp  = useMemo(() => prevSnap(ctx.snapshots,   'lp-sites'), [ctx.snapshots])

  const bpRecs     = useMemo(() => filterByCountry(bpSnap?.records ?? [], countryCode), [bpSnap, countryCode])
  const lpRecs     = useMemo(() => filterByCountry(lpSnap?.records ?? [], countryCode), [lpSnap, countryCode])
  const prevBpRecs = useMemo(() => filterByCountry(prevBp?.records ?? [], countryCode), [prevBp, countryCode])
  const prevLpRecs = useMemo(() => filterByCountry(prevLp?.records ?? [], countryCode), [prevLp, countryCode])

  if (!isValid) return null

  const noData = bpRecs.length === 0 && lpRecs.length === 0
  const countryName = COUNTRY_NAMES[countryCode]

  return (
    <div
      className="flex-1 flex flex-col min-h-0 bg-[#07090F]"
      style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, #1C2B3A 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* ── Page header ── */}
      <div className="px-4 sm:px-6 pt-5 pb-4 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="font-display text-[22px] sm:text-[28px] tracking-wider text-white leading-none">
            {countryName}
          </h1>
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-white/10 text-white/60 select-none">
            {countryCode}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Country chips */}
          {COUNTRY_ORDER.map((c) => (
            <button
              key={c}
              onClick={() => navigate(`/countries/${c.toLowerCase()}`)}
              className={`px-3 py-1 rounded-full text-[12px] font-semibold transition-colors ${
                c === countryCode
                  ? 'bg-white text-[#0A0A0A]'
                  : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
              }`}
            >
              {c}
            </button>
          ))}

          {/* Keyword search */}
          <div className="ml-auto relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40"
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={kwFilter}
              onChange={(e) => setKwFilter(e.target.value)}
              placeholder="Search keywords…"
              className="pl-7 pr-3 py-1 bg-white/10 border border-white/20 rounded-full text-[12px] text-white outline-none w-36 sm:w-44 placeholder:text-white/40 focus:border-white/40 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* ── Brand tables ── */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6 space-y-6">
        {noData ? (
          <div className="flex items-center justify-center h-40 text-white/30 text-[14px]">
            No data for {countryCode} — upload a snapshot to get started.
          </div>
        ) : (
          BRANDS.map((brand) => {
            const bpDomSet = new Set(brand.domains.map((d) => d.toLowerCase()))
            const lpDomSet = new Set((brand.lpDomains ?? []).map((d) => d.toLowerCase()))
            const brandBpRecs     = bpRecs.filter((r) => bpDomSet.has(r.domain.toLowerCase()))
            const brandLpRecs     = lpRecs.filter((r) => lpDomSet.has(r.domain.toLowerCase()))
            const brandPrevBpRecs = prevBpRecs.filter((r) => bpDomSet.has(r.domain.toLowerCase()))
            const brandPrevLpRecs = prevLpRecs.filter((r) => lpDomSet.has(r.domain.toLowerCase()))

            if (brandBpRecs.length === 0 && brandLpRecs.length === 0) return null

            return (
              <CountryBrandTable
                key={brand.name}
                brand={brand}
                bpRecords={brandBpRecs}
                lpRecords={brandLpRecs}
                prevBpRecords={brandPrevBpRecs}
                prevLpRecords={brandPrevLpRecs}
                kwFilter={kwFilter}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add CountryBrandTable sub-component to Countries.tsx**

Append to `src/pages/Countries.tsx`:

```tsx
// ─── CountryBrandTable ────────────────────────────────────────────────────────

function CountryBrandTable({
  brand,
  bpRecords,
  lpRecords,
  prevBpRecords,
  prevLpRecords,
  kwFilter,
}: {
  brand: Brand
  bpRecords: RankingRecord[]
  lpRecords: RankingRecord[]
  prevBpRecords: RankingRecord[]
  prevLpRecords: RankingRecord[]
  kwFilter: string
}) {
  const scrollRef     = useRef<HTMLDivElement>(null)
  const kwColRef      = useRef<HTMLTableCellElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [scrollRightPad, setScrollRightPad] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setScrolled(el.scrollLeft > 4)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const scrollEl = scrollRef.current
    const kwEl     = kwColRef.current
    if (!scrollEl || !kwEl) return
    const rows   = scrollEl.querySelectorAll('thead tr')
    const lastTh = rows.length >= 2
      ? (rows[1].querySelector('th:last-child') as HTMLElement | null)
      : null
    if (!lastTh) return
    const pad = scrollEl.clientWidth - kwEl.offsetWidth - lastTh.offsetWidth
    setScrollRightPad(Math.max(0, pad))
  })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      const atLeft  = el.scrollLeft <= 0
      const atRight = el.scrollLeft >= el.scrollWidth - el.clientWidth
      if ((e.deltaY < 0 && atLeft) || (e.deltaY > 0 && atRight)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const lookup     = useMemo(() => buildDomainLookup([...bpRecords, ...lpRecords]),     [bpRecords, lpRecords])
  const prevLookup = useMemo(() => buildDomainLookup([...prevBpRecords, ...prevLpRecords]), [prevBpRecords, prevLpRecords])
  const hasPrev    = prevBpRecords.length > 0 || prevLpRecords.length > 0

  // Columns: only domains that have at least 1 record for this country
  const activeBpDomainSet = useMemo(() => new Set(bpRecords.map((r) => r.domain.toLowerCase())), [bpRecords])
  const activeLpDomainSet = useMemo(() => new Set(lpRecords.map((r) => r.domain.toLowerCase())), [lpRecords])

  const mainDomain    = brand.mainDomain.toLowerCase()
  const showMain      = activeBpDomainSet.has(mainDomain)
  const activeBpDoms  = brand.domains
    .filter((d) => d.toLowerCase() !== mainDomain && activeBpDomainSet.has(d.toLowerCase()))
  const activeLpDoms  = (brand.lpDomains ?? [])
    .filter((d) => activeLpDomainSet.has(d.toLowerCase()))

  // Keywords: union of all keywords from bp + lp records, filtered by kwFilter
  const keywords = useMemo(() => {
    const seen: Record<string, string> = {}
    for (const r of [...bpRecords, ...lpRecords]) {
      const kl = r.keyword.toLowerCase()
      if (!seen[kl]) seen[kl] = r.keyword
    }
    const filter = kwFilter.trim().toLowerCase()
    return Object.keys(seen)
      .filter((kl) => !filter || kl.includes(filter) || seen[kl].toLowerCase().includes(filter))
      .sort()
      .map((kl) => ({ key: kl, label: seen[kl] }))
  }, [bpRecords, lpRecords, kwFilter])

  if (keywords.length === 0) return null

  const borderStyle = `1px solid ${TABLE_BORDER}`

  const totalDoms = (showMain ? 1 : 0) + activeBpDoms.length + activeLpDoms.length

  return (
    <div className="rounded-xl overflow-hidden shadow-lg" style={{ border: borderStyle }}>
      {/* Brand header band */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 shrink-0"
        style={{ background: DATE_BAND_BG, color: DATE_BAND_FG }}
      >
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: brand.color }} />
        <span className="font-bold text-[13px] tracking-wide">{brand.name}</span>
        <span className="ml-auto font-mono text-[11px] opacity-70">
          {keywords.length} kw · {totalDoms} domain{totalDoms !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Scrollable table */}
      <div ref={scrollRef} className="overflow-x-auto" style={{ background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '100%' }}>
          <thead>
            {/* Row 1 — group labels */}
            <tr>
              <th
                ref={kwColRef}
                rowSpan={2}
                className="sticky left-0 z-[6] px-3 py-2 text-left align-bottom whitespace-nowrap"
                style={{
                  background: STICKY_KW_BG,
                  borderRight: borderStyle,
                  borderBottom: borderStyle,
                  color: HEADER_FG,
                  minWidth: 160,
                  boxShadow: scrolled ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
                }}
              >
                KEYWORD
              </th>

              {showMain && (
                <th
                  className="px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{
                    background: MAIN_HEADER_BG,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                  }}
                >
                  MAIN
                </th>
              )}

              {activeBpDoms.length > 0 && (
                <th
                  colSpan={activeBpDoms.length}
                  className="px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{
                    background: BP_PALETTE[0].headerBg,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: borderStyle,
                    borderBottom: 'none',
                  }}
                >
                  BP
                </th>
              )}

              {activeLpDoms.length > 0 && (
                <th
                  colSpan={activeLpDoms.length}
                  className="px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
                  style={{
                    background: LP_PALETTE[0].headerBg,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: borderStyle,
                    borderBottom: 'none',
                  }}
                >
                  LP
                </th>
              )}

              {/* right-pad spacer */}
              {scrollRightPad > 0 && (
                <th
                  style={{ minWidth: scrollRightPad, background: '#fff', borderBottom: borderStyle }}
                  aria-hidden
                />
              )}
            </tr>

            {/* Row 2 — domain names */}
            <tr>
              {showMain && (
                <th
                  className="px-2 py-1 text-center text-[10px] font-semibold whitespace-nowrap"
                  style={{
                    background: MAIN_HEADER_BG,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                    maxWidth: 140,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {brand.mainDomain}
                </th>
              )}

              {activeBpDoms.map((d, i) => (
                <th
                  key={d}
                  className="px-2 py-1 text-center text-[10px] font-semibold whitespace-nowrap"
                  style={{
                    background: BP_PALETTE[i % BP_PALETTE.length].headerBg,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: i === activeBpDoms.length - 1 ? borderStyle : undefined,
                    borderBottom: borderStyle,
                    maxWidth: 140,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {d}
                </th>
              ))}

              {activeLpDoms.map((d, i) => (
                <th
                  key={d}
                  className="px-2 py-1 text-center text-[10px] font-semibold whitespace-nowrap"
                  style={{
                    background: LP_PALETTE[i % LP_PALETTE.length].headerBg,
                    color: HEADER_FG,
                    borderLeft: borderStyle,
                    borderRight: i === activeLpDoms.length - 1 ? borderStyle : undefined,
                    borderBottom: borderStyle,
                    maxWidth: 140,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {d}
                </th>
              ))}

              {scrollRightPad > 0 && (
                <th
                  style={{ minWidth: scrollRightPad, background: '#fff', borderBottom: borderStyle }}
                  aria-hidden
                />
              )}
            </tr>
          </thead>

          <tbody>
            {keywords.map(({ key: kw, label }) => (
              <tr key={kw}>
                {/* Sticky keyword cell */}
                <td
                  className="sticky left-0 z-[5] px-3 py-2 font-semibold whitespace-nowrap"
                  style={{
                    background: STICKY_KW_BG,
                    color: '#000',
                    borderRight: borderStyle,
                    borderBottom: borderStyle,
                    boxShadow: scrolled ? '4px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
                  }}
                >
                  {label}
                </td>

                {/* MAIN cell */}
                {showMain && (() => {
                  const rec    = lookup[kw]?.[mainDomain]
                  const prevPos = hasPrev ? parsePosition(prevLookup[kw]?.[mainDomain]?.position ?? '') : undefined
                  return (
                    <td
                      key={`main-${kw}`}
                      className="px-2 py-1.5 text-center align-middle min-w-[100px]"
                      style={{
                        background: MAIN_CELL_BG,
                        borderLeft: borderStyle,
                        borderRight: borderStyle,
                        borderBottom: borderStyle,
                      }}
                    >
                      {rec
                        ? <PosBadge record={rec} crossSnapPrevPos={prevPos} />
                        : <span className="text-[#6B7280] text-[11px]">–</span>}
                    </td>
                  )
                })()}

                {/* BP cells */}
                {activeBpDoms.map((d, i) => {
                  const dk     = d.toLowerCase()
                  const rec    = lookup[kw]?.[dk]
                  const prevPos = hasPrev ? parsePosition(prevLookup[kw]?.[dk]?.position ?? '') : undefined
                  return (
                    <td
                      key={`bp-${kw}-${d}`}
                      className="px-2 py-1.5 text-center align-middle min-w-[100px]"
                      style={{
                        background: BP_PALETTE[i % BP_PALETTE.length].cellBg,
                        borderLeft: borderStyle,
                        borderRight: i === activeBpDoms.length - 1 ? borderStyle : undefined,
                        borderBottom: borderStyle,
                      }}
                    >
                      {rec
                        ? <PosBadge record={rec} crossSnapPrevPos={prevPos} />
                        : <span className="text-[#6B7280] text-[11px]">–</span>}
                    </td>
                  )
                })}

                {/* LP cells */}
                {activeLpDoms.map((d, i) => {
                  const dk     = d.toLowerCase()
                  const rec    = lookup[kw]?.[dk]
                  const prevPos = hasPrev ? parsePosition(prevLookup[kw]?.[dk]?.position ?? '') : undefined
                  return (
                    <td
                      key={`lp-${kw}-${d}`}
                      className="px-2 py-1.5 text-center align-middle min-w-[100px]"
                      style={{
                        background: LP_PALETTE[i % LP_PALETTE.length].cellBg,
                        borderLeft: borderStyle,
                        borderRight: i === activeLpDoms.length - 1 ? borderStyle : undefined,
                        borderBottom: borderStyle,
                      }}
                    >
                      {rec
                        ? <PosBadge record={rec} crossSnapPrevPos={prevPos} />
                        : <span className="text-[#6B7280] text-[11px]">–</span>}
                    </td>
                  )
                })}

                {scrollRightPad > 0 && (
                  <td style={{ minWidth: scrollRightPad, borderBottom: borderStyle }} aria-hidden />
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
npm run build
```

Expected: zero TypeScript errors, zero warnings about missing types.

- [ ] **Step 4: Smoke test in dev server**

```bash
npm run dev
```

1. Navigate to `http://localhost:5173/countries/au` — page renders with dark background, country header "Australia · AU", country chips, keyword search
2. Click a different chip (e.g. CA) — URL changes to `/countries/ca`, header updates to "Canada · CA"
3. Brand tables appear for brands that have data for that country — each has a blue band header with brand name
4. MAIN column is purple, BP columns are grey/yellow/green/magenta, LP columns are cyan/orange/cornflower/blue
5. Keyword search filters rows across all tables simultaneously
6. Horizontal scroll works on tables with many domains; keyword column stays sticky
7. Navigate to homepage → click Countries card → AU row → lands on `/countries/au`
8. Sidebar shows globe icon; clicking it goes to `/countries/au`; sub-list shows all 5 countries with active state highlighted
9. Invalid URL `/countries/xx` redirects to `/countries/au`

- [ ] **Step 5: Commit**

```bash
git add src/pages/Countries.tsx
git commit -m "feat: Countries page — per-brand tables with BP/LP columns for selected country"
```
