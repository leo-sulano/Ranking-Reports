# AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating AI assistant to the dashboard that chats about ranking data and summarizes the current view, powered by OpenAI through a Supabase Edge Function proxy.

**Architecture:** A floating bubble + popover panel in the React SPA builds a compact full-history digest from the in-memory snapshots and POSTs it with the chat messages to a Supabase Edge Function. The function holds the OpenAI key server-side, calls `gpt-4o-mini` with `stream: true`, and pipes the SSE stream back to the browser, which renders tokens live. Per-session chat only.

**Tech Stack:** React 19 + TypeScript + Tailwind v4 (Vite), Supabase Edge Functions (Deno), OpenAI Chat Completions API, Vitest (new, for the one pure function).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/components/Assistant/types.ts` | Shared types: `ChatMessage`, `BrandSnapshotStat`, `Mover`, `HistoryDigest`. |
| `src/lib/assistantDigest.ts` | Pure `buildHistoryDigest(snapshots, category)` → `HistoryDigest`. |
| `src/lib/assistantDigest.test.ts` | Vitest unit tests for the digest. |
| `src/lib/assistantClient.ts` | `streamChat()` — fetch + SSE stream reader. |
| `src/hooks/useAssistant.ts` | Chat state + `send` / `summarize` / `stop` / `reset`. |
| `src/components/Assistant/AssistantPanel.tsx` | Chat popover UI. |
| `src/components/Assistant/AssistantBubble.tsx` | Floating button + panel container. |
| `supabase/functions/assistant/index.ts` | Deno Edge Function proxy to OpenAI (streaming). |
| `src/App.tsx` (modify) | Mount the bubble; derive active category. |
| `package.json` (modify) | Add `vitest` + `test` script. |

---

## Task 1: Add Vitest for the pure digest function

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest`
Expected: `vitest` added to devDependencies, no errors.

- [ ] **Step 2: Add the test script to `package.json`**

In the `"scripts"` block, add:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

The digest tests are pure (no DOM), so use the default node environment.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Verify the runner works**

Run: `npm test`
Expected: Vitest runs and reports "No test files found" (no tests yet) — exits without config errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for unit tests"
```

---

## Task 2: Define shared Assistant types

**Files:**
- Create: `src/components/Assistant/types.ts`

- [ ] **Step 1: Write the types file**

```ts
import type { CategoryId } from '../../lib/categories'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Per-brand aggregate for one snapshot date.
export interface BrandSnapshotStat {
  brand: string
  rankingKeywords: number  // records with a numeric position
  avgPosition: number      // mean of numeric positions, 1 decimal
  top3: number
  top10: number
}

// A single keyword's position change between the latest two snapshots.
export interface Mover {
  brand: string
  keyword: string
  country: string
  from: string    // previous position or 'NR'
  to: string      // current position or 'NR'
  delta: number   // negative = improved (moved toward #1)
}

export interface HistoryDigest {
  category: CategoryId
  generatedFor: string          // active snapshot displayDate (newest)
  brands: string[]
  timeline: {
    date: string                // displayDate
    rawDate: string
    perBrand: BrandSnapshotStat[]
  }[]                           // newest-first, capped at 12
  movers: Mover[]              // top 20 by absolute delta
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Assistant/types.ts
git commit -m "feat(assistant): add shared types"
```

---

## Task 3: Build the history digest (TDD)

**Files:**
- Create: `src/lib/assistantDigest.ts`
- Test: `src/lib/assistantDigest.test.ts`

The digest maps each record's `domain` to a brand using `DOMAIN_TO_BRAND`
(bp-sites) or `LP_DOMAIN_TO_BRAND` (lp-sites), parses positions with the existing
`parsePosition`, aggregates per brand per snapshot, and computes movers between the
two newest snapshots by matching `(domain, keyword, country)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildHistoryDigest } from './assistantDigest'
import type { Snapshot } from '../types'

function rec(domain: string, keyword: string, country: string, position: string) {
  return { domain, keyword, country, position, previous: '', change: '', date: '' }
}

// rooster.bet → RoosterBet (bp). Two snapshots, newest first.
const snaps: Snapshot[] = [
  {
    id: 's2', category: 'bp-sites', rawDate: '2026-05-20', displayDate: '20 May 26',
    records: [
      rec('rooster.bet', 'casino', 'Germany', '2'),    // was 5 → improved, delta -3
      rec('rooster.bet', 'slots',  'Germany', 'NR'),   // was 8 → fell out
      rec('rooster.bet', 'bonus',  'Germany', '11'),   // not top10
    ],
  },
  {
    id: 's1', category: 'bp-sites', rawDate: '2026-05-13', displayDate: '13 May 26',
    records: [
      rec('rooster.bet', 'casino', 'Germany', '5'),
      rec('rooster.bet', 'slots',  'Germany', '8'),
    ],
  },
]

describe('buildHistoryDigest', () => {
  it('aggregates per-brand stats for the newest snapshot', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    const latest = d.timeline[0]
    expect(latest.date).toBe('20 May 26')
    const rb = latest.perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.rankingKeywords).toBe(2)   // '2' and '11' are numeric; 'NR' excluded
    expect(rb.top3).toBe(1)              // only position 2
    expect(rb.top10).toBe(1)             // position 2 (<=10); 11 excluded
    expect(rb.avgPosition).toBe(6.5)     // mean(2, 11)
  })

  it('orders timeline newest-first and caps at 12 snapshots', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    expect(d.timeline.map((t) => t.rawDate)).toEqual(['2026-05-20', '2026-05-13'])
  })

  it('computes movers between the two newest snapshots, negative = improved', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    const casino = d.movers.find((m) => m.keyword === 'casino')!
    expect(casino).toMatchObject({ brand: 'RoosterBet', from: '5', to: '2', delta: -3 })
  })

  it('returns empty timeline/movers for no snapshots', () => {
    const d = buildHistoryDigest([], 'bp-sites')
    expect(d.timeline).toEqual([])
    expect(d.movers).toEqual([])
    expect(d.brands).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `buildHistoryDigest` is not defined / module not found.

- [ ] **Step 3: Implement `buildHistoryDigest`**

```ts
import type { Snapshot, RankingRecord } from '../types'
import type { CategoryId } from './categories'
import { DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND } from './brands'
import { parsePosition } from './parser'
import type { HistoryDigest, BrandSnapshotStat, Mover } from '../components/Assistant/types'

const MAX_SNAPSHOTS = 12
const MAX_MOVERS = 20

function brandOf(domain: string, category: CategoryId): string | undefined {
  const map = category === 'lp-sites' ? LP_DOMAIN_TO_BRAND : DOMAIN_TO_BRAND
  return map[domain.toLowerCase()]
}

function perBrandStats(records: RankingRecord[], category: CategoryId): BrandSnapshotStat[] {
  // brand → { sum, count, top3, top10 }
  const acc = new Map<string, { sum: number; count: number; top3: number; top10: number }>()
  for (const r of records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const pos = parsePosition(r.position)
    if (typeof pos !== 'number') continue   // 'NR' and null excluded from math
    let a = acc.get(brand)
    if (!a) { a = { sum: 0, count: 0, top3: 0, top10: 0 }; acc.set(brand, a) }
    a.sum += pos
    a.count += 1
    if (pos <= 3) a.top3 += 1
    if (pos <= 10) a.top10 += 1
  }
  return Array.from(acc.entries()).map(([brand, a]) => ({
    brand,
    rankingKeywords: a.count,
    avgPosition: a.count ? Math.round((a.sum / a.count) * 10) / 10 : 0,
    top3: a.top3,
    top10: a.top10,
  }))
}

function computeMovers(latest: Snapshot, prev: Snapshot, category: CategoryId): Mover[] {
  const key = (r: RankingRecord) => `${r.domain.toLowerCase()}|${r.keyword.toLowerCase()}|${r.country}`
  const prevByKey = new Map(prev.records.map((r) => [key(r), r]))
  const movers: Mover[] = []
  for (const r of latest.records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const before = prevByKey.get(key(r))
    if (!before) continue
    const pNow = parsePosition(r.position)
    const pPrev = parsePosition(before.position)
    // Only score movers where both ends are numeric — delta is meaningful then.
    if (typeof pNow !== 'number' || typeof pPrev !== 'number') continue
    const delta = pNow - pPrev          // negative = moved toward #1 = improved
    if (delta === 0) continue
    movers.push({ brand, keyword: r.keyword, country: r.country, from: before.position, to: r.position, delta })
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return movers.slice(0, MAX_MOVERS)
}

export function buildHistoryDigest(snapshots: Snapshot[], category: CategoryId): HistoryDigest {
  const inCat = snapshots.filter((s) => s.category === category)
  // snapshots arrive newest-first from App state; keep that order, cap at 12.
  const capped = inCat.slice(0, MAX_SNAPSHOTS)

  const brandSet = new Set<string>()
  const timeline = capped.map((s) => {
    const perBrand = perBrandStats(s.records, category)
    perBrand.forEach((b) => brandSet.add(b.brand))
    return { date: s.displayDate, rawDate: s.rawDate, perBrand }
  })

  const movers = capped.length >= 2 ? computeMovers(capped[0], capped[1], category) : []

  return {
    category,
    generatedFor: capped[0]?.displayDate ?? '',
    brands: Array.from(brandSet).sort(),
    timeline,
    movers,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistantDigest.ts src/lib/assistantDigest.test.ts
git commit -m "feat(assistant): build compact full-history digest"
```

---

## Task 4: Streaming client

**Files:**
- Create: `src/lib/assistantClient.ts`

Reads the Edge Function URL from the existing Supabase env var, POSTs the chat +
digest, and reads the SSE stream, invoking `onToken` per text delta. Handles the
OpenAI `data: {...}` / `data: [DONE]` SSE framing.

- [ ] **Step 1: Write the client**

```ts
import type { ChatMessage, HistoryDigest } from '../components/Assistant/types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const FN_URL = `${SUPABASE_URL}/functions/v1/assistant`

export interface StreamHandlers {
  onToken: (delta: string) => void
  signal?: AbortSignal
}

/**
 * POST the conversation + digest to the assistant Edge Function and stream the
 * reply. Resolves when the stream completes. Throws on non-2xx or network error.
 */
export async function streamChat(
  messages: ChatMessage[],
  digest: HistoryDigest,
  { onToken, signal }: StreamHandlers,
): Promise<void> {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ messages, digest }),
    signal,
  })

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j?.error) detail = typeof j.error === 'string' ? j.error : JSON.stringify(j.error)
    } catch { /* non-JSON error body */ }
    throw new Error(detail)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by double newlines.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) onToken(delta)
      } catch { /* keep-alive or partial frame — ignore */ }
    }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/assistantClient.ts
git commit -m "feat(assistant): add streaming SSE client"
```

---

## Task 5: useAssistant hook

**Files:**
- Create: `src/hooks/useAssistant.ts`

Owns per-session chat state. Builds the digest lazily at send time from the
snapshots/category passed in. Caps the upstream message list to the last 10 turns.

- [ ] **Step 1: Write the hook**

```ts
import { useState, useRef, useCallback } from 'react'
import type { Snapshot } from '../types'
import type { CategoryId } from '../lib/categories'
import type { ChatMessage } from '../components/Assistant/types'
import { buildHistoryDigest } from '../lib/assistantDigest'
import { streamChat } from '../lib/assistantClient'

const MAX_TURNS = 10
const SUMMARIZE_PROMPT =
  'Summarize the most important ranking movements across all brands in the latest snapshot versus the prior one. Call out the biggest improvements, the biggest drops, and any brand that stands out. Be concise.'

export function useAssistant(snapshots: Snapshot[], category: CategoryId) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async (history: ChatMessage[]) => {
    setError(null)
    setIsStreaming(true)
    // Push an empty assistant message we stream into.
    setMessages([...history, { role: 'assistant', content: '' }])

    const digest = buildHistoryDigest(snapshots, category)
    const upstream = history.slice(-MAX_TURNS)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat(upstream, digest, {
        signal: controller.signal,
        onToken: (delta) => {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, content: last.content + delta }
            return next
          })
        },
      })
    } catch (e) {
      if (controller.signal.aborted) return   // user-initiated stop — keep partial
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      // Drop the empty/partial assistant bubble so the error row stands alone.
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant' && last.content === '') return prev.slice(0, -1)
        return prev
      })
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [snapshots, category])

  const send = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    run([...messages, { role: 'user', content: trimmed }])
  }, [messages, isStreaming, run])

  const summarize = useCallback(() => {
    if (isStreaming) return
    run([...messages, { role: 'user', content: SUMMARIZE_PROMPT }])
  }, [messages, isStreaming, run])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
  }, [])

  return { messages, isStreaming, error, send, summarize, stop, reset }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAssistant.ts
git commit -m "feat(assistant): add useAssistant chat state hook"
```

---

## Task 6: AssistantPanel UI

**Files:**
- Create: `src/components/Assistant/AssistantPanel.tsx`

Popover with message list, streaming indicator, error row, empty/no-data states,
input, "Summarize this view" button. Styled to match existing modals (white card,
`#E2E8F0` borders, `#0F172A` ink, `font-display` headings).

- [ ] **Step 1: Write the panel**

```tsx
import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, X, Square } from 'lucide-react'
import type { ChatMessage } from './types'

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
  error: string | null
  hasData: boolean
  onSend: (text: string) => void
  onSummarize: () => void
  onStop: () => void
  onClose: () => void
}

export function AssistantPanel({
  messages, isStreaming, error, hasData, onSend, onSummarize, onStop, onClose,
}: Props) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const submit = () => {
    if (!input.trim() || isStreaming) return
    onSend(input)
    setInput('')
  }

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-8rem)] flex flex-col bg-white border border-[#E2E8F0] rounded-[14px] shadow-[0_40px_80px_rgba(15,23,42,0.18)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-14 shrink-0 border-b border-[#E2E8F0]">
        <Sparkles size={16} className="text-[#0F172A]" />
        <span className="font-display text-[15px] tracking-wider text-[#0F172A] flex-1">Assistant</span>
        <button onClick={onClose} className="text-[#64748B] hover:text-[#0F172A]" aria-label="Close assistant">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-[13px] text-[#64748B] mt-2">
            {hasData
              ? 'Ask about ranking trends, or summarize the current view.'
              : 'Load some ranking data first, then I can help analyze it.'}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={
              m.role === 'user'
                ? 'inline-block bg-[#0F172A] text-white rounded-[10px] px-3 py-2 text-[13px] max-w-[85%] text-left whitespace-pre-wrap'
                : 'inline-block bg-[#F1F5F9] text-[#0F172A] rounded-[10px] px-3 py-2 text-[13px] max-w-[85%] whitespace-pre-wrap'
            }>
              {m.content || (isStreaming && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
        {error && (
          <div className="text-[12px] text-[#EF4444] bg-[#FEF2F2] border border-[#FECACA] rounded-[8px] px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Summarize */}
      <div className="px-4 pb-2 shrink-0">
        <button
          onClick={onSummarize}
          disabled={!hasData || isStreaming}
          className="w-full text-[12px] font-mono tracking-wider text-[#0F172A] border border-[#E2E8F0] rounded-[8px] py-2 hover:bg-[#F8FAFC] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Summarize this view
        </button>
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-4 pb-4 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          disabled={!hasData}
          placeholder={hasData ? 'Ask a question…' : 'No data loaded'}
          className="flex-1 text-[13px] border border-[#E2E8F0] rounded-[8px] px-3 py-2 outline-none focus:border-[#0F172A] disabled:bg-[#F8FAFC]"
        />
        {isStreaming ? (
          <button onClick={onStop} className="bg-[#F1F5F9] text-[#0F172A] rounded-[8px] p-2" aria-label="Stop">
            <Square size={16} />
          </button>
        ) : (
          <button onClick={submit} disabled={!input.trim() || !hasData} className="bg-[#0F172A] text-white rounded-[8px] p-2 disabled:opacity-40" aria-label="Send">
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors. (If `lucide-react` 1.x lacks any icon name, swap for an available one — see [[project_lucide_react]] note: named exports on the 1.x line.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Assistant/AssistantPanel.tsx
git commit -m "feat(assistant): add chat panel UI"
```

---

## Task 7: AssistantBubble container

**Files:**
- Create: `src/components/Assistant/AssistantBubble.tsx`

Owns open/closed state, instantiates `useAssistant`, renders the floating button
and (when open) the panel.

- [ ] **Step 1: Write the bubble**

```tsx
import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { Snapshot } from '../../types'
import type { CategoryId } from '../../lib/categories'
import { useAssistant } from '../../hooks/useAssistant'
import { AssistantPanel } from './AssistantPanel'

interface Props {
  snapshots: Snapshot[]
  category: CategoryId
}

export function AssistantBubble({ snapshots, category }: Props) {
  const [open, setOpen] = useState(false)
  const { messages, isStreaming, error, send, summarize, stop } = useAssistant(snapshots, category)
  const hasData = snapshots.some((s) => s.category === category && s.records.length > 0)

  return (
    <>
      {open && (
        <AssistantPanel
          messages={messages}
          isStreaming={isStreaming}
          error={error}
          hasData={hasData}
          onSend={send}
          onSummarize={summarize}
          onStop={stop}
          onClose={() => setOpen(false)}
        />
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#0F172A] text-white flex items-center justify-center shadow-[0_12px_28px_rgba(15,23,42,0.35)] hover:bg-[#1E293B] transition-colors"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Assistant/AssistantBubble.tsx
git commit -m "feat(assistant): add floating bubble container"
```

---

## Task 8: Mount the bubble in Layout

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import**

Near the other component imports (after the `ToastContainer` import around line 18):

```tsx
import { AssistantBubble } from './components/Assistant/AssistantBubble'
```

- [ ] **Step 2: Derive the active category**

In `Layout`, after `const location = useLocation()` (around line 297), add:

```tsx
const activeCategory: CategoryId = location.pathname.startsWith('/lp-sites') ? 'lp-sites' : 'bp-sites'
```

`CategoryId` is already imported at the top of `App.tsx` (line 4).

- [ ] **Step 3: Render the bubble**

Just before the closing `<ToastContainer ... />` line (around line 396), add:

```tsx
      <AssistantBubble snapshots={viewSnapshots} category={activeCategory} />
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(assistant): mount assistant bubble in layout"
```

---

## Task 9: Supabase Edge Function (OpenAI proxy)

**Files:**
- Create: `supabase/functions/assistant/index.ts`

Deno function. Validates the request, builds a system prompt embedding the digest,
calls OpenAI with `stream: true`, and pipes the SSE stream straight back. CORS +
`OPTIONS` preflight handled.

- [ ] **Step 1: Write the function**

```ts
// Supabase Edge Function: assistant
// Proxies chat requests to OpenAI with the ranking digest as context.
// Secrets (set via `supabase secrets set`): OPENAI_API_KEY, optional OPENAI_MODEL.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function systemPrompt(digest: unknown): string {
  return [
    'You are an analytics assistant embedded in an SEO keyword-ranking dashboard',
    'for Rooster Partners casino brands. Answer questions about the ranking data',
    'concisely and factually. Lower position numbers are better (1 is best);',
    '"NR" means not ranking. A negative mover delta means the keyword improved',
    '(moved toward #1). Only use the data provided below — if something is not in',
    'the data, say so rather than guessing.',
    '',
    'Here is a compact digest of the ranking history (JSON):',
    JSON.stringify(digest),
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  let body: { messages?: { role: string; content: string }[]; digest?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: 'No messages provided' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      stream: true,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt(body.digest) },
        ...messages,
      ],
    }),
  })

  if (!openaiRes.ok || !openaiRes.body) {
    const detail = await openaiRes.text().catch(() => '')
    return new Response(JSON.stringify({ error: `OpenAI error ${openaiRes.status}: ${detail}` }), {
      status: openaiRes.status, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Pipe OpenAI's SSE stream straight back to the browser.
  return new Response(openaiRes.body, {
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/assistant/index.ts
git commit -m "feat(assistant): add OpenAI proxy edge function"
```

---

## Task 10: Deploy, configure secret, manual verification

**Files:** none (deployment + manual test)

> Requires the Supabase CLI logged in and the project linked (`supabase link`).
> If the CLI is not set up, this is the one blocking external dependency.

- [ ] **Step 1: Set the OpenAI key as a function secret (NEVER commit it)**

Run (replace with the real key; rotate it afterward since it was shared in chat):

```bash
supabase secrets set OPENAI_API_KEY=sk-...   OPENAI_MODEL=gpt-4o-mini
```

- [ ] **Step 2: Deploy the function**

Run: `supabase functions deploy assistant --no-verify-jwt`
Expected: deploy succeeds; function URL printed.

(`--no-verify-jwt` because the SPA authenticates with the anon key, not a user JWT.)

- [ ] **Step 3: Run the dev server**

Run: `npm run dev`
Open `http://localhost:5173`, ensure at least one snapshot is loaded.

- [ ] **Step 4: Manual UI verification**

Verify each:
- Floating bubble appears bottom-right; clicking toggles the panel.
- With data: typing a question + Enter streams a token-by-token reply.
- "Summarize this view" produces a movement summary.
- Stop button cancels an in-flight reply, keeping partial text.
- Kill the network (DevTools offline) and send → inline error row appears, input re-enabled, no crash.
- With no snapshots loaded, the panel shows the "Load some ranking data first" state and the input is disabled.

- [ ] **Step 5: Production build check**

Run: `npm run build`
Expected: `tsc -b && vite build` completes with no errors.

- [ ] **Step 6: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(assistant): manual-verification fixups"
```

---

## Self-Review Notes

- **Spec coverage:** chat + insights (Tasks 5–7), Edge Function proxy w/ server-side key (Task 9–10), compact full-history digest (Task 3), floating bubble (Task 7), gpt-4o-mini + configurable model (Task 9), streaming (Tasks 4 + 9), per-session history (Task 5, no persistence), error/empty/abort states (Tasks 5–6), CORS + OPTIONS (Task 9). All covered.
- **Type consistency:** `HistoryDigest`/`ChatMessage`/`Mover`/`BrandSnapshotStat` defined in Task 2 and used unchanged in Tasks 3–6. `buildHistoryDigest(snapshots, category)` signature consistent across Tasks 3, 5. `streamChat(messages, digest, handlers)` consistent across Tasks 4, 5.
- **No placeholders:** every code step shows complete code; deployment commands are explicit.
- **Security:** key is only ever set via `supabase secrets set`; never written to a repo file or frontend env. Rotate the shared key after setup.
