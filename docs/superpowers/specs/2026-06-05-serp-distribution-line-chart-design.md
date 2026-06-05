# SERP Distribution — Line Chart Redesign

**Date:** 2026-06-05
**Scope:** `src/pages/Home.tsx` — SERP Distribution card only

---

## Goal

Replace the current per-bucket vertical bar chart with a line chart that shows position frequency as a connected series of dots over uniform gray column backgrounds, with tier-based dot colors and smooth gradient segments between adjacent dots.

---

## Visual Design

### Chart Structure

The chart area contains:

1. **Gray background columns** — 12 rounded rectangles (`#F0F0EE`, `rx=6`), all full height, one per bucket. They act as visual lanes, not data bars.
2. **Gradient connecting line** — Each of the 11 segments between adjacent dots is its own `<line>` with a `linearGradient` from the left dot's color to the right dot's color.
3. **Colored dots** — Filled `<circle>` per bucket, positioned vertically by normalized count (`pct`), colored by tier.
4. **Count labels** — Small gray text (`#9CA3AF`, 9px) rendered above each dot when `count > 0`.
5. **X-axis labels** — Small text (`#ABABAA`, 8px) centered below each column.

### Dot Colors by Tier

| Tier | Buckets | Dot Color |
|------|---------|-----------|
| 1–3 | `top3` | `#059669` dark green |
| 4–10 | `top10` | `#34D399` light green |
| 11–100 | `r11` – `r91` | `#F59E0B` amber |
| NR | `nr` | `#1A1A1A` near-black |

### Gradient Line

- Each segment = one `<linearGradient id="seg-{i}">` with `gradientUnits="userSpaceOnUse"`, spanning from `(x1, y1)` of the left dot to `(x2, y2)` of the right dot.
- `<line>` uses `stroke="url(#seg-{i})"`, `strokeWidth={2.5}`, `strokeLinecap="round"`.
- Same-color segments (within 11–100 range) produce a flat amber line — no visible gradient.

### Legend

Unchanged from current implementation:

| Dot | Label |
|-----|-------|
| `#059669` | 1–3 |
| `#34D399` | 4–10 |
| `#F59E0B` | 11–100 |
| `#0A0A0A` | Not ranking |

---

## Implementation

### New Component: `SerpLineChart`

A self-contained component in `Home.tsx`:

```
SerpLineChart
  props: buckets — array of { key, label, count, pct }
  ref: containerRef (div) — measured via ResizeObserver
  state: { width, height } — updated on resize, initialized to 300×160
```

**Layout constants (computed from dims):**
- `PAD_TOP = 24` — space for count labels above dots
- `PAD_BOTTOM = 20` — space for x-axis labels
- `chartH = height - PAD_TOP - PAD_BOTTOM` — usable chart area
- `colW = width / N` — column width (N = 12)
- Dot center x: `colW * i + colW / 2`
- Dot center y: `PAD_TOP + (1 - pct) * chartH`

**SVG layers (bottom to top):**
1. Background rects
2. Gradient defs + line segments
3. Dots (circles)
4. Count label text
5. X-axis label text

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Home.tsx` | Replace bar chart JSX (lines 219–247) with `<SerpLineChart buckets={buckets} />`. Add `SerpLineChart` component + `DOT_COLOR` map. Add `useEffect` import if not present. |

### Data

No data changes. The existing `buckets` computation (count + pct normalized to max) is reused as-is.

---

## Out of Scope

- No changes to leaderboard, movers, country map, or any other section.
- No changes to data parsing, storage, or snapshot logic.
- No changes to the legend content or colors.
