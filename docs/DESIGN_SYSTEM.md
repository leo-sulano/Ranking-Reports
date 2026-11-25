# Home page design system

Canonical layout spec, extracted from `src/pages/Home.tsx` (hero cards, Brand
Leaderboard, Top Movers, `SectionHeader`/`MoverGroup` defined in that same
file). **Rule: any new homepage/landing page in this app matches this spec
exactly.** Don't invent new spacing, type sizes, or colors; reuse what's below.
This is also the origin pattern shared with the TryBet dashboard — keep the
two in sync structurally even though TryBet expresses colors as Tailwind
semantic classes (`primary-700`, etc.) instead of these CSS variables.

## 1. Page shell

```tsx
<div className="flex-1 overflow-auto bg-[var(--hover)]">
  <div className="px-3 sm:px-6 py-4 sm:py-5 space-y-4">
    {/* hero metric cards */}
    {/* leaderboard + movers grid */}
  </div>
</div>
```

- Page background is `var(--hover)`; panels sit on `var(--surface)`.
- Top-level vertical rhythm is always `space-y-4`.
- Sections fade in with a staggered `fadeUp 0.35s ease {delay}s both` — hero
  row first, leaderboard at `0.1s`, movers at `0.13s`, table rows at
  `0.12 + i * 0.025s`. Keep the stagger on new sections; it's cheap and every
  existing panel has it.

## 2. Empty state (no data yet)

```tsx
<div className="flex-1 overflow-auto flex items-center justify-center bg-[var(--hover)]">
  <div className="text-center max-w-[280px]" style={{ animation: 'fadeUp 0.4s ease both' }}>
    <div className="w-16 h-16 rounded-2xl bg-[var(--surface)] border border-[var(--border-2)] shadow-sm flex items-center justify-center mx-auto mb-5">
      {/* 22x22 stroke icon, stroke="var(--border-strong)" strokeWidth={1.5} */}
    </div>
    <h2 className="font-display text-[18px] font-[700] text-[var(--ink-2)] mb-2">No data yet</h2>
    <p className="text-[13px] text-[var(--muted-3)] mb-6 leading-relaxed">{explanation}</p>
    <button className="px-5 py-1.5 bg-[var(--brand-navy)] text-white text-[13px] font-semibold rounded-xl hover:bg-[var(--brand-blue)] transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-glow-light">
      {cta}
    </button>
  </div>
</div>
```

Any new homepage-style view needs this same empty state before it has real
data to show — icon box, title, one-line explanation, single CTA.

## 3. Hero metric cards

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
  <div
    className="relative rounded-xl px-4 sm:px-6 py-4 sm:py-5 overflow-hidden bg-[var(--brand-navy)] cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all duration-150 select-none"
    onClick={...}
  >
    <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-10 bg-[var(--surface)]" />
    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50 mb-2">{label}</div>
    <div className="font-display text-[28px] sm:text-[38px] font-[600] text-white tabular-nums leading-none">
      {value.toLocaleString()}
    </div>
  </div>
  {/* second card: style={{ background: 'var(--brand-blue-deep)' }}, text-white/60 label */}
</div>
```

- 2–4 cards, `grid-cols-1 sm:grid-cols-2` (extend to `sm:grid-cols-3/4` for
  more cards).
- Always the translucent corner disc (`-top-6 -right-6 w-24 h-24 opacity-10`),
  always `font-display` + `tabular-nums` for the numeral, always
  `hover:opacity-90 active:scale-[0.98]` for the press feedback.
- Card tones are direct brand values (`var(--brand-navy)`,
  `var(--brand-blue-deep)`) — add new tones as new CSS variables in
  `src/index.css`, never a one-off inline hex.

## 4. Main content grid

```tsx
<div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
  <PrimaryPanel />   {/* table/leaderboard-type content */}
  <SecondaryPanel /> {/* list-type content */}
</div>
```

Same principle as the hero grid: `grid-cols-1 → lg:grid-cols-[ratio]`. Change
the ratio only if the content calls for it.

## 5. Panel shell + SectionHeader

```tsx
<section className="bg-[var(--surface)] rounded-2xl border border-[var(--border-2)] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden flex flex-col">
  <SectionHeader title="..." subtitle="..." />
  {/* body */}
</section>
```

```tsx
// SectionHeader — same 3-stripe pattern as TryBet, colors via CSS vars
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border-3)] px-5 py-4">
      <div className="flex h-[15px] w-[3px] shrink-0 flex-col overflow-hidden rounded-sm" aria-hidden>
        <div className="flex-1" style={{ background: 'var(--brand-navy)' }} />
        <div className="flex-1" style={{ background: 'var(--brand-blue)' }} />
        <div className="flex-1" style={{ background: 'var(--brand-light)' }} />
      </div>
      <div>
        <h2 className="text-[13px] font-semibold leading-none text-[var(--navy-text)]">{title}</h2>
        <p className="mt-0.5 text-[10px] text-[var(--muted-3)]">{subtitle}</p>
      </div>
    </div>
  )
}
```

Every panel gets a title + a one-line subtitle describing what it's sorted/filtered by.

## 6. Body content patterns

**Data table** (see the Brand Leaderboard block in `Home.tsx`):
- Header row: `border-b border-[var(--border-3)]`, cells
  `text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-3)]`
  (emphasis column swaps to `text-[var(--navy-text)]` or the relevant accent var).
- Body cells: `px-3 py-0 text-[13px]` (row height comes from `py-0` + a fixed
  row wrapper, not cell padding — see the rank/name cells); numeric cells are
  `font-mono tabular-nums text-right`.
- Row: `border-b border-[var(--border-3)] hover:bg-[var(--hover)] transition-colors group`.
- First/last column gets `pl-5`/`pr-5` instead of the standard `px-3`.
- Zero values render as a muted em dash span, not a bare `0`.
- Optional totals `<tfoot>`: `border-t border-[var(--border-3)] bg-[var(--surface-2)]`.
- Always render an explicit empty-state row (`colSpan` message,
  `text-[12px] text-[var(--muted-3)]`) — never an empty `<tbody>`.
- Clickable cells get `hover:text-{accent} hover:underline` plus a `title`
  attribute explaining the action.

**List rows / MoverGroup** (see `MoverGroup` in `Home.tsx`):
```tsx
<div>
  <div className="mb-2.5 flex items-center gap-2.5">
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: tint }}>{label}</span>
    <div className="h-px flex-1 bg-[var(--border-3)]" />
  </div>
  {/* rows, or empty message text-[12px] text-[var(--muted-3)] */}
</div>
```
- `tint`/`bgTint`/`borderTint` come from the semantic accent trio
  (`var(--pos)`/`var(--pos-surface)`/`var(--pos-border)` or the `--neg-*`
  equivalents) — never a raw hex.
- Rank-change glyphs: no-change → `text-[9px] text-[var(--border-strong)]` em
  dash; up → `text-[9px] font-semibold text-[var(--pos)]` with `↑`; down →
  same weight with `var(--neg)` and `↓`.

## 7. Typography scale

| Size | Weight/style | Usage |
|---|---|---|
| `text-[18px]` | `font-display font-[700]` | Empty-state heading |
| `text-[38px]` / `text-[28px]` mobile | `font-display font-[600] tabular-nums` | Hero card numeral |
| `text-[13px]` | `font-semibold text-[var(--navy-text)]` | Panel title (`<h2>`) / table body |
| `text-[12px]` | — | Empty-state copy, list primary text |
| `text-[11px]` | `font-mono` | Rank numerals |
| `text-[10px]` | `font-semibold uppercase tracking-[0.14em]` (`0.16em` on hero cards) | Every eyebrow/label/column header |
| `text-[9px]` | `font-mono font-semibold` | Smallest — rank-change arrows |

Rules:
- Any all-caps label = `10px, font-semibold, uppercase, tracking-[0.14em]`. No exceptions.
- Any numeric/data value = `font-mono tabular-nums`.
- Big display numerals and empty-state headings use `.font-display` (Outfit,
  utility class in `src/index.css`). Everything else uses `.font-sans` (Figtree,
  the `body` default — don't apply the class explicitly unless overriding
  something else).

## 8. Color — CSS variables only, never hex literals in component code

All values live in `src/index.css` under `:root` (light) and `.dark` (dark
override, toggled via `.dark` on `<html>`). Reference them as
`var(--token)` in inline `style`, or `text-[var(--token)]` /
`bg-[var(--token)]` as Tailwind arbitrary values — never a raw hex in a
component file. Key tokens for homepage-style views:

| Token | Role |
|---|---|
| `--surface` / `--surface-2` / `--surface-3` | Panel/card backgrounds, subtle fills, inputs |
| `--border` / `--border-2` / `--border-3` / `--border-strong` | Dividers, from subtle to emphasized |
| `--ink` / `--ink-2` / `--text-2` / `--muted` / `--muted-2` / `--muted-3` | Text, primary → faintest |
| `--brand-navy` / `--brand-blue` / `--brand-light` / `--brand-blue-deep` | Brand accents — hero cards, stripes, glow |
| `--navy-text` | Brand navy used as text (links, emphasis column) |
| `--pos` / `--pos-surface` / `--pos-border` | Positive movement |
| `--neg` / `--neg-surface` / `--neg-border` | Negative movement |
| `--info` / `--warn` (+ `-surface`/`-border`) | Informational / caution states |

If a new tone is needed, add it as a new CSS variable (light + dark value) in
`src/index.css`, not an inline hex — the `.dark` override is what makes theming work.

## 9. Interaction & accessibility — non-negotiable on every new component

- Every interactive element gets visible press/hover feedback: cards use
  `hover:opacity-90 active:scale-[0.98]`; rows/panels use
  `hover:bg-[var(--hover)] transition-colors`; buttons add
  `active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed`.
- Any `<table>` whose visible heading isn't a real `<label>`/`aria-labelledby`
  target needs an explicit `aria-label` matching that heading (match the
  existing pattern once one exists in a given file — several current tables
  predate this and should be brought in line opportunistically, not as a
  blocking requirement for new work).
- Always render an explicit empty state (page-level empty state per §2, and
  per-table/per-list empty rows/messages) — never a silently empty panel.
- Zero/ambiguous values render as a muted em dash, not a bare `0` or blank cell.
- New sections get the `fadeUp` entrance stagger described in §1 — it's the
  existing house style, not optional polish.

## Checklist — before shipping a new homepage/landing page

- [ ] Page wrapped in `space-y-4` on `bg-[var(--hover)]`.
- [ ] Empty state (§2) implemented before real data exists.
- [ ] Hero cards (if any): corner disc, `font-display` numeral, `hover:opacity-90 active:scale-[0.98]`.
- [ ] Content grid is `grid-cols-1 lg:grid-cols-[…]`.
- [ ] Every panel = `bg-[var(--surface)] rounded-2xl border border-[var(--border-2)] shadow-[0_1px_4px_rgba(0,0,0,0.04)]` + `SectionHeader` copied verbatim.
- [ ] All labels 10px/uppercase/tracked; all numbers `font-mono tabular-nums`.
- [ ] Zero raw hex literals in component code — CSS variables only.
- [ ] `fadeUp` stagger applied to new sections.
- [ ] Empty/zero values render as a muted em dash.
