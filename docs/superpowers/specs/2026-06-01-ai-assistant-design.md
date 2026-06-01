# AI Assistant (OpenAI) — Design Spec

**Date:** 2026-06-01
**Status:** Approved (pending spec review)
**Project:** Ranking Reports dashboard

## Goal

Add an AI assistant to the dashboard that does two things:

1. **Chat** — answers natural-language questions about Rooster Partners ranking data
   ("which brand dropped most this month?", "how has RoosterBet trended in DE?").
2. **Insights** — a one-click "Summarize this view" that produces a narrative summary
   of the most important ranking movements.

The assistant reasons over a **compact, full-history digest** of the ranking
snapshots, built client-side.

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Function | Chat + on-demand insights |
| API key handling | Supabase Edge Function proxy (key stays server-side) |
| Data scope | Full history, compact pre-aggregated digest |
| UI placement | Floating chat bubble, bottom-right |
| Model | `gpt-4o-mini` (configurable via `OPENAI_MODEL` env) |
| Streaming | Yes — token-by-token via SSE |
| Chat history | Per-session only (cleared on reload) |
| Data-context strategy | Approach A — pre-built compact summary (not tool-calling) |

## Architecture

```
┌─ Browser (React SPA) ────────────────────────────────┐
│  AssistantBubble (floating, bottom-right)             │
│   └─ AssistantPanel (chat popover)                    │
│        • useAssistant() hook — chat state, streaming  │
│        • buildHistoryDigest(viewSnapshots) ───┐       │
└────────────────────────────────────────────────┼─────┘
                                                  │ POST {messages, digest}
                                                  ▼
┌─ Supabase Edge Function: `assistant` (Deno) ─────────┐
│  • holds OPENAI_API_KEY (secret, server-side)        │
│  • builds system prompt = persona + digest JSON      │
│  • calls OpenAI chat/completions  stream:true        │
│  • pipes the SSE stream straight back to the browser │
└──────────────────────────────────────────────────────┘
```

**The OpenAI key never reaches the browser.** The Edge Function receives only a
pre-aggregated digest plus the chat messages.

## Data flow (one chat turn)

1. User opens the bubble and types a question.
2. The hook calls `buildHistoryDigest(viewSnapshots, activeCategory)` (memoized) → compact JSON.
3. `POST` to the Edge Function with the full message list + digest.
4. Function injects the digest into a system prompt, calls OpenAI with `stream: true`.
5. Function returns the raw SSE stream; the browser reads it with `fetch` +
   `ReadableStream`, appending tokens to the in-progress assistant message.

**Insights button:** same path; the hook seeds a canned prompt
("Summarize the most important ranking movements across all brands in the latest
snapshot vs. the prior one."). No separate endpoint.

## Data contract — the history digest

Built client-side over `viewSnapshots`, aggregated per brand, per snapshot date.
Built for the **category the user is currently viewing** (`bp-sites` or `lp-sites`);
the system prompt tells the model which one.

```ts
interface BrandSnapshotStat {
  brand: string            // "RoosterBet"
  rankingKeywords: number  // count of records where position is numeric (not 'NR')
  avgPosition: number      // mean of numeric positions, 1 decimal
  top3: number
  top10: number
}

interface HistoryDigest {
  category: 'bp-sites' | 'lp-sites'
  generatedFor: string                 // active snapshot displayDate
  brands: string[]                     // all brand names present
  timeline: {
    date: string                       // snapshot displayDate
    rawDate: string
    perBrand: BrandSnapshotStat[]
  }[]                                  // newest-first, capped at last 12 snapshots
  movers: {                            // latest vs. previous snapshot
    brand: string
    keyword: string
    country: string
    from: string                       // previous position or 'NR'
    to: string                         // current position
    delta: number                      // negative = improved (toward #1)
  }[]                                  // top 20 by absolute delta
}
```

**Size guards:** timeline capped at the most recent 12 snapshots; movers capped at
20 by absolute delta. With 9 brands this keeps the payload to a few KB.

**Numeric parsing:** positions are strings (`'NR'`, `'5'`, …). The digest parses
them once so the model gets clean numbers. `'NR'`/non-numeric positions are
excluded from `avgPosition`/`top3`/`top10`, counted in `rankingKeywords` only when
numeric. A brand absent from a snapshot omits its `BrandSnapshotStat` for that date.

## Files

### New frontend files

| File | Role |
|------|------|
| `src/lib/assistantDigest.ts` | `buildHistoryDigest(snapshots, category)` → `HistoryDigest`. Pure function, no React. |
| `src/lib/assistantClient.ts` | `streamChat(messages, digest, onToken, signal)` — `fetch` to the Edge Function, reads the SSE `ReadableStream`, calls `onToken` per delta. |
| `src/hooks/useAssistant.ts` | Owns chat state (`messages`, `isStreaming`, `error`); exposes `send()`, `summarize()`, `reset()`, `stop()`. Per-session only (plain `useState`). |
| `src/components/Assistant/AssistantBubble.tsx` | Floating circular button, bottom-right, `position: fixed`, `z-50`. Toggles the panel. `lucide-react` icon. |
| `src/components/Assistant/AssistantPanel.tsx` | Popover: scrollable message list, streaming bubble, input box, "Summarize this view" button, error/empty states. |
| `src/components/Assistant/types.ts` | `ChatMessage` (`role: 'user' \| 'assistant'`, `content`), `HistoryDigest`, `BrandSnapshotStat`. |

### New backend file

| File | Role |
|------|------|
| `supabase/functions/assistant/index.ts` | Deno Edge Function. Reads `OPENAI_API_KEY` + `OPENAI_MODEL` (default `gpt-4o-mini`). Validates request, builds system prompt (persona + digest), calls OpenAI `stream: true`, streams back with CORS headers. |

### Wiring

Mount `<AssistantBubble snapshots={viewSnapshots} activeCategory={…} />` once in
`Layout` (`src/App.tsx`), as a sibling to `<ToastContainer>`. `viewSnapshots` is
already in scope; the current category is derived from `location.pathname`
(`/lp-sites` → `lp-sites`, else `bp-sites`).

### Styling

Matches the existing system: white cards, `#E2E8F0` borders, `#0F172A` ink,
`font-display` headings, the same shadow tokens used by `App.tsx` modals.

### Config

`OPENAI_API_KEY` and `OPENAI_MODEL` set as Supabase function secrets (documented,
never committed). No new frontend env var — the function URL derives from the
existing `VITE_SUPABASE_URL`.

## Error handling

- **No snapshots loaded** → bubble opens; panel shows "Load some ranking data first"
  and disables input. No empty digest sent.
- **Edge Function / network error** (non-200, fetch throws) → in-progress assistant
  message replaced with an inline error row ("Couldn't reach the assistant — try
  again"); `isStreaming` resets; input re-enabled. No app-level crash.
- **OpenAI error inside the function** (bad key, rate limit, 4xx/5xx) → function
  returns JSON `{ error }` with upstream status; client surfaces it in the inline
  error row.
- **Stream interrupted mid-reply** → text streamed so far is kept; an error row is
  appended below it.
- **CORS** → function sets `Access-Control-Allow-Origin` and handles the `OPTIONS`
  preflight.
- **Abort** → closing the panel or hitting "stop" aborts the in-flight `fetch` via
  `AbortController`.

## Edge cases

- `'NR'`/non-numeric positions excluded from average and top-N math.
- Brand absent from a snapshot → omitted from that date's `perBrand`.
- Long conversations: cap the messages sent upstream to the last 10 turns to bound
  token cost (older turns drop silently — acceptable for per-session chat).

## Testing

No automated test suite is configured in this repo; testing is manual.

- `buildHistoryDigest` verified against a known snapshot set (counts/averages checked by hand).
- Edge Function tested locally with `supabase functions serve` using a throwaway key.
- Manual UI pass: open/close, send, stream renders, "Summarize" works, error path
  (kill network), empty-data state.

## Out of scope (v1)

- Tool/function calling for drill-down (Approach B) — revisit if needed.
- Persisting chat history across sessions or to Supabase.
- Including both categories in a single digest.
- Authentication / per-user rate limiting on the Edge Function.
