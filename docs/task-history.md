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

---

## Task 35: BP Sites — Horizontal Scroll Refinements & Interactivity

**Date:** 2026-06-18
**PMS Task ID:** cmqjoixe7000204jru8a1i65x
**Column:** Review/QA
**Label:** UI
**Assignee:** Leo Sulano

Comprehensive polish pass on the BP Sites horizontal scroll table. Forced the table to always overflow for consistent horizontal scroll behaviour. Added domain scroll-jump buttons in the snapshot date band for fast column navigation. Fixed the sticky keyword column by switching `overflow: hidden` to `overflow: clip` so it no longer breaks scroll. Added a scroll shadow to the sticky keyword column as a visual cue. Tuned `minWidth` using real DOM measurements so the last domain column lands exactly beside the keyword column at max scroll. Made the table fill full viewport width when fewer sites are selected, and skipped the scroll-pad when no overflow exists. Always renders all domain columns regardless of whether data is present so the grid never shifts. Made individual BP Sites domain rows clickable with hover effects for quicker navigation.

---

## Task 36: Top Movers — Group by Site with Expandable Keyword List

**Date:** 2026-06-18
**PMS Task ID:** cmqjoj3i000010bjglzqrmfkw
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Redesigned the Top Movers widget to group movers by site (domain) rather than showing a flat list. Each site row is expandable to reveal its individual keyword movements. This makes the widget scannable at a glance while still surfacing keyword-level detail on demand.

---

## Task 37: Hero Metric Cards — Clickable with Detail Modal

**Date:** 2026-06-18
**PMS Task ID:** cmqjoja1h00030bjgi6vm6jzz
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Made the Keywords, Brands, and Countries hero metric cards on the home dashboard clickable. Each card opens a detail modal listing the underlying items (e.g. all tracked keywords, all brands, all countries). Removed the 'View list →' text hint from the cards since the click target is now the entire card.

---

## Task 38: Brand Leaderboard — Rank-Change Indicator, CVG%, and Clickable Values

**Date:** 2026-06-18
**PMS Task ID:** cmqjojh4900050bjgv8sbxxub
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Added a rank-change indicator column to the Brand Leaderboard showing position movement vs the previous snapshot. Added a CVG% (coverage percentage) column. Color-aligned the summary cards for visual consistency. Made leaderboard row values and Top Movers entries clickable so users can drill into brand details directly from the home page.

## Task 39: BP/LP Sites — Stable Per-Domain Colors & Responsive Table Layout

**Date:** 2026-06-19
**PMS Task ID:** cmql3cyzg000004jrcp7atoio
**Column:** Review/QA
**Label:** UI
**Assignee:** Leo Sulano

Each BP/LP domain now always receives the same palette color based on its fixed position in the full brand domain list, not its index in the current visible selection — colors no longer shift when sites are toggled. Table stretches to fill viewport width when all selected columns fit, and switches to horizontal scroll when they overflow. LPSites also received the scrollRightPad measurement effect so the last column snaps cleanly beside the sticky KEYWORD column at maximum scroll.

---

## Task 40: Deep Navigation — Clickable Keywords from Home & Top Movers

**Date:** 2026-06-19
**PMS Task ID:** cmql3d6t7000204jrgwh2ec3q
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Made Top Movers keyword rows clickable: clicking a keyword navigates directly to the BP Sites brand view pre-filtered by that domain and keyword. Home hero metric keyword modal rows are also clickable and navigate to the matching filtered BP Sites view. Removed the CVG%/Share columns from the Leaderboard and removed FTDs/Countries from the sidebar nav to streamline the layout.

---

## Task 41: Bidirectional URL Sync for All Filters (BP/LP Sites)

**Date:** 2026-06-19
**PMS Task ID:** cmql3de3m000404jrj8guxi5j
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Every filter on BP Sites and LP Sites — site selection, countries, keyword search, position filter, and date — now writes to the URL query string on change, making any filter combination bookmarkable and shareable. Visiting a URL with query params restores the exact filter state on mount. Keyword filter is also applied to the stats record set so Top 3/Improved/Dropped/NR counts always reflect only visible rows.

---

## Task 42: Navigate Cards Redesign

**Date:** 2026-06-19
**PMS Task ID:** cmql3dkf2000604jrzssw6f3p
**Column:** Review/QA
**Label:** UI
**Assignee:** Leo Sulano

Updated the Navigate quick-action cards on the home dashboard. BP Sites card uses a light tint background with a solid border; Import Data card gets a solid red style; LP Sites card uses neutral grey with a black border. The NavCard arrow indicator is hidden until hover to reduce visual noise.

---

## Task 43: StatsCard Modal — Clickable Sites & Keywords

**Date:** 2026-06-19
**PMS Task ID:** cmql3drzt000804jr8gloqutu
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Made site and keyword rows in the Stats Card detail modal clickable. Clicking a site or keyword navigates directly to the BP Sites brand view with that site or keyword pre-filtered. NavCard arrow hidden until hover for a cleaner idle state.

---

## Task 44: Performance — Deferred Snapshot Loading on Brand Views

**Date:** 2026-06-19
**PMS Task ID:** cmql3dwrr000a04jr6y74d7kz
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Brand detail views (BP Sites and LP Sites) previously rendered all snapshots' full keyword tables simultaneously on mount, blocking the main thread for several seconds with tens of thousands of DOM nodes. Now only the latest snapshot matrix is rendered on initial load. A "Show N older snapshots" button loads the remaining snapshots on demand, keeping initial navigation fast regardless of how many historical snapshots exist.

---

## Task 45: Navigation Filter Fixes — Exact Keyword Match & Country Sync from Modal Clicks

**Date:** 2026-06-22
**PMS Task ID:** cmqp9xtv5000n04l173ziin3k
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Fixed a series of navigation bugs when clicking through to BP Sites from home page modals and Top Movers. Country filters now correctly pass a single country (not an array) from Top Movers keyword clicks. `activeCountries` is synced from the `?countries=` URL param on external navigation so country filtering applies immediately on mount. Keyword filter switched to exact match when navigating from modal/Top Movers clicks to avoid partial-match false positives.

---

## Task 46: How It Works Help Page

**Date:** 2026-07-08
**PMS Task ID:** cmrc3st6n000004jtph3lfdwa
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Added a new "How It Works" help page (routed at `/how-it-works`, linked from a new sidebar nav entry) that walks users through the core dashboard workflow: uploading a ranking export, picking a brand, reading the ranking table, filtering, and tracking changes over time. The upload step notes that imported files contain Rooster BP Sites ranking data extracted from a ranking-tracking system/software.

---

## Task 47: Sync schema.sql with Live Schema Drift

**Date:** 2026-07-17
**PMS Task ID:** cmrp0fkh6000704l4j3krmai2
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Backported the `category` column ALTER on `snapshots` and the anon UPDATE policies on both `snapshots` and `ranking_records` into the checked-in `supabase/schema.sql`. Both changes already existed on the live DB (applied ad hoc) but were never captured in the file — without the anon UPDATE policy on `ranking_records`, inline GSV/SV/AFF edits would silently fail under RLS if this file were ever used to provision a fresh environment.

---

## Task 48: FTD Summary Cards, Year Grouping & Styling

**Date:** 2026-07-20
**PMS Task ID:** cmrtdqu1h000504l473qepw8n
**Column:** Review/QA
**Label:** Feature, UI
**Assignee:** Leo Sulano

Replaced the FTD Totals column with summary cards matching the app's StatsRow style; added an all-time summary row and year filter matched to the app's custom dropdown; stretched cards full-width. Removed the one-time FTD history import in favor of a month-by-month workflow. Grouped FTD months by year with expand/collapse, showing year-group totals only when collapsed. Refactored to share logo-accurate brand colors between BP and FTD tables, tinting FTD body cells with each brand's own light color. Styling pass on REG/FTD/CONV% sub-headers (bold, 12px). Added click-to-filter summary cards (filter to a single month) and calculation-formula tooltips on each card, with sub-label wording refined per filter context. Also sorted the FTD matrix newest-month-first.

---

## Task 49: FTD Conversion Percent Calculation Fixes

**Date:** 2026-07-20
**PMS Task ID:** cmrtdquih000704l4xok3f4w6
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Fixed FTD Conversion % to match the source sheet's AVG-based calculation (FTD divided by REG, times 100) at the per-month, single-month-card, and year/all-time levels — the year/all-time figures are now computed fresh from the underlying records rather than averaged from pre-rounded monthly values. Rounded Conversion % display to whole numbers (no decimals).

---

## Task 50: FTD Matrix Table — Scroll and Layout Fixes

**Date:** 2026-07-20
**PMS Task ID:** cmrtdquyz000904l4hueo1qj0
**Column:** Review/QA
**Label:** UI
**Assignee:** Leo Sulano

Fixed the FTD matrix table to scroll horizontally with the sticky keyword-style column, land flush against the last brand column at max scroll, and stop clipping/gapping when nested inside flex ancestor containers.

---

## Task 51: Write-Gated Authentication (Email + Google OAuth)

**Date:** 2026-07-20
**PMS Task ID:** cmrtdqvev000b04l4hpf5qy84
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Designed and implemented write-gated auth: design spec + implementation plan, a Google OAuth sign-in helper, a shared `LoginModal` (email + Google), and a `useAuth` hook exposing a `requireAuth` gate. Topbar now reflects real session state (sign in/out). Gated all uploads/edits/deletes app-wide, plus FTD record/totals/stags edits specifically, behind `requireAuth`. Fixed rejection of orphaned pending auth requests for symmetry, and fixed `requireAuth` to read the session from a ref so multi-write operations correctly resume after sign-in instead of stalling mid-flow.

---

## Task 52: Split RLS Policies — Anon Read-Only, Authenticated Write

**Date:** 2026-07-20
**PMS Task ID:** cmrtdqvtq000d04l4ngghdjmt
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Split Supabase Row Level Security policies so anonymous users are read-only and only authenticated users can write, backing the new write-gated auth flow at the database level.

---

## Task 53: User Approval Workflow — Design Spec

**Date:** 2026-07-20
**PMS Task ID:** cmrtdqw5h000f04l49y7jgttp
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Wrote a design spec for a user approval workflow (planning only — not yet implemented).

---

## Task 54: User Approval Workflow — Implementation

**Date:** 2026-07-21
**PMS Task ID:** cmrutipyf000504jstykbb1s3
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Implemented the user approval workflow designed in Task 53. Wired approval state into `Layout`, added an admin users page (approve/revoke), and computed a presentational write-gate hook (`disabled`/`disabledTitle`) consumed by `Sidebar`, Home page, `DuplicateWarning`, and FTD add/edit/save actions so unapproved and signed-out users are blocked from all write actions app-wide, with matching tooltips.

---

## Task 55: admin/users Route — Access Control & Nav Rename

**Date:** 2026-07-21
**PMS Task ID:** cmrutjv7w000c04jsk5471olr
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Added the `/admin/users` route with `isAdmin`/`accessLoading` threaded through `useAuth`, redirecting non-admins away and skipping the row fetch entirely for them. Fixed a `user_access` RLS self-recursion bug. Renamed the Admin nav label to "Users" with a matching icon. Also unified the BP Sites site filter into an independent checkbox control and moved the Weekly/Monthly stats filter to the top of the page.

---

## Task 56: Admin Promote/Demote & Delete User Account

**Date:** 2026-07-21
**PMS Task ID:** cmrutjrrs000904jsqq8nv0ki
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Let admins promote/demote other users' admin status and permanently delete user accounts via a new `delete-user` Edge Function that uses the service-role key and verifies caller admin status against `user_access`. Fixed the CORS preflight to allow the `apikey`/`x-client-info` headers that `supabase.functions.invoke()` attaches automatically (the narrower allowlist copied from the `assistant` function, called via raw `fetch()`, didn't send them and failed preflight).

---

## Task 57: Forgot Password Flow

**Date:** 2026-07-21
**PMS Task ID:** cmrutjyvr000f04jswshb4onh
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Added a Supabase-backed password reset flow: a "Forgot password?" link in both `LoginModal` and the full-page Login that emails a reset link, and a new `/reset-password` page (outside `AuthGate`) that lets the user set a new password once the recovery session lands.

---

## Task 58: Activity Log / Log Page

**Date:** 2026-07-21
**PMS Task ID:** cmrutk212000u04js7pdf9jf2
**Column:** Review/QA
**Label:** Feature
**Assignee:** Leo Sulano

Added an `activity_log` table with append-only RLS and an `activityLog` client module (`logActivity`, `loadActivityLog`). Wrote a design spec and implementation plan for a new `/log` page that will surface recent write activity, with call sites planned across `App.tsx` and `FTDs.tsx`.

---
