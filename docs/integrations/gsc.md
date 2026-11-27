# Google Search Console — Real keywords (Google)

The "Real keywords (Google)" tab on each BP Sites brand page shows the searches
Google says each site was found for, read live from the Search Console API. It
is separate from the Rankings (Ahrefs) tab: Ahrefs checks chosen keywords once a
week, Google reports every search that showed the site. The design and its
reasons are in
`docs/superpowers/specs/2026-11-27-gsc-real-keywords-design.md`.

One Google account (the one that owns the Search Console properties) is
connected once, by an admin. Everyone approved reads the tab through the
server; the browser never sees a Google token.

## One-time setup

### 1. Google Cloud Console

Use the Google account that owns the Cloud project, which does not have to be
the account that owns Search Console.

1. Create a project (for example "Ranking Reports").
2. APIs & Services, Library: enable **Google Search Console API**.
3. APIs & Services, OAuth consent screen:
   - **Internal** if the account that owns the project is in a Google
     Workspace. Only people in that Workspace can sign in, there is no
     verification and no expiry. The account that holds the Search Console
     properties must then be in the same Workspace.
   - Otherwise **External**, app name "Ranking Reports", and set the publishing
     status to **In production**. In "Testing" Google expires the refresh token
     after 7 days and the tab goes back to "reconnect" every week. In
     production the token does not expire. An unverified app shows a warning
     screen at sign-in: click Advanced, then continue. The 100-user cap of an
     unverified app does not matter, one account connects.
   - Scopes: `openid`, `email` and
     `https://www.googleapis.com/auth/webmasters.readonly` (read-only).
4. APIs & Services, Credentials: create an **OAuth client ID** of type **Web
   application** with these authorised redirect URIs:
   - `https://<production domain>/api/gsc-callback`
   - `http://localhost:5173/api/gsc-callback`

   The redirect URI the app sends is `${APP_URL}/api/gsc-callback`, so it must
   match one of these exactly.

### 2. Environment variables

Set these in Vercel (Production and Preview) and in `.env.local`. None has a
`VITE_` prefix, and none is ever pasted into chat, a ticket or a commit.

**Use the same `GSC_TOKEN_KEY` in every environment that uses this Supabase
project (Production, Preview, .env.local).** The connection is one shared row.
A different key cannot read it, so that environment answers "GSC_TOKEN_KEY here
doesn't match the key that stored the Google connection". It does not break the
connection for everyone else, but it cannot use it until the keys match.

| Variable | Value |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | The OAuth client's ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | The OAuth client's secret |
| `GSC_STATE_SECRET` | Any random string of 32 characters or more; signs the sign-in link |
| `GSC_TOKEN_KEY` | Base64 of exactly 32 random bytes; encrypts the stored refresh token |

Generate `GSC_TOKEN_KEY` (and, if you like, `GSC_STATE_SECRET`):

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

It also needs the existing `APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
and `SUPABASE_ANON_KEY`. A missing variable is a 500 whose message names it
(never its value). Changing `GSC_TOKEN_KEY` later makes the stored token
unreadable: reconnect. The stored token carries the first 8 hex characters of
the key's SHA-256 (not the key), which is how a mismatch is told apart from a
damaged token.

### 3. Database

Apply `supabase/gsc.sql` in the Supabase SQL editor. It creates
`gsc_connection` (one row: the encrypted refresh token, who connected it, and
whether Google still accepts it) and `gsc_cache`. Both have row level security
on and no policies; only the Vercel functions (service role) touch them.

### 4. Connect

After the deploy, as an admin open **Users** and click **Connect Google Search
Console**. Sign in with the account that has the properties and click Allow
(click through the unverified-app warning if it shows). **Leave the Search
Console permission ticked** on Google's consent screen: if it is unticked the
app stores nothing and shows "Google didn't grant Search Console access" (the
`reason=scope` toast); click Connect again and allow it.

Connect works only from production or from `localhost:5173`, because those are
the redirect URIs registered in step 1. On a Preview URL, Google refuses the
sign-in. Connect from production once and every environment that shares this
Supabase project and the same `GSC_TOKEN_KEY` reads the same connection. You land back on BP
Sites with "Google Search Console connected." The Users panel then shows who
is connected and "N of M BP sites found in Search Console", with each domain's
matched property or "not found".

### 5. Check

Open a brand's page and choose **Real keywords (Google)**.

## Endpoints

| Endpoint | Who | Does |
|---|---|---|
| `POST /api/gsc-connect` | admin | Returns the Google consent URL; sets the nonce cookie |
| `GET /api/gsc-callback` | the browser, from Google | Checks the signed state, the cookie and that the user is an admin, stores the encrypted token, redirects to `/bp-sites?gsc=connected` or `?gsc=error&reason=` one of `state`, `nonce`, `admin`, `denied`, `scope`, `google`, `config` |
| `POST /api/gsc-disconnect` | admin | Revokes the token at Google (best effort), deletes the stored row and the cache |
| `GET /api/gsc-status` | approved users | Connected or not and ok or broken; admins also get who/when and the coverage list |
| `GET /api/gsc-keywords?domain=&days=7\|28\|90` | approved users | One Search Console page for the domain, cached 6 hours |

## When it says reconnect

The tab shows "reconnect" (and the Users panel "The Google connection stopped
working") when Google no longer accepts the stored token. Common causes: the app
was still in Testing, the account's password changed, access was revoked at
myaccount.google.com/permissions, or `GSC_TOKEN_KEY` changed. An admin clicks
**Reconnect** on the Users page and signs in again. Nothing else needs to change.

A callback toast of "Google sign-in failed. Check the setup in
docs/integrations/gsc.md." means this setup is wrong somewhere: a missing env
var, a redirect URI that does not match `${APP_URL}/api/gsc-callback`, or a
secret that does not match the client.

## What the messages mean

| Message | Meaning | What to do |
|---|---|---|
| "Google Search Console did not answer. Try again in a minute." | Google was slow, down or rate limiting (a 429, a 5xx, a network error or a timeout). Retried once already. | Wait and try again |
| "Google refused access to this site's Search Console data. Check that the connected Google account still has access to it." | Search Console answered 403 for this site. The connection itself is fine. | Add the connected account as a user of that property, or connect a different account |
| "Google rejected the app's OAuth client. Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (docs/integrations/gsc.md)." | Google answered `invalid_client` or `unauthorized_client`: the client ID or secret is wrong or was rotated. The connection is not marked broken. | Fix the two variables in Vercel and redeploy |
| "GSC_TOKEN_KEY here doesn't match the key that stored the Google connection. Use the same GSC_TOKEN_KEY everywhere that uses this Supabase project." | This environment's key differs from the one used at Connect. The connection is not marked broken. | Set the same `GSC_TOKEN_KEY` here |
| "Could not check which BP sites are in Search Console: ..." (Users page) | The coverage list could not be read; the reason follows. The rest of the panel still works. | See the row above that matches the reason |
| "Google didn't grant Search Console access. Click Connect again and allow it when Google asks." | The Search Console permission was unticked at consent. Nothing was stored and the grant was revoked. | Click Connect again and leave it ticked |

A Search Console 401 (the token is no longer accepted) is treated like a
revoked grant: the connection is marked broken and the tab says reconnect.

## Limits

- **Average position.** Google reports the average position over the period,
  weighted by how often the site was shown. It is not a single check like the
  Rankings tab, so the two will not agree.
- **A 2-3 day lag.** The newest days are not final. The tab says "Google data up
  to <date>".
- **Rare searches are hidden.** Google leaves out anonymised queries, so very
  rare searches never appear and the totals are lower than the site's real
  traffic.
- **25,000 rows.** One page per site and period; when it comes back full the tab
  says it shows the top 25,000 searches by clicks. When a site has several
  root properties (`https://x.com/` and `https://www.x.com/`) they are merged
  and cut to the top 25,000 by clicks. Path-scoped properties such as
  `https://x.com/au/` are ignored: the root property already counts them.
- **Timeouts.** Each Google call has its own timeout (5 to 12 seconds) so a slow
  answer ends as "did not answer" before Vercel's 60 second limit.
- Results are cached for 6 hours per site and period; connecting or
  disconnecting clears the cache.
- A site only shows data if the connected account has a Search Console property
  for it (the coverage list on the Users page shows which ones).
