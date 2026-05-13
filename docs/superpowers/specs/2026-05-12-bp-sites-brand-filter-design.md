# BP Sites — Sidebar Brand Filter

**Date:** 2026-05-12

## Problem

The sidebar is completely empty when on the `/bp-sites` route. The user wants brand filter items so they can single-select a brand to narrow the BrandGrid to that one card.

## Solution

Add a BP Sites brand filter section to the existing `Sidebar` component, styled identically to the Ranking Reports brand list. Wire state through `App.tsx` and the outlet context.

## Architecture

### State

`App.tsx` (`Layout`) gains one new piece of state:

```ts
const [bpFilterBrand, setBPFilterBrand] = useState<string | null>(null)
```

### Sidebar

New props added to `Sidebar`:

```ts
activeBPBrand: string | null
onSelectBPBrand: (name: string | null) => void
```

When `isBPSitesRoute`, render:
- Section header: "BP Sites" with a globe icon (matches Ranking Reports header style)
- "All Brands" item (active when `activeBPBrand === null`) — left amber border accent when active
- All 9 brand items with color avatar, name, mainDomain — left brand-color border accent when active
- Scrollable list (same `flex-1 overflow-y-auto` pattern as Ranking Reports)

### Outlet Context (`RROutletContext`)

Two fields added:

```ts
bpFilterBrand: string | null
onSelectBPBrand: (name: string | null) => void
```

### BPSites page

`OutletCtx` type updated to include `bpFilterBrand`. `BrandGrid` receives `filterBrand: string | null` and filters `BRANDS` accordingly:

```ts
const visibleBrands = filterBrand ? BRANDS.filter(b => b.name === filterBrand) : BRANDS
```

Existing click-to-drill-down (`activeBrand` local state → `BrandView`) is unchanged.

## Files Changed

| File | Change |
|------|--------|
| `src/components/Sidebar.tsx` | Add BP Sites section + 2 new props |
| `src/pages/RankingReports.tsx` | Add 2 fields to `RROutletContext` interface |
| `src/App.tsx` | Add `bpFilterBrand` state, pass to Sidebar + outlet context |
| `src/pages/BPSites.tsx` | Read `bpFilterBrand` from outlet context, filter `BRANDS` |

## Non-Goals

- No multi-select
- No changes to BrandView (drill-down) behavior
- No changes to any other route
