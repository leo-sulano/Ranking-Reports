# Home dashboard: remove Navigate, fill the Brand Leaderboard

Date: 2026-07-27
Scope: `src/pages/Home.tsx` only. No prop, type, or route changes.

## Problem

Two independent issues on the home dashboard:

1. The **Navigate** panel duplicates the sidebar. BP Sites, LP Sites, and Import Data
   are all reachable from `Sidebar.tsx`, and Import Data has a second entry point in the
   Home hero. The panel costs a full-width band of screen space and adds nothing.
2. The **Brand Leaderboard** card stretches to the height of Top Movers beside it
   (`lg:grid-cols-[2fr_1fr]`, default `align-items: stretch`), but its table does not.
   Nine brand rows leave a block of dead white space below row 09.

## Change 1 — Remove the Navigate panel

Delete the `Navigate` `<section>` and the `NavCard` component, which has no other caller.

`ctx.onOpenUpload` and `ctx.writeGate` stay in use by the hero upload button, so
`RROutletContext` and `AppState` are untouched.

## Change 2 — Leaderboard fills its card

**Row stretch.** The leaderboard `<section>` becomes `flex flex-col`, its table wrapper
gets `flex-1`, and the `<table>` gets `h-full`. Table layout distributes the surplus
height across `<tbody>` rows, so the nine brands spread evenly instead of bunching at
the top.

On mobile the grid collapses to one column, the section height is content-driven, and
`h-full` resolves against an auto height — rows keep their natural size. No mobile change.

**Totals footer.** A `<tfoot>` row pins to the bottom of the table:

| Cell | Content | Style |
|---|---|---|
| `#` + Brand (colspan 2) | `ALL BRANDS` | uppercase, tracked, `--muted-3` — matches `<thead>` |
| P1 | sum of `row.p1` | mono tabular, `--ink-2` |
| Top-3 | sum of `row.t3` | mono tabular, `--neg` |
| Top-10 | sum of `row.t10` | mono tabular, `--navy-text` |

Per-column colors match the body rows so the eye tracks each column's total. The row
carries a `--border-3` top border and a `--surface-2` fill so it reads as a footer band,
not a tenth brand.

The footer is **not** clickable — a cross-brand sum has no single keyword modal to open,
unlike the per-brand P1/Top-3/Top-10 cells.

**Empty state.** When `leaderboard.length === 0` the existing "No brand data in current
snapshot." row renders and the footer is suppressed, so an empty snapshot never shows a
row of zeros.

## Verification

- `npm run build` clean (tsc + vite).
- Playwright screenshots of `/` against `npm run dev`, light and dark:
  - Navigate panel gone.
  - Leaderboard bottom edge aligns with Top Movers, totals row visible.
  - Narrow viewport: rows keep natural height, no stretched-out layout.
