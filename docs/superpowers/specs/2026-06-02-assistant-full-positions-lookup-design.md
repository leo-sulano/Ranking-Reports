# AI Assistant — Full Positions Lookup — Design Spec

**Date:** 2026-06-02
**Status:** Approved, pending implementation plan

## Goal

Enable the assistant to answer any specific keyword position question from the dashboard data — e.g. "What does RoosterBet rank for 'casino bonus' in Germany?" — by adding a full `positions` lookup map to the history digest.

## Problem

The current digest is capped (top-5 keywords per brand, top-8 countries, top-20 movers). With 5,000+ keyword rows per snapshot, the vast majority of specific keyword/country combinations are invisible to the assistant. It answers aggregate questions well but cannot answer row-level lookups.

## Approach

Add a single `positions` field to `HistoryDigest`: a nested map of `brand → country → keyword → current position string`. Built from the latest snapshot only. All keywords included — no cap. The model reads this field to answer any specific position question without requiring tool-calling or multi-round requests.

**Why not tool-calling?** Tool-calling (model requests slices on demand) is more token-efficient but requires a multi-round client ↔ Edge Function loop — significantly more engineering. For this dataset size the full lookup fits comfortably in a single request (~31k tokens) within gpt-4o-mini's 128k context window.

## Token budget

- 5,000 rows × ~25 bytes/entry ≈ 125 KB ≈ **31k tokens** for `positions`
- Existing digest ≈ 3k tokens
- System prompt ≈ 2k tokens
- Total per-request ≈ **36k tokens** — well within 128k limit

## Changes

### 1. `src/components/Assistant/types.ts`

Add one field to `HistoryDigest`:

```ts
positions: Record<string, Record<string, Record<string, string>>>
// brand → country → keyword → position string ("3", "NR", null-safe)
```

### 2. `src/lib/assistantDigest.ts`

Add a new private function:

```ts
function buildPositionLookup(
  snapshot: Snapshot,
  category: CategoryId,
): Record<string, Record<string, Record<string, string>>>
```

- Iterates all records in `snapshot.records`
- Groups by `brandOf(domain, category)` → `country` → `keyword` → `position` (raw string, e.g. `"5"`, `"NR"`)
- Skips records where `brandOf` returns `undefined` (unknown domain)
- All keywords included — no numeric-only filter, no cap

Wire into `buildHistoryDigest`:
```ts
positions: capped.length > 0 ? buildPositionLookup(capped[0], category) : {}
```

### 3. `supabase/functions/assistant/index.ts`

Add one line to the `## Digest structure` section of `systemPrompt()`:

```
- `positions` — full keyword lookup: brand → country → keyword → current position string ("3", "NR"). Use this to answer any specific keyword position question not covered by the aggregate stats.
```

## Testing

Extend `src/lib/assistantDigest.test.ts` with 4 new cases:

1. `positions` maps brand → country → keyword → position string for all records in latest snapshot
2. `positions` includes NR keywords (not filtered out)
3. `positions` is `{}` when no snapshots provided
4. `positions` reflects only the latest snapshot — prior snapshot keywords are not present if missing from latest

## Out of scope

No UI changes. No model change. No change to request contract, streaming, CORS, or token cap. Previous-position data not included in `positions` — covered by existing `movers`/`timeline`.
