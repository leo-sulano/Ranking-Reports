# Brand URL Slugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every brand its own shareable URL (`/bp-sites/lucky7even`, `/lp-sites/lucky7even`) by replacing React state-based brand selection with React Router URL params.

**Architecture:** Add `slug` to `Brand`, remove `bpFilterBrand`/`lpFilterBrand` state from Layout, and have `BPSites`/`LPSites` read the active brand from `useParams`. The Sidebar derives active state from the URL and navigates via `<Link>`. No state sync logic — the URL is the single source of truth.

**Tech Stack:** React 19, React Router DOM v7, TypeScript 5.8, Vite (no test framework — use `tsc --noEmit` for verification)

---

## File Map

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `slug` to `Brand`; remove filter fields from `RROutletContext` |
| `src/lib/brands.ts` | Add `slug` to each brand; add `BRAND_BY_SLUG` map |
| `src/App.tsx` | Add brand sub-routes; remove filter state + props |
| `src/pages/BPSites.tsx` | Use `useParams` + `useNavigate`; drop context filter fields |
| `src/pages/LPSites.tsx` | Same pattern as BPSites |
| `src/components/Sidebar.tsx` | Remove filter props; brand items become `<Link>` |

---

### Task 1: Update types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add `slug` to `Brand` and clean `RROutletContext`**

Replace the `Brand` interface and `RROutletContext` interface in `src/types/index.ts`:

```ts
export interface Brand {
  name: string
  abbr: string
  color: string
  slug: string          // ← new
  mainDomain: string
  domains: string[]
  lpDomains: string[]
}
```

```ts
export interface RROutletContext {
  snapshots: Snapshot[]
  activeSnapshotId: string | null
  onSelectSnapshot: (id: string) => void
  onOpenUpload: () => void
  onDeleteSnapshot: (id: string) => void
  onEditCell: (snapshotId: string, matcher: EditCellMatcher, patch: EditCellPatch) => Promise<void>
}
```

(Remove `bpFilterBrand`, `lpFilterBrand`, `onSelectBPBrand`, `onSelectLPBrand` — these four fields are deleted entirely.)

- [ ] **Step 2: Verify types compile**

```
cd "c:\Users\Leo\OneDrive\Desktop\AI Automation\Internal Projects\Ranking Reports"
npx tsc --noEmit 2>&1 | head -40
```

Expected: errors about `bpFilterBrand` / `lpFilterBrand` not existing on type (because App.tsx and pages still reference them). That's fine — subsequent tasks fix those.

- [ ] **Step 3: Commit**

```
git add src/types/index.ts
git commit -m "types: add slug to Brand, remove filter fields from RROutletContext"
```

---

### Task 2: Add slugs and BRAND_BY_SLUG to brands.ts

**Files:**
- Modify: `src/lib/brands.ts`

- [ ] **Step 1: Add `slug` field to every brand entry**

In `src/lib/brands.ts`, add a `slug:` line to each brand object, right after `color:`. Only the `slug` line is added — all other fields stay exactly as they are:

```ts
{ name: 'Lucky 7even',  ..., color: '#F59E0B',  slug: 'lucky7even',   ... }
{ name: 'RoosterBet',   ..., color: '#EF4444',  slug: 'roosterbet',   ... }
{ name: 'LuckyVibe',    ..., color: '#10B981',  slug: 'luckyvibe',    ... }
{ name: 'SpinsUp',      ..., color: '#8B5CF6',  slug: 'spinsup',      ... }
{ name: 'Spinjo',       ..., color: '#38BDF8',  slug: 'spinjo',       ... }
{ name: 'FortunePLay',  ..., color: '#EC4899',  slug: 'fortuneplay',  ... }
{ name: 'RocketSpin',   ..., color: '#F97316',  slug: 'rocketspin',   ... }
{ name: 'PlayMojo',     ..., color: '#14B8A6',  slug: 'playmojo',     ... }
{ name: 'Rollero',      ..., color: '#84CC16',  slug: 'rollero',      ... }
```

For example, the Lucky 7even entry becomes:

```ts
  {
    name: 'Lucky 7even',
    abbr: 'L7',
    color: '#F59E0B',
    slug: 'lucky7even',
    mainDomain: 'lucky7even.com',
    domains: [
      'lucky7even.com',
      'lucky7evencasino.com',
      'lucky7evencasino.io',
      'lucky7evencasino.org',
      'lucky7seven.com',
    ],
    lpDomains: [
      'lucky7even.club',
      'lucky7evencasino.org',
      'lucky7casino.de',
      'lucky7seven.net',
      'lucky7seven.org',
      'lucky7seven.de',
    ],
  },
```

Apply the same `slug:` insertion to all 9 brand objects using the slug table above.


- [ ] **Step 2: Add `BRAND_BY_SLUG` lookup map**

After the existing `BRAND_BY_NAME` definition, add:

```ts
export const BRAND_BY_SLUG: Record<string, Brand> = Object.fromEntries(
  BRANDS.map((b) => [b.slug, b]),
)
```

- [ ] **Step 3: Verify**

```
npx tsc --noEmit 2>&1 | head -40
```

Expected: same errors as before (App.tsx etc. still broken) — no *new* errors.

- [ ] **Step 4: Commit**

```
git add src/lib/brands.ts
git commit -m "brands: add slug field and BRAND_BY_SLUG lookup"
```

---

### Task 3: Update App.tsx — routes, remove filter state

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Remove `bpFilterBrand` / `lpFilterBrand` state**

Delete these two `useState` declarations inside `Layout`:

```ts
// DELETE these two lines:
const [bpFilterBrand, setBPFilterBrand] = useState<string | null>(null)
const [lpFilterBrand, setLPFilterBrand] = useState<string | null>(null)
```

- [ ] **Step 2: Remove filter fields from `rrContext`**

In the `rrContext` object, remove these four lines:

```ts
// DELETE:
bpFilterBrand,
lpFilterBrand,
onSelectBPBrand:   setBPFilterBrand,
onSelectLPBrand:   setLPFilterBrand,
```

- [ ] **Step 3: Remove filter props from `<Sidebar>`**

In the `<Sidebar>` JSX, remove these four props:

```tsx
// DELETE these four props from <Sidebar ...>:
activeBPBrand={bpFilterBrand}
onSelectBPBrand={setBPFilterBrand}
activeLPBrand={lpFilterBrand}
onSelectLPBrand={setLPFilterBrand}
```

- [ ] **Step 4: Add brand sub-routes**

In the `<Routes>` tree inside `App()`, add two new `<Route>` entries after the existing `/bp-sites` and `/lp-sites` routes:

```tsx
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/bp-sites"              element={<BPSites />} />
        <Route path="/bp-sites/:brandSlug"   element={<BPSites />} />
        <Route path="/lp-sites"              element={<LPSites />} />
        <Route path="/lp-sites/:brandSlug"   element={<LPSites />} />
        <Route path="/ftds"                  element={<FTDs />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 5: Verify**

```
npx tsc --noEmit 2>&1 | head -40
```

Expected: errors in `Sidebar.tsx`, `BPSites.tsx`, `LPSites.tsx` about missing/unknown props — no errors in `App.tsx` itself.

- [ ] **Step 6: Commit**

```
git add src/App.tsx
git commit -m "routing: add brand slug sub-routes, remove filter state from Layout"
```

---

### Task 4: Update BPSites.tsx

**Files:**
- Modify: `src/pages/BPSites.tsx`

- [ ] **Step 1: Update imports**

Replace the import line that brings in `useOutletContext`:

```ts
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type { Brand, EditCellMatcher, EditCellPatch, RankingRecord, RROutletContext, Snapshot } from '../types'
import { BRAND_BY_SLUG, BRANDS, COUNTRY_LABELS } from '../lib/brands'
```

(Add `useNavigate`, `useParams` to the react-router-dom import; add `BRAND_BY_SLUG` to the brands import; remove `BRAND_BY_NAME` from the brands import since it's no longer used in the entry component.)

- [ ] **Step 2: Rewrite the `BPSites` entry function**

Replace the entire `BPSites` function (lines 57–82):

```tsx
export function BPSites() {
  const ctx = useOutletContext<RROutletContext>()
  const { snapshots, onEditCell } = ctx
  const { brandSlug } = useParams<{ brandSlug?: string }>()
  const navigate = useNavigate()

  const bpSnapshots = useMemo(
    () => snapshots.filter((s) => s.category === 'bp-sites'),
    [snapshots],
  )
  const activeBrand = brandSlug ? (BRAND_BY_SLUG[brandSlug] ?? null) : null

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

  return (
    <BrandGrid
      snapshots={bpSnapshots}
      onSelect={(b) => navigate(`/bp-sites/${b.slug}`)}
    />
  )
}
```

- [ ] **Step 3: Verify**

```
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors in BPSites.tsx. Remaining errors only in LPSites.tsx and Sidebar.tsx.

- [ ] **Step 4: Commit**

```
git add src/pages/BPSites.tsx
git commit -m "bp-sites: use useParams + useNavigate for URL-based brand routing"
```

---

### Task 5: Update LPSites.tsx

**Files:**
- Modify: `src/pages/LPSites.tsx`

- [ ] **Step 1: Update imports**

```ts
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import type { Brand, RROutletContext, Snapshot } from '../types'
import { BRAND_BY_SLUG, BRANDS, COUNTRY_LABELS } from '../lib/brands'
```

(Add `useNavigate`, `useParams`; add `BRAND_BY_SLUG`; remove `BRAND_BY_NAME`.)

- [ ] **Step 2: Rewrite the `LPSites` entry function**

Replace the entire `LPSites` function (lines 50–74):

```tsx
export function LPSites() {
  const ctx = useOutletContext<RROutletContext>()
  const { snapshots } = ctx
  const { brandSlug } = useParams<{ brandSlug?: string }>()
  const navigate = useNavigate()

  const lpSnapshots = useMemo(
    () => snapshots.filter((s) => s.category === 'lp-sites'),
    [snapshots],
  )
  const activeBrand = brandSlug ? (BRAND_BY_SLUG[brandSlug] ?? null) : null

  if (activeBrand) {
    return (
      <BrandView
        key={activeBrand.name}
        brand={activeBrand}
        snapshots={lpSnapshots}
        onBack={() => navigate('/lp-sites')}
      />
    )
  }

  return (
    <BrandGrid
      snapshots={lpSnapshots}
      onSelect={(b) => navigate(`/lp-sites/${b.slug}`)}
    />
  )
}
```

- [ ] **Step 3: Verify**

```
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors in LPSites.tsx. Only Sidebar.tsx errors remain.

- [ ] **Step 4: Commit**

```
git add src/pages/LPSites.tsx
git commit -m "lp-sites: use useParams + useNavigate for URL-based brand routing"
```

---

### Task 6: Update Sidebar.tsx

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Update imports**

Add `Link` to the react-router-dom import and remove `useNavigate` if it's only used for brand navigation (keep it if it's used for page nav):

```ts
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BRANDS } from '../lib/brands'
```

- [ ] **Step 2: Remove filter props from the `Props` interface and function signature**

Replace the `Props` interface:

```ts
interface Props {
  uploadDate: string | null
  onOpenUpload: () => void
}
```

Replace the `Sidebar` function signature:

```ts
export function Sidebar({
  uploadDate,
  onOpenUpload,
}: Props) {
```

- [ ] **Step 3: Replace the brand sub-list section**

Find the brand items map (the inner `BRANDS.map(...)` block starting around line 129). Replace it entirely:

```tsx
<div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
  {BRANDS.map((brand) => {
    const brandPath = isBPSitesRoute
      ? `/bp-sites/${brand.slug}`
      : `/lp-sites/${brand.slug}`
    const isActive = location.pathname === brandPath
    return (
      <Link
        key={brand.name}
        to={brandPath}
        className={`flex items-center w-full px-3 py-2 rounded-md text-left transition-colors ${
          isActive ? 'bg-[#F1F5F9]' : 'hover:bg-[#F8FAFC]'
        }`}
      >
        <div className="text-[12px] font-semibold text-[#0F172A] truncate whitespace-nowrap">
          {brand.name}
        </div>
      </Link>
    )
  })}
</div>
```

- [ ] **Step 4: Verify — zero type errors**

```
npx tsc --noEmit 2>&1
```

Expected: **no output** (clean compile).

- [ ] **Step 5: Commit**

```
git add src/components/Sidebar.tsx
git commit -m "sidebar: remove filter props, brand items use Link for URL routing"
```

---

### Task 7: Final build + smoke test

- [ ] **Step 1: Full production build**

```
npm run build 2>&1 | tail -20
```

Expected: `✓ built in Xs` with no errors.

- [ ] **Step 2: Start preview server**

```
npm run preview
```

Expected: server starts at `http://localhost:4173`.

- [ ] **Step 3: Smoke test in browser**

Open `http://localhost:4173/bp-sites` — should show the brand grid.
Click **Lucky 7even** — URL should change to `/bp-sites/lucky7even` and the brand detail view loads.
Click **All brands** back button — URL returns to `/bp-sites`.
Navigate directly to `http://localhost:4173/bp-sites/roosterbet` — should load RoosterBet detail directly.
Repeat smoke test for `/lp-sites/luckyvibe`.
Sidebar brand links should highlight the active brand.

- [ ] **Step 4: Commit if any last fixes were made, otherwise done**

```
git log --oneline -6
```
