# AI Assistant — Full Positions Lookup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `positions` field to the history digest — a full brand → country → keyword → position map built from the latest snapshot — so the assistant can answer any specific keyword position question.

**Architecture:** One new private function `buildPositionLookup` in `assistantDigest.ts` iterates all records in the latest snapshot and groups them into a nested map. The result is added to `HistoryDigest` and serialised into every chat request. The system prompt is updated with one line explaining the new field. No contract, streaming, or UI changes.

**Tech Stack:** TypeScript, Vitest, Deno (Supabase Edge Function).

---

## Files

| Action | Path |
|--------|------|
| Modify | `src/components/Assistant/types.ts` |
| Modify | `src/lib/assistantDigest.ts` |
| Modify | `src/lib/assistantDigest.test.ts` |
| Modify | `supabase/functions/assistant/index.ts` |

---

## Task 1: Add `positions` type and failing tests

**Files:**
- Modify: `src/components/Assistant/types.ts`
- Modify: `src/lib/assistantDigest.test.ts`

- [ ] **Step 1: Add `positions` to `HistoryDigest`**

In `src/components/Assistant/types.ts`, add one field at the end of `HistoryDigest` (before the closing `}`):

```ts
  positions: Record<string, Record<string, Record<string, string>>>
```

The full `HistoryDigest` interface should now end with:

```ts
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
  positions: Record<string, Record<string, Record<string, string>>>
}
```

- [ ] **Step 2: Write 4 failing tests**

Append the following at the end of `src/lib/assistantDigest.test.ts` (after all existing describe blocks):

```ts
// ---------------------------------------------------------------------------
// positions lookup
// ---------------------------------------------------------------------------
describe('positions lookup', () => {
  it('maps brand → country → keyword → position string for all latest records', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    // snaps latest: rooster.bet casino/Germany/'2', bonus/Germany/'11'
    expect(d.positions['RoosterBet']['Germany']['casino']).toBe('2')
    expect(d.positions['RoosterBet']['Germany']['bonus']).toBe('11')
  })

  it('includes NR keywords — not filtered out', () => {
    const d = buildHistoryDigest(snaps, 'bp-sites')
    // snaps latest: slots/Germany/'NR'
    expect(d.positions['RoosterBet']['Germany']['slots']).toBe('NR')
  })

  it('returns empty object when no snapshots provided', () => {
    const d = buildHistoryDigest([], 'bp-sites')
    expect(d.positions).toEqual({})
  })

  it('uses only the latest snapshot — prior-only keywords are absent', () => {
    const twoSnaps: Snapshot[] = [
      {
        id: 's2', category: 'bp-sites' as const, rawDate: '2026-05-20', displayDate: '20 May 26',
        records: [rec('rooster.bet', 'casino', 'Germany', '5')],
      },
      {
        id: 's1', category: 'bp-sites' as const, rawDate: '2026-05-13', displayDate: '13 May 26',
        records: [
          rec('rooster.bet', 'casino', 'Germany', '8'),
          rec('rooster.bet', 'poker', 'Germany', '3'),  // only in prior snapshot
        ],
      },
    ]
    const d = buildHistoryDigest(twoSnaps, 'bp-sites')
    expect(d.positions['RoosterBet']['Germany']['casino']).toBe('5')        // latest value wins
    expect(d.positions['RoosterBet']?.['Germany']?.['poker']).toBeUndefined() // prior-only absent
  })
})
```

- [ ] **Step 3: Run tests — expect failures**

Run: `npx vitest run`
Expected: 4 new failures — `TypeError` or type error because `buildHistoryDigest` does not yet return `positions`. Existing 15 tests still pass.

- [ ] **Step 4: Commit types + failing tests**

```bash
git add src/components/Assistant/types.ts src/lib/assistantDigest.test.ts
git commit -m "test(assistant): add failing positions lookup tests"
```

---

## Task 2: Implement `buildPositionLookup`

**Files:**
- Modify: `src/lib/assistantDigest.ts`

- [ ] **Step 1: Add `buildPositionLookup` function**

In `src/lib/assistantDigest.ts`, add this function after `computeTransitions` and before `buildHistoryDigest`:

```ts
function buildPositionLookup(
  snapshot: Snapshot,
  category: CategoryId,
): Record<string, Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, Record<string, string>>> = {}

  for (const r of snapshot.records) {
    const brand = brandOf(r.domain, category)
    if (!brand) continue
    if (!result[brand]) result[brand] = {}
    if (!result[brand][r.country]) result[brand][r.country] = {}
    result[brand][r.country][r.keyword] = r.position
  }

  return result
}
```

- [ ] **Step 2: Wire into `buildHistoryDigest`**

In the `return` statement of `buildHistoryDigest`, add `positions` as the last field:

```ts
  return {
    category,
    generatedFor: capped[0]?.displayDate ?? '',
    brands: Array.from(brandSet).sort(),
    timeline,
    movers,
    gained,
    lost,
    rangeMovers,
    positions: capped.length > 0 ? buildPositionLookup(capped[0], category) : {},
  }
```

- [ ] **Step 3: Run tests — expect all to pass**

Run: `npx vitest run`
Expected: **19 passed** (15 existing + 4 new). Zero failures.

- [ ] **Step 4: Verify TypeScript build**

Run: `npm run build`
Expected: clean build, no type errors (pre-existing chunk-size warning is fine).

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistantDigest.ts
git commit -m "feat(assistant): add buildPositionLookup — full brand→country→keyword→position map"
```

---

## Task 3: Update system prompt

**Files:**
- Modify: `supabase/functions/assistant/index.ts`

- [ ] **Step 1: Add one line to the digest structure section**

In `supabase/functions/assistant/index.ts`, find the `systemPrompt` function. Locate the `## Digest structure` block — it currently ends with the `` `rangeMovers` `` line:

```ts
    `- \`rangeMovers\` — largest position changes across the **full retained range** (${rangeLabel}).`,
```

Add one line immediately after it:

```ts
    '- `positions` — full keyword lookup: brand → country → keyword → current position string ("3", "NR"). Use this to answer any specific keyword position question not covered by the aggregate stats.',
```

- [ ] **Step 2: Verify only one line changed**

Read `supabase/functions/assistant/index.ts` and confirm:
- The `## Digest structure` section now has 5 bullet points (timeline, movers, gained/lost, rangeMovers, positions)
- Nothing else in the file changed

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/assistant/index.ts
git commit -m "feat(assistant): document positions field in system prompt"
```

---

## Done

All three tasks complete. The assistant now receives the full keyword position map for the latest snapshot in every request and can answer any specific keyword/country question. Deploy `supabase/functions/assistant` to activate.
