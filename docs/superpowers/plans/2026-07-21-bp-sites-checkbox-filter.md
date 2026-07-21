# BP Sites Checkbox Site Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the BP Sites page's three-mode (`all`/`bp`/`custom`) site filter with a single set of independently-toggleable checkboxes covering Main + every BP domain, so any combination can be shown at once.

**Architecture:** `BrandView` in `src/pages/BPSites.tsx` currently derives table column visibility from a `siteMode` enum plus a `customDomains` array. This plan collapses both into one `visibleDomains: string[]` state value (the set of currently-checked domain strings), with `showMain`/`visibleBpDomains` derived from membership in that set. The `SiteFilter` dropdown becomes a flat list of uniform checkboxes ("All" as a select-all shortcut, then Main, then each BP domain) instead of two radio-style rows plus indented sub-checkboxes.

**Tech Stack:** React + TypeScript, React Router (`useSearchParams`), Tailwind v4. No test framework is configured in this repo — verification is via `npm run build` (type-check) and manual browser testing.

## Global Constraints

- Only `src/pages/BPSites.tsx` changes — no other file in the repo is touched (per spec's "Files to Change" / "Out of Scope").
- Default state with no URL param stays **BP domains only, Main unchecked** (unchanged from today).
- Unchecking every site is allowed; no minimum-selection guard.
- `?site=` URL serialization: omit the param at the default set, write `all` at the full set, write `none` at the empty set, otherwise a comma-separated lowercase domain list.

---

### Task 1: Replace site-filter state, handlers, and dropdown UI

**Files:**
- Modify: `src/pages/BPSites.tsx:230-252` (state)
- Modify: `src/pages/BPSites.tsx:343-369` (handlers)
- Modify: `src/pages/BPSites.tsx:495-502` (JSX usage)
- Modify: `src/pages/BPSites.tsx:873-1013` (`SiteFilter` / `SiteOption` components)

**Interfaces:**
- Consumes: `mainDomain: string` (lowercase, already defined at `BPSites.tsx:215`), `bpDomains: string[]` (original-case, already defined at `BPSites.tsx:216-219`), `searchParams`/`setSearchParams` from `useSearchParams()` (already in scope), `domainFilter: string | undefined` (component prop, already in scope).
- Produces: `visibleDomains: string[]`, `showMain: boolean`, `visibleBpDomains: string[]` — consumed unchanged by `SnapshotMatrix` (props `showMain`, `bpDomains={visibleBpDomains}`) and by the filter-bar JSX (`brand.domains.length` summary text, `showMain` main-nav button) later in the same file. No changes needed at those call sites — they already read `showMain`/`visibleBpDomains` by name.

This is one cohesive task because the state shape, its handlers, and the `SiteFilter` component are mutually dependent — the file won't type-check with only part of the change applied.

- [ ] **Step 1: Replace the state block**

Find this in `src/pages/BPSites.tsx` (currently lines 230-252):

```tsx
  // Site filter — prefer ?site= query param, fall back to domainFilter path param
  const [siteMode, setSiteMode] = useState<'all' | 'bp' | 'custom'>(() => {
    const src = searchParams.get('site') ?? domainFilter
    if (!src || src === 'bp') return 'bp'
    if (src === 'all') return 'all'
    if (src.split(',').some((s) => bpDomains.some((d) => d.toLowerCase() === s.trim().toLowerCase()))) return 'custom'
    return 'bp'
  })
  const [customDomains, setCustomDomains] = useState<string[]>(() => {
    const src = searchParams.get('site') ?? domainFilter
    if (!src || src === 'all' || src === 'bp') return []
    const parts = src.split(',').map((s) => s.trim().toLowerCase())
    return bpDomains.filter((d) => parts.includes(d.toLowerCase()))
  })

  const showMain = siteMode === 'all'
  const visibleBpDomains = useMemo(() => {
    if (siteMode === 'all' || siteMode === 'bp') return bpDomains
    return bpDomains.filter((d) =>
      customDomains.some((cd) => cd.toLowerCase() === d.toLowerCase()),
    )
  }, [siteMode, customDomains, bpDomains])
```

Replace it with:

```tsx
  // Site filter — a set of checked domains (Main + any BP domains). Prefer the
  // ?site= query param, fall back to the :domainFilter path param used by
  // brand-grid domain links. 'all' = full set, 'none' = empty set, 'bp' =
  // legacy default (kept for old bookmarked URLs), a comma list = explicit
  // domains, missing = default (BP domains only, no Main).
  const [visibleDomains, setVisibleDomains] = useState<string[]>(() => {
    const bpLower = bpDomains.map((d) => d.toLowerCase())
    const src = searchParams.get('site') ?? domainFilter
    if (!src || src === 'bp') return bpLower
    if (src === 'all') return [mainDomain, ...bpLower]
    if (src === 'none') return []
    const parts = src.split(',').map((s) => s.trim().toLowerCase())
    const matched = [mainDomain, ...bpLower].filter((d) => parts.includes(d))
    return matched.length > 0 ? matched : bpLower
  })

  const showMain = visibleDomains.includes(mainDomain)
  const visibleBpDomains = useMemo(
    () => bpDomains.filter((d) => visibleDomains.includes(d.toLowerCase())),
    [visibleDomains, bpDomains],
  )
```

- [ ] **Step 2: Replace the handlers block**

Find this in `src/pages/BPSites.tsx` (currently lines 343-369):

```tsx
  const handleSiteAll = () => {
    setSiteMode('all')
    setCustomDomains([])
    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.set('site', 'all'); return p }, { replace: true })
  }
  const handleSiteBP = () => {
    setSiteMode('bp')
    setCustomDomains([])
    setSearchParams((prev) => { const p = new URLSearchParams(prev); p.delete('site'); return p }, { replace: true })
  }
  const handleToggleDomain = (domain: string) => {
    setCustomDomains((prev) => {
      const already = prev.some((d) => d.toLowerCase() === domain.toLowerCase())
      const next = already
        ? prev.filter((d) => d.toLowerCase() !== domain.toLowerCase())
        : [...prev, domain]
      const newMode = next.length === 0 ? 'bp' : 'custom'
      setSiteMode(newMode)
      setSearchParams((sp) => {
        const p = new URLSearchParams(sp)
        if (next.length === 0) p.delete('site')
        else p.set('site', next.join(','))
        return p
      }, { replace: true })
      return next
    })
  }
```

Replace it with:

```tsx
  const serializeVisibleDomains = (domains: string[]): string | null => {
    const bpLower = bpDomains.map((d) => d.toLowerCase())
    const fullSet = [mainDomain, ...bpLower]
    if (domains.length === fullSet.length && fullSet.every((d) => domains.includes(d))) return 'all'
    if (domains.length === bpLower.length && bpLower.every((d) => domains.includes(d)) && !domains.includes(mainDomain)) return null
    if (domains.length === 0) return 'none'
    return domains.join(',')
  }
  const updateVisibleDomains = (next: string[]) => {
    setVisibleDomains(next)
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      const serialized = serializeVisibleDomains(next)
      if (serialized === null) p.delete('site')
      else p.set('site', serialized)
      return p
    }, { replace: true })
  }
  const handleSelectAll = () => {
    updateVisibleDomains([mainDomain, ...bpDomains.map((d) => d.toLowerCase())])
  }
  const handleToggleDomain = (domain: string) => {
    const dl = domain.toLowerCase()
    const already = visibleDomains.includes(dl)
    updateVisibleDomains(already ? visibleDomains.filter((d) => d !== dl) : [...visibleDomains, dl])
  }
```

- [ ] **Step 3: Update the `SiteFilter` JSX usage**

Find this in `src/pages/BPSites.tsx` (currently lines 495-502):

```tsx
            <SiteFilter
              siteMode={siteMode}
              customDomains={customDomains}
              bpDomains={bpDomains}
              onSelectAll={handleSiteAll}
              onSelectBP={handleSiteBP}
              onToggleDomain={handleToggleDomain}
            />
```

Replace it with:

```tsx
            <SiteFilter
              visibleDomains={visibleDomains}
              mainDomain={mainDomain}
              bpDomains={bpDomains}
              onSelectAll={handleSelectAll}
              onToggleDomain={handleToggleDomain}
            />
```

- [ ] **Step 4: Replace the `SiteFilter` and `SiteOption` components**

Find this in `src/pages/BPSites.tsx` (currently lines 873-1013, the full `SiteFilter` + `SiteOption` block from the `// ─── SiteFilter ───` comment through the end of `SiteOption`):

```tsx
// ─── SiteFilter — custom dropdown with multi-select for individual BP domains ──

function SiteFilter({
  siteMode,
  customDomains,
  bpDomains,
  onSelectAll,
  onSelectBP,
  onToggleDomain,
}: {
  siteMode: 'all' | 'bp' | 'custom'
  customDomains: string[]
  bpDomains: string[]
  onSelectAll: () => void
  onSelectBP: () => void
  onToggleDomain: (domain: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label =
    siteMode === 'all'
      ? `All · ${bpDomains.length + 1} sites`
      : siteMode === 'bp'
        ? `BP Sites · ${bpDomains.length}`
        : customDomains.length === 1
          ? customDomains[0]
          : `${customDomains.length} sites`

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 bg-white border rounded-md pl-2.5 pr-2 py-1.5 text-[12px] text-[#0F172A] cursor-pointer transition-colors ${
          open ? 'border-[#0F172A]' : 'border-[#CBD5E1] hover:border-[#0F172A]'
        }`}
      >
        <span className="font-medium flex-1 min-w-0 truncate">{label}</span>
        <ChevronDown
          size={13}
          strokeWidth={2.25}
          className={`text-[#64748B] shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 bg-white border border-[#E2E8F0] rounded-md shadow-[0_12px_32px_rgba(15,23,42,0.12)] overflow-hidden z-20 min-w-[210px] animate-[modalIn_0.12s_ease]">
          {/* All */}
          <SiteOption
            label="All"
            selected={siteMode === 'all'}
            onClick={() => { onSelectAll(); setOpen(false) }}
          />
          <div className="border-t border-[#E2E8F0]" />
          {/* BP Sites */}
          <SiteOption
            label="BP Sites"
            selected={siteMode === 'bp'}
            onClick={() => { onSelectBP(); setOpen(false) }}
          />
          {/* Individual BP domains — checkbox multi-select, stays open */}
          {bpDomains.length > 0 && (
            <>
              <div className="border-t border-[#E2E8F0]" />
              {bpDomains.map((d) => {
                const checked = customDomains.some((cd) => cd.toLowerCase() === d.toLowerCase())
                return (
                  <SiteOption
                    key={d}
                    label={d}
                    selected={checked}
                    multiSelect
                    onClick={() => onToggleDomain(d)}
                    indent
                  />
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SiteOption({
  label,
  selected,
  onClick,
  indent = false,
  multiSelect = false,
}: {
  label: string
  selected: boolean
  onClick: () => void
  indent?: boolean
  multiSelect?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between text-[12px] text-left transition-colors ${
        indent ? 'px-5' : 'px-3'
      } py-2 ${
        multiSelect
          ? selected
            ? 'bg-[#F0F9FF] text-[#0F172A]'
            : 'text-[#0F172A] hover:bg-[#F1F5F9]'
          : selected
            ? 'bg-[#0F172A] text-white'
            : 'text-[#0F172A] hover:bg-[#F1F5F9]'
      }`}
    >
      <span className="font-medium truncate mr-2">{label}</span>
      {multiSelect ? (
        <div
          className={`w-[13px] h-[13px] shrink-0 rounded-[3px] border flex items-center justify-center ${
            selected ? 'bg-[#0F172A] border-[#0F172A]' : 'border-[#CBD5E1] bg-white'
          }`}
        >
          {selected && <Check size={9} strokeWidth={3} className="text-white" />}
        </div>
      ) : (
        selected && <Check size={13} strokeWidth={2.5} className="shrink-0" />
      )}
    </button>
  )
}
```

Replace it with:

```tsx
// ─── SiteFilter — flat checkbox list: All shortcut + Main + each BP domain ────

function SiteFilter({
  visibleDomains,
  mainDomain,
  bpDomains,
  onSelectAll,
  onToggleDomain,
}: {
  visibleDomains: string[]
  mainDomain: string
  bpDomains: string[]
  onSelectAll: () => void
  onToggleDomain: (domain: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const totalCount = bpDomains.length + 1
  const isFull = visibleDomains.length === totalCount

  const label = isFull
    ? `All · ${totalCount} sites`
    : visibleDomains.length === 1
      ? visibleDomains[0]
      : visibleDomains.length === 0
        ? '0 sites'
        : `${visibleDomains.length} sites`

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 bg-white border rounded-md pl-2.5 pr-2 py-1.5 text-[12px] text-[#0F172A] cursor-pointer transition-colors ${
          open ? 'border-[#0F172A]' : 'border-[#CBD5E1] hover:border-[#0F172A]'
        }`}
      >
        <span className="font-medium flex-1 min-w-0 truncate">{label}</span>
        <ChevronDown
          size={13}
          strokeWidth={2.25}
          className={`text-[#64748B] shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 bg-white border border-[#E2E8F0] rounded-md shadow-[0_12px_32px_rgba(15,23,42,0.12)] overflow-hidden z-20 min-w-[210px] animate-[modalIn_0.12s_ease]">
          {/* All — select-all shortcut, checked when every site is visible */}
          <SiteOption label="All" selected={isFull} onClick={onSelectAll} />
          <div className="border-t border-[#E2E8F0]" />
          {/* Main + each BP domain — independent checkbox toggles */}
          <SiteOption
            label={mainDomain}
            selected={visibleDomains.includes(mainDomain)}
            onClick={() => onToggleDomain(mainDomain)}
          />
          {bpDomains.map((d) => (
            <SiteOption
              key={d}
              label={d}
              selected={visibleDomains.includes(d.toLowerCase())}
              onClick={() => onToggleDomain(d)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SiteOption({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2 text-[12px] text-left transition-colors ${
        selected ? 'bg-[#F0F9FF] text-[#0F172A]' : 'text-[#0F172A] hover:bg-[#F1F5F9]'
      }`}
    >
      <span className="font-medium truncate mr-2">{label}</span>
      <div
        className={`w-[13px] h-[13px] shrink-0 rounded-[3px] border flex items-center justify-center ${
          selected ? 'bg-[#0F172A] border-[#0F172A]' : 'border-[#CBD5E1] bg-white'
        }`}
      >
        {selected && <Check size={9} strokeWidth={3} className="text-white" />}
      </div>
    </button>
  )
}
```

Note: clicking "All" or an individual checkbox no longer closes the dropdown (`setOpen(false)` removed from `onSelectAll`/`onToggleDomain` calls) — every row is now an independent checkbox, so the dropdown stays open until the user clicks outside or presses Escape, letting them flip several boxes in one visit.

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: exits 0, no TypeScript errors (this also catches any leftover reference to `siteMode`, `customDomains`, `handleSiteAll`, `handleSiteBP`, or the removed `multiSelect`/`indent` `SiteOption` props).

- [ ] **Step 6: Commit**

```bash
git add src/pages/BPSites.tsx
git commit -m "feat: unify BP Sites site filter into independent Main/BP checkboxes"
```

---

### Task 2: Manual verification in the browser

**Files:** none (verification only — no code changes)

**Interfaces:**
- Consumes: the running dev server (`npm run dev`, default `http://localhost:5173`) and a brand that has BP Sites data (e.g. Lucky 7even, per the screenshot in the original request).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background)
Expected: Vite prints `Local: http://localhost:5173/`

- [ ] **Step 2: Open a BP Sites brand page and check the default state**

Navigate to `http://localhost:5173/bp-sites/lucky-7even` (or the correct slug per `brandToSlug` for a brand with BP data).
Expected: dropdown label reads `N sites` (BP-only default), Main column is absent, all BP domain column groups are present, top-right quick-nav shows `BP1..BPn` but no `MAIN` button.

- [ ] **Step 3: Click "All"**

Open the Sites dropdown, click "All".
Expected: dropdown label becomes `All · N sites`, a `MAIN` column group appears alongside all BP groups, top-right quick-nav now includes a `MAIN` button.

- [ ] **Step 4: Uncheck one BP domain while "All" is active**

With the dropdown still open, click one BP domain's checkbox to uncheck it.
Expected: that domain's checkbox unchecks, its column group disappears from the table, Main and the other BP domains remain visible, "All"'s own checkbox is no longer shown as checked, and the closed-dropdown label updates to `N sites` (N = remaining checked count).

- [ ] **Step 5: Uncheck Main**

Click Main's checkbox to uncheck it, leaving only BP domains checked.
Expected: Main's column group disappears; this should now match the same set as Task 2 Step 2's default (label reads `N sites` again if a BP domain from Step 4 is still unchecked, or matches the BP-only default if you re-check it first).

- [ ] **Step 6: Uncheck everything**

Uncheck every remaining checkbox (Main + all BP domains).
Expected: the table renders with no domain column groups (keyword column only), dropdown label reads `0 sites`, no console errors.

- [ ] **Step 7: Verify URL persistence across reload**

With a partial selection active (e.g. Main + 2 of 4 BP domains checked), copy the current URL, then reload the page.
Expected: the same partial selection is restored after reload — check the `?site=` query param is present with the expected domain list, and the same columns reappear.

- [ ] **Step 8: Verify the "All" URL shorthand**

Click "All", then check the URL.
Expected: `?site=all` (not a full comma-separated domain list).

- [ ] **Step 9: Verify single-domain navigation from the brand grid still works**

Go back to `/bp-sites`, click one of a brand's BP domain pills directly (not the brand card itself).
Expected: navigates straight into that brand's view with only that one BP domain checked (Main unchecked, other BP domains unchecked) — matching today's existing single-domain-link behavior.

- [ ] **Step 10: Stop the dev server**

Stop the background `npm run dev` process.
