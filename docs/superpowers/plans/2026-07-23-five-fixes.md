# Five Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five owner-requested changes as four sequential PRs: brand rename (FortunePLay→FortunePlay), removal of the "Data" badge on brand cards, light/dark theming for all spreadsheet-style matrices, an approved-users-only sign-in gate, and a logged-in-user display.

**Architecture:** React 19 + TypeScript + Tailwind v4 SPA (Vite), Supabase for data + auth. Theming is CSS variables in `src/index.css` (`:root` light, `.dark` overrides; `.dark` toggled on `<html>`). Auth gating already exists dormant behind `VITE_REQUIRE_AUTH`; this plan extends it with an approval check and matching RLS.

**Tech Stack:** Vite, Tailwind v4 (no config file — CSS vars only), supabase-js v2, vitest (logic tests only; UI verified via `npm run build` + Playwright MCP screenshots against `npm run dev`).

**Spec:** `docs/superpowers/specs/2026-07-23-five-fixes-design.md`

## Global Constraints

- One branch + PR per change, **every branch based on `main`** — never stacked. Merge order: PR 1 → 2 → 3 → 4 (PRs 2 and 3 touch the same files).
- Claude pushes, opens the PR (`gh`), and merges with `gh pr merge --merge --delete-branch` **only after the user's go-ahead**. Merging to `main` auto-deploys Vercel Production.
- Light mode must stay **visually identical to today** for the matrices — light token values are the exact hex currently hardcoded. Only dark mode changes.
- Sticky matrix cells overlay scrolled content → every token used on a sticky cell must be a **solid** color in both themes (no alpha).
- Do NOT adopt the harmonized matrix-pastel set (color-system spec §07) — out of scope.
- Do NOT restructure the brand cards (nested-`<button>` fix is a separate later change).
- Home.tsx's keyword-drawer/modal hardcoded light hexes are **out of scope** (not spreadsheet surfaces).
- PowerShell 5.1 mangles the repo's UTF-8 (no BOM) sources — never bulk-edit with `Get-Content`/`Set-Content`; use the Edit tool.
- Verify each PR with `npm run build` (must pass `tsc -b`) before committing; matrices additionally verified with Playwright screenshots in BOTH themes.
- The unpushed local `main` commit `cd2d449` (design spec) rides along with the PR 1 branch.

---

## PR 1 — `fix/fortuneplay-name`

### Task 1: Rename FortunePLay → FortunePlay (code + docs)

**Files:**
- Modify: `src/lib/brands.ts:103` (brand entry), `:221` (`BRAND_LOGO_COLORS` key), `:235` (`BRAND_FAVICONS` key)
- Modify: `CLAUDE.md:38`, `docs/DOCUMENTATION.md:17`
- Leave alone: `DONE_TASKS.md`, `docs/task-history.md`, old specs/plans (historical records)

**Interfaces:**
- Produces: brand `name: 'FortunePlay'` — every UI lookup (`DOMAIN_TO_BRAND`, favicons, colors) is keyed off this string via `brands.ts`, so all three occurrences must change together.

- [ ] **Step 1: Branch**

```bash
git checkout main && git checkout -b fix/fortuneplay-name
```

- [ ] **Step 2: Edit `src/lib/brands.ts`** — three edits:

```ts
// line 103:            'FortunePLay'  →  'FortunePlay'
    name: 'FortunePlay',
// line 221 (BRAND_LOGO_COLORS): 'FortunePLay': '#CA8A04',  →
  'FortunePlay': '#CA8A04',
// line 235 (BRAND_FAVICONS): 'FortunePLay': '/Brand-Favicon/fortuneplay.webp',  →
  'FortunePlay': '/Brand-Favicon/fortuneplay.webp',
```

- [ ] **Step 3: Edit docs** — in `CLAUDE.md:38` and `docs/DOCUMENTATION.md:17`, replace the word `FortunePLay` with `FortunePlay`.

- [ ] **Step 4: Verify no live references remain**

Run: `rg -n "FortunePLay" src/ api/ CLAUDE.md docs/DOCUMENTATION.md`
Expected: no matches (hits in DONE_TASKS.md / task-history.md / old specs are fine and expected when searching wider).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 6: Commit, push, open PR**

```bash
git add src/lib/brands.ts CLAUDE.md docs/DOCUMENTATION.md
git commit -m "fix(brands): rename FortunePLay -> FortunePlay"
git push -u origin fix/fortuneplay-name
gh pr create --base main --title "fix(brands): rename FortunePLay -> FortunePlay" --body "Renames the brand everywhere live (brands.ts entry + color/favicon map keys, CLAUDE.md, DOCUMENTATION.md). Supabase ftd_records/brand_stags rows are updated by SQL at merge time - see docs/superpowers/specs/2026-07-23-five-fixes-design.md #1."
```

- [ ] **Step 7 (at merge time, after user go-ahead): merge, then run the data migration**

Merge: `gh pr merge --merge --delete-branch`

Then in Supabase Dashboard → SQL Editor, run and confirm row counts:

```sql
-- pre-check: expect zero 'FortunePlay' rows (else merge manually before updating)
select count(*) from public.ftd_records where brand = 'FortunePlay';
select count(*) from public.brand_stags  where brand = 'FortunePlay';

update public.ftd_records set brand = 'FortunePlay' where brand = 'FortunePLay';
update public.brand_stags  set brand = 'FortunePlay' where brand = 'FortunePLay';

-- post-check: expect zero rows left under the old name
select count(*) from public.ftd_records where brand = 'FortunePLay';
select count(*) from public.brand_stags  where brand = 'FortunePLay';
```

- [ ] **Step 8: Verify on production** — open the FTDs page; FortunePlay's REG/FTD history must still show (aggregation in `FtdMatrixTable.aggregateByBrand` indexes `perBrand[r.brand]` — a mismatch would throw/blank).

---

## PR 2 — `chore/remove-data-badge`

### Task 2: Remove the "Data" pill from brand cards

**Files:**
- Modify: `src/pages/BPSites.tsx:108-111` (hasData calc), `:137-144` (badge)
- Modify: `src/pages/LPSites.tsx` (same pattern: `hasData` calc near line 98, badge near lines 129-136)

- [ ] **Step 1: Branch** — `git checkout main && git pull && git checkout -b chore/remove-data-badge`

- [ ] **Step 2: Edit `src/pages/BPSites.tsx`** — delete the badge JSX inside the card header:

```tsx
{hasData && (
  <span
    className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
    style={{ background: c + '20', color: c }}
  >
    Data
  </span>
)}
```

and delete the now-unused computation (lines 109-111):

```tsx
const hasData = snapshots.some((s) =>
  s.records.some((r) => domainSet.has(r.domain.toLowerCase())),
)
```

If `domainSet` (line 108) is then unused too (check with `tsc`), delete it as well. If the grid component's `snapshots` prop becomes unused, remove the prop from the component signature and its call site.

- [ ] **Step 3: Edit `src/pages/LPSites.tsx`** — same two deletions (badge `<span>…Data…</span>` and its `hasData` calc; clean up any newly-unused variable/prop).

- [ ] **Step 4: Build** — `npm run build` → exits 0 (this catches every unused-variable fallout since `tsc -b` runs with noUnusedLocals).

- [ ] **Step 5: Visual check** — `npm run dev`, Playwright-screenshot `/bp-sites` and `/lp-sites` brand grids: cards show favicon + name + domains, no pill.

- [ ] **Step 6: Commit, push, PR; merge after go-ahead**

```bash
git add src/pages/BPSites.tsx src/pages/LPSites.tsx
git commit -m "chore(ui): remove Data badge from brand cards"
git push -u origin chore/remove-data-badge
gh pr create --base main --title "chore(ui): remove Data badge from brand cards" --body "Removes the redundant 'Data' pill from BP/LP brand-grid cards plus the unused hasData computation."
```

---

## PR 3 — `feat/matrix-theming`

The spreadsheet surfaces (`FtdMatrixTable`, BP/LP matrices, `Countries` tables, `PosBadge`, `EditableCell`) hardcode a light palette. This PR introduces `--mx-*` tokens (light = today's exact hex; dark = navy-anchored solids) and swaps every hardcoded hex to a var.

### Task 3: Add the `--mx-*` token block to `src/index.css`

**Files:**
- Modify: `src/index.css` (append inside `:root` at line 63 area and `.dark` at line 112 area; update the stale header comment at lines 12-14)

**Interfaces:**
- Produces: the CSS custom properties below — Tasks 4-7 reference them by exact name via `var(--mx-…)`.

- [ ] **Step 1: Branch** — `git checkout main && git pull && git checkout -b feat/matrix-theming`

- [ ] **Step 2: Update the stale comment** at `src/index.css:12-14`. Replace

```
   The spreadsheet-style data matrices (BP/LP ranking tables, Reg & FTD
   matrix) intentionally keep their own hardcoded light palette — they read
   like an embedded Google Sheet in both themes. */
```

with

```
   The spreadsheet-style data matrices (BP/LP ranking tables, Reg & FTD
   matrix, Countries) theme via the --mx-* tokens below: light values match
   the client's Google Sheet exactly; dark values are navy-anchored solids.
   Sticky matrix cells overlay scrolled content, so --mx-* backgrounds must
   stay SOLID (no alpha) in both themes. */
```

- [ ] **Step 3: Append to the `:root` block** (before its closing `}`):

```css
  /* Matrix (spreadsheet) tokens — light = the client sheet's exact palette */
  --mx-bg:            #FFFFFF;  /* table + sticky cell background (SOLID) */
  --mx-border:        #B0B7BD;
  --mx-divider:       #E2E8F0;
  --mx-divider-soft:  #F1F5F9;
  --mx-subhead-bg:    #F8FAFC;
  --mx-stags-bg:      #F1F5F9;
  --mx-year-row-bg:   #EDF0F4;
  --mx-selected-bg:   #F0F9FF;
  --mx-ink:           #000000;  /* cell + header text */
  --mx-ink-strong:    #0F172A;
  --mx-ink-soft:      #334155;
  --mx-muted:         #64748B;
  --mx-faint:         #94A3B8;
  --mx-dash:          #6B7280;  /* empty-cell dash */
  --mx-hover:         rgba(15, 23, 42, 0.06);  /* non-sticky hover wash only */
  --mx-edit-bg:       #FFFFFF;  /* EditableCell input */
  --mx-chip-hover:    #312E81;
  --mx-pos:           #15803D;
  --mx-neg:           #B91C1C;
  --mx-totals-header-bg:  #16A34A;
  --mx-totals-subhead-bg: #D9EDDF;
  --mx-totals-cell-bg:    #EAF6EF; /* SOLID — sticky */
  --mx-group-bp:      #6B7280;
  --mx-group-lp:      #0F766E;
  /* Sheet column palette (header / cell pairs) */
  --mx-col-purple-h:     #B4A7D6;  --mx-col-purple-c:     #D9D2E9;
  --mx-col-grey-h:       #CCCCCC;  --mx-col-grey-c:       #D9D9D9;
  --mx-col-yellow-h:     #FFD966;  --mx-col-yellow-c:     #FFECB2;
  --mx-col-green-h:      #93C47D;  --mx-col-green-c:      #D9EAD3;
  --mx-col-magenta-h:    #C27BA0;  --mx-col-magenta-c:    #EAD1DC;
  --mx-col-cyan-h:       #76A5AF;  --mx-col-cyan-c:       #D0E0E3;
  --mx-col-orange-h:     #E69138;  --mx-col-orange-c:     #F9CB9C;
  --mx-col-cornflower-h: #6FA8DC;  --mx-col-cornflower-c: #C9DAF8;
  --mx-col-blue-h:       #A4C2F4;  --mx-col-blue-c:       #D9E1F2;
```

- [ ] **Step 4: Append to the `.dark` block** (before its closing `}`):

```css
  /* Matrix tokens — navy-anchored dark solids */
  --mx-bg:            #131A26;
  --mx-border:        #3A4860;
  --mx-divider:       #29354A;
  --mx-divider-soft:  #1E2836;
  --mx-subhead-bg:    #182130;
  --mx-stags-bg:      #1F2937;
  --mx-year-row-bg:   #1B2431;
  --mx-selected-bg:   #13293C;
  --mx-ink:           #E8EDF6;
  --mx-ink-strong:    #F3F6FB;
  --mx-ink-soft:      #B6C2D6;
  --mx-muted:         #8EA1BA;
  --mx-faint:         #6B7A90;
  --mx-dash:          #78889C;
  --mx-hover:         rgba(232, 237, 246, 0.08);
  --mx-edit-bg:       #1F2937;
  --mx-chip-hover:    #9DB4F0;
  --mx-pos:           #35CE86;
  --mx-neg:           #FF6B7A;
  --mx-totals-header-bg:  #15532F;
  --mx-totals-subhead-bg: #163524;
  --mx-totals-cell-bg:    #112B1C;
  --mx-group-bp:      #4A5568;
  --mx-group-lp:      #0F5D57;
  /* Column palette — same hues, desaturated + darkened */
  --mx-col-purple-h:     #4A4066;  --mx-col-purple-c:     #322B45;
  --mx-col-grey-h:       #3E4756;  --mx-col-grey-c:       #2A3140;
  --mx-col-yellow-h:     #6B5A1E;  --mx-col-yellow-c:     #423A1A;
  --mx-col-green-h:      #3D5B33;  --mx-col-green-c:      #283A24;
  --mx-col-magenta-h:    #5C3A4D;  --mx-col-magenta-c:    #3D2A34;
  --mx-col-cyan-h:       #2F4D53;  --mx-col-cyan-c:       #223438;
  --mx-col-orange-h:     #6B4A1E;  --mx-col-orange-c:     #45331F;
  --mx-col-cornflower-h: #2F4A66;  --mx-col-cornflower-c: #23334A;
  --mx-col-blue-h:       #3A4C6E;  --mx-col-blue-c:       #283349;
```

- [ ] **Step 5: Commit** — `git add src/index.css && git commit -m "feat(theme): add --mx-* matrix tokens (light = sheet palette, dark = navy solids)"`

### Task 4: Swap FtdMatrixTable to tokens

**Files:**
- Modify: `src/components/FtdMatrixTable.tsx`

**Interfaces:**
- Consumes: `--mx-*` tokens from Task 3. CSS `var()` strings work anywhere the current hex strings are used (inline `style` values).

- [ ] **Step 1: Replace the constants** (lines 9-19, 253):

| Constant / literal | Old | New |
|---|---|---|
| `TABLE_BORDER` | `'#B0B7BD'` | `'var(--mx-border)'` |
| `STICKY_BG` | `'#FFFFFF'` | `'var(--mx-bg)'` |
| `STAGS_BG` | `'#F1F5F9'` | `'var(--mx-stags-bg)'` |
| `SUBHEAD_BG` | `'#F8FAFC'` | `'var(--mx-subhead-bg)'` |
| `TOTALS_HEADER_BG` | `'#16A34A'` | `'var(--mx-totals-header-bg)'` |
| `TOTALS_SUBHEAD_BG` | `'#D9EDDF'` | `'var(--mx-totals-subhead-bg)'` |
| `TOTALS_CELL_BG` | `'#EAF6EF'` | `'var(--mx-totals-cell-bg)'` |
| `YEAR_ROW_BG` (line 253) | `'#EDF0F4'` | `'var(--mx-year-row-bg)'` |

- [ ] **Step 2: Fix the tint-overlay base** (line ~322). The brand-tint trick layers an alpha gradient over a solid base so sticky cells stay opaque:

```tsx
? { backgroundColor: '#FFFFFF', backgroundImage: `linear-gradient(${tint}, ${tint})` }
```
becomes
```tsx
? { backgroundColor: 'var(--mx-bg)', backgroundImage: `linear-gradient(${tint}, ${tint})` }
```
(`tint` stays the brand `#RRGGBB14` alpha wash — over the dark base it reads as a subtle dark brand tint, which is the intent.)

- [ ] **Step 3: Remaining literals:**

| Line ~ | Old | New |
|---|---|---|
| 326 (scroll wrapper) | `background: '#fff', color: '#0F172A'` | `background: 'var(--mx-bg)', color: 'var(--mx-ink-strong)'` |
| 428 (empty state) | `text-[#94A3B8]` | `text-[var(--mx-faint)]` |
| 487 (chevron) | `text-[#64748B]` | `text-[var(--mx-muted)]` |

Also sweep the whole file for any remaining `#`-hex literals (`rg -n "#[0-9A-Fa-f]{3,8}" src/components/FtdMatrixTable.tsx`) — anything left should be brand-color-derived (via `BRAND_LOGO_COLORS`) only. If any hardcoded white/black FG remains on TOTALS header text (`color: 'white'`), leave it: white-on-green passes in both themes.

- [ ] **Step 4: Build + commit** — `npm run build` → 0; `git add -A && git commit -m "feat(theme): FtdMatrixTable on --mx-* tokens"`

### Task 5: Swap PosBadge + EditableCell to tokens

**Files:**
- Modify: `src/components/PosBadge.tsx`, `src/components/EditableCell.tsx`

- [ ] **Step 1: PosBadge** — replace every color literal (appears twice each, cross-snapshot path lines 42-55 and within-file path lines 81-83):

| Old | New |
|---|---|
| `'#15803D'` | `'var(--mx-pos)'` |
| `'#B91C1C'` | `'var(--mx-neg)'` |
| `'#000000'` | `'var(--mx-ink)'` |

- [ ] **Step 2: EditableCell** — line 78 (input) and line 89 (resting button):

```tsx
// input, line 78 — old:
className={`w-full bg-white border border-[#0F172A] rounded-[3px] px-1 py-0.5 text-[11px] text-[#0F172A] outline-none ${inputClassName}`}
// new:
className={`w-full bg-[var(--mx-edit-bg)] border border-[var(--mx-ink-strong)] rounded-[3px] px-1 py-0.5 text-[11px] text-[var(--mx-ink-strong)] outline-none ${inputClassName}`}

// resting button, line 89 — old:
... cursor-text hover:bg-[rgba(15,23,42,0.06)] ...
// new:
... cursor-text hover:bg-[var(--mx-hover)] ...
```

- [ ] **Step 3: Build + commit** — `npm run build` → 0; `git commit -am "feat(theme): PosBadge + EditableCell on --mx-* tokens"`

### Task 6: Swap the BPSites matrix + toolbar to tokens

**Files:**
- Modify: `src/pages/BPSites.tsx`

- [ ] **Step 1: Constants (lines 21-35):**

```ts
const MAIN_HEADER_BG = 'var(--mx-col-purple-h)'
const MAIN_CELL_BG   = 'var(--mx-col-purple-c)'
const COL_PALETTE = [
  { headerBg: 'var(--mx-col-grey-h)',    cellBg: 'var(--mx-col-grey-c)' },    // BP #1
  { headerBg: 'var(--mx-col-yellow-h)',  cellBg: 'var(--mx-col-yellow-c)' },  // BP #2
  { headerBg: 'var(--mx-col-green-h)',   cellBg: 'var(--mx-col-green-c)' },   // BP #3
  { headerBg: 'var(--mx-col-magenta-h)', cellBg: 'var(--mx-col-magenta-c)' }, // BP #4
]
const DATE_BAND_FG  = '#FFFFFF'            // stays: white on --band-date, both themes
const HEADER_FG     = 'var(--mx-ink)'
const TABLE_BORDER  = 'var(--mx-border)'
const STICKY_KW_BG  = 'var(--mx-bg)'
```
(Keep each line's existing comment text; only swap the values shown.)

- [ ] **Step 2: Literal sweep** — for each remaining hex in the file, apply this mapping (line numbers approximate):

| Line ~ | Old | New |
|---|---|---|
| 548, 571 | `bg-[#E2E8F0]` | `bg-[var(--mx-divider)]` |
| 633 | `hover:text-[#312E81]` | `hover:text-[var(--mx-chip-hover)]` |
| 1050 | `bg-[#F0F9FF]` | `bg-[var(--mx-selected-bg)]` |
| 1295 | `bg-[#FFFFFF] … text-black` | `bg-[var(--mx-bg)] … text-[var(--mx-ink)]` |
| 1307 | `background: '#16A34A'` | `background: 'var(--mx-totals-header-bg)'` (its `color: 'white'` stays) |
| 1352, 1416 | `color: '#000'` | `color: 'var(--mx-ink)'` |
| 1444 | `text-[#6B7280]` | `text-[var(--mx-dash)]` |
| 1469 | `top3: '#0F172A'` | `top3: 'var(--mx-ink-strong)'` |
| 1472 | `unchanged: '#94A3B8'` | `unchanged: 'var(--mx-faint)'` |
| 1473 | `notRanking: '#64748B'` | `notRanking: 'var(--mx-muted)'` |
| 1590 | `border-[#F1F5F9]` | `border-[var(--mx-divider-soft)]` |
| 1621 | `text-[#334155]` | `text-[var(--mx-ink-soft)]` |
| 1634, 1644 | `color: '#000000'` | `color: 'var(--mx-ink)'` |
| 1655 | `color: '#94A3B8'` | `color: 'var(--mx-faint)'` |
| 1720 | `borderTop: '3px solid #0F172A'` | `borderTop: '3px solid var(--mx-ink-strong)'` |
| 1758 | `badgeColor="#64748B"` | `badgeColor="var(--mx-muted)"` |
| 1764, 1766 | `bg-[#E2E8F0]` | `bg-[var(--mx-divider)]` |

Leave untouched: brand-color-derived values (`brand.color`, `BRAND_LOGO_COLORS`, `#RRGGBB14`-style brand tints) and any navy accent literals (`#1e2a6e`, `#1c9fe0`, `#7fd4f5`).

- [ ] **Step 3: Build + commit** — `npm run build` → 0; `git commit -am "feat(theme): BP matrix on --mx-* tokens"`

### Task 7: Swap the LPSites matrix + Countries tables to tokens

**Files:**
- Modify: `src/pages/LPSites.tsx`, `src/pages/Countries.tsx`

- [ ] **Step 1: LPSites constants (lines 17-32)** — swap to the paired tokens in listed order:

```ts
const COL_PALETTE = [
  { headerBg: 'var(--mx-col-purple-h)',     cellBg: 'var(--mx-col-purple-c)' },
  { headerBg: 'var(--mx-col-grey-h)',       cellBg: 'var(--mx-col-grey-c)' },
  { headerBg: 'var(--mx-col-yellow-h)',     cellBg: 'var(--mx-col-yellow-c)' },
  { headerBg: 'var(--mx-col-green-h)',      cellBg: 'var(--mx-col-green-c)' },
  { headerBg: 'var(--mx-col-magenta-h)',    cellBg: 'var(--mx-col-magenta-c)' },
  { headerBg: 'var(--mx-col-cyan-h)',       cellBg: 'var(--mx-col-cyan-c)' },
  { headerBg: 'var(--mx-col-orange-h)',     cellBg: 'var(--mx-col-orange-c)' },
  { headerBg: 'var(--mx-col-cornflower-h)', cellBg: 'var(--mx-col-cornflower-c)' },
  { headerBg: 'var(--mx-col-blue-h)',       cellBg: 'var(--mx-col-blue-c)' },
]
const DATE_BAND_FG = '#FFFFFF'          // stays
const HEADER_FG    = 'var(--mx-ink)'
const TABLE_BORDER = 'var(--mx-border)'
const STICKY_KW_BG = 'var(--mx-bg)'
```

- [ ] **Step 2: LPSites literals:**

| Line ~ | Old | New |
|---|---|---|
| 385, 408 | `bg-[#E2E8F0]` | `bg-[var(--mx-divider)]` |
| 904 | `bg-[#FFFFFF] … text-black` | `bg-[var(--mx-bg)] … text-[var(--mx-ink)]` |
| 915 | `background: '#16A34A'` | `background: 'var(--mx-totals-header-bg)'` |
| 934, 1000 | `color: '#000'` | `color: 'var(--mx-ink)'` |
| 1025 | `text-[#6B7280]` | `text-[var(--mx-dash)]` |

- [ ] **Step 3: Countries constants (lines 21-55) and literals:**

```ts
const MAIN_HEADER_BG = 'var(--mx-col-purple-h)'
const MAIN_CELL_BG   = 'var(--mx-col-purple-c)'
const TABLE_BORDER   = 'var(--mx-border)'
const STICKY_KW_BG   = 'var(--mx-bg)'
const DATE_BAND_FG   = '#FFFFFF'                 // stays
const HEADER_FG      = 'var(--mx-ink)'
const BP_GROUP_BG  = 'var(--mx-group-bp)'
const LP_GROUP_BG  = 'var(--mx-group-lp)'
const GROUP_FG     = '#FFFFFF'                   // stays: white on both group solids
const SECTION_DIVIDER = '3px solid var(--mx-group-bp)'
// BP_COL_PALETTE / LP_COL_PALETTE entries: same hue→token mapping as LPSites
// (grey, yellow, green, magenta, cyan, orange, cornflower, blue, cyan, …) —
// match each hex pair to its --mx-col-<hue>-h/-c token.
```

| Line ~ | Old | New |
|---|---|---|
| 327 | `background: '#fff'` | `background: 'var(--mx-bg)'` |
| 469 | `color: '#000'` | `color: 'var(--mx-ink)'` |
| 495, 518, 541 | `text-[#6B7280]` | `text-[var(--mx-dash)]` |

- [ ] **Step 4: Full-repo leftover check**

Run: `rg -n "#(FFFFFF|fff|F8FAFC|F1F5F9|B0B7BD|16A34A|D9EDDF|EAF6EF|EDF0F4|15803D|B91C1C|B4A7D6|D9D2E9|CCCCCC|D9D9D9|FFD966|FFECB2|93C47D|D9EAD3|C27BA0|EAD1DC|76A5AF|D0E0E3|E69138|F9CB9C|6FA8DC|C9DAF8|A4C2F4|D9E1F2)" src/components/FtdMatrixTable.tsx src/components/PosBadge.tsx src/components/EditableCell.tsx src/pages/BPSites.tsx src/pages/LPSites.tsx src/pages/Countries.tsx`
Expected: no matches (or only lines explicitly kept: white FG on date band / totals header / group headers).

- [ ] **Step 5: Build + commit** — `npm run build` → 0; `git commit -am "feat(theme): LP matrix + Countries tables on --mx-* tokens"`

### Task 8: Visual verification + PR

- [ ] **Step 1:** `npm run dev`; with Playwright MCP, screenshot each of `/bp-sites/<brand>`, `/lp-sites/<brand>`, `/ftds`, and the Countries view in **light** mode. Compare against production: must be visually identical (same pastels, same borders).
- [ ] **Step 2:** Toggle dark mode (Topbar moon button); screenshot the same four. Verify: no white slabs; sticky columns stay opaque when scrolled horizontally; header text readable on every column hue; pos/neg colors visible; EditableCell hover/edit states legible.
- [ ] **Step 3:** Fix anything off (contrast, missed hex), rebuild, commit.
- [ ] **Step 4: PR**

```bash
git push -u origin feat/matrix-theming
gh pr create --base main --title "feat(theme): light/dark theming for spreadsheet matrices" --body "Adds --mx-* tokens (light = client-sheet palette, unchanged; dark = navy-anchored solids) and swaps FtdMatrixTable, BP/LP matrices, Countries, PosBadge, EditableCell off hardcoded hex. Sticky cells stay solid in both themes. Screenshots in comments."
```
Post light+dark screenshots as a PR comment (`gh pr comment`). Merge after go-ahead.

---

## PR 4 — `feat/auth-gate-approved`

### Task 9: `supabase/auth-approved-lockdown.sql`

**Files:**
- Create: `supabase/auth-approved-lockdown.sql`
- Modify: `supabase/auth-lockdown.sql` (header pointer only)

**Interfaces:**
- Produces: `public.is_approved()` (SQL, `security definer`) and `"approved <op> <table>"` policies — referenced only inside Supabase, not by app code. App code keeps calling the same supabase-js queries; the JWT satisfies the policies.

- [ ] **Step 1: Branch** — `git checkout main && git pull && git checkout -b feat/auth-gate-approved`

- [ ] **Step 2: Create `supabase/auth-approved-lockdown.sql`:**

```sql
-- ============================================================================
-- Ranking Reports — APPROVED-ONLY LOCKDOWN (supersedes auth-lockdown.sql)
-- ============================================================================
-- Requires sign-in AND user_access.status = 'approved' to read OR write any
-- data. Pending self-signups get nothing until an admin approves them at
-- /admin/users. Portal SSO users are auto-approved at provisioning
-- (api/portal-callback.ts), so they pass.
--
-- ── FLIP-THE-SWITCH CHECKLIST ───────────────────────────────────────────────
--   1. Merge + deploy the frontend PR that gates on approval (AuthGate).
--   2. Run THIS file: Supabase Dashboard → SQL Editor → paste → Run.
--   3. Vercel → Project → Settings → Environment Variables:
--        VITE_REQUIRE_AUTH = true   (Production) → redeploy.
--   4. Verify (see checklist in the PR / plan).
--
-- Safe to re-run: every statement is idempotent.
-- To ROLL BACK (reads open to anon, writes to any authenticated user):
--   re-run supabase/auth-write-lockdown.sql, then remove the env var.
-- ============================================================================

-- Approval check used by every data policy. SECURITY DEFINER so the check
-- can read user_access regardless of that table's own RLS.
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access
    where user_id = auth.uid() and status = 'approved'
  );
$$;

revoke all on function public.is_approved() from public;
grant execute on function public.is_approved() to authenticated;

alter table public.snapshots       enable row level security;
alter table public.ranking_records enable row level security;
alter table public.ftd_records     enable row level security;
alter table public.ftd_totals      enable row level security;
alter table public.brand_stags     enable row level security;

-- snapshots -------------------------------------------------------------------
drop policy if exists "anon read snapshots"       on public.snapshots;
drop policy if exists "anon write snapshots"      on public.snapshots;
drop policy if exists "anon update snapshots"     on public.snapshots;
drop policy if exists "anon delete snapshots"     on public.snapshots;
drop policy if exists "auth read snapshots"       on public.snapshots;
drop policy if exists "auth write snapshots"      on public.snapshots;
drop policy if exists "auth update snapshots"     on public.snapshots;
drop policy if exists "auth delete snapshots"     on public.snapshots;
drop policy if exists "approved read snapshots"   on public.snapshots;
drop policy if exists "approved write snapshots"  on public.snapshots;
drop policy if exists "approved update snapshots" on public.snapshots;
drop policy if exists "approved delete snapshots" on public.snapshots;

create policy "approved read snapshots"   on public.snapshots for select to authenticated using (public.is_approved());
create policy "approved write snapshots"  on public.snapshots for insert to authenticated with check (public.is_approved());
create policy "approved update snapshots" on public.snapshots for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy "approved delete snapshots" on public.snapshots for delete to authenticated using (public.is_approved());

-- ranking_records -------------------------------------------------------------
drop policy if exists "anon read records"       on public.ranking_records;
drop policy if exists "anon write records"      on public.ranking_records;
drop policy if exists "anon update records"     on public.ranking_records;
drop policy if exists "anon delete records"     on public.ranking_records;
drop policy if exists "auth read records"       on public.ranking_records;
drop policy if exists "auth write records"      on public.ranking_records;
drop policy if exists "auth update records"     on public.ranking_records;
drop policy if exists "auth delete records"     on public.ranking_records;
drop policy if exists "approved read records"   on public.ranking_records;
drop policy if exists "approved write records"  on public.ranking_records;
drop policy if exists "approved update records" on public.ranking_records;
drop policy if exists "approved delete records" on public.ranking_records;

create policy "approved read records"   on public.ranking_records for select to authenticated using (public.is_approved());
create policy "approved write records"  on public.ranking_records for insert to authenticated with check (public.is_approved());
create policy "approved update records" on public.ranking_records for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy "approved delete records" on public.ranking_records for delete to authenticated using (public.is_approved());

-- ftd_records -----------------------------------------------------------------
drop policy if exists "anon read ftd_records"       on public.ftd_records;
drop policy if exists "anon write ftd_records"      on public.ftd_records;
drop policy if exists "anon update ftd_records"     on public.ftd_records;
drop policy if exists "anon delete ftd_records"     on public.ftd_records;
drop policy if exists "auth read ftd_records"       on public.ftd_records;
drop policy if exists "auth write ftd_records"      on public.ftd_records;
drop policy if exists "auth update ftd_records"     on public.ftd_records;
drop policy if exists "auth delete ftd_records"     on public.ftd_records;
drop policy if exists "approved read ftd_records"   on public.ftd_records;
drop policy if exists "approved write ftd_records"  on public.ftd_records;
drop policy if exists "approved update ftd_records" on public.ftd_records;
drop policy if exists "approved delete ftd_records" on public.ftd_records;

create policy "approved read ftd_records"   on public.ftd_records for select to authenticated using (public.is_approved());
create policy "approved write ftd_records"  on public.ftd_records for insert to authenticated with check (public.is_approved());
create policy "approved update ftd_records" on public.ftd_records for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy "approved delete ftd_records" on public.ftd_records for delete to authenticated using (public.is_approved());

-- ftd_totals ------------------------------------------------------------------
drop policy if exists "anon read ftd_totals"       on public.ftd_totals;
drop policy if exists "anon write ftd_totals"      on public.ftd_totals;
drop policy if exists "anon update ftd_totals"     on public.ftd_totals;
drop policy if exists "anon delete ftd_totals"     on public.ftd_totals;
drop policy if exists "auth read ftd_totals"       on public.ftd_totals;
drop policy if exists "auth write ftd_totals"      on public.ftd_totals;
drop policy if exists "auth update ftd_totals"     on public.ftd_totals;
drop policy if exists "auth delete ftd_totals"     on public.ftd_totals;
drop policy if exists "approved read ftd_totals"   on public.ftd_totals;
drop policy if exists "approved write ftd_totals"  on public.ftd_totals;
drop policy if exists "approved update ftd_totals" on public.ftd_totals;
drop policy if exists "approved delete ftd_totals" on public.ftd_totals;

create policy "approved read ftd_totals"   on public.ftd_totals for select to authenticated using (public.is_approved());
create policy "approved write ftd_totals"  on public.ftd_totals for insert to authenticated with check (public.is_approved());
create policy "approved update ftd_totals" on public.ftd_totals for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy "approved delete ftd_totals" on public.ftd_totals for delete to authenticated using (public.is_approved());

-- brand_stags -----------------------------------------------------------------
drop policy if exists "anon read brand_stags"       on public.brand_stags;
drop policy if exists "anon write brand_stags"      on public.brand_stags;
drop policy if exists "anon update brand_stags"     on public.brand_stags;
drop policy if exists "anon delete brand_stags"     on public.brand_stags;
drop policy if exists "auth read brand_stags"       on public.brand_stags;
drop policy if exists "auth write brand_stags"      on public.brand_stags;
drop policy if exists "auth update brand_stags"     on public.brand_stags;
drop policy if exists "auth delete brand_stags"     on public.brand_stags;
drop policy if exists "approved read brand_stags"   on public.brand_stags;
drop policy if exists "approved write brand_stags"  on public.brand_stags;
drop policy if exists "approved update brand_stags" on public.brand_stags;
drop policy if exists "approved delete brand_stags" on public.brand_stags;

create policy "approved read brand_stags"   on public.brand_stags for select to authenticated using (public.is_approved());
create policy "approved write brand_stags"  on public.brand_stags for insert to authenticated with check (public.is_approved());
create policy "approved update brand_stags" on public.brand_stags for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy "approved delete brand_stags" on public.brand_stags for delete to authenticated using (public.is_approved());
```

- [ ] **Step 3: Point the old file at the new one.** In `supabase/auth-lockdown.sql`, after line 4 (`-- ⚠️  DO NOT RUN THIS UNTIL YOU ARE READY TO REQUIRE LOGIN.`), insert:

```sql
-- ⚠️  SUPERSEDED: use auth-approved-lockdown.sql instead — it additionally
--     requires user_access.status = 'approved', not just any session.
```

- [ ] **Step 4: Commit** — `git add supabase/ && git commit -m "feat(auth): approved-only RLS lockdown migration"`

### Task 10: AuthGate approval check + pending screen

**Files:**
- Modify: `src/components/AuthGate.tsx` (full replacement below)

**Interfaces:**
- Consumes: `REQUIRE_AUTH`, `getSession`, `onAuthChange`, `signOut` from `../lib/auth`; `getUserAccess(userId): Promise<{status, isAdmin} | null>` from `../lib/userAccess`; `<Login />`.
- Produces: same external contract — `AuthGate({ children })` wraps `<Layout />` in `App.tsx` (no App.tsx change needed).

- [ ] **Step 1: Replace `src/components/AuthGate.tsx` with:**

```tsx
import { useState, useEffect, type ReactNode } from 'react'
import { LogOut, Hourglass } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { REQUIRE_AUTH, getSession, onAuthChange, signOut } from '../lib/auth'
import { getUserAccess } from '../lib/userAccess'
import { Login } from './Login'

type Access = 'checking' | 'pending' | 'approved'

/**
 * Wraps the app. When VITE_REQUIRE_AUTH is false, it renders children
 * immediately — the app is unchanged. When true, it requires a Supabase
 * session AND an approved user_access row: signed out → <Login />; signed in
 * but pending → an "awaiting approval" screen; approved → the app.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // Flag off → no gating, ever. Resolve immediately so there's no flicker.
  const [session, setSession] = useState<Session | null>(null)
  const [checked, setChecked] = useState(!REQUIRE_AUTH)
  const [access, setAccess] = useState<Access>('checking')

  useEffect(() => {
    if (!REQUIRE_AUTH) return
    let cancelled = false
    // Generation counter so a slow approval lookup for an old session can't
    // clobber the state of a newer one (e.g. quick sign-out/sign-in).
    let gen = 0

    const applySession = (s: Session | null) => {
      setSession(s)
      setChecked(true)
      const my = ++gen
      setAccess('checking')
      if (!s) return
      getUserAccess(s.user.id)
        .then((a) => {
          if (cancelled || my !== gen) return
          setAccess(a?.status === 'approved' ? 'approved' : 'pending')
        })
        .catch(() => {
          // Treat lookup failure as not-approved; the user can sign out/in.
          if (cancelled || my !== gen) return
          setAccess('pending')
        })
    }

    getSession().then((s) => { if (!cancelled) applySession(s) })
    const unsub = onAuthChange((s) => { if (!cancelled) applySession(s) })
    return () => { cancelled = true; unsub() }
  }, [])

  if (!REQUIRE_AUTH) return <>{children}</>

  if (!checked) return <GateNote text="Checking session…" />
  if (!session) return <Login />
  if (access === 'checking') return <GateNote text="Checking access…" />
  if (access === 'pending') return <PendingApproval email={session.user.email ?? 'your account'} />

  return <>{children}</>
}

function GateNote({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-screen bg-[var(--surface-2)] text-[var(--muted)] font-mono text-[12px] tracking-wider">
      {text}
    </div>
  )
}

/** Signed in, but user_access.status is still 'pending'. */
function PendingApproval({ email }: { email: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--surface-2)] px-4">
      <div className="w-full max-w-[400px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 text-center shadow-[0_24px_60px_rgba(0,0,0,0.12)]">
        <div className="mx-auto mb-4 w-11 h-11 rounded-full bg-[var(--warn-surface)] border border-[var(--warn-border)] flex items-center justify-center">
          <Hourglass size={18} className="text-[var(--warn)]" />
        </div>
        <h1 className="font-display text-[18px] text-[var(--ink)] mb-2">Awaiting approval</h1>
        <p className="text-[13px] text-[var(--text-2)] leading-relaxed mb-1">
          You're signed in as <span className="font-semibold text-[var(--ink)]">{email}</span>.
        </p>
        <p className="text-[13px] text-[var(--text-2)] leading-relaxed mb-6">
          An admin needs to approve your account before you can view the
          dashboard. Check back once you've been approved.
        </p>
        <button
          type="button"
          onClick={() => { void signOut() }}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-[var(--border-2)] text-[12px] font-mono text-[var(--muted)] hover:text-[var(--ink-2)] hover:border-[var(--muted-3)] transition-colors"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build** — `npm run build` → 0.
- [ ] **Step 3: Commit** — `git commit -am "feat(auth): AuthGate requires approved user_access when gated"`

### Task 11: Show who is logged in (Topbar)

**Files:**
- Modify: `src/components/Topbar.tsx:55-64`

- [ ] **Step 1:** Replace the signed-in branch:

```tsx
{session ? (
  <div className="shrink-0 flex items-center gap-2 min-w-0">
    <span
      title={session.user.email ?? undefined}
      className="hidden sm:inline text-[11px] font-mono text-[var(--muted)] max-w-[180px] truncate"
    >
      {session.user.email}
    </span>
    <button
      type="button"
      onClick={() => { void signOut() }}
      title="Sign out"
      className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-2)] text-[12px] font-mono text-[var(--muted)] text-glow hover:border-[#7fd4f5] transition-colors"
    >
      <LogOut size={14} />
      Sign out
    </button>
  </div>
) : (
```
(The signed-out branch and everything else stays as-is.)

- [ ] **Step 2:** Add the flag to `.env.example` so the dormant switch is discoverable:

```
# Set to 'true' to require sign-in + admin approval to use the app (see
# supabase/auth-approved-lockdown.sql for the full flip checklist).
VITE_REQUIRE_AUTH=false
```

- [ ] **Step 3: Build + commit** — `npm run build` → 0; `git add -A && git commit -m "feat(auth): show signed-in email in Topbar"`

### Task 12: Local verification, PR, production flip

- [ ] **Step 1: Local gate test.** Temporarily set `VITE_REQUIRE_AUTH=true` in local `.env`, restart `npm run dev`, verify with Playwright:
  - Signed out → login screen (no sidebar/data behind it).
  - Sign in with an approved account → app loads; **Topbar shows the account email** next to Sign out.
  - Sign out from Topbar → back to login screen.
  - (If a pending test account exists: sign in with it → "Awaiting approval" card with email + working Sign out. If none exists, skip — the state is exercised in Step 4 verification.)
  - Revert local `.env` to `VITE_REQUIRE_AUTH=false` afterwards.
- [ ] **Step 2: `npm run test`** — existing vitest suites still pass (auth changes touch none of them, this is a regression check).
- [ ] **Step 3: PR**

```bash
git push -u origin feat/auth-gate-approved
gh pr create --base main --title "feat(auth): approved-only sign-in gate + signed-in email display" --body "AuthGate now requires session AND user_access approval when VITE_REQUIRE_AUTH=true; adds awaiting-approval screen, Topbar email display, and supabase/auth-approved-lockdown.sql (approved-only RLS on all five data tables). Flip checklist in the SQL header - env flag is turned on only after this deploys."
```
Merge after go-ahead.

- [ ] **Step 4: Production flip (manual, in order):**
  1. Confirm the merge deployed (Vercel Production shows the new commit).
  2. Supabase SQL Editor → run `supabase/auth-approved-lockdown.sql`.
  3. Vercel → Settings → Environment Variables → add `VITE_REQUIRE_AUTH = true` (Production) → redeploy.
  4. Verify:
     - Incognito visit → login screen, no data.
     - Anon REST probe returns no rows (401/empty `[]`):
       `curl "https://<project>.supabase.co/rest/v1/snapshots?select=id&limit=1" -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"`
     - Approved account signs in → full app, email in Topbar.
     - Fresh self-signup → "Awaiting approval" screen; approve it at `/admin/users` → sign out/in → app loads.
     - Portal SSO entry still lands signed-in and approved.

---

## Self-review notes (already applied)

- Spec coverage: §1→Task 1, §2→Task 2, §3→Tasks 3-8, §4→Tasks 9-10+12, §5→Task 11. Flip sequence preserved (SQL before env var; both after deploy).
- `user_access` policies untouched — `getUserAccess` (own-row read) keeps working for the pending screen; `is_approved()` is `security definer` so data-table policies don't depend on `user_access` RLS.
- `activity_log` table intentionally not in the lockdown list — `supabase/activity-log.sql` already installs approved-only read/insert policies for it (verified), so it's covered without touching it here.
