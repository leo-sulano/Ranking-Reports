# Stats Card Modal — Show Previous Position Design

**Date:** 2026-07-22
**Scope:** `StatsCardModal` keyword chips (`src/pages/BPSites.tsx`) — BP Sites only, LP Sites has no equivalent modal

## Problem

The card summary modal (opened from the Top 3 / Improved / Dropped / Unchanged / Not Ranking stat cards) shows each keyword's current position per country as a flat badge, e.g. `AU #6`. It doesn't show what the position moved from, so the user can't see the magnitude of the change without leaving the modal.

## Change

`ModalEntry` gains a `prevPos: number | 'NR' | null` field, resolved per record using the same lookup the filter already performs (`prevPosMap.get(`${keyword}|${domain}|${country}`) ?? null`), so behavior is consistent with how "improved"/"dropped" are already classified elsewhere in this component.

Chip rendering (`src/pages/BPSites.tsx` ~line 1598-1613) changes from a single accent-colored `posDisplay` string to a per-entry computed display:

| Condition | Rendered | Color |
|---|---|---|
| `prevPos === null` (no history for this snapshot pair) | `#6` | card accent (unchanged from today) |
| `prevPos` equals current (both same number, or both `'NR'`) | `6` | black `#000000`, no arrow |
| Improved: current is a number and (`prevPos === 'NR'` or `prevPos > current`) | `6 ↑ 7` | `6 ↑` green `#15803D`, `7` black |
| Dropped: current is `'NR'`, or both numbers with `prevPos < current` | `10 ↓ 6` | `10 ↓` red `#B91C1C`, `6` black |

Colors reuse the exact codes already used by `PosBadge` (`src/components/PosBadge.tsx`) so movement coloring stays consistent app-wide.

This is per-entry logic, so it applies uniformly across all five card types (Top 3, Improved, Dropped, Unchanged, Not Ranking) with no special-casing per card — a Top 3 keyword that moved within the top 3 will show its arrow same as an Improved-card entry would.

Pill background (`accent + '18'`) and the country label styling are unchanged — only the position text inside the pill changes.

## Out of scope

- No change to `PosBadge` or the main ranking table — this only affects the modal's keyword chips.
- No change to the underlying `improved`/`dropped`/`unchanged` filter classification logic — only to what's displayed once an entry is already in the list.
