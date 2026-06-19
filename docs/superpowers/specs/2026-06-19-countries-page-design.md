# Countries Page Design

**Date:** 2026-06-19  
**Route:** `/countries/:code`  
**Status:** Approved

---

## Overview

A new dedicated page that shows all keyword rankings for a specific country across every brand, combining both BP Sites and LP Sites data. Navigated to by clicking a country row in the Countries modal on the homepage.

---

## Routing & Navigation

- New route in `App.tsx`: `<Route path="/countries/:code" element={<Countries />} />`
- `code` is uppercase: `AU`, `CA`, `DE`, `IT`, `NZ`
- Countries modal on homepage gets a click handler per row: `onNavigate('/countries/au')`
- Sidebar gets a new nav icon (globe) linking to `/countries/AU` as the default entry point, consistent with how BP Sites and LP Sites are listed

---

## Page Header

- Title: country name + code, e.g. **"Australia · AU"**
- Country switcher chips row: `AU | CA | DE | IT | NZ` — clicking navigates to `/countries/:code`; active country is highlighted. Same chip style as the country filter buttons in BPSites.
- Keyword search input — filters keyword rows across all brand tables simultaneously. Same search box style as BPSites.
- No snapshot date selector — always uses the latest BP and LP snapshots automatically.

---

## Brand Tables

One table per brand, stacked vertically in Brand Leaderboard order (same order as `BRANDS` array). Brands with zero records for the selected country are hidden.

### Brand header bar
- Brand color dot + brand name on the left
- Total record count for that country on the right
- Same visual style as the snapshot date bar in BPSites

### Column structure (per table)
Each domain is one column — no country sub-columns (page is already scoped to one country).

| Group | Header colour | Columns |
|-------|--------------|---------|
| MAIN  | Neutral/white | Brand's `mainDomain` — 1 column |
| BP    | Amber/orange (same as BPSites) | All BP partner domains for this brand |
| LP    | Pastel green (same as LPSites) | All LP domains for this brand |

If a snapshot type is missing entirely (no bp-sites or no lp-sites snapshots loaded), that column group is omitted from all tables.

### Rows
- One row per keyword tracked for that brand in the selected country
- Alphabetically sorted by default
- Filtered by the global keyword search input

### Cells
- Position value: number (`1`, `24`) or `NR` (not ranking)
- Green/red change arrow + previous position delta if a previous snapshot exists
- Same `PosBadge` component style as BPSites/LPSites

---

## Data Sourcing

- **BP data:** Latest snapshot with `category === 'bp-sites'`, records filtered where `COUNTRY_LABELS[r.country] === code`
- **LP data:** Latest snapshot with `category === 'lp-sites'`, records filtered same way
- **Previous snapshot:** Second-latest of each category, used for change arrow calculation
- Both are read from `useOutletContext<RROutletContext>().snapshots` — no new data fetching needed

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/pages/Countries.tsx` | New page component |
| `src/App.tsx` | Add route + import |
| `src/pages/Home.tsx` | Wire country row clicks to `onNavigate('/countries/:code')` in MetricModal |
| Sidebar component | Add globe nav icon linking to `/countries/AU` |

---

## Out of Scope

- Position filter (P1 / Top-3 / Top-10) chips — not included in v1
- Snapshot date picker — always latest
- Exporting data from this page
