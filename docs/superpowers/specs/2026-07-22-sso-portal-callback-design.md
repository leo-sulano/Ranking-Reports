# SSO portal callback

## Problem

A separate "portal" project does cross-dashboard SSO: a user signs into the portal once, clicks this dashboard's card, and should land here already signed in. The portal signs a short-lived JWT asserting the user's email and redirects the browser to a callback URL we control. We own a distinct Supabase project (own users, own keys) from the portal's, so on first SSO for a given email we need to provision an account here (JIT), not look one up in a shared user store.

This app has no server runtime today — it's a static Vite SPA (client-side Supabase, anon key, session persisted in `localStorage`) deployed to Vercel with a catch-all rewrite to `index.html`. There is currently nowhere to safely hold a Supabase service-role key or verify a third-party JWT.

## Goals

- One new endpoint that: verifies the portal's JWT (signature, issuer, audience, expiry) against the portal's JWKS; finds-or-creates a Supabase Auth user for the asserted email; establishes a session the existing SPA already knows how to read (no new client-side session-reading code); redirects to `/`.
- SSO users are auto-approved — no admin step. The portal (which we built and control) is the trust boundary; anyone it vouches for is trusted here immediately, consistent with the "auto-approve" decision made during design.
- Fail closed: any missing env var, bad signature, wrong issuer/audience, or expired token results in no session and a redirect back to `/` with an error flag — never a partially-provisioned or silently-accepted user.
- Service-role key stays server-only, never bundled into client JS.

## Non-goals

- No change to `VITE_REQUIRE_AUTH` — this feature doesn't turn login-gating on or off. It only gives SSO arrivals a way to already have a session, exactly as Google OAuth or email/password sign-in already do.
- No change to the existing manual approval path (`user_access`, `/admin/users`) for non-SSO signups — this only affects the status row for the specific user this callback provisions.
- No migration to Next.js. The reference implementation we were handed assumed Next.js App Router + `@supabase/ssr` cookie sessions; this app is a Vite SPA and does not need a framework change to support this feature.
- No new "revoked" status or session-invalidation mechanism — out of scope, and `user_access.status` only has `pending`/`approved` today.

## Architecture

### New endpoint: `api/auth/portal-callback.ts`

A Vercel serverless function (Node runtime), reachable at `/api/auth/portal-callback` on the existing Vercel domain — no framework change, no new deploy target. This is the callback URL to give the portal owner (see Setup work).

New dependency: `jose` (JWKS fetch + verification). `@supabase/supabase-js` is already a project dependency.

### Request handling

```
GET /api/auth/portal-callback?token=<portal-signed JWT>
```

1. Read `token` from the query string. Missing → redirect to `/?error=sso`.
2. Verify with `jose`:
   - `createRemoteJWKSet(new URL(PORTAL_JWKS_URL))`
   - `jwtVerify(token, JWKS, { issuer: PORTAL_ISSUER, audience: SSO_AUDIENCE })`
   - `PORTAL_JWKS_URL`, `PORTAL_ISSUER`, `SSO_AUDIENCE` are read via a `requireEnv` helper that throws if unset — an unset issuer/audience must never silently become "no constraint" in `jose`, which is what stops a token minted for a different dashboard in the same portal from working here.
   - Any failure (bad signature, wrong issuer/audience, expired, malformed) → redirect to `/?error=sso`.
3. Extract `email` from the verified payload. Missing/empty → redirect to `/?error=sso`.
4. Build a service-role Supabase client (`SUPABASE_SERVICE_ROLE_KEY`, server-only env var — no `VITE_` prefix, never sent to the client bundle).
5. `admin.generateLink({ type: 'magiclink', email })` — this single call both creates the Supabase Auth user if the email is new **and** returns an `action_link` for an existing one, so there's no separate create-then-lookup step and no need to page through `listUsers` (a limitation called out, but not solved, in the reference code).
   - Failure → redirect to `/?error=sso`.
6. Upsert `user_access` for `data.user.id`: `status: 'approved'` (service-role client bypasses RLS, so this works even though the "admin update user_access" policy would otherwise block it). This is an upsert, not an insert, because the existing `handle_new_user` trigger already inserts a `pending` row on user creation — we're overriding that default for the SSO path only. Safe to run on every SSO login, including returning users, since there's no `revoked` state to accidentally clobber today.
7. Redirect the browser (302) to `action_link`.
   - Supabase's own hosted verify endpoint validates the link and redirects back to this app's origin with session tokens in the URL. The SPA's existing Supabase client (`detectSessionInUrl: true` in `src/lib/supabase.ts`) picks this up automatically and persists the session to `localStorage` — the same mechanism already used for password-reset and email-confirmation links. No cookies, no `@supabase/ssr`, no new client-side code.
8. Any unexpected error at any step → redirect to `/?error=sso` rather than throwing a raw 500.

### Why not the reference implementation's approach

The pasted reference assumes Next.js App Router with `@supabase/ssr` cookie-based sessions, and manually calls `verifyOtp` server-side to set cookies. This app has neither a Next.js server nor cookie-based sessions — its Supabase client is client-side with `localStorage` persistence. Redirecting straight to Supabase's own `action_link` reuses the exact mechanism this app already relies on for other auth flows, so no new session-establishment code path is introduced at all.

### Error surface on the client

The reference assumed a `/login` route to redirect errors to. This app doesn't have one — sign-in is a modal (`LoginModal`), not a page. Errors redirect to `/?error=sso` instead; a follow-up (not required for this feature to function) could have the top-level layout notice `?error=sso` and surface a toast, but wiring that is optional polish, not required for the SSO flow itself to work.

## Setup work (manual, outside this codebase)

1. `npm install jose`.
2. Set these env vars in the Vercel project (Production), server-only (no `VITE_`/`NEXT_PUBLIC_` prefix):
   - `PORTAL_JWKS_URL = https://dashboard-portal-tawny.vercel.app/api/sso/jwks`
   - `PORTAL_ISSUER = https://dashboard-portal-tawny.vercel.app` (exact, no trailing slash)
   - `SSO_AUDIENCE = 3b3a26b1-c89d-4d2f-ba2e-d88f743f062d`
   - `SUPABASE_SERVICE_ROLE_KEY` = this project's service-role key (Supabase Dashboard → Settings → API)
3. Confirm the app's own `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are already set (they should be, for existing auth).
4. Confirm `/` (this app's origin) is on the Supabase project's Auth → URL Configuration → Redirect URLs allow-list — `generateLink`'s `action_link` will only redirect to allow-listed URLs. This is likely already satisfied since other auth flows already redirect to this app's origin, but verify during implementation.
5. Deploy. Give the portal owner the callback URL: `https://ranking-reports-alpha.vercel.app/api/auth/portal-callback`. They enable SSO for this dashboard and test by clicking the card.

## Risks / things to verify during implementation

- Confirm Vercel's routing resolves `/api/auth/portal-callback` to the serverless function ahead of the SPA's catch-all rewrite in `vercel.json` (filesystem/function routes are expected to take priority over rewrites, but this should be verified against a real deploy, not assumed).
- Confirm the Supabase project's Redirect URLs allow-list includes this app's origin, or `generateLink`'s `action_link` redirect will be rejected by Supabase's own auth server.
- Confirm `admin.generateLink({ type: 'magiclink' })` behaves as documented (creates the user if absent, returns a usable `action_link` either way) against this project's actual Supabase version during testing — this is based on current Supabase docs, not yet exercised against this project.
