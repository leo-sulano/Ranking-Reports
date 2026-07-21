# BP Sites — Unified Checkbox Site Filter

**Date:** 2026-07-21
**Status:** Approved

## Summary

Replace the `SiteFilter`'s three-mode selection (`all` / `bp` / `custom`) with a single set of checked domains. Every site — Main and each BP domain — becomes a uniform checkbox that can be toggled independently, so any combination (including Main + a subset of BP sites) can be shown at once. The separate "BP Sites" radio option is removed.

## Problem

Today `SiteFilter` (`src/pages/BPSites.tsx`) has three modes:

- **All** — Main + all BP domains, no way to hide individual ones
- **BP Sites** — all BP domains, no Main, no way to hide individual ones
- **Custom** — clicking any individual BP-domain checkbox jumps to showing *only* that domain (not "current set minus this one")

There is no way to view Main together with a hand-picked subset of BP domains, and unchecking a domain doesn't behave like a deselect — it resets the view to a single-domain custom set.

## Design

### State model

Replace:
```ts
const [siteMode, setSiteMode] = useState<'all' | 'bp' | 'custom'>(...)
const [customDomains, setCustomDomains] = useState<string[]>(...)
```

with:
```ts
const [visibleDomains, setVisibleDomains] = useState<string[]>(...)  // lowercase domain strings
```

`visibleDomains` is always a subset of `[mainDomain, ...bpDomains]`.

**Derived values** (replace `showMain` / `visibleBpDomains`):
```ts
const showMain = visibleDomains.includes(mainDomain)
const visibleBpDomains = bpDomains.filter((d) => visibleDomains.includes(d.toLowerCase()))
```

### Behavior

- **"All" row** — sets `visibleDomains` to every domain (Main + all BP). Highlighted/checked when the current set already equals the full set.
- **Main row / each BP domain row** — plain checkbox toggle: adds the domain to `visibleDomains` if absent, removes it if present. No mode switching, no reset of other selections.
- **Unchecking everything is allowed.** The table renders with no domain column groups. No minimum-selection guard.

### Dropdown UI (`SiteFilter`)

One flat list, all rows using the same checkbox styling (the style already used for BP-domain rows today):

```
All                                  (checked when full set selected)
──────────────
Main — <mainDomain>                  [checkbox]
<bpDomain1>                          [checkbox]
<bpDomain2>                          [checkbox]
...
```

The current two-tier layout (radio-style "All"/"BP Sites" rows, then indented BP checkboxes) is replaced by this flat list. `SiteOption`'s `multiSelect` checkbox rendering becomes the only row style used (the non-multiSelect / highlighted-bar rendering path for "All" is dropped in favor of the same checkbox treatment, with "All" simply reflecting whether the full set is checked).

### Label (closed dropdown button)

Unchanged logic, now driven by set size instead of mode:

- Full set checked → `All · N sites`
- Exactly one domain checked → that domain's name
- Otherwise → `N sites`
- Zero checked → `0 sites`

### URL persistence (`?site=`)

- Serialize `visibleDomains` as a comma-separated list of domains.
- **Default omission:** when `visibleDomains` equals the default (all BP domains, no Main), omit the `site` param entirely — preserves today's clean default URLs.
- **Full-set shorthand:** when `visibleDomains` equals the full set, write `site=all` (shorter, matches existing convention) instead of listing every domain.
- Otherwise write the explicit comma-separated domain list.
- Restoring on load: read `?site=` (falling back to the `:domainFilter` path param used by brand-grid domain links) —
  - missing → default (all BP domains, no Main)
  - `all` → full set
  - comma list → intersect with `[mainDomain, ...bpDomains]`, case-insensitive

### Default state

On a fresh visit with no `?site=` param and no `:domainFilter` path segment: **BP domains only, Main unchecked** — unchanged from today's default.

## Files to Change

| File | Change |
|---|---|
| `src/pages/BPSites.tsx` | Replace `siteMode`/`customDomains` state (lines ~230–252) and handlers (`handleSiteAll`, `handleSiteBP`, `handleToggleDomain`, lines ~343–369) with `visibleDomains` + a single toggle handler + a select-all handler. Rewrite `SiteFilter`/`SiteOption` (lines ~873–1013) to render the flat checkbox list. |

No other files change — `SnapshotMatrix` and the rest of `BrandView` already consume `showMain` / `bpDomains` (renamed from `visibleBpDomains`) as plain props and don't care how they're derived.

## Out of Scope

- LP Sites / other pages — unchanged
- Country filter pills, keyword search — unchanged
- Any change to `BrandGrid`'s per-domain navigation links (still seed a single-domain view via the `:domainFilter` path param)
