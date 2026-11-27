# Real keywords (Google): a Search Console tab on the BP Sites brand page — design

**Date:** 2026-11-27
**Status:** draft, for the user's approval.
**Repo:** Ranking-Reports, branch `feat/gsc-real-keywords`.

## Why

**Meny's ask (2026-11-25):**
- Every keyword each site ranks for, in every country, automatically.
- At least 80% accurate against actual Google.

**Why Ahrefs falls short:** Ahrefs' index knows only a small part of these sites' searches. When we checked, it had 95 keyword rankings across all 36 live BP sites, and 26 sites had none.

**Ramiel's proposal (chat, 2026-11-27):** use Google Search Console, Google's own record of every search each site appeared for, per country, with the position. It's free, updated daily, and the real Google result.
- He shared one Google login with access to the Search Console accounts.
- He wants a pilot on the Rooster brands, meaning this dashboard.

**Decisions so far (the user's):**
- **A:** a separate "Real keywords" page per site. The weekly Ahrefs tables stay as they are.
- **Approach 1:** read Search Console live, with a short cache. No nightly copy.
- **Credential:** use the shared Google login through a one-time sign-in. No service account for now.
- **Layout:** the one sketched below.

## Goals

1. **A second tab on each BP Sites brand page,** "Real keywords (Google)", next to the rankings. For one site, it shows every search Google showed that site for, per country:
   - average position;
   - clicks;
   - impressions.

   It covers the last 7, 28 or 90 days.
2. **An admin connects Google once** from the dashboard by signing in with the shared login in Google's own window. The access is kept on the server. The password never reaches the dashboard.
3. **The pilot covers whichever BP sites the connected login can see in Search Console.** Every other site says so plainly.

## Non-goals

- No change to:
  - the weekly Ahrefs tables, the sync and the cron jobs;
  - the "Also ranking" / other-countries discovery;
  - Home, LP Sites, `/log` and the assistant.
- No nightly copy, no stored history and no Search Console column in the weekly table. That would be option B or approach 2, later.
- TryBet, UK-Sites and the shared package are not part of this.
- Nothing is ever written to Search Console. The access is read-only.

## Anti-goals (failure even if it works)

- **The Google password is stored, logged or typed into the dashboard.**
- **The stored Google access is readable by the browser,** by a non-admin, or by anything but the server.
- **Anyone who is not an approved dashboard user gets Search Console data from the API.** The new endpoints are gated exactly like `/api/sites`.
- **The tab can ask Google about sites that are not this dashboard's.** The API only accepts a BP domain from `DOMAIN_TO_BRAND`.
- **The Rankings tab gets slower or changes.** Google is called only when the Google tab is open.
- **Google's average position looks like an Ahrefs weekly rank.** It is labelled as Google's average over the period.
- **Silent truncation.** If a site has more rows than we fetch, the tab says so.

## Constraints

**Stack:**
- Ranking-Reports is a Vite + React Router SPA with Vercel functions in `api/`, and Supabase behind it.
- Server code imports with `.js` extensions; check with `npx vercel build`, as the earlier Vercel ESM gotcha showed.
- Server env vars today: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `CRON_SECRET`, `AHREFS_*`.

**Auth:**
- `api/_lib/requestAuth.ts` resolves the caller's Supabase session from the `Authorization: Bearer` header and checks `isApprovedUser`.
- Admin is `user_access.is_admin` (`public.user_is_admin()` in `supabase/schema.sql`).
- SQL changes ship as `supabase/*.sql` files, which the user applies in the Supabase SQL editor.

**Search Console API facts the design relies on:**
- **Query:** `searchanalytics.query` on one property, with `dimensions: ["query","country"]`, a date range, `rowLimit` up to 25,000 and paging by `startRow`.
- **Position** is Google's average position over the range, weighted by impressions.
- **Country** comes back as ISO 3166-1 alpha-3, lower case (`aus`), while the dashboard uses alpha-2 (`AU`).
- **Freshness and privacy:** data runs about 2-3 days behind, 16 months are kept, and rare searches are hidden for privacy, so totals are lower than Google's own headline numbers.
- **Properties:** `sites.list` lists the properties a login can see, with its permission level. A site can be a domain property (`sc-domain:rooster.bet`) or a URL-prefix one (`https://www.rooster.bet/`).
- **Scope:** read-only, `https://www.googleapis.com/auth/webmasters.readonly`.

**Google sign-in (OAuth) facts:**
- A password can't be used by an app. An app gets a long-lived refresh token from a one-time consent in Google's window (`access_type=offline`, `prompt=consent`).
- While the Google Cloud app is in "Testing", refresh tokens expire after 7 days. Once the app is set to "In production", they don't expire. An unverified app shows a warning screen, which an internal user can click through.
- The refresh token stops working if the account's password changes or the access is removed. The tab must then ask an admin to reconnect.

**Verification never touches real data.** Tests stub every Google call. The only live call is the admin's own connect step, plus reading the tab afterwards, which is read-only.

## Approaches considered

**Where the data comes from:**
1. **Live from Google per view, with a few hours' cache.** Chosen. It's the least to build and as fresh as Google. The first load of a site takes a second or two, and the tab errors while the connection is broken.
2. **A nightly copy into Supabase.** Fast, survives a broken connection, and builds history for option B. It costs tables, a migration, a cron, a log line and growing storage. Kept for later.
3. **Each viewer signs in with their own Google account.** Rejected: clients and most staff have no Search Console access.

**Whose credential:**
- The shared login via one-time OAuth consent was chosen by the user.
- A service account, added as a read-only user on each property, is sturdier and stays the recommended long-term route.

## The design

### 1. Connecting Google (admins only)

**Where:**
- On the Google tab: an admin who finds no connection sees **Connect Google Search Console**; everyone else reads "Google Search Console isn't connected yet".
- In the admin's Users page, a small "Google Search Console" panel shows:
  - "Connected as <google email> by <admin> on <date>", plus **Disconnect**;
  - or **Connect**.

**Flow:**
1. **The SPA starts it.** The SPA calls `POST /api/gsc-connect` with the admin's bearer token. A browser redirect can't carry that header, so the SPA asks first.
2. **The server signs a state.** It checks the caller is an approved admin, then signs a short-lived `state`: an HMAC over the admin's user id, an expiry of 10 minutes and a nonce, using `GSC_STATE_SECRET`. It returns Google's consent URL:
   - `client_id`;
   - `redirect_uri = <APP_URL>/api/gsc-callback`;
   - `scope = openid email https://www.googleapis.com/auth/webmasters.readonly`;
   - `access_type=offline`, `prompt=consent`, and the `state`.

   The SPA navigates there.
3. **The person signs in.** They sign in with the shared login in Google's window and click Allow.
4. **Google calls back.** Google redirects to `GET /api/gsc-callback?code&state`. The server:
   - verifies the state's signature and expiry;
   - re-checks that the user id is still an admin;
   - exchanges the code for tokens;
   - reads the Google email from the ID token;
   - stores the refresh token, the email, the admin's id and the time.

   It then redirects to `/bp-sites?gsc=connected`, or `?gsc=error&reason=<short code>`. The page shows a toast.
5. **Disconnect.** **Disconnect** (`POST /api/gsc-disconnect`, admin only) revokes the token at Google's revoke endpoint, best effort, and deletes the stored row and the cache.

There is one connection for the whole dashboard. Connecting again replaces it.

### 2. Reading a site's searches

`GET /api/gsc-keywords?domain=<domain>&days=7|28|90`, with the caller's bearer token. Approved users only, exactly as `/api/sites`.

**Steps:**
1. **Validate.** `domain` must be a BP domain in `DOMAIN_TO_BRAND`, and `days` one of 7, 28 or 90; otherwise 400.
2. **Load the connection** with the service-role client. If there is none, answer `{ ok: false, code: "not_connected" }`.
3. **Get an access token** from the refresh token. If Google says `invalid_grant`, mark the connection broken and answer `{ ok: false, code: "reconnect" }`.
4. **Find the site's property** in `sites.list`, cached for an hour. Match in this order:
   - `sc-domain:<domain without www.>`;
   - `https://<domain>/`, `https://www.<domain>/`, `http://<domain>/`, `http://www.<domain>/`.

   If none matches, answer `{ ok: true, property: null }`. The tab says "lucky7even.com isn't in the connected Search Console account".
5. **Find the latest day with data:** a query with `dimensions: ["date"]` over the last 7 days, taking the newest date. The range is that day back `days` days, inclusive.
6. **Query** `searchanalytics.query` with `dimensions: ["query","country"]` and `rowLimit: 25000`. Fetch one page only. A page of exactly 25,000 rows sets `truncated: true`. The tab then says it shows the top 25,000 searches by clicks, which is Google's default order.
7. **Answer:**
   ```
   { ok: true, property, startDate, dataUpTo, truncated,
     rows: [{ query, country, position, clicks, impressions }] }
   ```
   - `country` is alpha-2 upper case, mapped from Google's alpha-3; unknown becomes `"ZZ"`.
   - `position` is rounded to one decimal.

**Cache:**
- The answer from step 7 is kept for 6 hours per (domain, days) in Supabase.
- A hit skips steps 3 to 6.
- A Connect or Disconnect clears the cache.

**Errors:**
- Google quota or 5xx: one retry, then `{ ok: false, error: "<worded for the tab>" }`.
- `maxDuration` is 60 s, with a fetch timeout under it, as `/api/sites` does.

### 3. The tab

**Where it lives:** on `/bp-sites/:brandSlug`, two tabs at the top of the brand page: **Rankings (Ahrefs)**, which is the page as it is today, and **Real keywords (Google)**.
- The choice is in the URL (`?view=google`). Links and refresh keep it, and the Rankings tab's own parameters are untouched.
- LP Sites gets no tab in the pilot.

**Layout** (approved by the user):

```
Lucky 7even › lucky7even.com          [Rankings (Ahrefs)] [Real keywords (Google)]
Site: lucky7even.com ▾   Last 28 days ▾   Google data up to Nov 25
Countries ▾   Search…   ☐ Page 1 only                         1,240 searches
 Search                     Country  Avg position  Clicks  Impressions
 lucky 7even                AU             1.2       842      3,105
 …                          (sorted by impressions)          [Show more]
```

**Site:**
- One site at a time, from the brand's BP domains.
- It defaults to the site the Rankings tab has filtered to, if exactly one; otherwise the brand's main domain.
- The choice is kept in the URL (`?gsite=`).

**Period and data date:**
- Period: 7, 28 or 90 days, default 28, kept in the URL (`?days=`).
- "Google data up to <date>" comes from `dataUpTo`.

**Filters:**
- Countries: multi-select, built from the countries in the answer.
- Search: substring, case-insensitive.
- Page 1 only: average position ≤ 10.

All of them filter in the browser.

**Table:**
- Columns: Search, Country, Avg position, Clicks, Impressions.
- Sorted by impressions, high to low.
- Shows the first 200 rows; **Show more** adds 200.
- The header "Avg position" has a tooltip: "Google's average position over the period, weighted by how often the site was shown. It is not a single check like the Rankings tab."

**States:**
- loading;
- not connected (Connect button for admins);
- reconnect needed (the same, worded "the Google connection stopped working");
- site not in Search Console;
- no searches in the period;
- error with **Try again**;
- truncated notice.

**Who sees it:** every approved user who sees the brand page. Connect and Disconnect are for admins only.

### 4. Data and configuration

**`supabase/gsc.sql`** (new, applied by the user) adds two tables. Both have RLS enabled with no policies, so only the service role can read or write them.
- `gsc_connection`:
  - one row (`id = 1`);
  - `refresh_token text not null`, `google_email text`;
  - `connected_by uuid`, `connected_at timestamptz`;
  - `status text` (`ok`, `broken`).
- `gsc_cache`:
  - `domain text`, `days int`, `payload jsonb`, `fetched_at timestamptz`;
  - primary key `(domain, days)`.

The `sites.list` cache is one row with `domain = '*'`.

**Env vars, Vercel and `.env.local`:**
- `GOOGLE_OAUTH_CLIENT_ID`;
- `GOOGLE_OAUTH_CLIENT_SECRET`;
- `GSC_STATE_SECRET` (random, 32+ bytes).

`APP_URL` builds the redirect URI.

### 5. Setup the user does once (steps written into the PR and `docs/integrations/gsc.md`)

1. **Google Cloud Console:**
   - create a project;
   - enable **Google Search Console API**;
   - set the OAuth consent screen to External, with the app name "Ranking Reports" and the scopes above;
   - set it **In production**, so the access doesn't expire after 7 days;
   - create an OAuth client of type **Web application** with redirect URIs `https://<prod domain>/api/gsc-callback` and `http://localhost:5173/api/gsc-callback`.
2. **Put the three env vars** in Vercel (Production and Preview) and in `.env.local`.
3. **Apply `supabase/gsc.sql`.**
4. **After the deploy,** as an admin, click **Connect Google Search Console**. Sign in with Ramiel's login and click Allow, clicking through the "unverified app" warning if shown.
5. **Open a Rooster brand's Google tab.**

## Builder check: the answers

A reviewer read this as the builder would. Every question was answerable from the code, or was settled as my call; none needed the user. These answers bind the plan.

1. **Which properties exist, and how to match them.** Nobody knows until the login is connected, so the first thing an admin sees afterwards is a coverage list (see 5 below).
   - **Matching:** a domain property (`sc-domain:<domain without www>`) wins, because it is the whole site.
   - **No domain property:** every URL-prefix property for the domain (`https://`, `https://www.`, `http://`, `http://www.`) is queried, and the rows are merged per (search, country):
     - clicks and impressions are summed;
     - position is averaged, weighted by impressions.
   - Each alias domain is its own site in the selector and looks up its own property.
2. **The Google Cloud app's status.**
   - The setup steps cover both cases:
     - an **Internal** consent screen if the account that owns the Cloud project is in a Google Workspace;
     - otherwise **External, In production**, with the unverified-app warning clicked through once.
   - The 100-user cap of an unverified app doesn't matter: one account connects.
   - Testing mode, with its 7-day expiry, must not be used. The setup doc says why.
3. **Local development.**
   - The Vite dev middleware that serves `/api/sites` also serves the four new endpoints: `gsc-connect`, `gsc-callback`, `gsc-disconnect` and `gsc-keywords`.
   - The registered redirect URIs are production plus `http://localhost:5173/api/gsc-callback`.
   - Preview deployments can show the tab once production holds a connection, but they can't run Connect: their URLs can't be registered.
4. **The callback's identity.**
   - `POST /api/gsc-connect` also sets a single-use nonce cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, path `/api/gsc-callback`, 10 minutes).
   - The callback checks four things before going on:
     - the state's HMAC;
     - its expiry;
     - that the nonce equals the cookie, which it then clears;
     - that the user id in the state is still an admin.
   - The admin lookup reads `user_access.is_admin` with the service-role client: a new small helper in `api/_lib/requestAuth.ts`, beside `isApprovedUser`.
5. **Storage.**
   - The refresh token is **encrypted at rest** (AES-256-GCM, key from a new env var `GSC_TOKEN_KEY`, 32 random bytes, base64). A leaked database row is then not a usable Google token.
   - The `sites.list` cache row uses `domain = '*'`, `days = 0`.
   - The admin panel shows the coverage after Connect: "N of 36 BP sites found in Search Console", listing each site with its matched property, or "not found".
6. **The default site and the URL.**
   - The Rankings tab's filter lives in the path (`/bp-sites/:brandSlug/:domainFilter`) or in `?site=`.
   - The Google tab defaults to that domain when exactly one is set; otherwise it uses the brand's main domain.
   - Switching tabs only adds or removes `?view=google` and keeps the path and every other parameter.
   - The site selector lists the brand's BP domains that `isReported` keeps. Retired domains such as `casinoroosters.com` stay hidden, as they are elsewhere.
7. **Countries.**
   - The Google tab shows every country Google reports, including those outside a narrowed brand's markets (RoosterBet's DE, for example). That is Meny's "every country".
   - The Rankings tab's market narrowing does not apply here.

Also noted: each new function sets `export const config = { maxDuration: 60 }`, as `api/sites.ts` does. No `vercel.json` change is needed.

## Left to the builder

- The component split and file names. Keep `BPSites.tsx`, already 1,906 lines, from growing: the tab is its own component.
- The alpha-3 → alpha-2 country table: a small static map of the countries that appear, or a generated full list.
- How "Show more" and the country list render, within the existing table styles.
- Test fixtures.

## My calls, for the user to check

1. **One Google connection for the whole dashboard,** set by an admin. Connecting again replaces it.
2. **Only BP sites get the tab,** and only domains the dashboard already knows can be asked about.
3. **One page of Google rows (25,000) per site and period,** with a notice when it's full, rather than paging further.
4. **A 6-hour cache per site and period.** Search Console only changes once a day.
5. **The connected Google email is shown to admins.** It needs the extra `openid email` scope on the consent screen.
6. **Disconnect revokes the access at Google,** not just in the dashboard.
7. **The choice of tab, site and period lives in the URL,** so a link to a site's Google tab can be shared.
