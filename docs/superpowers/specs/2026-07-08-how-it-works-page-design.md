# How It Works Page Design

**Date:** 2026-07-08
**Route:** `/how-it-works`
**Status:** Approved

---

## Overview

A new static help page that explains the core dashboard workflow to users — from uploading a ranking export through reading and filtering the table. Read-only reference content; no interactivity, screenshots, or call-to-action buttons.

---

## Routing & Navigation

- New route in `App.tsx`: `<Route path="/how-it-works" element={<HowItWorks />} />`, nested under the existing `Layout`/`Outlet`.
- Add an entry to `SECTION_TITLES` in `App.tsx`/`Layout` for the Topbar title/subtitle on this route (e.g. title "How It Works", subtitle "A quick guide to using the dashboard").
- Sidebar: add an entry to the `PAGES` array in `src/components/Sidebar.tsx`, placed near the bottom — after "Ask AI" and before the "Import Data" footer button — since this is reference material, not a primary destination.
- Icon: `lucide-react`'s `CircleHelp`, sized to match the existing inline SVG icons (18×18, `stroke="currentColor"`).
- No CTA button on the page itself (e.g. no "Upload Data" button) — purely explanatory.

---

## Page Content

Page heading + subtitle, followed by a vertical list of 5 step cards. Each card: a number badge, a short title, and a 1–2 sentence description. Core flow only — no coverage of BP Sites, LP Sites, FTDs, or Ask AI as separate destinations.

1. **Upload your data** — Click "Import Data," pick a category, and drop in your ranking export (.xlsx/.xls/.csv).
2. **Pick a brand** — Select a brand from the sidebar to see its full ranking table; until then, the Home page shows an overview of all brands.
3. **Read the table** — Each row is a keyword: current position, day-over-day change (▲/▼), and "NR" when it isn't ranking.
4. **Filter what you see** — Narrow the table by country, domain, or keyword using the filters above it.
5. **Track over time** — Upload new reports as they come in; each becomes a dated snapshot so you can compare rankings across dates.

---

## Visual Style

Matches the app's actual light theme (CLAUDE.md's "dark theme" claim is stale and should be disregarded for this work):
- Background: `#F7F7F5` / white cards
- Borders: `#E5E4DF`
- Accents: black `#0A0A0A`, red `#CC0000`
- Headings: `font-display` (Outfit)
- Step cards: `rounded-[14px]`/`rounded-md` with soft shadow, consistent with existing modal/card styling

No screenshots or GIFs. No shared layout wrapper needed — Sidebar/Topbar are already provided by `Layout` via `Outlet`, so the page returns its own centered content, similar in spirit to the existing stub pages (`src/pages/FTDs.tsx`) but with real step-card content instead of a "Coming Soon" placeholder.

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/pages/HowItWorks.tsx` | New page component |
| `src/App.tsx` | Add route + import + `SECTION_TITLES` entry |
| `src/components/Sidebar.tsx` | Add `CircleHelp` nav entry to `PAGES`, near the bottom |

---

## Out of Scope

- Screenshots, GIFs, or embedded media
- FAQ/expandable Q&A format
- Coverage of BP Sites, LP Sites, FTDs, or Ask AI as individual steps
- "Upload Data" CTA button on the page
- Placement at the top of the sidebar
