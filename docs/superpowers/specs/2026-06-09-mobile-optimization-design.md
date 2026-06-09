# Mobile Optimization Design

**Date:** 2026-06-09  
**Scope:** Full app sweep — LP Sites grid, Country map, BrandView tables, minor Home padding

## Changes

### 1. LP Sites BrandGrid (`src/pages/LPSites.tsx`)
- Container padding: `px-7` → `px-3 sm:px-7`
- Grid columns: `grid-cols-3` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`

### 2. Country Coverage map (`src/pages/Home.tsx`)
- Section min-height: `min-h-[300px]` → `min-h-[260px] sm:min-h-[340px]`
- Add `overflow-x-hidden` to the section to prevent SVG spillover

### 3. BrandView data tables — BP Sites (`src/pages/BPSites.tsx`)
- Locate the table container in BrandView and confirm `overflow-x-auto` is present; add if missing

### 4. BrandView data tables — LP Sites (`src/pages/LPSites.tsx`)
- Same as above for the LP BrandView table container

## Out of scope
- Home middle row (already collapses to single column via `lg:grid-cols-3`)
- Home Brand Leaderboard table (already has `overflow-x-auto`)
- BP Sites BrandGrid (already has `grid-cols-2 sm:grid-cols-3`)
- No card/list view for data tables — horizontal scroll is the right pattern for dense SEO data
