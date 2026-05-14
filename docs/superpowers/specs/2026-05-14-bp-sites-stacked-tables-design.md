# BP Sites — Stacked Per-Date Tables

**Date:** 2026-05-14
**Scope:** `src/pages/BPSites.tsx` only.

## Goal

On the BP Sites brand-detail page, render one matrix table per uploaded snapshot, stacked vertically (newest first), instead of switching between dates via tabs. Every uploaded date materialises a table; deleting a snapshot removes its table.

## Current Behaviour

`BrandView` (in `src/pages/BPSites.tsx`) renders **one** matrix for the active snapshot, switched via `SnapshotTabs`. Filters (countries, keyword search) and the stats row already exist at page level.

## Target Behaviour

- All snapshots that contain data for the active brand render as their own table, in descending date order (newest top).
- Each table preserves the existing layout: date band (with `✕ Delete`), `MAIN — <main domain>` block (GSV + per-country AU/SV/AFF triplets), one `BP — <bp domain>` block per BP domain (country columns only).
- `SnapshotTabs` is removed from this page. (Other pages and the topbar/sidebar still use `activeSnapshotId` — no global change.)
- One shared filter bar above all tables:
  - Country chips drive `visibleCountries` for every table.
  - Keyword search applies per-table when computing that table's keyword list.
- One `StatsRow` at the top, computed from the most recent snapshot only (`brandSnapshots[0]`).
- Spacing between tables: ~24px vertical gap. Outer container keeps `px-7 pb-7`.

## Design

### Component Structure

```
BrandView
├── header (back button + brand name)
├── StatsRow              (most-recent snapshot only)
├── filter bar            (country chips + keyword search — shared)
└── for each snapshot in brandSnapshots:
    └── SnapshotMatrix    (new local helper component)
```

### `SnapshotMatrix` (new, local to the file)

```ts
type Props = {
  snapshot: Snapshot
  brand: Brand
  mainDomain: string           // lowercased
  bpDomains: string[]          // original casing
  visibleCountries: string[]
  kwFilter: string
  onDelete: (id: string) => void
}
```

Internally:
- Builds its own keyword list from `snapshot.records`, applying `kwFilter`.
- Builds its own `Lookup` (`keyword → domain → country → record`) from `snapshot.records`.
- Renders the existing table markup (date band, two-row header, body).

This is a straight extraction of the current `(() => { ... return <div>... })()` IIFE at lines 361–607 of `BPSites.tsx`, generalised over a snapshot prop. No styling changes, no new constants.

### Per-Table Keyword Resolution

Each table's keyword set is derived from that snapshot's own records. A keyword present only in one date appears only there — no blank rows in other tables.

## Out of Scope

- No changes to other pages, sidebar, topbar, or outlet context.
- No changes to `SnapshotTabs` (component still exists, just unused on this page).
- No changes to colour palette, header structure, or `PosBadge`.
- No changes to data loading, storage, or types.

## Verification

- `npm run build` succeeds.
- `npm run dev`: load BP Sites → open any brand with multiple uploaded dates → see N tables stacked, newest on top; filters affect all tables; deleting a table's snapshot removes only that one.
