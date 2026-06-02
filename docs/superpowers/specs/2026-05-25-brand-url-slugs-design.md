# Brand URL Slugs — Design Spec
Date: 2026-05-25

## Overview
Replace the React state-based brand selection (`bpFilterBrand` / `lpFilterBrand`) with URL-based routing so every brand has a shareable, bookmarkable URL — e.g. `/bp-sites/lucky7even` and `/lp-sites/lucky7even`.

## Section 1 — Data layer

### `Brand` type (`src/types/index.ts`)
Add `slug: string` to the `Brand` interface.

### `brands.ts` (`src/lib/brands.ts`)
Add a `slug` field to each brand entry:

| Brand | Slug |
|-------|------|
| Lucky 7even | `lucky7even` |
| RoosterBet | `roosterbet` |
| LuckyVibe | `luckyvibe` |
| SpinsUp | `spinsup` |
| Spinjo | `spinjo` |
| FortunePLay | `fortuneplay` |
| RocketSpin | `rocketspin` |
| PlayMojo | `playmojo` |
| Rollero | `rollero` |

Add a `BRAND_BY_SLUG` lookup map alongside the existing `BRAND_BY_NAME`.

No changes needed to `vercel.json` — the existing catch-all SPA rewrite already handles nested paths.

## Section 2 — Routing (`src/App.tsx`)

Add two new nested routes under `Layout`:
```
<Route path="/bp-sites/:brandSlug" element={<BPSites />} />
<Route path="/lp-sites/:brandSlug" element={<LPSites />} />
```

Remove from `Layout`:
- `bpFilterBrand` and `lpFilterBrand` state and their setters
- Those fields from `RROutletContext`
- Those props from `Sidebar` and `<Outlet context>`

Update `SECTION_TITLES` matching so `/bp-sites/lucky7even` still resolves to the BP Sites section title in the topbar.

### `RROutletContext` (`src/types/index.ts`)
Remove:
- `bpFilterBrand: string | null`
- `lpFilterBrand: string | null`
- `onSelectBPBrand: (name: string | null) => void`
- `onSelectLPBrand: (name: string | null) => void`

## Section 3 — Pages

Both `BPSites.tsx` and `LPSites.tsx` follow the same pattern:

1. Replace context brand fields with `useParams<{ brandSlug?: string }>()`
2. Look up brand via `BRAND_BY_SLUG[brandSlug ?? '']` — unknown/missing slug → render `BrandGrid`
3. `BrandGrid` card clicks call `useNavigate()` to push `/bp-sites/:slug` or `/lp-sites/:slug`
4. `BrandView` back button calls `useNavigate()` to go to `/bp-sites` or `/lp-sites`

## Section 4 — Sidebar (`src/components/Sidebar.tsx`)

Remove props: `activeBPBrand`, `onSelectBPBrand`, `activeLPBrand`, `onSelectLPBrand`.

Derive active brand slug from `useLocation().pathname` (already available in the component).

Brand list items become `<Link>` components pointing to `/bp-sites/:slug` or `/lp-sites/:slug` — no callbacks needed.

## Files changed
- `src/types/index.ts` — add `slug` to `Brand`, remove filter fields from `RROutletContext`
- `src/lib/brands.ts` — add `slug` to each brand, add `BRAND_BY_SLUG`
- `src/App.tsx` — add routes, remove state + props
- `src/pages/BPSites.tsx` — use `useParams`, `useNavigate`
- `src/pages/LPSites.tsx` — use `useParams`, `useNavigate`
- `src/components/Sidebar.tsx` — remove props, use `Link`
