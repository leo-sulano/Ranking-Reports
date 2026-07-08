# How It Works Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static "How It Works" help page that walks users through the core dashboard flow (upload → pick a brand → read the table → filter → track over time), reachable from a new sidebar nav entry.

**Architecture:** A new standalone page component (`src/pages/HowItWorks.tsx`) rendering a heading and five step cards, wired into the existing React Router config in `src/App.tsx`, with a matching entry added to the `PAGES` array in `src/components/Sidebar.tsx`. No new state, no data fetching, no shared layout component beyond what `Layout` already provides via `Outlet`.

**Tech Stack:** React + TypeScript + Tailwind v4 (utility classes only, no CSS files touched), `lucide-react` for the nav icon.

## Global Constraints

- No test suite is configured in this project (see root `CLAUDE.md`) — verification is via `npm run build` (runs `tsc -b && vite build`, i.e. a full type-check) plus manual verification in the browser via `npm run dev`, per this project's standard practice for UI changes.
- Visual style must match the app's actual **light** theme, not the stale "dark theme" description in `CLAUDE.md`: background `#F7F7F5`, white cards, borders `#E5E4DF`, text `#0A0A0A` (primary) / `#6B6B65` (secondary) / `#ABABAA` (muted), red accent `#CC0000`, headings in `font-display` (Outfit).
- No screenshots/GIFs, no "Upload Data" CTA button on the page, no FAQ/expandable format — a plain step list only, per the approved spec at `docs/superpowers/specs/2026-07-08-how-it-works-page-design.md`.
- The new sidebar entry goes near the bottom of the `PAGES` array (after "Ask AI"), not the top.

---

### Task 1: Create the HowItWorks page and wire the route

**Files:**
- Create: `src/pages/HowItWorks.tsx`
- Modify: `src/App.tsx:27` (imports), `src/App.tsx:304-308` (`SECTION_TITLES`), `src/App.tsx:426-427` (routes)

**Interfaces:**
- Produces: `HowItWorks` — a zero-props React function component, default page body for route `/how-it-works`.

- [ ] **Step 1: Create the page component**

Create `src/pages/HowItWorks.tsx`:

```tsx
const STEPS: Array<{ title: string; desc: string }> = [
  {
    title: 'Upload your data',
    desc: 'Click "Import Data," pick a category, and drop in your ranking export (.xlsx/.xls/.csv).',
  },
  {
    title: 'Pick a brand',
    desc: 'Select a brand from the sidebar to see its full ranking table; until then, the Home page shows an overview of all brands.',
  },
  {
    title: 'Read the table',
    desc: 'Each row is a keyword: current position, day-over-day change (▲/▼), and "NR" when it isn\'t ranking.',
  },
  {
    title: 'Filter what you see',
    desc: 'Narrow the table by country, domain, or keyword using the filters above it.',
  },
  {
    title: 'Track over time',
    desc: 'Upload new reports as they come in; each becomes a dated snapshot so you can compare rankings across dates.',
  },
]

export function HowItWorks() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto px-7 py-10">
      <div className="max-w-2xl mx-auto w-full">
        <h1 className="font-display text-[28px] tracking-wider text-[#0A0A0A] mb-2">
          How It Works
        </h1>
        <p className="text-[14px] text-[#6B6B65] mb-8 leading-relaxed">
          A quick guide to using the dashboard, from uploading your first report to reading the results.
        </p>

        <div className="flex flex-col gap-4">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="flex gap-4 items-start bg-white border border-[#E5E4DF] rounded-[14px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]"
            >
              <div className="w-8 h-8 shrink-0 rounded-full bg-[#0A0A0A] text-white font-display text-[13px] flex items-center justify-center">
                {i + 1}
              </div>
              <div>
                <h2 className="font-display text-[15px] tracking-wide text-[#0A0A0A] mb-1">
                  {step.title}
                </h2>
                <p className="text-[13px] text-[#6B6B65] leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the import and route in App.tsx**

In `src/App.tsx`, add the import after the existing `AskAI` import (currently line 27):

```tsx
import { AskAI }        from './pages/AskAI'
import { HowItWorks }   from './pages/HowItWorks'
```

Add a `SECTION_TITLES` entry (the object currently at lines 304-308):

```tsx
  const SECTION_TITLES: Record<string, [string, string]> = {
    '/bp-sites':      ['BP Sites', 'Brand website ranking report'],
    '/lp-sites':      ['LP Sites', 'Landing page ranking report'],
    '/ftds':          ['FTDs', 'First-time depositors'],
    '/how-it-works':  ['How It Works', 'A quick guide to using the dashboard'],
  }
```

Add the route after the existing `/ftds` and `/ask-ai` routes (currently lines 426-427):

```tsx
          <Route path="/ftds"             element={<FTDs />} />
          <Route path="/ask-ai"           element={<AskAI />} />
          <Route path="/how-it-works"     element={<HowItWorks />} />
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: Completes with exit code 0, no TypeScript errors referencing `HowItWorks.tsx` or `App.tsx`.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`, then open `http://localhost:5173/how-it-works` directly in the browser.

Expected:
- Topbar shows "How It Works" / "A quick guide to using the dashboard".
- Page body shows the "How It Works" heading, the subtitle, and 5 numbered step cards in the order: Upload your data, Pick a brand, Read the table, Filter what you see, Track over time.
- No console errors.

Stop the dev server once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/pages/HowItWorks.tsx src/App.tsx
git commit -m "feat: add How It Works help page"
```

---

### Task 2: Add the sidebar nav entry

**Files:**
- Modify: `src/components/Sidebar.tsx:4` (imports), `src/components/Sidebar.tsx:26-29` (`PAGES` array)

**Interfaces:**
- Consumes: route `/how-it-works` from Task 1 (must exist for the nav entry to navigate to a valid page).

- [ ] **Step 1: Import the icon**

In `src/components/Sidebar.tsx`, add the `lucide-react` import after the existing `AiIcon` import (currently line 4):

```tsx
import { AiIcon } from './Assistant/AiIcon'
import { CircleHelp } from 'lucide-react'
```

- [ ] **Step 2: Add the PAGES entry**

In the `PAGES` array, add a new entry after the `/ask-ai` entry (currently lines 26-28, just before the closing `]`):

```tsx
  { path: '/ask-ai', label: 'Ask AI', icon: (
    <AiIcon size={18} />
  )},
  { path: '/how-it-works', label: 'How It Works', icon: (
    <CircleHelp size={18} />
  )},
]
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: Completes with exit code 0, no TypeScript errors referencing `Sidebar.tsx`.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`, then open `http://localhost:5173/`.

Expected:
- Hovering the collapsed sidebar expands it and reveals a "How It Works" label below "Ask AI", with a question-mark-circle icon.
- Clicking it navigates to `/how-it-works` and the page from Task 1 renders.
- The clicked entry shows the active state: red left border, `#FFF5F5` background, `#CC0000` icon color, `#0A0A0A` label color — matching the active-state styling already used by the other nav entries (e.g. Home, BP Sites).
- Navigating away and back re-applies/removes the active state correctly.

Stop the dev server once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add How It Works entry to sidebar nav"
```

---

## Out of Scope

(carried over from the design spec)
- Screenshots, GIFs, or embedded media
- FAQ/expandable Q&A format
- Coverage of BP Sites, LP Sites, FTDs, or Ask AI as individual steps
- "Upload Data" CTA button on the page
- Placement at the top of the sidebar
