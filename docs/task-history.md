# Task History — Ranking Reports

Append a new `## Task N` entry here whenever work is completed.
Format: `## Task N: <Title>` followed by date and description.

---

## Task 1: PMS Integration Setup

**Date:** 2026-06-09
**PMS Task ID:** cmq6q2tn9000004jyqm0o94v6
**Column:** Done
**Label:** Setup

Connected the Ranking Reports repository to the PMS at https://pms-nu-eight.vercel.app.
Configured automatic dual-logging: completed tasks are appended here and created on the
"Ranking Sheet Automation" PMS board (team: AI Automation Team), assigned to Leo Sulano.

Discovered API endpoints:
- `GET /api/teams` — list teams
- `GET /api/teams/{teamId}/projects` — list projects
- `GET /api/projects/{projectId}/tasks` — list/create tasks
- `POST /api/projects/{projectId}/tasks` — create task
- `PATCH /api/tasks/{taskId}` — update task (move column, etc.)

---

## Task 2: Project Scaffold

**Date:** 2026-06-06
**PMS Task ID:** cmq6qeql4000204jxe1tg7swu
**Column:** Done
**Label:** Setup

Initialized the React + TypeScript + Vite + Tailwind v4 SPA. Set up the folder structure, React Router, Layout component with sidebar and topbar, and stub pages for BP Sites, LP Sites, and FTDs. Configured Vite with `@tailwindcss/vite` plugin; all theme customization done via CSS variables in `index.css`.

---

## Task 3: Brand Configuration

**Date:** 2026-06-06
**PMS Task ID:** cmq6qesd0000404jx5znduehk
**Column:** Done
**Label:** Setup

Created `src/lib/brands.ts` as the single source of truth for all 9 brands (Lucky 7even, RoosterBet, LuckyVibe, SpinsUp, Spinjo, FortunePLay, RocketSpin, PlayMojo, Rollero). Each brand has a `mainDomain`, `domains` (BP), `lpDomains` (LP), color token, and abbreviation. Auto-generates `DOMAIN_TO_BRAND` and `LP_DOMAIN_TO_BRAND` lookup maps.

---

## Task 4: Excel Parser — Flat Format

**Date:** 2026-06-06
**PMS Task ID:** cmq6qetwj000604jxyc4xb26c
**Column:** Done
**Label:** Data

Built `src/lib/parser.ts` to parse flat-format `.xlsx` exports (columns: Domain, Keyword, Country, Position, Previous, Change, Last Check). Auto-detects the header row by scanning the first 5 rows for `domain`/`keyword`. Normalizes all "Not Ranking" variants to `'NR'`. Deduplicates rows on `(domain, keyword, country)` keeping the last occurrence.

---

## Task 5: Excel Parser — Matrix Format (Legacy Bulk Import)

**Date:** 2026-06-06
**PMS Task ID:** cmq6qevio000804jxk9epqon4
**Column:** Done
**Label:** Data

Extended the parser to handle legacy Google Sheets matrix exports where each brand has its own tab and keyword rows are stacked by date block. BP matrix format includes SV and AFF columns per domain; LP matrix is position-only. A single file can contain multiple date snapshots which are all imported in one operation with a progress indicator.

---

## Task 6: Supabase Integration

**Date:** 2026-06-06
**PMS Task ID:** cmq6qex7x000a04jxvxtx1bdc
**Column:** Done
**Label:** Setup

Replaced localStorage with Supabase (PostgreSQL via PostgREST) as the persistence layer. Created two tables: `snapshots` and `ranking_records`. Initialized the Supabase JS client in `src/lib/supabase.ts` reading `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from env.

---

## Task 7: Paginated Snapshot Loading

**Date:** 2026-06-06
**PMS Task ID:** cmq6qez0d000c04jx1zb8kgs3
**Column:** Done
**Label:** Data

Worked around PostgREST's 1,000-row cap in `src/lib/storage.ts`. `loadSnapshots` first fetches a total row count with `{ count: 'exact', head: true }`, calculates the number of pages, then fires all page requests in parallel with `Promise.all`.

---

## Task 8: Upsert Strategy — Wipe and Replace

**Date:** 2026-06-06
**PMS Task ID:** cmq6qf0h0000e04jxrmkvdjqf
**Column:** Done
**Label:** Data

Implemented `upsertSnapshot` in `storage.ts` as an explicit delete-then-insert rather than SQL `ON CONFLICT DO UPDATE`. Deletes all `ranking_records` for the snapshot ID first, then the snapshot row, then re-inserts in 500-row chunks. Makes re-uploads idempotent.

---

## Task 9: Carry-Forward Logic

**Date:** 2026-06-06
**PMS Task ID:** cmq6qf1qf000g04jxlaqhm9n4
**Column:** Done
**Label:** Feature

Implemented `applyCarryForward` in `parser.ts`. Walks snapshots oldest-to-newest within each category and fills any empty `searchVolume`, `affiliateUrl`, and `globalSearchVolume` from the most recent prior snapshot. Applied only in the in-memory view layer via `useMemo` in `App.tsx` — raw Supabase data is never mutated.

---

## Task 10: Inline Cell Editing (GSV / SV / AFF)

**Date:** 2026-06-06
**PMS Task ID:** cmq6qf2x3000i04jx282vbawb
**Column:** Done
**Label:** Feature

Made the GSV, SV, and AFF columns click-to-edit in the ranking table. Changes are saved immediately to Supabase via `updateRecordFields` and reflected in the view without a page reload. GSV edits apply to all records sharing that keyword in the snapshot; SV and AFF edits apply to the specific `(domain, keyword, country)` row.

---

## Task 11: Duplicate Snapshot Detection

**Date:** 2026-06-06
**PMS Task ID:** cmq6qf4h9000k04jxx0eagjlx
**Column:** Done
**Label:** Feature

Added a check in the import flow that warns when the uploaded file contains a snapshot date that already exists for the same brand category. The user is prompted to confirm replacement. For multi-snapshot matrix imports, the bulk operation proceeds and overwrites matching dates automatically.

---

## Task 12: Snapshot Deletion

**Date:** 2026-06-06
**PMS Task ID:** cmq6qf6j3000m04jxk8vskv7n
**Column:** Done
**Label:** Feature

Added a delete icon on each snapshot date tab. Clicking it shows a confirmation prompt; confirming permanently removes the snapshot and all its ranking records from Supabase via `deleteSnapshot` in `storage.ts`.

---

## Task 13: Overview Grid — Home Page

**Date:** 2026-06-06
**PMS Task ID:** cmq6qf8qk000o04jx23mor0my
**Column:** Done
**Label:** Feature

Built `src/pages/Home.tsx` as an overview grid showing all brands with their latest snapshot stats: Top 3, Improved, Dropped, NR, and Unchanged counts. Stats are computed via `computeStats` in `parser.ts` using effective delta logic.

---

## Task 14: BP Sites Ranking Table

**Date:** 2026-06-06
**PMS Task ID:** cmq6qfawf000q04jx0qexewzm
**Column:** Done
**Label:** Feature

Built `src/pages/BPSites.tsx` with a full ranking table for brand main domains. Includes domain, country, and keyword filters, snapshot date tab bar, and per-row movement badges. Brand is selected from the sidebar or via URL slug (`/bp-sites/lucky7even`).

---

## Task 15: LP Sites Ranking Table

**Date:** 2026-06-06
**PMS Task ID:** cmq6qfci2000s04jxfg2vj25d
**Column:** Done
**Label:** Feature

Built `src/pages/LPSites.tsx` as the LP Sites equivalent of BP Sites. Uses `LP_DOMAIN_TO_BRAND` for domain resolution and a separate `lp-sites` category namespace so LP traffic data never bleeds into BP rankings.

---

## Task 16: URL-Driven Brand Navigation

**Date:** 2026-06-06
**PMS Task ID:** cmq6qfdw7000u04jxg8tbafp3
**Column:** Done
**Label:** Feature

Added React Router routes for `/bp-sites/:slug` and `/lp-sites/:slug` so individual brands are directly linkable. The slug is derived from the brand name (lowercased, spaces removed). Invalid slugs fall back to the overview grid.

---

## Task 17: AI Assistant Chat Bubble

**Date:** 2026-06-06
**PMS Task ID:** cmq6qff3k000w04jxgxkznmj9
**Column:** Done
**Label:** Feature

Added a floating chat bubble that answers ranking questions via a Supabase Edge Function proxying to OpenAI. The assistant has context about current snapshot data and degrades gracefully when offline or when the Edge Function is unavailable.

---

## Task 18: BP Sites Domain Filter Dropdown

**Date:** 2026-06-03
**PMS Task ID:** cmq6qgw6l000y04jxjddwxr89
**Column:** Done
**Label:** Feature

Replaced the domain filter pill buttons in BP Sites with a custom `SiteFilter` dropdown component offering three levels: All, Brand-grouped, and Individual. Filter state is URL-driven (`?domainFilter=...`) so selections are shareable and survive page refresh.

---

## Task 19: LP Sites Domain Filter Dropdown

**Date:** 2026-06-03
**PMS Task ID:** cmq6qgy3h001004jx79vq10ls
**Column:** Done
**Label:** Feature

Added the same URL-driven `SiteFilter` dropdown to LP Sites, matching the BP Sites implementation. Domain options are populated from the LP domain registry. Filter state persists in the URL query string.

---

## Task 20: Voice Input for AI Assistant

**Date:** 2026-06-03
**PMS Task ID:** cmq6qgzld001204jxlzx6szr8
**Column:** Done
**Label:** Feature

Added voice input to the AI assistant floating bubble via a shared `useVoice` hook using the Web Speech API. 5-second silence delay before auto-submitting; clicking the stop button sends the transcript immediately.

---

## Task 21: Home Dashboard Redesign — 3-Panel Layout

**Date:** 2026-06-04
**PMS Task ID:** cmq6qh183001404jxyjfg54it
**Column:** Done
**Label:** UI

Consolidated the home dashboard into a single full-width 3-panel row layout (leaderboard, SERP distribution chart, country coverage map). Removed the max-width constraint. Replaced the country dropdown selector with an SVG world map visualization.

---

## Task 22: Home Page Font and Theme Redesign

**Date:** 2026-06-04
**PMS Task ID:** cmq6qh2sy001604jxvs1d1j7n
**Column:** Done
**Label:** UI

Redesigned the home page typography using Syne (headings), Figtree (body), and JetBrains Mono (data/code values). Explored two full theme variants before settling on the current design. Switched to full-page layout removing max-width constraints.

---

## Task 23: SERP Distribution Chart

**Date:** 2026-06-04
**PMS Task ID:** cmq6qh479001804jxgv1m59fg
**Column:** Done
**Label:** Feature

Built a SERP distribution chart showing keyword counts per position band (1–3, 4–10, decade bands up to 90+, NR). Designed as a gradient line chart with hover tooltips. Position bands 1–10 use a green palette; NR bar is black.

---

## Task 24: Brand Leaderboard

**Date:** 2026-06-04
**PMS Task ID:** cmq6qh5sz001a04jxvv3xuzs9
**Column:** Done
**Label:** Feature

Added a brand leaderboard on the home page ranking all brands by their Top 3 keyword count using the latest BP Sites snapshot per brand. Brand names are colored by their brand color token.

---

## Task 25: Country Coverage Map

**Date:** 2026-06-04
**PMS Task ID:** cmq6qh7yy001c04jxzr4mi52f
**Column:** Done
**Label:** Feature

Added an SVG world map using `react-simple-maps` showing which countries have ranking data (AU, CA, DE, IT, NZ). Map includes zoom controls and hover tooltips. Configured `.npmrc` with `legacy-peer-deps` to resolve peer dependency conflict on Vercel.

---

## Task 26: Top Movers Widget

**Date:** 2026-06-04
**PMS Task ID:** cmq6qh9cc001e04jxplw8fteh
**Column:** Done
**Label:** Feature

Added a Top Movers section on the home page showing the top 3 climbers and top 3 droppers from the latest snapshot.

---

## Task 27: RR Favicon

**Date:** 2026-06-05
**PMS Task ID:** cmq6qhaq7000304jym5plry79
**Column:** Done
**Label:** UI

Added the Ranking Reports (RR) favicon to the app, replacing the default Vite favicon. Configured in `index.html`.

---

## Task 28: AI Assistant — Custom Robot Icon

**Date:** 2026-06-06
**PMS Task ID:** cmq6qhcg9000504jy464lw63z
**Column:** Done
**Label:** UI

Replaced the generic Bot icon in the AI chat bubble with a custom robot-headphones SVG icon.

---

## Task 29: Mobile Responsive Overhaul

**Date:** 2026-06-09
**PMS Task ID:** cmq6rihbs001h04jyujziw7rq
**Column:** Done
**Label:** UI

Implemented full mobile responsiveness across the dashboard. Added a hamburger menu with a slide-in sidebar drawer for mobile (`Sidebar.tsx`, `Topbar.tsx`, `App.tsx`). Applied mobile-first padding and layout fixes to `StatsRow`, `Topbar`, and `BPSites` table. Comprehensive responsive sweep: LP Sites BrandView `px-7 → px-3 sm:px-7`, Home Country Coverage map min-height responsive + `overflow-x-hidden`, BP/LP BrandView tables verified.

---

## Task 30: Home Dashboard Cards & Map Updates

**Date:** 2026-06-09
**PMS Task ID:** cmq6rihcb000204jscuvgn7c7
**Column:** Done
**Label:** UI

Redesigned the brand summary cards on the home page for a cleaner layout. Fixed the Country Coverage map sizing and overflow behavior for better responsiveness on smaller screens.

---

## Task 31: AI Icon & UI Polish

**Date:** 2026-06-09
**PMS Task ID:** cmq6rihg2000004l5rm2tchle
**Column:** Done
**Label:** UI

Updated AI assistant icons across the dashboard: distinctive icon added to the Ask AI page, AI sidebar nav icon updated, tab AI icon updated. Minor layout spacing improvements to BPSites table.

---

## Task 32: Filter-Aware Stats Counts (BP & LP Sites)

**Date:** 2026-06-15
**PMS Task ID:** cmqgm2s5o000004jv6hil9578
**Column:** Done
**Label:** Feature

Made the Top 3, Improved, Dropped, NR, and Unchanged counts in the StatsRow header respond dynamically to active filters. Stats useMemo now filters by `visibleBpDomains` (selecting a specific site narrows counts to that site only) and `activeCountries` (selecting a country narrows counts to matching rows). The Sites and Countries filter bars in BPSites.tsx and LPSites.tsx were merged into a single unified filter row with a divider between them.

---

## Task 33: Ranking Tables — Horizontal Scroll & Side-by-Side Layout

**Date:** 2026-06-16
**PMS Task ID:** cmqgm2xuf000204jvqclkff4h
**Column:** Done
**Label:** UI

Refactored the BP Sites and LP Sites ranking tables to support horizontal scrolling so all columns remain visible side by side without wrapping. Mouse/trackpad horizontal swipe is supported on the table container. Adjusted StatsRow card layout spacing to align with the new table structure.

---

## Task 34: AI Assistant — Exact Domain in Keyword Movement Responses

**Date:** 2026-06-16
**PMS Task ID:** cmqgm35rw000404jvbc83zcwk
**Column:** Done
**Label:** Feature

Updated the AI assistant to always include the specific site domain alongside the brand name when reporting keyword movers, gainers, and losers. Added a `domain` field to the `Mover` and `Transition` types in `src/components/Assistant/types.ts`, propagated it through `computeMovers` and `computeTransitions` in `src/lib/assistantDigest.ts`, and updated the Edge Function system prompt in `supabase/functions/assistant/index.ts` to instruct the AI to cite the exact domain (e.g. `rocketspin.com`) next to the brand name in every mover/gained/lost entry.
