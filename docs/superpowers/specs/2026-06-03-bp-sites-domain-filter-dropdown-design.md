# BP Sites — Domain Filter Dropdown & Per-Domain URL Routing

**Date:** 2026-06-03  
**Status:** Approved

## Summary

Replace the pill-button site filter on the BP Sites brand view with a hierarchical dropdown. Each selection updates the URL slug so individual domain views are directly linkable.

---

## 1. Routing

Two new route patterns are added to `App.tsx` alongside the existing two:

```
/bp-sites                              → BrandGrid (all brands)
/bp-sites/:brandSlug                   → BrandView — All (main + all BP)  [unchanged]
/bp-sites/:brandSlug/main              → BrandView — Main only             [new]
/bp-sites/:brandSlug/bp                → BrandView — BP Sites only         [new]
/bp-sites/:brandSlug/:domainFilter     → BrandView — single domain         [new]
```

All routes render the same `BPSites` component. `BrandView` reads the `:domainFilter` param (via `useParams`) to derive column visibility — no local state for domain selection.

**Route order:** The named routes (`/main`, `/bp`) must be declared before the wildcard `/:domainFilter` route to avoid shadowing.

---

## 2. Column Visibility Logic

`BrandView` derives `showMain` and `visibleBpDomains` from `domainFilter`:

| `domainFilter` value | Main column | BP columns |
|---|---|---|
| `undefined` (no segment) | shown | all shown |
| `"main"` | shown | all hidden |
| `"bp"` | hidden | all shown |
| a domain string (e.g. `"lucky7evencasino.com"`) | hidden | only that domain |

The existing `showMain` boolean state and `activeBpDomains` array state in `BrandView` are removed. All column visibility is derived from the URL param.

**Invalid `domainFilter`:** If the param is set but doesn't match `"main"`, `"bp"`, or any of the brand's domains, fall back to "All" (same behaviour as no param).

---

## 3. Dropdown UI

The pill button row (`SITES` label + pill buttons) is replaced with a `<select>`-based or custom dropdown control.

**Dropdown option list structure:**

```
All — main + all BP sites           → navigates to /bp-sites/:brandSlug
Main — <mainDomain>                 → navigates to /bp-sites/:brandSlug/main
BP Sites — all <n> domains          → navigates to /bp-sites/:brandSlug/bp
── Individual ──
<bpDomain1>                         → navigates to /bp-sites/:brandSlug/<bpDomain1>
<bpDomain2>                         → ...
...
```

The dropdown's selected value reflects the current URL: reading `domainFilter` from `useParams` and mapping it back to the matching option.

**Selected value display:**
- All → `"All — <mainDomain> + <n> BP"`
- Main → `"Main — <mainDomain>"`
- BP Sites → `"BP Sites — all <n> domains"`
- Individual domain → `"<domainName>"`

Selecting an option calls `navigate()` with the appropriate path — no extra state needed.

---

## 4. Sidebar Compatibility

The sidebar reads `location.pathname` and calls `startsWith('/bp-sites/')` + slices to extract the brand slug. Because the new `:domainFilter` segment sits after the brand slug, the sidebar's brand-active detection is unaffected and requires no changes.

---

## 5. Files to Change

| File | Change |
|---|---|
| `src/App.tsx` | Add 3 new `<Route>` entries for `/main`, `/bp`, `/:domainFilter` |
| `src/pages/BPSites.tsx` | Read `domainFilter` from `useParams`; remove `showMain`/`activeBpDomains` state; replace pill row with dropdown; derive column visibility from param |

No other files need changes.

---

## 6. Out of Scope

- LP Sites page — unchanged
- Country filter pills — unchanged
- Keyword search — unchanged
- Multi-select domain views (selecting more than one BP domain simultaneously)
