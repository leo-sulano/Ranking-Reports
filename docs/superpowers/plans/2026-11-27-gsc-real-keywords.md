# Real keywords (Google Search Console) tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Real keywords (Google)" tab to each BP Sites brand page. It reads a site's Search Console searches live through one admin-connected Google account, with a 6-hour cache.

**Architecture:** Plain server helpers in `api/_lib/gsc.ts` (Google calls, signing, encryption) and `api/_lib/gscStore.ts` (Supabase rows) back five Vercel functions:
- `gsc-connect`
- `gsc-callback`
- `gsc-disconnect`
- `gsc-status`
- `gsc-keywords`

The SPA gets a tab component on the brand page and a connection panel on the admin Users page. The tab's logic sits in plain functions so the node-only test suite covers it.

**Tech Stack:** Vite + React 19 + React Router SPA, Vercel Node functions (ESM, `.js` import extensions), Supabase (service-role client on the server), Google OAuth 2.0 and Search Console API v3 (`fetch`, no Google SDK), Node `crypto`, vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-11-27-gsc-real-keywords-design.md`. Its "Builder check: the answers" section binds this plan.

## Global Constraints

- **Repo and branch:** the Ranking-Reports main checkout, branch `feat/gsc-real-keywords`. Never stage or commit `supabase/.temp/cli-latest`, which is the user's change. `git add` only the files a task names.
- **Gate:** `npm test` (vitest), `npm run build` (`tsc -b && vite build`), and `npx tsc -p api --noEmit` if an `api` tsconfig exists, otherwise `npm run build` covers it. Before the PR, `npx vercel build` must also pass: every relative server import ends in `.js`.
- **Google calls:**
  - only through an injected `fetch` (`typeof fetch`), so tests stub them;
  - no test, script or check calls Google or Supabase for real;
  - no Google SDK dependency.
- **Scope:** `openid email https://www.googleapis.com/auth/webmasters.readonly`. Consent URL params: `access_type=offline`, `prompt=consent`, `response_type=code`, `include_granted_scopes=true`.
- **Redirect URI:** `${APP_URL}/api/gsc-callback`.
- **Env vars:**
  - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`;
  - `GSC_STATE_SECRET` (any string ≥ 32 chars);
  - `GSC_TOKEN_KEY` (base64 of exactly 32 bytes);
  - plus the existing `APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.

  A missing one is a 500 with an operator-worded message that names the variable and never its value.
- **Security:**
  - the refresh token never leaves the server;
  - it is stored only encrypted (AES-256-GCM, `GSC_TOKEN_KEY`);
  - the password is never handled;
  - every endpoint except `gsc-callback` requires the caller's bearer token and `isApprovedUser`;
  - `gsc-connect`, `gsc-disconnect` and the admin part of `gsc-status` also require `user_access.is_admin`.
- **Domains:** `gsc-keywords` accepts only a key of `DOMAIN_TO_BRAND`, and `days` only 7, 28 or 90.
- **Search Console:**
  - one `searchanalytics.query` page, `rowLimit: 25000`, `dimensions: ["query","country"]`;
  - `truncated` is true when exactly 25,000 rows come back;
  - position is rounded to 1 decimal;
  - country is alpha-2 upper case (unknown → `ZZ`).
- **Cache:** 6 hours per (domain, days). The `sites.list` cache is the row (`'*'`, `0`), 1 hour. Connect and Disconnect clear every cache row.
- **Copy, exact:**
  - tab labels "Rankings (Ahrefs)" and "Real keywords (Google)";
  - button "Connect Google Search Console";
  - header "Avg position" with the tooltip "Google's average position over the period, weighted by how often the site was shown. It is not a single check like the Rankings tab.";
  - "Google data up to <date>";
  - "Page 1 only".
- **URL:** `?view=google`, `?gsite=<domain>`, `?days=7|28|90`. Switching tabs only adds or removes `view` and keeps the path and every other parameter.
- **Who can do what:** Connect and Disconnect are admin-only. The tab is for every approved user who can see the brand page. Only BP Sites gets the tab; LP Sites doesn't.

## Review Focus

1. **A non-admin approved user calling `gsc-connect`, `gsc-disconnect` or `gsc-status?admin`** must get 403 with no Google call and no state. Test in Task 3.
2. **A callback with a tampered state, an expired state, a nonce that doesn't match the cookie, a replayed nonce, or a state for a user who is no longer admin** must store nothing and redirect with `?gsc=error&reason=…`. Test in Task 3.
3. **A Google `invalid_grant` while reading**, after a password change or removed access, must mark the connection broken and answer `code: "reconnect"`. The tab then says "the Google connection stopped working" and shows Connect to admins. Tests in Tasks 1, 3 and 5.
4. **A site with both `www` and non-`www` URL-prefix properties and no domain property** must get merged rows: clicks and impressions summed, position weighted by impressions. A site with a domain property must not also query its URL-prefix ones. Test in Task 1.
5. **Not touching the Rankings tab.** Opening the brand page without `?view=google` must make no `gsc-*` request, and the Rankings tab must render exactly as before, its URL parameters included. This is checked in Task 6's browser run and pinned by a test of the URL helper in Task 4.

---

### Task 1: Search Console and OAuth helpers (`api/_lib/gsc.ts`)

**Files:**
- Create: `api/_lib/gsc.ts`, `api/_lib/gsc.test.ts`, `api/_lib/countryCodes.ts` (alpha-3 → alpha-2 map, full ISO list).

**Interfaces (Produces):**
```ts
export type GscConfig = { clientId: string; clientSecret: string; redirectUri: string }
export class GscReconnectError extends Error {}           // Google said invalid_grant
export class GscUpstreamError extends Error { constructor(message: string, readonly status?: number) }
export type StatePayload = { userId: string; nonce: string; exp: number }   // exp = epoch ms
export function gscConfig(env: Record<string, string | undefined>): GscConfig      // throws naming the missing var
export function signState(secret: string, p: StatePayload): string                 // base64url(json).base64url(hmac-sha256)
export function verifyState(secret: string, state: string, now: number): StatePayload | null  // null on bad sig, bad json, expired
export function consentUrl(cfg: GscConfig, state: string): string
export function encryptToken(keyB64: string, plain: string): string               // "v1.<iv>.<tag>.<ciphertext>" base64url parts
export function decryptToken(keyB64: string, blob: string): string                // throws on tamper/wrong key
export async function exchangeCode(f: typeof fetch, cfg: GscConfig, code: string): Promise<{ refreshToken: string; email: string | null }>
export async function accessToken(f: typeof fetch, cfg: GscConfig, refreshToken: string): Promise<string>  // GscReconnectError on invalid_grant
export async function revokeToken(f: typeof fetch, token: string): Promise<void>  // never throws
export type GscSite = { siteUrl: string; permissionLevel: string }
export async function listSites(f: typeof fetch, token: string): Promise<GscSite[]>
export function matchProperties(domain: string, sites: GscSite[]): string[]       // [] | ['sc-domain:x'] | url-prefix list
export async function latestDataDate(f: typeof fetch, token: string, property: string, today: Date): Promise<string | null>  // 'YYYY-MM-DD' or null
export type GscRow = { query: string; country: string; position: number; clicks: number; impressions: number }
export async function queryRows(f: typeof fetch, token: string, property: string, start: string, end: string): Promise<{ rows: GscRow[]; truncated: boolean }>
export function mergeRows(parts: GscRow[][]): GscRow[]                              // per (query,country): sum, impression-weighted position
```
- Google endpoints:
  - consent: `https://accounts.google.com/o/oauth2/v2/auth`;
  - token: `https://oauth2.googleapis.com/token`;
  - revoke: `https://oauth2.googleapis.com/revoke`;
  - sites: `https://www.googleapis.com/webmasters/v3/sites`;
  - query: `https://www.googleapis.com/webmasters/v3/sites/{encodeURIComponent(property)}/searchAnalytics/query`.
- `exchangeCode` reads `email` from the `id_token` payload (base64url JSON, middle segment) without verifying its signature. It came straight from Google's token endpoint over TLS.
- `queryRows` maps `keys[0]` to `query` and `keys[1]` to `country`. Country goes through `countryCodes.ts` to alpha-2, or `ZZ`. Position is rounded to 1 decimal.
- `latestDataDate` queries `dimensions:["date"]` from `today-7` to `today-1` and returns the max `keys[0]`.

- [ ] **Step 1: Write the failing tests** in `api/_lib/gsc.test.ts`, with a stub `fetch` that records requests and returns canned JSON:
  - `signState` then `verifyState` round-trips. A changed character gives `null`, `exp < now` gives `null`, and a different secret gives `null`.
  - `consentUrl` contains every param in Global Constraints, the redirect URI, and the exact scope string (URL-decoded).
  - `encryptToken` then `decryptToken` round-trips. Flipping a byte of the ciphertext or tag throws. A different key throws. Two encryptions of the same text differ (random IV).
  - `exchangeCode` posts `grant_type=authorization_code`, `code`, `client_id`, `client_secret` and `redirect_uri`. It returns `refreshToken` and the email from a fixture `id_token`. A response without `refresh_token` throws `GscUpstreamError`.
  - `accessToken` posts `grant_type=refresh_token`. A 400 `{error:"invalid_grant"}` throws `GscReconnectError`, and another 400 or 500 throws `GscUpstreamError`.
  - `matchProperties`:
    - `www.x.com` with sites `[sc-domain:x.com, https://x.com/]` gives `['sc-domain:x.com']`.
    - `x.com` with only `https://x.com/` and `https://www.x.com/` gives both.
    - `x.com` with `sc-domain:y.com` gives `[]`.
    - The `siteUnverifiedUser` permission level is ignored.
  - `queryRows`:
    - maps `aus` to `AU` and `xkx`/unknown to `ZZ`;
    - rounds 3.456 to 3.5;
    - sets `truncated` true at exactly 25,000 rows and false at 24,999;
    - sends `rowLimit: 25000` and `dimensions: ["query","country"]`.
  - `mergeRows`: `[{q,AU,pos 2,clicks 1,impr 100}]` and `[{q,AU,pos 4,clicks 2,impr 300}]` give `{pos 3.5, clicks 3, impr 400}`. Distinct keys are kept apart.
  - `latestDataDate` returns the newest date, or `null` on no rows.
  - `revokeToken` swallows a network error.
- [ ] **Step 2: Run** `npx vitest run api/_lib/gsc.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `api/_lib/gsc.ts` and `api/_lib/countryCodes.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `npm test`.
- [ ] **Step 5: Commit** `feat(gsc): Search Console and Google sign-in helpers`.

### Task 2: Storage (`supabase/gsc.sql`, `api/_lib/gscStore.ts`) and the admin check

**Files:**
- Create: `supabase/gsc.sql`, `api/_lib/gscStore.ts`, `api/_lib/gscStore.test.ts`.
- Modify: `api/_lib/requestAuth.ts` (add `isAdminUser`) and its test.

**Interfaces (Produces):**
```ts
// gscStore.ts — `admin` is AdminClient from ./snapshotStore.js (createAdminClient)
export type GscConnection = { refreshTokenEnc: string; googleEmail: string | null; connectedBy: string; connectedAt: string; status: 'ok' | 'broken' }
export async function loadConnection(admin: AdminClient): Promise<GscConnection | null>
export async function saveConnection(admin: AdminClient, c: Omit<GscConnection, 'status'>): Promise<void>  // upsert id=1, status 'ok'
export async function markBroken(admin: AdminClient): Promise<void>
export async function deleteConnection(admin: AdminClient): Promise<void>
export async function readCache<T>(admin: AdminClient, domain: string, days: number, maxAgeMs: number, now: Date): Promise<T | null>
export async function writeCache(admin: AdminClient, domain: string, days: number, payload: unknown, now: Date): Promise<void>
export async function clearCache(admin: AdminClient): Promise<void>
// requestAuth.ts
export async function isAdminUser(admin: AdminClient, userId: string): Promise<boolean>  // user_access.is_admin, false on error/missing
```

**`supabase/gsc.sql`:** idempotent (`create table if not exists`).
- `gsc_connection`:
  - `id smallint primary key default 1 check (id = 1)`;
  - `refresh_token_enc text not null`, `google_email text`;
  - `connected_by uuid not null`, `connected_at timestamptz not null default now()`;
  - `status text not null default 'ok' check (status in ('ok','broken'))`.
- `gsc_cache`:
  - `domain text not null`, `days int not null`;
  - `payload jsonb not null`, `fetched_at timestamptz not null default now()`;
  - `primary key (domain, days)`.
- Both get `alter table … enable row level security;` with no policies. A comment says why: service role only.

- [ ] **Step 1: Write the failing tests.** Use a small fake `AdminClient` in the style of the existing `discoveryStore.test.ts` fakes. Read that file and reuse its pattern.
  - save/load round-trip;
  - `markBroken` sets the status;
  - `deleteConnection` leaves `null`;
  - `readCache` returns the payload when it is younger than `maxAgeMs`, and `null` when older or missing;
  - `clearCache` empties the table;
  - `isAdminUser` is true or false from the row, and false on a query error.
- [ ] **Step 2: Run** `npx vitest run api/_lib/gscStore.test.ts api/_lib/requestAuth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write `supabase/gsc.sql` as specified.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `npm test`.
- [ ] **Step 5: Commit** `feat(gsc): connection and cache storage; admin check`.

### Task 3: The five endpoints and the dev shim

**Files:**
- Create: `api/gsc-connect.ts`, `api/gsc-callback.ts`, `api/gsc-disconnect.ts`, `api/gsc-status.ts`, `api/gsc-keywords.ts`, each with its `*.test.ts`.
- Modify: `vite.config.ts` (serve `/api/gsc-*` under `npm run dev` the way `/api/sites` is served).

**Interfaces (Consumes Tasks 1-2. Produces, for Tasks 4-6):**
- `POST /api/gsc-connect`, approved admin.
  - Answers `{ ok: true, url }` and sets the cookie `gsc_nonce=<nonce>; HttpOnly; Secure; SameSite=Lax; Path=/api/gsc-callback; Max-Age=600`.
  - `Secure` is omitted when `APP_URL` starts with `http://localhost`.
- `GET /api/gsc-callback?code&state` checks, in this order:
  1. the state signature and expiry;
  2. the cookie nonce equals the state nonce;
  3. `isAdminUser(state.userId)`.

  Then it runs `exchangeCode`, `encryptToken`, `saveConnection({connectedBy: state.userId, …})` and `clearCache`.
  - It always clears the cookie.
  - It redirects 302 to `${APP_URL}/bp-sites?gsc=connected`, or `?gsc=error&reason=state|nonce|admin|google|config`.
  - A Google `error=access_denied` query param gives `reason=denied`.
- `POST /api/gsc-disconnect`, approved admin: best-effort `revokeToken` on the decrypted token, then `deleteConnection` and `clearCache`. Answers `{ ok: true }`.
- `GET /api/gsc-status`, approved user. Answers `{ ok: true, connected, status?: 'ok'|'broken' }`. For admins it also returns `googleEmail`, `connectedBy`, `connectedAt`, and `coverage: [{ domain, brand, properties: string[] }]`.
  - Coverage covers every `DOMAIN_TO_BRAND` domain that `isReported` keeps for at least one country of its brand, using the cached `sites.list`.
  - It is computed only when connected and `status === 'ok'`. An `invalid_grant` while computing it marks the connection broken.
- `GET /api/gsc-keywords?domain&days`, approved user.
  - **Bad input:** a domain not in `DOMAIN_TO_BRAND`, or `days` not in {7,28,90}, gives 400.
  - **Not connected:** `{ ok:false, code:'not_connected' }`.
  - **Broken connection, or `invalid_grant`:** mark it broken and answer `{ ok:false, code:'reconnect' }`.
  - **No property:** `{ ok:true, property:null }`.
  - **Otherwise:** `{ ok:true, property, startDate, dataUpTo, truncated, rows }`.
    - `property` is the matched property, or a ` + `-joined list when merged.
    - Rows are merged when several URL-prefix properties match.
    - `startDate` is `dataUpTo` minus `days - 1`.
    - When `latestDataDate` is null: `rows: []`, `dataUpTo: null`.
  - **Cache:** 6 h per (domain, days). A cache hit makes no Google call.
  - **Google 5xx or 429:** one retry, then `{ ok:false, error:'Google Search Console did not answer. Try again in a minute.' }`.
- Every handler exports `config = { maxDuration: 60 }` and guards on method (405 with `Allow`), as `api/sites.ts` does.
- The auth failure shapes copy `api/sites.ts`: 401 for no or invalid token, 403 for not approved. The admin endpoints answer 403 `{ ok:false, error:'Admins only' }` for a non-admin.

- [ ] **Step 1: Write the failing tests.** Mirror `api/sites.test.ts`: mock `@supabase/supabase-js` and inject a stub `fetch` (`vi.stubGlobal('fetch', …)` or a module seam; read how `api/sites.test.ts` stubs Ahrefs and do the same). Cover:
  - every Review Focus 1-3 case;
  - the happy paths:
    - connect returns the url and sets the cookie;
    - callback saves an encrypted token, clears the cache, clears the cookie and redirects `?gsc=connected`;
    - disconnect deletes the connection and calls revoke;
    - status for an admin has coverage, and for a user has no admin fields;
    - keywords:
      - a domain property makes a single query;
      - URL-prefix properties are merged;
      - a cache hit makes no fetch;
      - `days=90` gives a 90-day range ending at `dataUpTo`;
      - `truncated` is passed through;
      - a non-BP domain gives 400;
  - a missing env var gives a 500 naming the var.
- [ ] **Step 2: Run** `npx vitest run api/gsc-`. Expected: FAIL.
- [ ] **Step 3: Implement** the five handlers and the `vite.config.ts` shim. The shim mounts `/api/gsc-connect`, `/api/gsc-callback`, `/api/gsc-disconnect`, `/api/gsc-status` and `/api/gsc-keywords`, each loading its module with `server.ssrLoadModule`, the same way `/api/sites` is wired.
- [ ] **Step 4: Run** `npm test` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(gsc): connect, callback, disconnect, status and keywords endpoints`.

### Task 4: Client API and the tab's plain logic

**Files:**
- Create: `src/lib/gscApi.ts`, `src/lib/gscView.ts`, `src/lib/gscView.test.ts`, `src/lib/gscApi.test.ts`.

**Interfaces (Produces):**
```ts
// gscApi.ts — bearer token from supabase.auth.getSession(), as src/lib/sitesApi.ts does
export type GscKeywordsResult =
  | { ok: true; property: string | null; startDate?: string; dataUpTo?: string | null; truncated?: boolean; rows?: GscRow[] }
  | { ok: false; code?: 'not_connected' | 'reconnect'; error: string }
export async function fetchGscKeywords(domain: string, days: 7 | 28 | 90, signal?: AbortSignal): Promise<GscKeywordsResult>
export async function fetchGscStatus(): Promise<GscStatus>
export async function startGscConnect(): Promise<string>     // returns Google URL; caller does window.location.assign
export async function disconnectGsc(): Promise<void>
// gscView.ts — pure
export type GscFilters = { countries: string[]; search: string; page1: boolean }
export function filterRows(rows: GscRow[], f: GscFilters): GscRow[]       // countries empty = all; search case-insensitive substring; page1 = position <= 10
export function sortByImpressions(rows: GscRow[]): GscRow[]              // desc, then clicks desc, then query asc
export function countriesOf(rows: GscRow[]): string[]                    // distinct, sorted by total impressions desc
export const PAGE_STEP = 200
export function readGscParams(search: URLSearchParams): { view: 'rankings' | 'google'; gsite: string | null; days: 7 | 28 | 90 }   // bad values -> defaults
export function withView(search: URLSearchParams, view: 'rankings' | 'google'): URLSearchParams  // adds/removes view only
export function defaultSite(brand: Brand, domainFilter: string | undefined, siteParam: string | null, gsite: string | null): string
export function reportedBpDomains(brand: Brand): string[]               // brand.domains kept by isReported for >= 1 brand country; main first
```
- `GscRow` and the `GscStatus` type are re-exported from a shared types module. The builder decides where, as long as `src/` doesn't import server-only code.
- **`defaultSite`, in priority order:**
  1. `gsite`, if it is one of `reportedBpDomains`;
  2. else exactly one of `domainFilter` / `siteParam` (comma lists count as many), if reported;
  3. else `brand.mainDomain`.

- [ ] **Step 1: Write the failing tests** for every pure function. Include:
  - `withView` keeps `site`, `kw` and `pos` and only toggles `view` (Review Focus 5);
  - `readGscParams` with `days=30` gives 28;
  - `defaultSite` ignores a retired domain such as `casinoroosters.com` and falls back to the main domain;
  - `fetchGscKeywords` sends the bearer token and passes `code` through on a 409 or 401 body, with a stub `fetch` and a stubbed session.
- [ ] **Step 2: Run** `npx vitest run src/lib/gsc`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(gsc): client API and the tab's filtering and URL helpers`.

### Task 5: The tab on the brand page

**Files:**
- Create: `src/components/RealKeywordsTab.tsx`, `src/components/BrandTabs.tsx`.
- Modify: `src/pages/BPSites.tsx`, only to render the tab bar above the brand view and choose the view.

**Behaviour:**
- **Tab bar.** `BrandTabs` shows "Rankings (Ahrefs)" and "Real keywords (Google)" above the existing `BrandView`, on BP Sites only.
  - Clicking a tab calls `setSearchParams(withView(...))`.
  - With `view=google`, the page renders `RealKeywordsTab` instead of `BrandView`. The Rankings view is unmounted, so no Ahrefs work happens there.
  - The Rankings tab triggers no `gsc-*` request, ever.
- **Header row.** `RealKeywordsTab` shows:
  - the site select (`reportedBpDomains`, `?gsite`);
  - the period select (7, 28, 90; `?days`);
  - "Google data up to <formatted date>".
- **Filter row:** countries multi-select (from `countriesOf`), search, "Page 1 only" and the row count.
- **Table:** Search, Country, "Avg position" with the exact tooltip, Clicks, Impressions; `PAGE_STEP` rows plus "Show more".
- **Styling** reuses the existing table and filter classes from `BPSites.tsx` and `OtherRankingKeywords.tsx`.
- **States**, worded plainly:
  - loading;
  - not connected: admins get the Connect button, which calls `startGscConnect` and then `window.location.assign`; others get "Google Search Console isn't connected yet";
  - reconnect: the same, worded "The Google connection stopped working";
  - property null: "<domain> isn't in the connected Search Console account";
  - no rows: "Google shows no searches for this site in the last <n> days";
  - error with "Try again";
  - truncated: "Showing the top 25,000 searches by clicks".
- **Requests:** a request is aborted when the site or period changes.
- **No crash on 5,000+ rows.** Render `PAGE_STEP` rows only; filtering runs over the array.

- [ ] **Step 1:** No component unit tests (the suite is node-only, with no testing-library or jsdom; ruling in the ledger). The logic is covered in Task 4. Write the components.
- [ ] **Step 2: Run** `npm run build` and `npm test`. Expected: PASS.
- [ ] **Step 3: Commit** `feat(gsc): Real keywords tab on the BP Sites brand page`.

### Task 6: Admin panel, the callback toast, docs, and the browser check

**Files:**
- Create: `src/components/GscConnectionPanel.tsx`, `docs/integrations/gsc.md`.
- Modify:
  - `src/pages/AdminUsers.tsx`: render the panel for admins;
  - `src/pages/BPSites.tsx`, or wherever the BP Sites index reads its search params: show a toast for `?gsc=connected` / `?gsc=error&reason=…`, then remove `gsc` and `reason` from the URL;
  - `CLAUDE.md`: Key Files rows for the new files, and one Data Flow line.

**Behaviour:**
- **Panel**, admins only, on the Users page. It shows:
  - "Connected as <email> · by <admin email or id> · <date>", plus Disconnect, which asks a `window.confirm` first;
  - or Connect;
  - if broken: "The Google connection stopped working", plus Reconnect.
- **Coverage list:** "N of M BP sites found in Search Console", listing each domain with its matched property, or "not found".
- **Toast copy:**
  - connected: "Google Search Console connected.";
  - error reasons: `state`/`nonce` give "The sign-in link expired. Try Connect again."; `admin` gives "Only admins can connect Google."; `denied` gives "Google access was not granted."; `google`/`config` give "Google sign-in failed. Check the setup in docs/integrations/gsc.md."
- **`docs/integrations/gsc.md`:** the spec's setup section 5, step by step:
  - the Google Cloud project, the API, the consent screen (Internal vs External/In production and why), the OAuth client and redirect URIs;
  - the four env vars and how to generate `GSC_TOKEN_KEY` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
  - applying `supabase/gsc.sql`;
  - connecting;
  - what to do when it says reconnect;
  - the limits: average position, a 2-3 day lag, rare searches hidden, 25,000 rows.

- [ ] **Step 1: Build the panel, the toast, the docs and the CLAUDE.md rows.**
- [ ] **Step 2: Gate.** Run `npm test` and `npm run build`. Then `npx vercel build` must succeed, and a failure that names a missing `.js` extension is a fix.
- [ ] **Step 3: Browser check, stubbed.** No real Google or Supabase writes.
  - Run `npm run dev`, with the `gsc-*` endpoints stubbed by a temporary dev-only patch that's never committed: canned JSON per state.
  - The stub ignores Supabase auth the way the earlier Ranking-Reports visual checks did (Playwright `page.route` mocking the Supabase REST reads and answering non-GET with 400). Read `docs/superpowers` or the previous ledgers for the method if one exists; otherwise mock in the browser.
  - Screenshots at 1440 and 390:
    - the brand page Rankings tab, unchanged;
    - the Google tab with rows;
    - not connected (as admin and as user);
    - reconnect;
    - property null;
    - no rows;
    - truncated;
    - the admin panel connected (with coverage) and not connected.
  - Check that the Rankings tab makes no `gsc-*` request (network log).
  - Check there's no sideways scroll at 390.
- [ ] **Step 4: Commit** `feat(gsc): admin connection panel, callback toast and setup docs`.

---

## After the plan (each step needs the user's OK)

1. **The user does the one-time setup** in `docs/integrations/gsc.md`: the Google Cloud project, the four env vars in Vercel and `.env.local`, and `supabase/gsc.sql` applied.
2. **Push the branch** and open the PR. Ranking-Reports PRs are merged by Leo, or as the user directs. Check the Vercel preview.
3. **After merge and the production deploy,** an admin clicks Connect and signs in with Ramiel's login. The coverage list shows which Rooster sites are found.
4. **Read-only smoke test** on production: open one brand's Google tab.
