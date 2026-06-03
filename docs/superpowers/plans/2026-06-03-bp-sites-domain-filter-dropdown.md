# BP Sites — Domain Filter Dropdown & Per-Domain URL Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the BP Sites pill-button site filter with a dropdown whose selection is reflected in the URL slug (e.g. `/bp-sites/lucky7even/lucky7evencasino.com`).

**Architecture:** URL is the single source of truth — a new `/:domainFilter` route segment feeds `BrandView` which derives column visibility purely from the param, removing `showMain`/`activeBpDomains` local state entirely. Selecting a dropdown option calls `navigate()` with the new path; the dropdown reads `useParams` to stay in sync.

**Tech Stack:** React 18 · React Router v6 · TypeScript · Tailwind v4 · Vite

---

### Task 1: Add the `/:domainFilter` route in App.tsx

**Files:**
- Modify: `src/App.tsx:418-419`

No test suite exists (`No test suite is configured` in CLAUDE.md). Verify manually at the end.

- [ ] **Step 1: Add the new route**

In `src/App.tsx`, find the two existing BP Sites routes and add one new route immediately after them:

```tsx
// Before (lines 418-419):
<Route path="/bp-sites"              element={<BPSites />} />
<Route path="/bp-sites/:brandSlug"   element={<BPSites />} />

// After:
<Route path="/bp-sites"                          element={<BPSites />} />
<Route path="/bp-sites/:brandSlug"               element={<BPSites />} />
<Route path="/bp-sites/:brandSlug/:domainFilter" element={<BPSites />} />
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat(bp-sites): add /:domainFilter route"
```

---

### Task 2: Pass `domainFilter` from `BPSites` entry into `BrandView`

**Files:**
- Modify: `src/pages/BPSites.tsx` — `BPSites` function (lines 57-82) and `BrandView` signature (lines 174-184)

- [ ] **Step 1: Read `domainFilter` from `useParams` in `BPSites`**

Replace the `useParams` call at line 60 (currently only reads `brandSlug`):

```tsx
// Before:
const { brandSlug } = useParams<{ brandSlug: string }>()

// After:
const { brandSlug, domainFilter } = useParams<{ brandSlug: string; domainFilter: string }>()
```

- [ ] **Step 2: Pass `domainFilter` to `BrandView`**

In the `if (activeBrand)` block (lines 69-79), add the new prop:

```tsx
// Before:
if (activeBrand) {
  return (
    <BrandView
      key={activeBrand.name}
      brand={activeBrand}
      snapshots={bpSnapshots}
      onBack={() => navigate('/bp-sites')}
      onEditCell={onEditCell}
    />
  )
}

// After:
if (activeBrand) {
  return (
    <BrandView
      key={activeBrand.name}
      brand={activeBrand}
      snapshots={bpSnapshots}
      domainFilter={domainFilter}
      onBack={() => navigate('/bp-sites')}
      onEditCell={onEditCell}
    />
  )
}
```

- [ ] **Step 3: Add `domainFilter` to the `BrandView` props destructure and type**

Find the `BrandView` function signature (around line 174):

```tsx
// Before:
function BrandView({
  brand,
  snapshots,
  onBack,
  onEditCell,
}: {
  brand: Brand
  snapshots: Snapshot[]
  onBack: () => void
  onEditCell: EditCellFn
})

// After:
function BrandView({
  brand,
  snapshots,
  domainFilter,
  onBack,
  onEditCell,
}: {
  brand: Brand
  snapshots: Snapshot[]
  domainFilter: string | undefined
  onBack: () => void
  onEditCell: EditCellFn
})
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/BPSites.tsx
git commit -m "feat(bp-sites): wire domainFilter param into BrandView"
```

---

### Task 3: Derive column visibility from `domainFilter` (remove local state)

**Files:**
- Modify: `src/pages/BPSites.tsx` — inside `BrandView`, lines ~212-268

- [ ] **Step 1: Remove `activeBpDomains` state, `showMain` state, and `toggleBpDomain` handler**

Delete these three blocks (around lines 213-239):

```tsx
// DELETE these lines:
const [activeBpDomains, setActiveBpDomains] = useState<string[]>(() => bpDomains)
const [showMain, setShowMain] = useState(true)
// ...
const toggleBpDomain = (d: string) => {
  setActiveBpDomains((prev) => {
    if (prev.includes(d) && prev.length === 1) return prev
    return prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
  })
}
```

- [ ] **Step 2: Add derived `showMain` and `visibleBpDomains` in their place**

Immediately after the `bpDomains` useMemo (around line 194), add:

```tsx
// Derived from URL param — no local state needed
const showMain = !domainFilter || domainFilter === 'main'

const visibleBpDomains = useMemo(() => {
  if (!domainFilter || domainFilter === 'bp') return bpDomains
  if (domainFilter === 'main') return []
  const match = bpDomains.find((d) => d.toLowerCase() === domainFilter.toLowerCase())
  return match ? [match] : bpDomains // unknown filter → show all (graceful fallback)
}, [domainFilter, bpDomains])
```

- [ ] **Step 3: Remove the old `visibleBpDomains` derived line**

Find and delete the old derivation (around line 268) — it's now computed above:

```tsx
// DELETE this line:
const visibleBpDomains = bpDomains.filter((d) => activeBpDomains.includes(d))
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no type errors. Fix any if they appear (likely a stale reference to `activeBpDomains` or `toggleBpDomain`).

- [ ] **Step 5: Commit**

```bash
git add src/pages/BPSites.tsx
git commit -m "feat(bp-sites): derive column visibility from URL domainFilter param"
```

---

### Task 4: Replace pill row with dropdown

**Files:**
- Modify: `src/pages/BPSites.tsx` — the Sites pill row block (lines ~316-351)

- [ ] **Step 1: Add `useNavigate` inside `BrandView`**

`BrandView` currently has no `navigate` — it receives `onBack` for the back button but needs its own navigate for the dropdown. Add this line near the top of `BrandView`, right after the `mainDomain` / `bpDomains` derivations (around line 194):

```tsx
const navigate = useNavigate()
```

`useNavigate` is already imported at the top of the file (`import { useOutletContext, useParams, useNavigate } from 'react-router-dom'`), so no import change is needed.

- [ ] **Step 2: Replace the entire Sites pill block with a dropdown**

Find and replace the Sites filter section. The current block looks like:

```tsx
{/* Sites filter — toggles which domain columns/sections show.
    MAIN chip can be hidden too; BPs keep the min-one-active rule.  */}
<div className="flex items-center gap-1.5 px-7 pb-2 shrink-0 flex-wrap">
  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] mr-1">
    Sites
  </span>

  <button
    onClick={() => setShowMain((v) => !v)}
    className="px-3 py-1 rounded-full text-[12px] font-sans border transition-all flex items-center gap-1.5"
    style={
      showMain
        ? { background: '#0F172A', color: 'white', borderColor: 'transparent', fontWeight: 700 }
        : { background: 'white', color: '#475569', borderColor: '#E2E8F0' }
    }
  >
    <span className="text-[9px] font-bold uppercase tracking-[0.1em] opacity-70">Main</span>
    {brand.mainDomain}
  </button>

  {bpDomains.map((d) => {
    const active = activeBpDomains.includes(d)
    return (
      <button
        key={d}
        onClick={() => toggleBpDomain(d)}
        className="px-3 py-1 rounded-full text-[12px] font-sans border transition-all"
        style={
          active
            ? { background: '#CBD5E1', color: '#0F172A', borderColor: 'transparent', fontWeight: 700 }
            : { background: 'white', color: '#475569', borderColor: '#E2E8F0' }
        }
      >
        {d}
      </button>
    )
  })}
</div>
```

Replace it with:

```tsx
{/* Sites filter — dropdown; selection navigates to new URL slug */}
<div className="flex items-center gap-1.5 px-7 pb-2 shrink-0">
  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] mr-1">
    Sites
  </span>
  <div className="relative">
    <select
      value={(() => {
        if (!domainFilter) return ''
        if (domainFilter === 'main' || domainFilter === 'bp') return domainFilter
        if (bpDomains.some((d) => d.toLowerCase() === domainFilter.toLowerCase())) return domainFilter
        return ''
      })()}
      onChange={(e) => {
        const val = e.target.value
        const base = `/bp-sites/${brandToSlug(brand.name)}`
        navigate(val ? `${base}/${val}` : base)
      }}
      className="appearance-none pl-3 pr-7 py-1 bg-white border border-[#E2E8F0] rounded-full text-[12px] text-[#0F172A] font-medium cursor-pointer outline-none focus:border-[#CBD5E1] transition-colors"
    >
      <option value="">All — {mainDomain} + {bpDomains.length} BP</option>
      <option value="main">Main — {mainDomain}</option>
      <option value="bp">BP Sites — all {bpDomains.length}</option>
      <optgroup label="Individual">
        {bpDomains.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </optgroup>
    </select>
    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none w-3 h-3 text-[#94A3B8]" />
  </div>
</div>
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/BPSites.tsx
git commit -m "feat(bp-sites): replace site filter pills with URL-driven dropdown"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open `http://localhost:5173/bp-sites/lucky7even`.

- [ ] **Step 2: Verify All view**

URL: `/bp-sites/lucky7even`
Expected: dropdown shows "All — lucky7even.com + 4 BP", main column + all 4 BP domain columns visible.

- [ ] **Step 3: Verify Main**

Select "Main" from dropdown.
Expected: URL changes to `/bp-sites/lucky7even/main`, only main (lucky7even.com) columns visible, no BP columns.

- [ ] **Step 4: Verify BP Sites**

Select "BP Sites" from dropdown.
Expected: URL changes to `/bp-sites/lucky7even/bp`, main column hidden, all 4 BP domain columns visible.

- [ ] **Step 5: Verify individual domain**

Select "lucky7evencasino.com" from dropdown.
Expected: URL changes to `/bp-sites/lucky7even/lucky7evencasino.com`, only lucky7evencasino.com columns visible.

- [ ] **Step 6: Verify direct URL navigation**

Paste `/bp-sites/lucky7even/lucky7evencasino.io` into the browser address bar.
Expected: page loads with dropdown showing "lucky7evencasino.io" and only that domain's columns.

- [ ] **Step 7: Verify sidebar stays in sync**

While on `/bp-sites/lucky7even/lucky7evencasino.com`, check that "Lucky 7even" is still highlighted in the sidebar.

- [ ] **Step 8: Verify invalid filter fallback**

Navigate to `/bp-sites/lucky7even/garbage`.
Expected: dropdown shows "All" (falls back gracefully), all columns visible.

- [ ] **Step 9: Push to main**

```bash
git push
```
