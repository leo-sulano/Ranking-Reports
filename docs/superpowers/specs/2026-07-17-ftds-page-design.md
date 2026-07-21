# FTDs Page Design

**Date:** 2026-07-17
**Route:** `/ftds` (already exists as a stub)
**Status:** Approved

---

## Overview

Replaces the manually-maintained "MANUAL RANKING UPDATES - ROOSTER PARTNERS" Google Sheet with an in-app page tracking monthly Registrations (REG), First-Time Depositors (FTD), and Conversion % per brand. Includes a one-time historical backfill from the existing sheet (data back to Aug '23), then ongoing monthly entry happens in-app going forward.

This is a fully separate data model from the ranking/keyword feature — FTD data is brand+month shaped, not domain+keyword+country shaped, so it does not reuse `Snapshot`/`RankingRecord`/`CategoryId`.

Built and verified against the local dev server first; ships to Supabase using the same direct-query pattern as `storage.ts` (no ORM).

---

## Data Model (Supabase)

```sql
create table public.ftd_records (
  brand           text not null,        -- matches Brand.name from src/lib/brands.ts
  year_month      text not null,        -- 'YYYY-MM', e.g. '2023-08'
  reg             int not null default 0,
  ftd             int not null default 0,
  conversion_pct  numeric,              -- nullable; manually entered, not derived
  primary key (brand, year_month)
);

create table public.ftd_totals (
  year_month      text primary key,
  conversion_pct  numeric               -- manually entered; Totals REG/FTD are derived client-side, not stored
);

create table public.brand_stags (
  brand  text primary key,
  stags  text not null default ''       -- e.g. "159031, 161387, 161388, 161389, 161390"
);
```

- Totals REG and Totals FTD are **not stored** — computed client-side as the sum of that month's per-brand REG/FTD.
- Totals Conversion % **is stored** — it's a manually entered value, same as per-brand conversion (confirmed: conversion is not a clean same-month FTD÷REG calculation, so it's never derived).
- `brand_stags` holds one row per brand as a reference field, independent of month.

---

## Types

New types (in `src/types/index.ts` or a new `src/types/ftd.ts`):

```ts
export interface FtdRecord {
  brand: string          // Brand.name
  yearMonth: string       // 'YYYY-MM'
  reg: number
  ftd: number
  conversionPct: number | null
}

export interface FtdTotals {
  yearMonth: string
  conversionPct: number | null
}

export interface BrandStags {
  brand: string
  stags: string
}
```

---

## Storage

New `src/lib/ftdStorage.ts`, following `storage.ts`'s existing conventions (direct Supabase calls, explicit snake_case↔camelCase mapping, no ORM/codegen):

- `loadFtdData()` — loads all three tables in one round trip, returns `{ records: FtdRecord[], totals: FtdTotals[], stags: BrandStags[] }`
- `upsertFtdRecord(record: FtdRecord)` — upsert on `(brand, year_month)`
- `upsertFtdTotals(totals: FtdTotals)` — upsert on `year_month`
- `upsertBrandStags(stags: BrandStags)` — upsert on `brand`

State is **local to `FTDs.tsx`** (own `useEffect` load on mount + local `useState`), not hoisted into `Layout`'s global `AppState`/`RROutletContext` — no other page needs this data.

---

## UI

### `FtdMatrixTable` (main view)
- Rows = months, chronological (oldest to newest, matching the sheet)
- Column groups, left to right: **Totals** (REG, FTD, Conv%) first, then one 3-column group (REG, FTD, Conv%) per brand, in `BRANDS` array order
- Sticky first column (month) + sticky header row, horizontal scroll for the rest (mirrors the sheet's own layout, which already requires horizontal scrolling)
- Totals REG/FTD cells are computed/read-only in the table; Totals Conv% is a normal editable cell

### Inline cell editing
- Click any REG / FTD / Conv% cell to edit it directly in place — same interaction pattern as the existing ranking table's cell editing (`onEditCell`)
- Edits write through `upsertFtdRecord` / `upsertFtdTotals` and patch local state optimistically

### `FtdEntryForm` (modal)
- "Add / Edit Month" action opens a modal: pick a year-month, then REG/FTD/Conv% inputs for each brand + a Totals Conv% input
- Totals REG/FTD shown live-computed (read-only) as brand values are typed
- Reopening an existing month prefills current values
- Used both for adding a new month going forward, and as an alternative correction path to inline editing (per your answer: both should work)

### Brand Stags row
- Displayed as a reference row above/within the matrix header, one cell per brand
- Editable inline (click to edit), independent of any month

### One-time "Import History" action
- New `src/lib/ftdParser.ts`, structurally similar to `parser.ts` but built specifically for this sheet's layout (Totals column group first, then per-brand 3-column groups identified by brand abbreviation headers, plus the Stags header row)
- Surfaced as a single upload action (e.g. an empty-state button before any data exists, or a menu action) — not part of the ongoing monthly workflow once historical data is seeded
- Validates each row (numeric REG/FTD, parseable year-month); reports any skipped/invalid rows rather than failing the whole import silently

### Navigation
- Re-add an **FTDs** entry to `Sidebar.tsx`'s `PAGES` array (it was intentionally removed on 2026-06-19 while the page was an unimplemented stub)

---

## Error Handling

- Supabase read/write failures surface via the existing `ToastContainer` pattern already used elsewhere in the app
- Historical import reports which rows were skipped and why, rather than aborting the whole import on a single bad row

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/pages/FTDs.tsx` | Replace stub with real page (matrix table + entry form + import action) |
| `src/types/index.ts` (or new `src/types/ftd.ts`) | Add `FtdRecord`, `FtdTotals`, `BrandStags` types |
| `src/lib/ftdStorage.ts` | New — Supabase load/upsert functions |
| `src/lib/ftdParser.ts` | New — one-time historical sheet import parser |
| `src/components/FtdMatrixTable.tsx` | New — main matrix table component |
| `src/components/FtdEntryForm.tsx` | New — add/edit month modal |
| `supabase/schema.sql` | Add `ftd_records`, `ftd_totals`, `brand_stags` table definitions |
| `src/components/Sidebar.tsx` | Re-add FTDs entry to `PAGES` array |

---

## Out of Scope

- Auto-calculating Conversion % from REG/FTD (confirmed this doesn't cleanly apply — always manually entered)
- Charts/trend visualization for FTD data (v1 is the matrix table only)
- Deprecating/archiving the original Google Sheet (stays as historical reference; not deleted)
