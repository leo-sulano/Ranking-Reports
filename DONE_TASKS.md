# Done Tasks — Ranking Reports

All completed tasks since the beginning of the project, ordered chronologically.

---

## Foundation

**Task Title:** Project Scaffold
**Task Description:** Initialized the React + TypeScript + Vite + Tailwind v4 SPA. Set up the folder structure, React Router, Layout component with sidebar and topbar, and stub pages for BP Sites, LP Sites, and FTDs. Configured Vite with `@tailwindcss/vite` plugin; all theme customization done via CSS variables in `index.css`.
**Date Completed:** June 6, 2026
**Label:** Setup

---

**Task Title:** Brand Configuration
**Task Description:** Created `src/lib/brands.ts` as the single source of truth for all 9 brands (Lucky 7even, RoosterBet, LuckyVibe, SpinsUp, Spinjo, FortunePLay, RocketSpin, PlayMojo, Rollero). Each brand has a `mainDomain`, `domains` (BP), `lpDomains` (LP), color token, and abbreviation. Auto-generates `DOMAIN_TO_BRAND` and `LP_DOMAIN_TO_BRAND` lookup maps so parsers and display components share a single registry.
**Date Completed:** June 6, 2026
**Label:** Setup

---

**Task Title:** Excel Parser — Flat Format
**Task Description:** Built `src/lib/parser.ts` to parse flat-format `.xlsx` exports (columns: Domain, Keyword, Country, Position, Previous, Change, Last Check). Auto-detects the header row by scanning the first 5 rows for `domain`/`keyword`. Normalizes all "Not Ranking" variants (`"Not Ranking"`, `"Not in top 100"`, `"-"`, `"nr"`) to the string `'NR'`. Deduplicates rows on `(domain, keyword, country)` keeping the last occurrence.
**Date Completed:** June 6, 2026
**Label:** Data

---

**Task Title:** Excel Parser — Matrix Format (Legacy Bulk Import)
**Task Description:** Extended the parser to handle legacy Google Sheets matrix exports where each brand has its own tab and keyword rows are stacked by date block. BP matrix format includes SV and AFF columns per domain; LP matrix is position-only. A single file can contain multiple date snapshots which are all imported in one operation with a progress indicator. Detects format by checking for known brand sheet names in `MATRIX_BRAND_SHEETS`.
**Date Completed:** June 6, 2026
**Label:** Data

---

**Task Title:** Supabase Integration
**Task Description:** Replaced localStorage with Supabase (PostgreSQL via PostgREST) as the persistence layer. Created two tables: `snapshots` (id, raw_date, display_date, category) and `ranking_records` (snapshot_id FK, domain, keyword, country, position, previous, change, date, search_volume, affiliate_url, global_search_volume). Initialized the Supabase JS client in `src/lib/supabase.ts` reading `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from env.
**Date Completed:** June 6, 2026
**Label:** Setup

---

**Task Title:** Paginated Snapshot Loading
**Task Description:** Worked around PostgREST's 1,000-row cap in `src/lib/storage.ts`. `loadSnapshots` first fetches a total row count with `{ count: 'exact', head: true }`, calculates the number of pages, then fires all page requests in parallel with `Promise.all`. This ensures large datasets load completely without silent truncation.
**Date Completed:** June 6, 2026
**Label:** Data



---

**Task Title:** Upsert Strategy — Wipe and Replace
**Task Description:** Implemented `upsertSnapshot` in `storage.ts` as an explicit delete-then-insert rather than SQL `ON CONFLICT DO UPDATE`. Deletes all `ranking_records` for the snapshot ID first, then the snapshot row, then re-inserts in 500-row chunks. This makes re-uploads idempotent regardless of whether Supabase FK `ON DELETE CASCADE` is configured.
**Date Completed:** June 6, 2026
**Label:** Data

---

**Task Title:** Carry-Forward Logic
**Task Description:** Implemented `applyCarryForward` in `parser.ts`. Walks snapshots oldest-to-newest within each category and fills any empty `searchVolume`, `affiliateUrl`, and `globalSearchVolume` from the most recent prior snapshot that had a value for the same key. SV/AFF key is `domain|keyword|country`; GSV key is `keyword` (denormalized). The raw Supabase data is never mutated — carry-forward is applied only in the in-memory view layer via `useMemo` in `App.tsx`.
**Date Completed:** June 6, 2026
**Label:** Feature

---

**Task Title:** Inline Cell Editing (GSV / SV / AFF)
**Task Description:** Made the GSV, SV, and AFF columns click-to-edit in the ranking table. Changes are saved immediately to Supabase via `updateRecordFields` and reflected in the view without a page reload. GSV edits apply to all records sharing that keyword in the snapshot; SV and AFF edits apply to the specific `(domain, keyword, country)` row. Carry-forward propagates the new value forward to newer snapshots.
**Date Completed:** June 6, 2026
**Label:** Feature

---

**Task Title:** Duplicate Snapshot Detection
**Task Description:** Added a check in the import flow that warns when the uploaded file contains a snapshot date that already exists for the same brand category. The user is prompted to confirm replacement. For multi-snapshot matrix imports, no per-date confirmation is shown — the bulk operation proceeds and overwrites matching dates automatically.
**Date Completed:** June 6, 2026
**Label:** Feature

---

**Task Title:** Snapshot Deletion
**Task Description:** Added a delete icon on each snapshot date tab. Clicking it shows a confirmation prompt; confirming permanently removes the snapshot and all its ranking records from Supabase. Deletion calls `deleteSnapshot` in `storage.ts` which removes the `ranking_records` rows first, then the `snapshots` row.
**Date Completed:** June 6, 2026
**Label:** Feature

---

**Task Title:** Overview Grid — Home Page
**Task Description:** Built `src/pages/Home.tsx` as an overview grid showing all brands with their latest snapshot stats: Top 3, Improved, Dropped, NR, and Unchanged counts. Each brand card links through to the BP Sites brand view. Stats are computed via `computeStats` in `parser.ts` which classifies movement into mutually exclusive buckets using effective delta logic (handles the BP matrix quirk where `"⇑ (6)"` stores previous position, not delta).
**Date Completed:** June 6, 2026
**Label:** Feature

---

**Task Title:** BP Sites Ranking Table
**Task Description:** Built `src/pages/BPSites.tsx` with a full ranking table for brand main domains. Includes domain, country, and keyword filters, snapshot date tab bar, and per-row movement badges (⬆ improved, ⬇ dropped, NR, unchanged). Brand is selected from the sidebar brand list or via URL slug (`/bp-sites/lucky7even`). Domain filter shows the brand's `mainDomain` first.
**Date Completed:** June 6, 2026
**Label:** Feature

---

**Task Title:** LP Sites Ranking Table
**Task Description:** Built `src/pages/LPSites.tsx` as the LP Sites equivalent of BP Sites. Uses `LP_DOMAIN_TO_BRAND` for domain resolution and a separate `lp-sites` category namespace so LP traffic data never bleeds into BP rankings.
**Date Completed:** June 6, 2026
**Label:** Feature

---

**Task Title:** URL-Driven Brand Navigation
**Task Description:** Added React Router routes for `/bp-sites/:slug` and `/lp-sites/:slug` so individual brands are directly linkable. The slug is derived from the brand name (lowercased, spaces removed). Navigating to a brand URL selects it in the sidebar automatically. Invalid slugs fall back to the overview grid.
**Date Completed:** June 6, 2026
**Label:** Feature

---

**Task Title:** AI Assistant Chat Bubble
**Task Description:** Added a floating chat bubble that answers ranking questions via a Supabase Edge Function proxying to OpenAI. The assistant has context about current snapshot data and responds with specific ranking insights. The bubble degrades gracefully when offline or when the Edge Function is unavailable.
**Date Completed:** June 6, 2026
**Label:** Feature

---

## June 2026

**Task Title:** BP Sites Domain Filter Dropdown
**Task Description:** Replaced the domain filter pill buttons in BP Sites with a custom `SiteFilter` dropdown component offering three levels: All (all domains), Brand-grouped (domains grouped by brand), and Individual (single domain). Filter state is URL-driven (`?domainFilter=...`) so selections are shareable and survive page refresh. Invalid `domainFilter` values in the URL fall back to the All view.
**Date Completed:** June 3, 2026
**Label:** Feature

---

**Task Title:** LP Sites Domain Filter Dropdown
**Task Description:** Added the same URL-driven `SiteFilter` dropdown to LP Sites, matching the BP Sites implementation. Domain options are populated from the LP domain registry. Filter state persists in the URL query string.
**Date Completed:** June 3, 2026
**Label:** Feature

---

**Task Title:** Voice Input for AI Assistant
**Task Description:** Added voice input to the AI assistant floating bubble via a shared `useVoice` hook using the Web Speech API. The user can tap the microphone button to start recording; speech is transcribed in real-time. Set a 5-second silence delay before auto-submitting after a speech pause. Clicking the stop button manually sends the transcript immediately without waiting for the delay.
**Date Completed:** June 3, 2026
**Label:** Feature

---

**Task Title:** Home Dashboard Redesign — 3-Panel Layout
**Task Description:** Consolidated the home dashboard into a single full-width 3-panel row layout (leaderboard, SERP distribution chart, country coverage map). Removed the max-width constraint so the dashboard fills the full viewport. Replaced the country dropdown selector with an SVG world map visualization.
**Date Completed:** June 4, 2026
**Label:** UI

---

**Task Title:** Home Page Font and Theme Redesign
**Task Description:** Redesigned the home page typography using Syne (headings), Figtree (body), and JetBrains Mono (data/code values). Explored two full theme variants — a dark cyberpunk theme (deep navy, gradient cards, glow effects) and a German flag light theme (black, red #CC0000, gold #FFCC00) — before settling on the current Syne/Figtree design. Switched to full-page layout removing max-width constraints.
**Date Completed:** June 4, 2026
**Label:** UI

---

**Task Title:** SERP Distribution Chart
**Task Description:** Built a SERP distribution chart showing how many keywords rank in each position band (1–3, 4–10, then decade bands up to 90+, plus NR). Initially implemented as a bar chart with dashed vertical pattern, then redesigned as a gradient line chart with hover tooltips on each data point. Position bands 1–10 use a green palette (dark to light); NR bar is black.
**Date Completed:** June 4–5, 2026
**Label:** Feature

---

**Task Title:** Brand Leaderboard
**Task Description:** Added a brand leaderboard on the home page ranking all brands by their Top 3 keyword count using the latest BP Sites snapshot per brand. Brand names are colored by their brand color token. Row padding tightened to zero vertical for a compact list view.
**Date Completed:** June 4–5, 2026
**Label:** Feature

---

**Task Title:** Country Coverage Map
**Task Description:** Added an SVG world map using `react-simple-maps` showing which countries have ranking data. Each tracked country (AU, CA, DE, IT, NZ) is highlighted with a flag-representative color. Map includes zoom in/out controls and hover tooltips showing the full country name and record count. Configured `.npmrc` with `legacy-peer-deps` to resolve peer dependency conflict on Vercel.
**Date Completed:** June 4, 2026
**Label:** Feature

---

**Task Title:** Top Movers Widget
**Task Description:** Added a Top Movers section on the home page showing the top 3 climbers and top 3 droppers from the latest snapshot. Limited to 3 per direction to keep the panel compact. Vertical padding on list items removed for tighter layout.
**Date Completed:** June 4, 2026
**Label:** Feature

---

**Task Title:** RR Favicon
**Task Description:** Added the Ranking Reports (RR) favicon to the app, replacing the default Vite favicon. Configured in `index.html`.
**Date Completed:** June 5, 2026
**Label:** UI

---

**Task Title:** AI Assistant — Custom Robot Icon
**Task Description:** Replaced the generic Bot icon in the AI chat bubble with a custom robot-headphones SVG icon to give the assistant a more distinctive identity in the dashboard UI.
**Date Completed:** June 6, 2026
**Label:** UI

---

**Task Title:** Mobile Responsive Overhaul
**Task Description:** Implemented full mobile responsiveness across the dashboard. Added a hamburger menu with a slide-in sidebar drawer for mobile (Sidebar.tsx + Topbar.tsx + App.tsx). Applied mobile-first padding and layout fixes to StatsRow, Topbar, and BPSites table. Followed up with a comprehensive responsive sweep across LP Sites BrandView (px-7 → px-3 sm:px-7), Home Country Coverage map (min-h responsive + overflow-x-hidden), and BP/LP BrandView tables.
**Date Completed:** June 9, 2026
**Label:** UI

---

**Task Title:** Home Dashboard Cards & Map Updates
**Task Description:** Redesigned the brand summary cards on the home page for a cleaner layout. Fixed the Country Coverage map sizing and overflow behavior for better responsiveness on smaller screens.
**Date Completed:** June 9, 2026
**Label:** UI

---

**Task Title:** AI Icon & UI Polish
**Task Description:** Updated the AI assistant icons across the dashboard: added a distinctive icon to the Ask AI page, updated the AI sidebar nav icon, and updated the tab AI icon. Minor layout spacing improvements to BPSites table.
**Date Completed:** June 9, 2026
**Label:** UI

---

**Task Title:** Filter-Aware Stats Counts (BP & LP Sites)
**Task Description:** Made the Top 3, Improved, Dropped, NR, and Unchanged counts in the `StatsRow` header respond dynamically to active filters. Previously counts were computed over all records for the brand regardless of what was visible. Now the stats `useMemo` filters by `visibleBpDomains` (so selecting a specific site narrows the counts to that site only) and also by `activeCountries` (so selecting a country filter narrows counts to matching rows). The Sites and Countries filter bars in `BPSites.tsx` and `LPSites.tsx` were also merged into a single unified filter row with a divider between them.
**Date Completed:** June 15, 2026
**Label:** Feature

---

**Task Title:** Ranking Tables — Horizontal Scroll & Side-by-Side Layout
**Task Description:** Refactored the BP Sites and LP Sites ranking tables to support horizontal scrolling so all columns remain visible side by side without wrapping. Mouse/trackpad horizontal swipe is supported on the table container. Also adjusted `StatsRow` card layout spacing to align with the new table structure.
**Date Completed:** June 16, 2026
**Label:** UI

---

**Task Title:** AI Assistant — Exact Domain in Keyword Movement Responses
**Task Description:** Updated the AI assistant to always include the specific site domain alongside the brand name when reporting keyword movers, gainers, and losers. Added a `domain` field to the `Mover` and `Transition` types in `src/components/Assistant/types.ts`, propagated it through `computeMovers` and `computeTransitions` in `src/lib/assistantDigest.ts`, and updated the Edge Function system prompt in `supabase/functions/assistant/index.ts` to instruct the AI to cite the exact domain (e.g. `rocketspin.com`) next to the brand name in every mover/gained/lost entry.
**Date Completed:** June 16, 2026
**Label:** Feature

---

**Task Title:** BP Sites — Horizontal Scroll Refinements & Interactivity
**Task Description:** Comprehensive polish pass on the BP Sites horizontal scroll table. Forced the table to always overflow for consistent horizontal scroll behaviour. Added domain scroll-jump buttons in the snapshot date band for fast column navigation. Fixed the sticky keyword column by switching `overflow: hidden` to `overflow: clip` so it no longer breaks scroll. Added a scroll shadow to the sticky keyword column as a visual cue. Tuned `minWidth` using real DOM measurements so the last domain column lands exactly beside the keyword column at max scroll. Made the table fill full viewport width when fewer sites are selected, and skipped the scroll-pad when no overflow exists. Always renders all domain columns regardless of whether data is present so the grid never shifts. Made individual BP Sites domain rows clickable with hover effects for quicker navigation.
**Date Completed:** June 18, 2026
**Label:** UI

---

**Task Title:** Top Movers — Group by Site with Expandable Keyword List
**Task Description:** Redesigned the Top Movers widget to group movers by site (domain) rather than showing a flat list. Each site row is expandable to reveal its individual keyword movements. This makes the widget scannable at a glance while still surfacing keyword-level detail on demand.
**Date Completed:** June 18, 2026
**Label:** Feature

---

**Task Title:** Hero Metric Cards — Clickable with Detail Modal
**Task Description:** Made the Keywords, Brands, and Countries hero metric cards on the home dashboard clickable. Each card opens a detail modal listing the underlying items (e.g. all tracked keywords, all brands, all countries). Removed the 'View list →' text hint from the cards since the click target is now the entire card.
**Date Completed:** June 18, 2026
**Label:** Feature

---

**Task Title:** Brand Leaderboard — Rank-Change Indicator, CVG%, and Clickable Values
**Task Description:** Added a rank-change indicator column to the Brand Leaderboard showing position movement vs the previous snapshot. Added a CVG% (coverage percentage) column. Color-aligned the summary cards for visual consistency. Made leaderboard row values and Top Movers entries clickable so users can drill into brand details directly from the home page.
**Date Completed:** June 18, 2026
**Label:** Feature

---

## June 19, 2026

**Task Title:** BP/LP Sites — Stable Per-Domain Colors & Responsive Table Layout
**Task Description:** Each BP/LP domain now always receives the same palette color based on its fixed position in the full brand domain list, not its index in the current visible selection — colors no longer shift when sites are toggled. Table stretches to fill viewport width when all selected columns fit, and switches to horizontal scroll when they overflow. LPSites also received the `scrollRightPad` measurement effect so the last column snaps cleanly beside the sticky KEYWORD column at maximum scroll.
**Date Completed:** June 19, 2026
**Label:** UI

---

**Task Title:** Deep Navigation — Clickable Keywords from Home & Top Movers
**Task Description:** Made Top Movers keyword rows clickable: clicking a keyword navigates directly to the BP Sites brand view pre-filtered by that domain and keyword. Home hero metric keyword modal rows are also clickable and navigate to the matching filtered BP Sites view. Removed the CVG%/Share columns from the Leaderboard and removed FTDs/Countries from the sidebar nav to streamline the layout.
**Date Completed:** June 19, 2026
**Label:** Feature

---

**Task Title:** Bidirectional URL Sync for All Filters (BP/LP Sites)
**Task Description:** Every filter on BP Sites and LP Sites — site selection, countries, keyword search, position filter, and date — now writes to the URL query string on change, making any filter combination bookmarkable and shareable. Visiting a URL with query params restores the exact filter state on mount. Keyword filter is also applied to the stats record set so the Top 3/Improved/Dropped/NR counts always reflect only the visible rows.
**Date Completed:** June 19, 2026
**Label:** Feature

---

**Task Title:** Navigate Cards Redesign
**Task Description:** Updated the Navigate quick-action cards on the home dashboard. BP Sites card uses a light tint background with a solid border; Import Data card gets a solid red style; LP Sites card uses neutral grey with a black border. The NavCard arrow indicator is hidden until hover to reduce visual noise.
**Date Completed:** June 19, 2026
**Label:** UI

---

**Task Title:** StatsCard Modal — Clickable Sites & Keywords
**Task Description:** Made site and keyword rows in the Stats Card detail modal clickable. Clicking a site or keyword navigates directly to the BP Sites brand view with that site or keyword pre-filtered. NavCard arrow hidden until hover for a cleaner idle state.
**Date Completed:** June 19, 2026
**Label:** Feature

---

**Task Title:** Performance — Deferred Snapshot Loading on Brand Views
**Task Description:** Brand detail views (BP Sites and LP Sites) previously rendered all snapshots' full keyword tables simultaneously on mount, blocking the main thread for several seconds with tens of thousands of DOM nodes. Now only the latest snapshot matrix is rendered on initial load. A "Show N older snapshots" button loads the remaining snapshots on demand, keeping initial navigation fast regardless of how many historical snapshots exist.
**Date Completed:** June 19, 2026
**Label:** Feature

---

## June 22, 2026

**Task Title:** Navigation Filter Fixes — Exact Keyword Match & Country Sync from Modal Clicks
**Task Description:** Fixed a series of navigation bugs when clicking through to BP Sites from home page modals and Top Movers. Country filters now correctly pass a single country (not an array) from Top Movers keyword clicks. `activeCountries` is synced from the `?countries=` URL param on external navigation so country filtering applies immediately on mount. Keyword filter switched to exact match when navigating from modal/Top Movers clicks to avoid partial-match false positives.
**Date Completed:** June 22, 2026
**Label:** Feature

---

## July 8, 2026

**Task Title:** How It Works Help Page
**Task Description:** Added a new "How It Works" help page (routed at `/how-it-works`, linked from a new sidebar nav entry) that walks users through the core dashboard workflow: uploading a ranking export, picking a brand, reading the ranking table, filtering, and tracking changes over time. The upload step notes that imported files contain Rooster BP Sites ranking data extracted from a ranking-tracking system/software.
**Date Completed:** July 8, 2026
**Label:** Feature

---
