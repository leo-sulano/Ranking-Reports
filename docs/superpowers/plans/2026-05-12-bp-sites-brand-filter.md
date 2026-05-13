# BP Sites Brand Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-select brand filter list to the sidebar on the `/bp-sites` route so users can narrow the BrandGrid to one brand card.

**Architecture:** `App.tsx` holds `bpFilterBrand: string | null` state and passes it down to `Sidebar` (new props) and through the outlet context to `BPSites`. `BPSites` filters `BRANDS` before passing to `BrandGrid`. No new components are created — all changes are additive edits to existing files.

**Tech Stack:** React 18, TypeScript, React Router v6, Tailwind v4

> **Note:** No test suite is configured in this project. TDD steps are replaced with dev-server manual verification.

---

## File Map

| File | Change |
|------|--------|
| `src/pages/RankingReports.tsx` | Add `bpFilterBrand` + `onSelectBPBrand` to `RROutletContext` interface |
| `src/App.tsx` | Add `bpFilterBrand` state + `selectBPBrand` callback; pass both to `Sidebar` and outlet context |
| `src/components/Sidebar.tsx` | Add 2 new props; render BP Sites brand filter section when `isBPSitesRoute` |
| `src/pages/BPSites.tsx` | Read `bpFilterBrand` from outlet context; filter `BRANDS` in `BrandGrid` |

---

### Task 1: Extend `RROutletContext` with BP filter fields

**Files:**
- Modify: `src/pages/RankingReports.tsx:12-30`

- [ ] **Step 1: Add two fields to the `RROutletContext` interface**

Open `src/pages/RankingReports.tsx`. The interface currently ends at `onOpenUpload`. Add two fields after `onSelectOverview`:

```ts
export interface RROutletContext {
  snapshots: Snapshot[]
  activeSnapshotId: string | null
  activeBrand: string | null
  activeCountries: string[]
  activeDomains: string[]
  kwFilter: string
  activeRecords: RankingRecord[]
  visibleRecords: RankingRecord[]
  availableCountries: string[]
  availableDomains: string[]
  onSelectSnapshot: (id: string) => void
  onSelectBrand: (name: string) => void
  onSelectOverview: () => void
  onToggleCountry: (c: string) => void
  onToggleDomain: (d: string) => void
  onKwFilter: (v: string) => void
  onOpenUpload: () => void
  bpFilterBrand: string | null
  onSelectBPBrand: (name: string | null) => void
}
```

- [ ] **Step 2: Verify TypeScript is happy so far**

```bash
npx tsc --noEmit
```

Expected: errors about `bpFilterBrand` and `onSelectBPBrand` not yet provided by `App.tsx`. That is correct — the interface is ahead of the wiring. Proceed.

- [ ] **Step 3: Commit**

```bash
git add src/pages/RankingReports.tsx
git commit -m "feat: extend RROutletContext with bpFilterBrand fields"
```

---

### Task 2: Add state and callbacks in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `bpFilterBrand` state to `Layout`**

Inside the `Layout` function, after the existing `useState` declarations (around line 63), add:

```ts
const [bpFilterBrand, setBPFilterBrand] = useState<string | null>(null)
```

- [ ] **Step 2: Add `selectBPBrand` callback**

After the `setKwFilter` callback (around line 181), add:

```ts
const selectBPBrand = useCallback((name: string | null) => {
  setBPFilterBrand(name)
}, [])
```

- [ ] **Step 3: Pass new props to `Sidebar`**

Find the `<Sidebar` JSX block (around line 245) and add two props:

```tsx
<Sidebar
  brands={BRANDS}
  records={activeRecords}
  activeBrand={state.activeBrand}
  uploadDate={activeSnapshot?.displayDate ?? null}
  onSelectBrand={selectBrand}
  onSelectOverview={selectOverview}
  onOpenUpload={() => setShowUpload(true)}
  activeBPBrand={bpFilterBrand}
  onSelectBPBrand={selectBPBrand}
/>
```

- [ ] **Step 4: Add fields to the outlet context object**

Find the `rrContext` object (around line 213) and add two entries at the end:

```ts
const rrContext: RROutletContext = {
  snapshots:         state.snapshots,
  activeSnapshotId:  state.activeSnapshotId,
  activeBrand:       state.activeBrand,
  activeCountries:   state.activeCountries,
  activeDomains:     state.activeDomains,
  kwFilter:          state.kwFilter,
  activeRecords,
  visibleRecords,
  availableCountries,
  availableDomains,
  onSelectSnapshot:  selectSnapshot,
  onSelectBrand:     selectBrand,
  onSelectOverview:  selectOverview,
  onToggleCountry:   toggleCountry,
  onToggleDomain:    toggleDomain,
  onKwFilter:        setKwFilter,
  onOpenUpload:      () => setShowUpload(true),
  bpFilterBrand,
  onSelectBPBrand:   selectBPBrand,
}
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: errors on `Sidebar` (props not yet accepted) and `BPSites` (not yet reading from context). That's fine — proceed.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add bpFilterBrand state and wire to sidebar + outlet context"
```

---

### Task 3: Render BP Sites brand filter in `Sidebar`

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add the two new props to the `Props` interface**

Find the `interface Props` block at the top of the file and add:

```ts
interface Props {
  brands: Brand[]
  records: RankingRecord[]
  activeBrand: string | null
  uploadDate: string | null
  onSelectBrand: (name: string) => void
  onSelectOverview: () => void
  onOpenUpload: () => void
  activeBPBrand: string | null
  onSelectBPBrand: (name: string | null) => void
}
```

- [ ] **Step 2: Destructure the new props in the function signature**

Find the `export function Sidebar({` line and add the two new props to the destructuring:

```ts
export function Sidebar({
  brands,
  records,
  activeBrand,
  uploadDate,
  onSelectBrand,
  onSelectOverview,
  onOpenUpload,
  activeBPBrand,
  onSelectBPBrand,
}: Props) {
```

- [ ] **Step 3: Replace the empty BP Sites spacer with the filter section**

Find this line (around line 45):

```tsx
{isBPSitesRoute && <div className="flex-1" />}
```

Replace it entirely with:

```tsx
{isBPSitesRoute && (
  <>
    <div className="flex items-center gap-2 px-5 pt-4 pb-2 shrink-0">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
        BP Sites
      </span>
    </div>

    <button
      onClick={() => onSelectBPBrand(null)}
      className={`flex items-center gap-2.5 mx-2.5 mb-0.5 px-2.5 py-2 rounded-md text-left transition-colors relative ${
        activeBPBrand === null
          ? 'bg-[#111928] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-sm before:bg-[#F59E0B]'
          : 'hover:bg-[#151F30]'
      }`}
    >
      <div className="w-7 h-7 rounded-lg bg-[#1C2B3A] flex items-center justify-center text-[#F59E0B] text-sm shrink-0">
        ⊞
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-[#E2E8F0]">All Brands</div>
        <div className="text-[10px] text-[#64748B] font-mono">{brands.length} brands</div>
      </div>
    </button>

    <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
      {brands.map((brand) => {
        const isActive = activeBPBrand === brand.name
        return (
          <button
            key={brand.name}
            onClick={() => onSelectBPBrand(brand.name)}
            className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-left transition-colors relative ${
              isActive ? 'bg-[#111928]' : 'hover:bg-[#151F30]'
            }`}
          >
            {isActive && (
              <span
                className="absolute left-0 top-1 bottom-1 w-0.5 rounded-sm"
                style={{ background: brand.color }}
              />
            )}
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center font-display text-[11px] text-black shrink-0"
              style={{ background: brand.color, opacity: isActive ? 1 : 0.85 }}
            >
              {brand.abbr}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-[#E2E8F0] truncate">{brand.name}</div>
              <div className="text-[10px] text-[#64748B] font-mono truncate">{brand.mainDomain}</div>
            </div>
          </button>
        )
      })}
    </div>
  </>
)}
```

- [ ] **Step 4: Remove the now-redundant non-ranking spacer**

Find this line further down (around line 113):

```tsx
{/* Spacer for non-ranking routes */}
{!isRankingRoute && <div className="flex-1" />}
```

Since `isBPSitesRoute` now renders its own `flex-1` scroll area, the `!isRankingRoute` spacer would also fire on `/bp-sites` and create a double spacer. Change the condition to exclude BP Sites:

```tsx
{!isRankingRoute && !isBPSitesRoute && <div className="flex-1" />}
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: one remaining error — `BPSites` not yet reading `bpFilterBrand` from context. Proceed.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add BP Sites brand filter section to sidebar"
```

---

### Task 4: Wire filter into `BPSites` page

**Files:**
- Modify: `src/pages/BPSites.tsx`

- [ ] **Step 1: Update `OutletCtx` type and read `bpFilterBrand`**

At the top of `BPSites.tsx`, find:

```ts
interface OutletCtx { snapshots: Snapshot[] }
```

Replace with:

```ts
interface OutletCtx {
  snapshots: Snapshot[]
  bpFilterBrand: string | null
}
```

- [ ] **Step 2: Destructure `bpFilterBrand` from outlet context**

Find the line inside `BPSites`:

```ts
const { snapshots } = useOutletContext<OutletCtx>()
```

Replace with:

```ts
const { snapshots, bpFilterBrand } = useOutletContext<OutletCtx>()
```

- [ ] **Step 3: Pass `filterBrand` to `BrandGrid`**

Find the `<BrandGrid` JSX and add the prop:

```tsx
return <BrandGrid snapshots={snapshots} onSelect={setActiveBrand} filterBrand={bpFilterBrand} />
```

- [ ] **Step 4: Update `BrandGrid` to accept and apply the filter**

Find the `BrandGrid` function signature:

```ts
function BrandGrid({
  snapshots,
  onSelect,
}: {
  snapshots: Snapshot[]
  onSelect: (b: Brand) => void
}) {
```

Replace with:

```ts
function BrandGrid({
  snapshots,
  onSelect,
  filterBrand,
}: {
  snapshots: Snapshot[]
  onSelect: (b: Brand) => void
  filterBrand: string | null
}) {
```

- [ ] **Step 5: Filter the brands list inside `BrandGrid`**

Inside `BrandGrid`, find the line:

```tsx
{BRANDS.map((brand, idx) => {
```

Add a derived constant just before the `return` statement:

```ts
const visibleBrands = filterBrand ? BRANDS.filter((b) => b.name === filterBrand) : BRANDS
```

Then change `BRANDS.map` to `visibleBrands.map`:

```tsx
{visibleBrands.map((brand, idx) => {
```

- [ ] **Step 6: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run dev server and manually verify**

```bash
npm run dev
```

Check:
1. Navigate to `/bp-sites` — sidebar shows "BP Sites" header, "All Brands" item (active, amber accent), and all 9 brand items
2. All 9 brand cards appear in the grid
3. Click a brand in the sidebar — only that brand's card shows in the grid; left-border accent appears on the sidebar item
4. Click "All Brands" — all 9 cards reappear; amber accent returns to "All Brands"
5. Click a brand card — drills into `BrandView` as before (unaffected)
6. Navigate to `/ranking-reports` — sidebar is unchanged

- [ ] **Step 8: Commit**

```bash
git add src/pages/BPSites.tsx
git commit -m "feat: filter BrandGrid by sidebar brand selection"
```
