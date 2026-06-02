# Ranking Reports — Project Documentation

---

## 1. Project Overview

**Ranking Reports** is an internal SEO dashboard for Rooster Partners, built to track Google keyword ranking positions across all 9 casino brands and their associated domains. Prior to this tool, ranking data lived in Google Sheets, making cross-brand comparison, historical trend analysis, and data management error-prone and slow.

**What it does:**
- Ingests weekly ranking exports (`.xlsx` files) from rank-tracking tools
- Stores historical snapshots in a Supabase database
- Displays per-brand, per-domain, per-country, and per-keyword ranking data
- Shows movement indicators (improved / dropped / unchanged / not ranking)
- Tracks supplementary SEO metadata: Search Volume (SV), Global Search Volume (GSV), and Affiliate URLs (AFF)
- Supports two asset categories: Brand Properties (BP Sites) and Landing Pages (LP Sites)

**Brands tracked:** Lucky 7even, RoosterBet, LuckyVibe, SpinsUp, Spinjo, FortunePLay, RocketSpin, PlayMojo, Rollero

**Countries tracked:** AU, CA, DE, IT, NZ

**Current status:** Active and in production use. FTDs page is a stub (not yet implemented).

---

## 2. Requirements

### Functional Requirements

| # | Requirement |
|---|-------------|
| F1 | Upload `.xlsx` ranking files for BP Sites or LP Sites |
| F2 | Auto-detect flat-format vs. legacy matrix-format workbooks |
| F3 | Parse and store snapshots (date + records) in Supabase |
| F4 | Display an overview grid of all brands with latest ranking stats |
| F5 | Drill into a brand to see a full ranking table filterable by domain, country, and keyword |
| F6 | Switch between historical snapshots via a date tab bar |
| F7 | Show position movement badges (⬆ improved, ⬇ dropped, NR, unchanged) |
| F8 | Inline-edit GSV, SV, and AFF values directly in the table |
| F9 | Carry-forward GSV/SV/AFF from earlier snapshots when newer uploads leave them blank |
| F10 | Warn when uploading a duplicate snapshot (same brand category + date) |
| F11 | Support bulk import of matrix-format workbooks containing multiple date snapshots |
| F12 | Delete snapshots with confirmation |
| F13 | Brand-specific URLs (`/bp-sites/lucky7even`) for direct linking |

### Non-Functional Requirements

| # | Requirement |
|---|-------------|
| N1 | Supabase (PostgreSQL via PostgREST) as the persistence layer |
| N2 | Paginate `ranking_records` fetches in 1,000-row pages due to PostgREST cap |
| N3 | Full TypeScript coverage — no implicit `any` |
| N4 | Vite dev server starts in under 3 seconds |
| N5 | No global state library — single `useState` in Layout component |
| N6 | All brand/domain configuration lives in one file (`src/lib/brands.ts`) |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────┐
│                  Browser (React SPA)             │
│                                                  │
│  ┌──────────┐   ┌──────────────────────────────┐ │
│  │ Sidebar  │   │         Main Content          │ │
│  │ (nav +   │   │  ┌────────────────────────┐   │ │
│  │  brand   │   │  │  React Router Outlet   │   │ │
│  │  filter) │   │  │  /         → Home      │   │ │
│  └──────────┘   │  │  /bp-sites → BPSites   │   │ │
│                 │  │  /bp-sites/:slug        │   │ │
│  ┌──────────┐   │  │  /lp-sites → LPSites   │   │ │
│  │  Topbar  │   │  │  /ftds     → FTDs(stub)│   │ │
│  └──────────┘   │  └────────────────────────┘   │ │
│                 └──────────────────────────────┘ │
│                                                  │
│  ┌──────────────────────────────────────────────┐│
│  │            Layout (App.tsx)                  ││
│  │  - All AppState (useState)                   ││
│  │  - loadSnapshots() on mount                  ││
│  │  - handleImport / handleEditCell / delete    ││
│  │  - applyCarryForward() derived view          ││
│  └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
                         │
                         │ Supabase JS Client
                         ▼
┌─────────────────────────────────────────────────┐
│              Supabase (PostgreSQL)               │
│                                                  │
│  snapshots          ranking_records              │
│  ──────────         ────────────────             │
│  id (PK)      1──∞  snapshot_id (FK)             │
│  raw_date           domain                       │
│  display_date       keyword                      │
│  category           country                      │
│                     position                     │
│                     previous                     │
│                     change                       │
│                     date                         │
│                     search_volume                │
│                     affiliate_url                │
│                     global_search_volume         │
└─────────────────────────────────────────────────┘
```

### Category Namespacing

The app tracks two independent categories:
- **`bp-sites`** — brand's main/primary domains (e.g. `lucky7even.com`, `rooster.bet`)
- **`lp-sites`** — landing page domains (e.g. `lucky7even.club`, `roosterbet.io`)

Each snapshot has a `category` field. Domain-to-brand lookups use separate maps (`DOMAIN_TO_BRAND` for BP, `LP_DOMAIN_TO_BRAND` for LP) so the two namespaces never bleed into each other during parsing or display.

### Carry-Forward

GSV, SV, and AFF values are rarely re-exported every week. Rather than requiring users to re-enter them, the app applies carry-forward: when loading snapshots, it walks them oldest-to-newest within each category and fills any empty GSV/SV/AFF from the most recent prior snapshot that had a value for the same key. The raw Supabase data is unchanged — carry-forward only affects the in-memory view layer.

---

## 4. Technical Design

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/brands.ts` | Single source of truth for all brands, domains, abbreviations, and color tokens. `DOMAIN_TO_BRAND` and `LP_DOMAIN_TO_BRAND` map every known domain to a brand name. **Add new brands here.** |
| `src/lib/parser.ts` | Excel parsing logic. Auto-detects flat vs. matrix format. Contains `parsePosition`, `parseChange`, `computeStats`, `applyCarryForward`, `formatDisplayDate`. |
| `src/lib/storage.ts` | All Supabase reads and writes. `loadSnapshots` (paginated), `upsertSnapshot` (wipe-and-replace, 500-row chunked insert), `deleteSnapshot`, `updateRecordFields`. |
| `src/lib/supabase.ts` | Supabase client initialisation. Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from env. |
| `src/lib/categories.ts` | `CategoryId` union type (`'bp-sites' | 'lp-sites'`) and `DEFAULT_CATEGORY`. |
| `src/types/index.ts` | Shared TypeScript types: `RankingRecord`, `Snapshot`, `Brand`, `AppState`, `RROutletContext`, `EditCellMatcher`, `EditCellPatch`, `ToastItem`. |
| `src/App.tsx` | `Layout` holds all `AppState` via `useState`. Handles import, carry-forward derivation, inline edits, snapshot deletion, duplicate detection. Passes state to pages via React Router `Outlet` context. |
| `src/pages/Home.tsx` | Overview grid — all brands, latest snapshot stats. |
| `src/pages/BPSites.tsx` | BP Sites ranking table with brand/domain/country/keyword filters and snapshot tabs. |
| `src/pages/LPSites.tsx` | LP Sites equivalent. |
| `src/components/UploadModal.tsx` | File picker, category selector, triggers `parseXlsx` then calls `onImport`. |

### Core Types

```typescript
interface RankingRecord {
  domain: string
  keyword: string
  country: string
  position: string        // "1", "42", "NR"
  previous: string        // previous position (raw from file)
  change: string          // "⇑ (6)", "⇓ 3", "-", etc.
  date: string            // "yyyy-MM-dd"
  searchVolume?: string
  affiliateUrl?: string
  globalSearchVolume?: string
}

interface Snapshot {
  id: string              // "snap-bp-sites-2026-05-20"
  category: CategoryId
  rawDate: string         // "2026-05-20"
  displayDate: string     // "May 20, 2026"
  records: RankingRecord[]
}
```

### State Management

All state lives in a single `useState<AppState>` inside the `Layout` component in `src/App.tsx`. There is no Redux, Zustand, or Context API for data. State is passed to child pages via React Router's `useOutletContext()`. This keeps the data flow linear and easy to trace.

The `viewSnapshots` derived value (carry-forward applied) is computed via `useMemo` so it re-derives automatically whenever raw snapshots or edits change.

---

## 5. Installation Guide

### Prerequisites

- Node.js 18 or higher
- A Supabase project with the `snapshots` and `ranking_records` tables created (see schema in Section 7)

### Steps

**1. Clone the repository**
```
git clone <repo-url>
cd ranking-reports
```

**2. Install dependencies**
```
npm install
```

**3. Configure environment variables**

Create a `.env` file in the project root:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Both values are found in your Supabase project under **Settings → API**.

**4. Start the dev server**
```
npm run dev
```

The app runs at `http://localhost:5173`.

**5. Build for production**
```
npm run build
```

Output goes to `dist/`. Preview with `npm run preview`.

---

## 6. User Manual

### Uploading a Ranking File

1. Click the **Upload** button in the sidebar (or the upload icon next to the snapshot date).
2. Select a category: **BP Sites** (brand main domains) or **LP Sites** (landing pages).
3. Choose your `.xlsx` file. The parser auto-detects flat or matrix format.
4. If the file contains only one snapshot and a snapshot for that date already exists, you'll be asked to confirm replacement.
5. If the file is a multi-snapshot matrix format, it bulk-imports all dates with a progress bar — no confirmation per date.
6. A toast notification confirms the import with record/brand/keyword counts. Unknown domains (not in the Rooster registry) are reported as a warning.

### Navigating the Dashboard

- **Home** — overview grid of all brands. Each card shows latest position stats (Top 3, Improved, Dropped, NR, Unchanged).
- **BP Sites** — full ranking table for brand main domains. Click any brand card from Home, or select from the sidebar brand list.
- **LP Sites** — same layout for landing page domains.
- **FTDs** — stub page, not yet implemented.

### Filtering Rankings

Within BP Sites or LP Sites brand view:
- **Domain filter** — dropdown to show one domain or all
- **Country filter** — AU / CA / DE / IT / NZ or all
- **Keyword search** — free-text filter
- **Snapshot tabs** — click any date tab to switch to a historical snapshot

### Inline Editing (GSV / SV / AFF)

Click any cell in the **GSV**, **SV**, or **AFF** columns to edit it inline. Changes are saved immediately to Supabase and propagate forward to newer snapshots that have empty values for the same key.

- **GSV** edits apply to all records sharing that keyword in the snapshot (it's a per-keyword value)
- **SV / AFF** edits apply to the specific (domain, keyword, country) row

### Deleting a Snapshot

Click the **delete** icon on a snapshot tab. Confirm the prompt. The snapshot and all its records are permanently removed from Supabase.

---

## 7. Features & API Docs

### Import Flow — Flat Format

Used for current-format exports: a single sheet with column headers `Domain`, `Keyword`, `Country`, `Position`, `Previous`, `Change`, `Last Check`.

- Parser auto-detects header row (scans first 5 rows for `domain` or `keyword`)
- Rows with unknown domains are skipped and counted as warnings
- Deduplication: within a single upload, duplicate `(domain, keyword, country)` rows keep the last occurrence
- Date is extracted as the most common value in the `Last Check` column

### Import Flow — Matrix Format (Legacy)

Used for older Google Sheets exports: per-brand tabs named `LUCKY7`, `LUCKYVIBE`, `ROOSTERBET`, etc.

- Each sheet has a domain row (row 1) and a stacked series of date-keyed blocks
- BP matrix columns: `AU / SV / AFF / CA / SV / AFF / ...` per domain
- LP matrix columns: `AU / CA / DE / IT / NZ` per domain, position-only (no SV/AFF)
- Multiple date blocks in one file → multiple snapshots imported in one operation
- BP position cells format: `"4 ⇓ (1)"` → position=4, change=`⇓ (1)`
- LP position cells format: `"12 ⇓ 10"` → position=12, change=`⇓ 10`

### Supabase Table Schema

**`snapshots`**
```sql
id            text  PRIMARY KEY        -- e.g. "snap-bp-sites-2026-05-20"
raw_date      text  NOT NULL           -- "2026-05-20"
display_date  text                     -- "May 20, 2026"
category      text                     -- "bp-sites" | "lp-sites"
created_at    timestamptz DEFAULT now()
```

**`ranking_records`**
```sql
id                   bigserial PRIMARY KEY
snapshot_id          text NOT NULL REFERENCES snapshots(id)
domain               text NOT NULL
keyword              text NOT NULL
country              text NOT NULL
position             text
previous             text
change               text
date                 text
search_volume        text
affiliate_url        text
global_search_volume text
```

Recommended index:
```sql
CREATE INDEX ON ranking_records (snapshot_id);
```

### Carry-Forward Logic

`applyCarryForward(snapshots)` in `parser.ts`:
- Groups snapshots by category
- Sorts each group oldest → newest
- For each snapshot, fills empty `searchVolume`, `affiliateUrl`, `globalSearchVolume` from a running map seeded by prior snapshots
- SV/AFF key: `domain|keyword|country`
- GSV key: `keyword` (denormalized — same value appears on every record for that keyword)
- Returns new snapshot objects; raw state in Supabase is never mutated

### Position Badge Logic (`computeStats`)

Movement is classified into mutually exclusive buckets:

| Bucket | Condition |
|--------|-----------|
| NR | `position === 'NR'` |
| Improved | effective delta > 0 |
| Dropped | effective delta < 0 |
| Unchanged | everything else |

Top 3 is a separate non-exclusive counter (position 1/2/3 regardless of movement direction).

"Effective delta" accounts for a BP matrix quirk: `"⇑ (6)"` stores the previous position in the parens, not the delta. If `current position === parenthesized value`, the record hasn't actually moved, so delta is treated as 0.

---

## 8. Workflows

### Workflow A — Weekly Ranking Upload

This is the primary recurring task performed after each ranking report is generated.

1. Receive the ranking export `.xlsx` from the rank-tracking tool
2. Open the Ranking Reports dashboard
3. Click **Upload** in the sidebar
4. Select the correct category (**BP Sites** or **LP Sites**)
5. Select the `.xlsx` file
6. If prompted about a duplicate date, click **Replace** to overwrite the old snapshot
7. Review the import toast — confirm record count and brand count look correct
8. If a warning appears about unknown domains, note them — new domains may need to be registered in `src/lib/brands.ts`
9. Navigate to **BP Sites** or **LP Sites** to verify the data looks correct for the new snapshot

### Workflow B — Adding a New Brand

When a new casino brand is onboarded to Rooster Partners:

1. Open `src/lib/brands.ts`
2. Add a new entry to the `BRANDS` array with:
   - `name` — display name (e.g. `'NewBrand'`)
   - `abbr` — 2-letter abbreviation
   - `color` — hex color for brand badges
   - `mainDomain` — the primary domain (shown first in domain filters)
   - `domains` — all BP/main domains for this brand
   - `lpDomains` — all landing page domains for this brand
3. Save the file — `DOMAIN_TO_BRAND` and `LP_DOMAIN_TO_BRAND` maps are auto-generated from the `BRANDS` array
4. Also add the brand's sheet name to `MATRIX_BRAND_SHEETS` in `src/lib/parser.ts` if matrix-format uploads will be used for this brand
5. Run `npm run build` to confirm no TypeScript errors
6. Upload a test ranking file and verify the brand appears correctly in the dashboard

---

## 9. Important Notes

### PostgREST 1,000-Row Cap

Supabase's PostgREST API caps query responses at 1,000 rows by default. The `loadSnapshots` function in `storage.ts` works around this by:
1. First fetching a count of total records (`{ count: 'exact', head: true }`)
2. Calculating the number of pages needed (`Math.ceil(total / 1000)`)
3. Firing all page requests in parallel using `Promise.all`

If this pagination is ever removed or simplified, large datasets will silently truncate — stats counters will read lower than actual.

### Domain Namespacing — BP vs LP

BP domains and LP domains are intentionally kept in separate lookup maps (`DOMAIN_TO_BRAND` vs `LP_DOMAIN_TO_BRAND`). This means a domain registered only in `lpDomains` will be treated as "unknown" in a BP Sites upload, and vice versa. This is by design — it prevents LP traffic data from contaminating the BP rankings view.

### "Not Ranking" Normalisation

The position parser (`parsePosition` in `parser.ts`) normalises all of the following to the string `'NR'`:
- `"Not Ranking"`
- `"Not in top 100"`
- `"-"`
- `"nr"` (case-insensitive)

Any downstream code comparing positions should compare against `'NR'`, not against any of the original strings.

### Upsert Strategy — Wipe and Replace

`upsertSnapshot` does not use SQL `ON CONFLICT DO UPDATE`. Instead it explicitly deletes all `ranking_records` for the snapshot ID first, then deletes the snapshot row, then re-inserts everything. This is intentional: it makes the operation idempotent regardless of whether Supabase's FK `ON DELETE CASCADE` is configured, avoiding silent row duplication on re-uploads.

### Known Limitations

- **FTDs page** is a stub — the route exists (`/ftds`) but no data model or UI is implemented yet.
- **No test suite** — there are no automated tests configured. Manual verification is required after changes to the parser or storage layer.
- **No authentication** — the app uses the Supabase anon key. Row-level security (RLS) policies on the Supabase side control data access.
- **Matrix format brand names** in `MATRIX_BRAND_SHEETS` must match sheet tab names exactly (case-insensitive check via `.toUpperCase()`). A renamed tab in the source spreadsheet will silently fall through to flat-format parsing.
