# Write-gated auth (login required to add/edit/upload)

## Problem

Today the dashboard is fully open: anyone with the URL can view AND mutate data (upload snapshots, edit cells, add FTD entries) with no login. A dormant whole-app `AuthGate` exists (`VITE_REQUIRE_AUTH` flag) but it's all-or-nothing — flipping it on would also block anonymous viewing, which isn't what's wanted. The `anon` Supabase key also currently has full read/write/delete access at the database level (`schema.sql`), so even the UI gate alone would be cosmetic — anyone could still write directly via the REST API.

## Goals

- Viewing the dashboard (all pages, all data) stays open — no login required.
- Mutating actions — upload snapshot, inline cell edit (GSV/SV/AFF), delete snapshot, FTD entry save — require a signed-in user.
- Sign-in supports email/password AND "Sign in with Google" (any Google account).
- No public self-signup. Teammates are added manually in the Supabase dashboard (email/password), or sign in with Google using an email that already has a Supabase user record.
- Enforcement is real (database-level via RLS), not just a UI nicety.

## Non-goals

- No per-user roles/permissions — any authenticated user can perform any write.
- No change to the existing whole-app `AuthGate` / `VITE_REQUIRE_AUTH` flag — left in place, dormant, in case all-or-nothing gating is wanted again later.
- No automatic account provisioning on first Google sign-in (out of scope: deciding whether Supabase auto-links by email needs to be verified during implementation — see Risks).

## Architecture

### Client-side gate: `useAuth()` + `requireAuth(fn)`

A new hook, `src/lib/useAuth.ts`, wraps session state and exposes:

```ts
const { session, requireAuth } = useAuth()
requireAuth(() => doTheMutation())
```

- If `session` is present, `requireAuth` invokes `fn` immediately.
- If not, it opens a shared `LoginModal` and stashes `fn` in a ref. On successful email/password sign-in (no page reload), the stashed `fn` runs automatically and the modal closes.
- On "Sign in with Google", the browser fully redirects to Google and back (Supabase's default OAuth flow — no in-page popup). The stashed `fn` does NOT survive this reload. The modal simply won't be open anymore when the page comes back with a session; the user re-clicks the action once. This is an accepted trade-off, not a bug — persisting intent across an OAuth redirect (e.g. via `sessionStorage`) is unnecessary complexity for one extra click.

`requireAuth` is called at the five existing mutation call sites:
- `App.tsx`: `handleImport` (upload trigger), `handleEditCell`, `handleDeleteSnapshot`, `handleReplaceDuplicate`
- FTD save path: wherever `FtdEntryForm` / `FtdMatrixTable` invoke `ftdStorage.ts` writes

No other files need to know about auth — they keep calling their existing callbacks; only the callback definitions gain a `requireAuth(...)` wrapper.

### `LoginModal` component

Replaces `Login.tsx`'s full-page layout with a centered modal/overlay, reusing the existing visual language (dark card, mono labels) from the current `Login.tsx`. Two controls:
- Email + password form (existing `signIn()` from `lib/auth.ts`)
- "Sign in with Google" button → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } })`

Rendered once, near the app root (in `Layout`, alongside the other modals like `UploadModal`/`DuplicateWarning`), driven by `useAuth()`'s modal-open state.

### Topbar sign-in/out state

`Topbar.tsx` currently only shows "Sign out" when `REQUIRE_AUTH` is true. Update it to always reflect real session state (regardless of the dormant `REQUIRE_AUTH` flag): show "Sign in" when signed out (opens `LoginModal` directly, no pending action) and "Sign out" when signed in.

### Database: RLS split (the real enforcement)

New migration `supabase/auth-write-lockdown.sql`, replacing the current `anon`-does-everything policies across all six tables (`snapshots`, `ranking_records`, `ftd_records`, `ftd_totals`, `brand_stags`):

- `anon` role: `select` only.
- `authenticated` role: `select`, `insert`, `update`, `delete`.

This mirrors the existing `supabase/auth-lockdown.sql` pattern (drop-then-create, idempotent) but keeps anon read access instead of removing it entirely — `auth-lockdown.sql` remains as-is for the (unused) whole-app-gate scenario; this is a new, separate file for the read-open/write-gated model actually being adopted.

`schema.sql` is also updated so fresh installs get the correct split from the start (not just existing databases via the migration file).

## Data flow

1. Page loads → Supabase client reads with the `anon` key → works exactly as today (RLS now explicitly allows this).
2. User clicks "Upload", edits a cell, or saves an FTD entry → the handler calls `requireAuth(actualMutation)`.
3. No session → `LoginModal` opens. User signs in (email/password resumes the mutation automatically; Google requires one re-click after the redirect).
4. Session exists → Supabase JS SDK attaches the user's JWT to the request automatically → RLS policy `to authenticated` passes → write succeeds.
5. If the session expired mid-action (edge case), the write is rejected by RLS, and the existing toast error path (`addToast(msg, 'error')`) surfaces it — same as any other save failure today.

## Setup work (manual, outside this codebase)

1. **Google Cloud Console**: create an OAuth 2.0 Client ID (OAuth consent screen + credentials), get Client ID + Secret.
2. **Supabase → Authentication → Providers → Google**: paste the Client ID/Secret, enable the provider.
3. **Supabase → Authentication → Users**: manually add each teammate who needs write access (email/password), OR ensure their email is pre-registered so Google sign-in can match/link to it.
4. Run `auth-write-lockdown.sql` in the Supabase SQL editor.
5. Set the Google OAuth redirect URL in both Google Cloud Console and Supabase to match the deployed app URL (and localhost for dev).

## Risks / things to verify during implementation

- **Google auto-linking behavior**: whether Supabase creates a brand-new user on first Google sign-in (effectively open self-signup) or only succeeds if a matching email already has a user record depends on the "Allow new user signups" project setting, which is currently undetermined for this project. Must be checked against the live Supabase project settings before considering this "admin-created only" in practice — if signups are enabled, any Google account could self-provision write access, undermining that goal.
- **OAuth redirect in local dev**: `redirectTo: window.location.href` needs `localhost` (and its port) allow-listed in both Google Cloud Console and Supabase's redirect URL settings, or the dev flow will fail after Google's consent screen.
