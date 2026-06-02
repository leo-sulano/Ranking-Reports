# AI Assistant Intelligence Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the embedded AI assistant with a richer history digest (country breakdown, NR transitions, long-range trends, top keywords), a rewritten system prompt with few-shot examples, and clickable starter-question chips in the panel UI.

**Architecture:** Single bounded JSON digest built once per request in `assistantDigest.ts` → POSTed to the Supabase Edge Function → injected into a rewritten system prompt alongside the user messages → OpenAI SSE stream piped back unchanged. The UI panel gains a static chip strip in its empty state. No contract, streaming, or CORS changes.

**Tech Stack:** React, TypeScript, Vitest, Deno (Supabase Edge Function), `src/lib/parser.ts` (`parsePosition`), `lucide-react`.

---

## Files

| Action | Path |
|--------|------|
| Modify | `src/components/Assistant/types.ts` |
| Modify | `src/lib/assistantDigest.ts` |
| Modify | `src/lib/assistantDigest.test.ts` |
| Modify | `supabase/functions/assistant/index.ts` |
| Modify | `src/components/Assistant/AssistantPanel.tsx` |

---

## Task 1: Extend types

**Files:**
- Modify: `src/components/Assistant/types.ts`

- [ ] **Step 1: Replace the file contents**

Overwrite `src/components/Assistant/types.ts` with:

```ts
import type { CategoryId } from '../../lib/categories'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CountryStat {
  country: string
  rankingKeywords: number
  avgPosition: number
  top3: number
  top10: number
}

export interface TopKeyword {
  keyword: string
  country: string
  position: number
}

// Per-brand aggregate for one snapshot date.
export interface BrandSnapshotStat {
  brand: string
  rankingKeywords: number
  avgPosition: number
  top3: number
  top10: number
  byCountry: CountryStat[]    // top 8 countries by rankingKeywords
  topKeywords: TopKeyword[]   // 5 best numeric positions
}

// A single keyword's position change between two snapshots.
export interface Mover {
  brand: string
  keyword: string
  country: string
  from: string
  to: string
  delta: number
}

// NR transition entry. `to` present on gained; `from` present on lost.
export interface Transition {
  brand: string
  keyword: string
  country: string
  to?: string
  from?: string
}

// Movement across the full retained snapshot window.
export interface RangeMovers {
  fromDate: string
  toDate: string
  movers: Mover[]
}

export interface HistoryDigest {
  category: CategoryId
  generatedFor: string
  brands: string[]
  timeline: {
    date: string
    rawDate: string
    perBrand: BrandSnapshotStat[]
  }[]
  movers: Mover[]
  gained: Transition[]
  lost: Transition[]
  rangeMovers: RangeMovers
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: no type errors (other pre-existing errors from unrelated files are acceptable if already present).

- [ ] **Step 3: Commit**

```bash
git add src/components/Assistant/types.ts
git commit -m "feat(assistant): extend digest types — CountryStat, TopKeyword, Transition, RangeMovers"
```

---

## Task 2: Extend the digest

**Files:**
- Modify: `src/lib/assistantDigest.ts`

- [ ] **Step 1: Replace the file contents**

Overwrite `src/lib/assistantDigest.ts` with:

```ts
import type { Snapshot, RankingRecord } from '../types'
import type { CategoryId } from './categories'
import { DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND } from './brands'
import { parsePosition } from './parser'
import type {
  HistoryDigest, BrandSnapshotStat, Mover, Transition, RangeMovers,
} from '../components/Assistant/types'

const MAX_SNAPSHOTS    = 12
const MAX_MOVERS       = 20
const MAX_RANGE_MOVERS = 15
const MAX_TRANSITIONS  = 15
const MAX_COUNTRIES    = 8
const MAX_TOP_KEYWORDS = 5

function brandOf(domain: string, category: CategoryId): string | undefined {
  const map = category === 'lp-sites' ? LP_DOMAIN_TO_BRAND : DOMAIN_TO_BRAND
  return map[domain.toLowerCase()]
}

function numericPos(pos: string | undefined): number | null {
  if (!pos) return null
  const p = parsePosition(pos)
  return typeof p === 'number' ? p : null
}

function perBrandStats(records: RankingRecord[], category: CategoryId): BrandSnapshotStat[] {
  type CountryAcc = { sum: number; count: number; top3: number; top10: number }
  type BrandAcc = {
    sum: number; count: number; top3: number; top10: number
    byCountry: Map<string, CountryAcc>
    topKeywords: { keyword: string; country: string; position: number }[]
  }
  const acc = new Map<string, BrandAcc>()

  for (const r of records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const pos = parsePosition(r.position)
    if (typeof pos !== 'number') continue

    let a = acc.get(brand)
    if (!a) {
      a = { sum: 0, count: 0, top3: 0, top10: 0, byCountry: new Map(), topKeywords: [] }
      acc.set(brand, a)
    }

    a.sum += pos
    a.count += 1
    if (pos <= 3) a.top3 += 1
    if (pos <= 10) a.top10 += 1

    let c = a.byCountry.get(r.country)
    if (!c) { c = { sum: 0, count: 0, top3: 0, top10: 0 }; a.byCountry.set(r.country, c) }
    c.sum += pos
    c.count += 1
    if (pos <= 3) c.top3 += 1
    if (pos <= 10) c.top10 += 1

    a.topKeywords.push({ keyword: r.keyword, country: r.country, position: pos })
  }

  return Array.from(acc.entries()).map(([brand, a]) => {
    const byCountry = Array.from(a.byCountry.entries())
      .map(([country, c]) => ({
        country,
        rankingKeywords: c.count,
        avgPosition: Math.round((c.sum / c.count) * 10) / 10,
        top3: c.top3,
        top10: c.top10,
      }))
      .sort((x, y) => y.rankingKeywords - x.rankingKeywords)
      .slice(0, MAX_COUNTRIES)

    const topKeywords = [...a.topKeywords]
      .sort((x, y) => x.position - y.position)
      .slice(0, MAX_TOP_KEYWORDS)

    return {
      brand,
      rankingKeywords: a.count,
      avgPosition: a.count ? Math.round((a.sum / a.count) * 10) / 10 : 0,
      top3: a.top3,
      top10: a.top10,
      byCountry,
      topKeywords,
    }
  })
}

function computeMovers(
  latest: Snapshot,
  prev: Snapshot,
  category: CategoryId,
  cap: number,
): Mover[] {
  const key = (r: RankingRecord) =>
    `${r.domain.toLowerCase()}|${r.keyword.toLowerCase()}|${r.country}`
  const prevByKey = new Map(prev.records.map((r) => [key(r), r]))
  const movers: Mover[] = []

  for (const r of latest.records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const before = prevByKey.get(key(r))
    if (!before) continue
    const pNow = parsePosition(r.position)
    const pPrev = parsePosition(before.position)
    if (typeof pNow !== 'number' || typeof pPrev !== 'number') continue
    const delta = pNow - pPrev
    if (delta === 0) continue
    movers.push({ brand, keyword: r.keyword, country: r.country, from: before.position, to: r.position, delta })
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return movers.slice(0, cap)
}

function computeTransitions(
  latest: Snapshot,
  prev: Snapshot,
  category: CategoryId,
): { gained: Transition[]; lost: Transition[] } {
  const key = (r: RankingRecord) =>
    `${r.domain.toLowerCase()}|${r.keyword.toLowerCase()}|${r.country}`
  const prevByKey = new Map(prev.records.map((r) => [key(r), r]))
  const gained: Transition[] = []
  const lost: Transition[] = []

  for (const r of latest.records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    const before = prevByKey.get(key(r))
    if (!before) continue
    const pNow = parsePosition(r.position)
    const pPrev = parsePosition(before.position)

    if (typeof pPrev !== 'number' && typeof pNow === 'number') {
      gained.push({ brand, keyword: r.keyword, country: r.country, to: r.position })
    } else if (typeof pPrev === 'number' && typeof pNow !== 'number') {
      lost.push({ brand, keyword: r.keyword, country: r.country, from: before.position })
    }
  }

  gained.sort((a, b) => (numericPos(a.to) ?? Infinity) - (numericPos(b.to) ?? Infinity))
  lost.sort((a, b) => (numericPos(a.from) ?? Infinity) - (numericPos(b.from) ?? Infinity))

  return { gained: gained.slice(0, MAX_TRANSITIONS), lost: lost.slice(0, MAX_TRANSITIONS) }
}

export function buildHistoryDigest(snapshots: Snapshot[], category: CategoryId): HistoryDigest {
  const inCat = snapshots.filter((s) => s.category === category)
  const capped = inCat.slice(0, MAX_SNAPSHOTS)

  const brandSet = new Set<string>()
  const timeline = capped.map((s) => {
    const perBrand = perBrandStats(s.records, category)
    perBrand.forEach((b) => brandSet.add(b.brand))
    return { date: s.displayDate, rawDate: s.rawDate, perBrand }
  })

  const movers = capped.length >= 2
    ? computeMovers(capped[0], capped[1], category, MAX_MOVERS)
    : []

  const { gained, lost } = capped.length >= 2
    ? computeTransitions(capped[0], capped[1], category)
    : { gained: [], lost: [] }

  const rangeMovers: RangeMovers = {
    fromDate: capped.length >= 2 ? capped[capped.length - 1].displayDate : '',
    toDate: capped[0]?.displayDate ?? '',
    movers: capped.length >= 2
      ? computeMovers(capped[0], capped[capped.length - 1], category, MAX_RANGE_MOVERS)
      : [],
  }

  return {
    category,
    generatedFor: capped[0]?.displayDate ?? '',
    brands: Array.from(brandSet).sort(),
    timeline,
    movers,
    gained,
    lost,
    rangeMovers,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/assistantDigest.ts
git commit -m "feat(assistant): extend digest — byCountry, topKeywords, gained/lost, rangeMovers"
```

---

## Task 3: Tests for new digest fields

**Files:**
- Modify: `src/lib/assistantDigest.test.ts`

- [ ] **Step 1: Append new test suites to the existing file**

Add the following after the closing `})` of the existing `describe('buildHistoryDigest', ...)` block:

```ts
// ---------------------------------------------------------------------------
// byCountry
// ---------------------------------------------------------------------------
describe('byCountry', () => {
  it('aggregates per-country stats within a brand', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    const rb = d.timeline[0].perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.byCountry).toHaveLength(1)
    const de = rb.byCountry[0]
    expect(de.country).toBe('Germany')
    expect(de.rankingKeywords).toBe(2)  // positions 2 and 11
    expect(de.top3).toBe(1)             // position 2
    expect(de.top10).toBe(1)            // position 2 (11 > 10)
    expect(de.avgPosition).toBe(6.5)    // (2 + 11) / 2
  })

  it('caps byCountry at 8 countries sorted by rankingKeywords desc', () => {
    const countries = ['DE', 'GB', 'AU', 'NZ', 'CA', 'US', 'ZA', 'IE', 'MT']
    const manyRecs = countries.map((c, i) => rec('rooster.bet', `kw${i}`, c, String(i + 1)))
    const d = buildHistoryDigest(
      [{ id: 'x', category: 'bp-sites', rawDate: '2026-05-20', displayDate: '20 May 26', records: manyRecs }],
      'bp-sites',
    )
    const rb = d.timeline[0].perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.byCountry).toHaveLength(8)
  })
})

// ---------------------------------------------------------------------------
// topKeywords
// ---------------------------------------------------------------------------
describe('topKeywords', () => {
  it('returns the 5 best numeric positions, excludes NR', () => {
    const records = [
      rec('rooster.bet', 'kw1', 'DE', '3'),
      rec('rooster.bet', 'kw2', 'DE', '1'),
      rec('rooster.bet', 'kw3', 'DE', 'NR'),
      rec('rooster.bet', 'kw4', 'DE', '7'),
      rec('rooster.bet', 'kw5', 'DE', '2'),
      rec('rooster.bet', 'kw6', 'DE', '5'),
    ]
    const d = buildHistoryDigest(
      [{ id: 'x', category: 'bp-sites', rawDate: '2026-05-20', displayDate: '20 May 26', records }],
      'bp-sites',
    )
    const rb = d.timeline[0].perBrand.find((b) => b.brand === 'RoosterBet')!
    expect(rb.topKeywords).toHaveLength(5)
    expect(rb.topKeywords[0]).toMatchObject({ keyword: 'kw2', position: 1 })
    expect(rb.topKeywords.some((k) => k.keyword === 'kw3')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// gained / lost
// ---------------------------------------------------------------------------

function gainedLostSnaps(): Snapshot[] {
  return [
    {
      id: 's2', category: 'bp-sites' as const, rawDate: '2026-05-20', displayDate: '20 May 26',
      records: [
        rec('rooster.bet', 'casino', 'Germany', '5'),  // numeric → numeric — NOT a transition
        rec('rooster.bet', 'slots',  'Germany', 'NR'), // numeric → NR — lost
        rec('rooster.bet', 'poker',  'Germany', '8'),  // NR → numeric — gained
      ],
    },
    {
      id: 's1', category: 'bp-sites' as const, rawDate: '2026-05-13', displayDate: '13 May 26',
      records: [
        rec('rooster.bet', 'casino', 'Germany', '3'),
        rec('rooster.bet', 'slots',  'Germany', '6'),
        rec('rooster.bet', 'poker',  'Germany', 'NR'),
      ],
    },
  ]
}

describe('gained and lost', () => {
  it('detects NR → numeric as gained and excludes numeric-to-numeric', () => {
    const d = buildHistoryDigest(gainedLostSnaps(), 'bp-sites')
    expect(d.gained).toHaveLength(1)
    expect(d.gained[0]).toMatchObject({ keyword: 'poker', country: 'Germany', to: '8' })
  })

  it('detects numeric → NR as lost and excludes numeric-to-numeric', () => {
    const d = buildHistoryDigest(gainedLostSnaps(), 'bp-sites')
    expect(d.lost).toHaveLength(1)
    expect(d.lost[0]).toMatchObject({ keyword: 'slots', country: 'Germany', from: '6' })
  })

  it('returns empty gained/lost with fewer than 2 snapshots', () => {
    const d = buildHistoryDigest([gainedLostSnaps()[0]], 'bp-sites')
    expect(d.gained).toEqual([])
    expect(d.lost).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// rangeMovers
// ---------------------------------------------------------------------------

const threeSnaps: Snapshot[] = [
  {
    id: 's3', category: 'bp-sites', rawDate: '2026-06-01', displayDate: '01 Jun 26',
    records: [rec('rooster.bet', 'casino', 'DE', '2')],
  },
  {
    id: 's2', category: 'bp-sites', rawDate: '2026-05-15', displayDate: '15 May 26',
    records: [rec('rooster.bet', 'casino', 'DE', '5')],
  },
  {
    id: 's1', category: 'bp-sites', rawDate: '2026-05-01', displayDate: '01 May 26',
    records: [rec('rooster.bet', 'casino', 'DE', '10')],
  },
]

describe('rangeMovers', () => {
  it('uses the oldest snapshot as baseline, not the prior snapshot', () => {
    const d = buildHistoryDigest(threeSnaps, 'bp-sites')
    expect(d.rangeMovers.fromDate).toBe('01 May 26')
    expect(d.rangeMovers.toDate).toBe('01 Jun 26')
    const casino = d.rangeMovers.movers.find((m) => m.keyword === 'casino')!
    expect(casino).toMatchObject({ from: '10', to: '2', delta: -8 })
  })

  it('returns empty movers with fewer than 2 snapshots', () => {
    const d = buildHistoryDigest([threeSnaps[0]], 'bp-sites')
    expect(d.rangeMovers.movers).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run`
Expected: all tests pass, including the existing 4 and all 8 new ones.

- [ ] **Step 3: Commit**

```bash
git add src/lib/assistantDigest.test.ts
git commit -m "test(assistant): cover byCountry, topKeywords, gained/lost, rangeMovers"
```

---

## Task 4: Rewrite the system prompt

**Files:**
- Modify: `supabase/functions/assistant/index.ts`

- [ ] **Step 1: Replace only the `systemPrompt` function**

Find the existing `function systemPrompt(digest: unknown): string { ... }` block and replace it with:

```ts
function systemPrompt(digest: unknown): string {
  const d = digest as {
    rangeMovers?: { fromDate?: string; toDate?: string }
  }
  const rangeLabel =
    d.rangeMovers?.fromDate && d.rangeMovers?.toDate
      ? `${d.rangeMovers.fromDate} → ${d.rangeMovers.toDate}`
      : 'full retained range'

  return [
    '## Role',
    'You are an analytics assistant embedded in an SEO keyword-ranking dashboard for Rooster Partners casino brands.',
    'Answer questions about the ranking data concisely and factually.',
    '',
    '## Domain rules',
    '- Lower position numbers are better (position 1 is best).',
    '- "NR" means Not Ranking — the keyword does not appear in the tracked results.',
    '- A negative `delta` means the keyword improved (moved toward position 1).',
    '- The `gained` list contains keywords that moved from NR to a numeric position (wins).',
    '- The `lost` list contains keywords that moved from a numeric position to NR (regressions).',
    '- Only use data present in the digest below. If something is not in the data, say so rather than guessing.',
    '',
    '## Digest structure',
    '- `timeline` — per-brand stats across snapshots, **newest first**, capped at 12.',
    '  Each entry has `perBrand[]` with: `rankingKeywords`, `avgPosition`, `top3`, `top10`,',
    '  `byCountry[]` (top 8 countries by keyword count), and `topKeywords[]` (5 best numeric positions).',
    '- `movers` — keywords with the largest position changes between the **two most recent** snapshots.',
    '- `gained` / `lost` — keywords that newly started or stopped ranking between the two most recent snapshots.',
    `- \`rangeMovers\` — largest position changes across the **full retained range** (${rangeLabel}).`,
    '',
    '## Answer format',
    '- Lead with the direct answer; no preamble.',
    '- Use compact markdown: short bullet points, **bold** brand names and keywords, position numbers inline.',
    '- Be concise — one or two sentences when that is sufficient.',
    '',
    '## Few-shot examples',
    '',
    '**Q: Which keywords dropped the most this week?**',
    'A: Biggest drops (latest vs prior snapshot, from `movers` where delta > 0):',
    '- **RoosterBet** – "online casino" UK: 3 → 9 (+6, worsened)',
    '- **Spinjo** – "free spins" AU: 7 → 14 (+7, worsened)',
    'Also check `lost` for keywords that fell off entirely (dropped to NR).',
    '',
    '**Q: How is RoosterBet doing in Germany?**',
    'A: In the latest snapshot, **RoosterBet** Germany (`byCountry`): avg position **4.2**, **12** ranking keywords, **3** in top 3, **8** in top 10.',
    'Top keywords: "online casino" (#1), "best casino" (#2), "casino bonus" (#4).',
    '',
    '**Q: Any keywords that fell off (NR) recently?**',
    'A: From the `lost` list (latest vs prior snapshot):',
    '- **LuckyVibe** – "casino app" IE: fell from position **5** to NR.',
    '- **PlayMojo** – "slots bonus" AU: fell from position **8** to NR.',
    '',
    '## Ranking data digest (JSON)',
    JSON.stringify(digest),
  ].join('\n')
}
```

Everything else in the file (CORS, health probe, POST handler, streaming) is **unchanged**.

- [ ] **Step 2: Verify the file is valid (no syntax errors)**

The Edge Function is Deno/TypeScript but is not part of the Vite build. Do a quick sanity check by reading the function top-to-bottom to confirm:
- `systemPrompt` is the only function that changed.
- The `Deno.serve` handler still calls `systemPrompt(body.digest)` correctly.
- No trailing syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/assistant/index.ts
git commit -m "feat(assistant): rewrite system prompt — domain rules, digest guide, few-shot examples"
```

---

## Task 5: Starter-question chips in the panel

**Files:**
- Modify: `src/components/Assistant/AssistantPanel.tsx`

- [ ] **Step 1: Add the STARTER_QUESTIONS constant and update the empty-state render**

At the top of the file, after the imports, add:

```ts
const STARTER_QUESTIONS = [
  'Biggest drops since last week?',
  'Which brand improved the most?',
  'Any keywords that fell off (NR)?',
  'Which brand has the best avg position?',
  'Summarize wins and losses',
] as const
```

Then in the JSX, replace the existing empty-state paragraph:

```tsx
{messages.length === 0 && (
  <p className={`text-[13px] mt-2 ${reachable === false ? 'text-[#B45309]' : 'text-[#64748B]'}`}>
    {emptyState}
  </p>
)}
```

with:

```tsx
{messages.length === 0 && (
  <>
    <p className={`text-[13px] mt-2 ${reachable === false ? 'text-[#B45309]' : 'text-[#64748B]'}`}>
      {emptyState}
    </p>
    {ready && (
      <div className="flex flex-wrap gap-2 mt-3">
        {STARTER_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onSend(q)}
            className="text-[11px] border border-[#E2E8F0] rounded-[8px] px-2 py-1 text-[#475569] hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
    )}
  </>
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Assistant/AssistantPanel.tsx
git commit -m "feat(assistant): add starter-question chips to empty panel state"
```

---

## Done

All five tasks complete. The assistant now:
- Provides country-level stats, NR transition lists, long-range movers, and top-5 keywords per brand in every digest.
- Has a system prompt that correctly explains the digest shape, states domain rules, and demonstrates the expected answer format via three few-shot pairs.
- Shows five clickable starter-question chips in the empty panel when online and data is loaded.
