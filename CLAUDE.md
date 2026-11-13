# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (Vite, localhost:5173)
npm run build     # Type-check + production build (tsc -b && vite build)
npm run preview   # Preview production build
```

No test suite is configured.

## Architecture

This is a React + TypeScript + Tailwind v4 SPA (Vite) for tracking SEO keyword rankings across Rooster Partners casino brands.

### Data Flow

1. **Import** — Two paths into the same `Snapshot` shape:
   - **Sync from API** (BP Sites only) — `src/lib/sitesApi.ts` makes one call to
     `/api/sites` (a Vercel function holding `AHREFS_API_KEY`). The server reads
     the client's Ahrefs Rank Tracker (`api/_lib/ahrefs.ts`, free endpoints
     only): the project list, the projects whose target is in
     `DOMAIN_TO_BRAND`, and each one's competitor list and
     `competitors-overview` rankings. `api/_lib/sitesNormalize.ts` turns them
     into `RankingRecord[]`: one per domain × keyword × market, with the
     snapshot dated by the weekly Ahrefs update. An unchecked keyword is never
     read as NR. `api/cron-sync.ts` runs the same path on a schedule (Wed + Fri
     04:00 UTC). OpenSEO and the Ranks API before it are no longer called. See
     `docs/integrations/ahrefs.md`.
   - **Import Data** — user uploads an `.xlsx` via `UploadModal`;
     `src/lib/parser.ts` (`parseXlsx`) reads it, auto-detects the header row, and
     filters to known brand domains. The only path for LP Sites, which the sync
     does not read.
2. **Persist** — Parsed records are wrapped in a `Snapshot` (id, rawDate, displayDate, records[]) and saved to `localStorage` via `src/lib/storage.ts`. Multiple snapshots are supported; legacy flat-record format is migrated on first load.
3. **State** — All app state lives in a single `AppState` object managed by `useState` in the `Layout` component (`src/App.tsx`). There is no global state library. State is passed to the `RankingReports` page via React Router's `useOutletContext`.
4. **Display** — `RankingReports` is either an `OverviewGrid` (all brands, no active brand selected) or a `RankingTable` (filtered to the active brand + country/domain/keyword filters).
5. **Other ranking keywords** — `api/cron-discovery.ts` (3× daily) pulls Ahrefs
   Site Explorer organic keywords for the 37 BP domains × 5 countries once per
   Ahrefs billing month into Supabase (`keyword_discovery*`,
   `supabase/keyword-discovery.sql`). Unlike the rankings sync this SPENDS API
   units, so it uses its own capped key, `AHREFS_DISCOVERY_API_KEY`, and stops
   before the key's monthly limit. `src/components/OtherRankingKeywords.tsx`
   shows them under each BP Sites brand matrix, minus what the newest snapshot
   tracks. See `docs/integrations/ahrefs.md`.

### Key Files

| File | Role |
|------|------|
| `src/lib/brands.ts` | Single source of truth for all brands, their domains, and color tokens. `DOMAIN_TO_BRAND` maps every domain → brand name. Add new brands/domains here. |
| `src/lib/parser.ts` | Excel parsing + position/change string normalisation (`parsePosition`, `parseChange`). "Not Ranking" variants all resolve to `'NR'`. |
| `src/lib/storage.ts` | `localStorage` persistence under key `rr_snapshots`. Handles legacy migration from the old single-snapshot format. |
| `src/types/index.ts` | All shared TypeScript types (`RankingRecord`, `Snapshot`, `Brand`, `AppState`). |
| `src/App.tsx` | `Layout` holds all state and callback handlers; passes everything to `RankingReports` via `RROutletContext`. Stub pages (BP Sites, Screenshots, GMB, FTDs) exist but are not implemented. |
| `api/_lib/sitesNormalize.ts` | Ahrefs Rank Tracker projects → `RankingRecord` (re-exported for the frontend by `src/lib/sitesNormalize.ts`). Positions are credited to sites by competitor slot order; a null `serp_updated` means "not checked", `position: null` means NR; a site's own project wins over others, else the best same-day position; `cycleDate` dates the snapshot by the weekly update. |
| `api/_lib/ahrefs.ts` | Server-only Ahrefs client: project list, BP filter (other clients' projects are never fetched), per-project competitors + rankings with bounded concurrency, one retry, operator-worded errors; fails if a response reports API units spent. |
| `api/sites.ts` | Serverless proxy holding `AHREFS_API_KEY`; the browser never sees the key or the upstream URL. Requires the caller's Supabase session (verified via `api/_lib/requestAuth.ts`) — it is not a public endpoint. Returns normalized records. |
| `scripts/ahrefs-week-to-xlsx.mts` | Read-only: prints one Ahrefs week as the sync sees it, and can write it as an import-ready xlsx under `docs/references/` (gitignored). |
| `api/_lib/keywordDiscovery.ts` | Browser-safe logic for other ranking keywords: domain × country pairs, the Ahrefs billing cycle, keyword normalization, organic-keywords response → rows, the tracked index, and the `where` that excludes tracked keywords. |
| `api/_lib/ahrefsDiscovery.ts` | Server-only client for the PAID Site Explorer call: its own key (refuses the rankings key), the key's limits, cost read from `x-api-units-cost-total-actual`, an over-charge stop, one retry. `scripts/ahrefs-discovery-check.mts` exercises it at 0 units on a free test target. |
| `api/cron-discovery.ts` | Cron (05:00, 11:00, 17:00 UTC): takes a run lease, refuses while halted, fetches the cycle's missing domain × country pairs within a 45 s budget, saves each through `api/_lib/discoveryStore.ts`, stops before the key's limit, halts on an Ahrefs pricing or response-shape change, and writes one /log line per run that did work. |
| `src/components/OtherRankingKeywords.tsx` | The "Other ranking keywords · not tracked" section on BP Sites brand pages; list logic in `src/lib/discoveryList.ts`, loader in `src/lib/keywordDiscovery.ts`. |

### Brands

Nine brands are registered in `src/lib/brands.ts`: Lucky 7even, RoosterBet, LuckyVibe, SpinsUp, Spinjo, FortunePlay, RocketSpin, PlayMojo, Rollero. Each brand has a `mainDomain` (sorted first in domain filters) plus alias domains.

### Tailwind

Uses Tailwind v4 (`@tailwindcss/vite` plugin) — no `tailwind.config.js`. All theme customisation is done via CSS variables in `src/index.css`. Dark background is `#07090F` with a `#1C2B3A` grid overlay.

<!-- gitnexus:start -->
# GitNexus MCP

This project is indexed by GitNexus as **Ranking Reports** (108 symbols, 211 relationships, 7 execution flows).

GitNexus provides a knowledge graph over this codebase — call chains, blast radius, execution flows, and semantic search.

## Always Start Here

For any task involving code understanding, debugging, impact analysis, or refactoring, you must:

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx gitnexus analyze` in the terminal first.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/refactoring/SKILL.md` |

## Tools Reference

| Tool | What it gives you |
|------|-------------------|
| `query` | Process-grouped code intelligence — execution flows related to a concept |
| `context` | 360-degree symbol view — categorized refs, processes it participates in |
| `impact` | Symbol blast radius — what breaks at depth 1/2/3 with confidence |
| `detect_changes` | Git-diff impact — what do your current changes affect |
| `rename` | Multi-file coordinated rename with confidence-tagged edits |
| `cypher` | Raw graph queries (read `gitnexus://repo/{name}/schema` first) |
| `list_repos` | Discover indexed repos |

## Resources Reference

Lightweight reads (~100-500 tokens) for navigation:

| Resource | Content |
|----------|---------|
| `gitnexus://repo/{name}/context` | Stats, staleness check |
| `gitnexus://repo/{name}/clusters` | All functional areas with cohesion scores |
| `gitnexus://repo/{name}/cluster/{clusterName}` | Area members |
| `gitnexus://repo/{name}/processes` | All execution flows |
| `gitnexus://repo/{name}/process/{processName}` | Step-by-step trace |
| `gitnexus://repo/{name}/schema` | Graph schema for Cypher |

## Graph Schema

**Nodes:** File, Function, Class, Interface, Method, Community, Process
**Edges (via CodeRelation.type):** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

```cypher
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath
```

<!-- gitnexus:end -->
