# Stats Modal Previous Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each keyword chip in `StatsCardModal` with both current and previous position, colored to indicate direction, matching the spec in `docs/superpowers/specs/2026-07-22-stats-modal-prev-position-design.md`.

**Architecture:** Attach a resolved `prevPos` field to each `ModalEntry` when the grouped map is built (reusing the existing `prevPosMap` key lookup), then replace the single-color position span in the chip renderer with a branch that produces plain/black/green/red output per the spec table.

**Tech Stack:** React + TypeScript, no new dependencies.

## Global Constraints

- Colors must reuse the exact codes from `src/components/PosBadge.tsx`: improved `#15803D`, dropped `#B91C1C`, unchanged/previous `#000000`.
- Pill background (`accent + '18'`) and country label styling must not change.
- No change to filter/classification logic (`top3`/`improved`/`dropped`/`unchanged`/`notRanking` membership) — only to what's displayed once an entry is in the list.

---

### Task 1: Add `prevPos` to `ModalEntry` and update chip rendering

**Files:**
- Modify: `src/pages/BPSites.tsx:1455` (`ModalEntry` type)
- Modify: `src/pages/BPSites.tsx:1497-1513` (`grouped` useMemo — attach `prevPos` per entry)
- Modify: `src/pages/BPSites.tsx:1598-1613` (chip renderer — position display)

**Interfaces:**
- Consumes: existing `prevPosMap: Map<string, number | 'NR'> | null` prop (already in scope), existing `parsePosition` from `src/lib/parser.ts`.
- Produces: `ModalEntry.prevPos: number | 'NR' | null`, consumed only within this same component.

- [ ] **Step 1: Extend the `ModalEntry` type**

At `src/pages/BPSites.tsx:1455`, change:

```typescript
type ModalEntry = { keyword: string; country: string; position: string; change: string }
```

to:

```typescript
type ModalEntry = { keyword: string; country: string; position: string; change: string; prevPos: number | 'NR' | null }
```

- [ ] **Step 2: Resolve `prevPos` when building the grouped map**

At `src/pages/BPSites.tsx:1497-1513`, the current code is:

```typescript
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, ModalEntry[]>>()
    for (const r of filtered) {
      if (!map.has(r.domain)) map.set(r.domain, new Map())
      const kwMap = map.get(r.domain)!
      const kl = r.keyword.toLowerCase()
      if (!kwMap.has(kl)) kwMap.set(kl, [])
      kwMap.get(kl)!.push({
        keyword: r.keyword,
        country: COUNTRY_LABELS[r.country] ?? r.country.toUpperCase(),
        position: r.position,
        change: r.change ?? '',
      })
    }
    return map
  }, [filtered])
```

Change it to resolve `prevPos` using the same key shape the filter above already uses (`${keyword}|${domain}|${countryLabel}`, all lowercase for keyword/domain):

```typescript
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, ModalEntry[]>>()
    for (const r of filtered) {
      if (!map.has(r.domain)) map.set(r.domain, new Map())
      const kwMap = map.get(r.domain)!
      const kl = r.keyword.toLowerCase()
      if (!kwMap.has(kl)) kwMap.set(kl, [])
      const cc = COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()
      const prevPos = prevPosMap
        ? prevPosMap.get(`${kl}|${r.domain.toLowerCase()}|${cc}`) ?? null
        : null
      kwMap.get(kl)!.push({
        keyword: r.keyword,
        country: cc,
        position: r.position,
        change: r.change ?? '',
        prevPos,
      })
    }
    return map
  }, [filtered, prevPosMap])
```

Note: `cc` replaces the old inline `COUNTRY_LABELS[r.country] ?? r.country.toUpperCase()` call in the `country:` field — reuse the same computed value rather than calling it twice.

- [ ] **Step 3: Replace the chip position display**

At `src/pages/BPSites.tsx:1598-1613`, the current code is:

```typescript
                            {sorted.map((entry, i) => {
                              const p = parsePosition(entry.position)
                              const posDisplay = typeof p === 'number' ? `#${p}` : 'NR'
                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap"
                                  style={{ background: accent + '18', color: accent }}
                                >
                                  <span className="font-normal" style={{ color: '#94A3B8' }}>{entry.country}</span>
                                  <span>{posDisplay}</span>
                                </span>
                              )
                            })}
```

Replace it with:

```typescript
                            {sorted.map((entry, i) => {
                              const p = parsePosition(entry.position)
                              const prev = entry.prevPos

                              let positionNode: React.ReactNode
                              if (prev === null) {
                                positionNode = <span style={{ color: accent }}>{typeof p === 'number' ? `#${p}` : 'NR'}</span>
                              } else if (prev === p || (prev === 'NR' && p === 'NR')) {
                                positionNode = <span style={{ color: '#000000' }}>{typeof p === 'number' ? p : 'NR'}</span>
                              } else {
                                const improved = p !== 'NR' && (prev === 'NR' || (typeof prev === 'number' && typeof p === 'number' && prev > p))
                                const dirColor = improved ? '#15803D' : '#B91C1C'
                                const arrow = improved ? '↑' : '↓'
                                const curDisplay = typeof p === 'number' ? p : 'NR'
                                const prevDisplay = typeof prev === 'number' ? prev : 'NR'
                                positionNode = (
                                  <>
                                    <span style={{ color: dirColor }}>{curDisplay} {arrow}</span>{' '}
                                    <span style={{ color: '#000000' }}>{prevDisplay}</span>
                                  </>
                                )
                              }

                              return (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap"
                                  style={{ background: accent + '18' }}
                                >
                                  <span className="font-normal" style={{ color: '#94A3B8' }}>{entry.country}</span>
                                  {positionNode}
                                </span>
                              )
                            })}
```

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (this is the project's only automated check — there is no test suite).

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev`, open BP Sites for a brand with historical data (e.g. RoosterBet), open the "Improved" stat card modal, confirm chips show `current ↑ previous` in green with the previous number in black. Open "Dropped" and confirm red/↓. Open "Top 3" and confirm mixed directions render correctly (some green, some red, some plain black for unchanged). Open "Not Ranking" and confirm entries that dropped out of rankings show `NR ↓ <prevNumber>`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/BPSites.tsx
git commit -m "feat: show previous position with direction color in stats modal chips"
```
