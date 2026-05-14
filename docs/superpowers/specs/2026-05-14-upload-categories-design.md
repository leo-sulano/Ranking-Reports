# Categorized Uploads (BP Sites only for now)

**Date:** 2026-05-14
**Scope:** Tag every snapshot with a category at upload time. Only show snapshots in their category's page. BP Sites is the only category at launch; the registry is built so adding more is a one-line change.

## Goal

Today every upload feeds the BP Sites page. The user has confirmed that future uploads will not all be BP Sites data, so the upload flow must let the user pick a category and route that snapshot's data to the right page. For now the dropdown only contains "BP Sites".

## Data Model

- Add `category: CategoryId` to the `Snapshot` type.
- Add `category TEXT NOT NULL DEFAULT 'bp-sites'` to the Supabase `snapshots` table. The default backfills every existing row to `'bp-sites'` on migration.
- Snapshot id format becomes `snap-${category}-${rawDate}` so a future "affiliate-sites" upload on the same date does not collide with a "bp-sites" upload.
- Duplicate-detection key changes from `rawDate` to `(category, rawDate)`.

## Category Registry

New file `src/lib/categories.ts`:

```ts
export type CategoryId = 'bp-sites'

export interface Category {
  id: CategoryId
  label: string   // dropdown label
  path:  string   // route this category's data shows on
}

export const CATEGORIES: Category[] = [
  { id: 'bp-sites', label: 'BP Sites', path: '/bp-sites' },
]

export const DEFAULT_CATEGORY: CategoryId = 'bp-sites'
```

Adding a future category = one entry here + a route in `App.tsx`.

## UploadModal

- A category `<select>` sits at the top of the modal body, above the drop zone.
- Defaults to `'bp-sites'`. Required.
- `onImport` signature becomes `(records: RankingRecord[], category: CategoryId) => void`.

## App.tsx Wiring

- `persistSnapshot(records, category)` builds the snapshot id from `category + rawDate` and stores `category` on the snapshot.
- `handleImport(records, category)` runs dup detection on `(category, rawDate)` and forwards.
- `handleReplaceDuplicate` preserves the existing snapshot's `category` when replacing.

## BPSites Filtering

`BPSites` page pre-filters `snapshots` to those with `category === 'bp-sites'` at the top of the component. The brand grid's "has data" badge and the brand-detail stacked tables both see only BP Sites snapshots.

## Stats / Topbar / Sidebar

No change. The "last upload date" indicators keep reflecting the most recent snapshot across all categories — they are a global last-upload signal, not category-specific.

## Files Changed

| File | Change |
|---|---|
| `src/types/index.ts` | Add `category: CategoryId` to `Snapshot` |
| `src/lib/categories.ts` | New — registry + `DEFAULT_CATEGORY` |
| `src/lib/storage.ts` | Read/write `category` column on `snapshots` table |
| `src/components/UploadModal.tsx` | Category `<select>`; pass category in `onImport` |
| `src/App.tsx` | Plumb category through `persistSnapshot` / `handleImport`; id includes category |
| `src/pages/BPSites.tsx` | Pre-filter `snapshots` to `category === 'bp-sites'` |

## Supabase Migration (user runs once)

```sql
ALTER TABLE snapshots
  ADD COLUMN category TEXT NOT NULL DEFAULT 'bp-sites';
```

## Out of Scope

- No changes to Home, FTDs, Topbar, Sidebar, or the matrix-table internals.
- No UI for editing or deleting categories.
- No backfill UI — relying on the SQL column default to tag existing rows.

## Verification

- `npm run build` succeeds.
- Run the SQL migration in Supabase; existing snapshots still appear on `/bp-sites`.
- Open the upload modal → category dropdown shows "BP Sites" as the only option, defaults to it.
- Upload a new file → it appears on `/bp-sites` and survives a refresh.
- Re-uploading the same file with the same category triggers the duplicate warning. (Re-uploading the same date under a *different* future category will not, once more categories exist.)
