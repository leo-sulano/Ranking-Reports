# AI Assistant Intelligence Upgrade — Design Spec

**Date:** 2026-06-02
**Status:** Approved, pending implementation plan

## Goal

Make the embedded AI assistant answer ranking questions more accurately and usefully — without changing the model or building a training pipeline. Three coupled improvements ship together:

1. **Richer data context** — extend the history digest so the assistant can reason about countries, NR transitions, longer-range trends, and specific top keywords.
2. **Better instructions** — rewrite the system prompt to explain the digest structure, restate domain rules, guide answer format, and include few-shot examples.
3. **Starter questions** — clickable suggested-question chips in the empty panel.

Fine-tuning a custom model is **explicitly deferred** to a separate future project; we first establish how far an optimized prompt + context gets `gpt-4o-mini` on this bounded domain.

## Architecture

The existing flow is unchanged: client builds a digest → POSTs `{ messages, digest }` to the Supabase Edge Function `assistant` → function injects a system prompt and proxies to OpenAI with `stream: true` → SSE piped back. This upgrade only **grows the digest payload and the system prompt**, and **adds UI to the panel**. The request/response contract, streaming, CORS, origin allowlist, and `MAX_TOKENS` cap are untouched.

**Chosen approach: one comprehensive, bounded digest (Approach A).** The digest is built once per request, fully stateless, with hard caps per dimension. Rejected alternatives: question-aware trimming (brittle heuristics, savings we don't need) and tool-calling (multi-round loop, significant added code/latency — over-engineered for this scale). `gpt-4o-mini`'s 128k context window makes a few-KB JSON digest negligible in cost.

## 1. Extended digest

All changes in `src/lib/assistantDigest.ts` and `src/components/Assistant/types.ts`. The digest remains a single `HistoryDigest` JSON object.

### New / changed types

```ts
// Per-country slice of a brand's stats within one snapshot.
interface CountryStat {
  country: string
  rankingKeywords: number
  avgPosition: number   // 1 decimal, numeric positions only
  top3: number
  top10: number
}

// A brand's single best-ranking keyword entries.
interface TopKeyword {
  keyword: string
  country: string
  position: number      // numeric only (NR excluded)
}

interface BrandSnapshotStat {
  brand: string
  rankingKeywords: number
  avgPosition: number
  top3: number
  top10: number
  byCountry: CountryStat[]    // NEW — top 8 countries by rankingKeywords
  topKeywords: TopKeyword[]   // NEW — 5 best numeric positions
}

// NR transition entries (latest vs prior snapshot).
interface Transition {
  brand: string
  keyword: string
  country: string
  to?: string     // present on `gained` (new numeric position)
  from?: string   // present on `lost` (prior numeric position)
}

interface HistoryDigest {
  category: CategoryId
  generatedFor: string
  brands: string[]
  timeline: { date: string; rawDate: string; perBrand: BrandSnapshotStat[] }[]  // newest-first, ≤12
  movers: Mover[]            // existing — latest vs prior, ≤20 by |delta|
  gained: Transition[]       // NEW — NR → numeric, latest vs prior, ≤15
  lost: Transition[]         // NEW — numeric → NR, latest vs prior, ≤15
  rangeMovers: RangeMovers   // NEW — latest vs oldest-in-range
}

// Longer-range movement across the full retained window.
interface RangeMovers {
  fromDate: string           // oldest-in-range displayDate
  toDate: string             // latest displayDate
  movers: Mover[]            // ≤15 by |delta|, numeric-both-ends only
}
```

### Computation rules

- **byCountry** — group a brand's records by `country`; compute the same aggregates as the global stat per country; numeric positions only (NR/null excluded from math, consistent with `perBrandStats`). Sort by `rankingKeywords` desc, cap at **8**.
- **topKeywords** — a brand's records with numeric positions, sorted by position asc (best first), cap at **5**. NR excluded.
- **gained / lost** — reuse the mover key `domain|keyword|country`. `gained`: prior position is NR/non-numeric AND current is numeric. `lost`: prior numeric AND current NR/non-numeric. Sort each by the *numeric* position involved (best first), cap at **15** each. Only computed when ≥2 snapshots in range.
- **rangeMovers** — identical to `computeMovers` but `prev = capped[capped.length - 1]` (oldest retained) instead of `capped[1]`. Numeric-both-ends only, cap **15**. Empty `movers` (with both dates still set) when <2 snapshots.
- Existing `movers` (latest vs prior, ≤20) is **unchanged**.

### Bounding summary

countries ≤8/brand · topKeywords ≤5/brand · gained ≤15 · lost ≤15 · rangeMovers ≤15 · movers ≤20 · timeline ≤12 snapshots. Keeps the serialized digest to a few KB.

## 2. Instructions (system prompt + few-shot)

Rewrite `systemPrompt(digest)` in `supabase/functions/assistant/index.ts`. Content additions:

- **Digest-structure guide:** `timeline` is newest-first; `movers`/`gained`/`lost` are latest-vs-prior; `rangeMovers` spans `fromDate`→`toDate`; each brand in a timeline entry carries `byCountry` and `topKeywords`.
- **Domain rules (retained + extended):** lower position is better, 1 is best, "NR" = not ranking, negative delta = improved (moved toward #1). Treat `gained` as wins, `lost` as regressions. Use only data present in the digest — if it's not there, say so rather than guessing.
- **Answer-format guidance:** lead with the direct answer; compact markdown (short bullets, **bold** brand/keyword names, positions inline); no preamble; concise.
- **Few-shot:** 2–3 static Q&A pairs appended to the system prompt, written against the digest shape (e.g. a "biggest drops this week" answer using `movers`/`lost`, and a "how is brand X doing in country Y" answer using `byCountry`). Invisible to users; shape every answer.

Contract, streaming, CORS, and `MAX_TOKENS` (800) unchanged — only prompt text grows.

## 3. UI: starter chips

In `src/components/Assistant/AssistantPanel.tsx`:

- When `messages.length === 0 && ready` (online + `hasData`), render 3–5 suggested-question pill buttons below the empty-state line.
- Clicking a chip calls `onSend(text)` immediately (same path as typing + Enter).
- **Static, generic** question list (a constant in the panel) — no brand/country hardcoded, since brands vary by dataset. Examples: "Biggest drops since last week?", "Which brand improved the most?", "Summarize wins and losses", "Any keywords that fell off (NR)?".
- Chips appear only in the empty state (gone once a conversation starts) and are hidden when offline / no data (same `ready` gate as the input).
- The existing **Summarize this view** button is unchanged.
- Styling: small pills using existing tokens (`border-[#E2E8F0]`, `rounded-[8px]`, `text-[12px]`), flex-wrapped.

## 4. Testing

- Extend `src/lib/assistantDigest.test.ts` (vitest, already configured) with cases:
  - `byCountry` aggregates per country correctly and caps at 8.
  - `gained`/`lost` detect NR↔numeric transitions and exclude numeric↔numeric.
  - `rangeMovers` uses oldest-in-range as baseline; empty movers with <2 snapshots.
  - `topKeywords` returns the 5 best numeric positions and excludes NR.
- No automated test for the Edge Function prompt (static content; verified by reading).
- No UI test harness exists — chips verified manually.

## Out of scope

Fine-tuning; model change (`gpt-4o-mini` stays, switchable via existing `OPENAI_MODEL` env); tool-calling; question-aware digest trimming; persisting chat history across sessions.
