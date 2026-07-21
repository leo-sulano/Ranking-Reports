# Guard the /admin/users route for non-admins

## Problem

The "Users" nav link is already hidden from non-admins (`Sidebar.tsx`'s `isAdmin ? [...PAGES, ADMIN_PAGE] : PAGES`), but the underlying route, `/admin/users`, has no guard of its own. Any signed-in, non-admin user who types or bookmarks that URL directly still lands on `AdminUsers.tsx`. Postgres RLS already stops them from seeing other users' rows or mutating anything (`self or admin read user_access` / `admin update user_access`), so this isn't a data leak — but it's a rough edge: they see a stripped-down, mostly-empty admin page instead of being sent back into the app.

## Goals

- A non-admin who navigates to `/admin/users` directly is redirected to `/` instead of seeing the page.
- An actual admin loading `/admin/users` on a hard refresh is never falsely redirected during the brief window before their `isAdmin` status has loaded from Supabase.

## Non-goals

- No change to the actual enforcement boundary — RLS remains the real security control, exactly as noted in the original `user-approval` design. This is a UX-layer redirect, not a new permission check.
- No change to nav-hiding behavior, which already works correctly.

## Architecture

### `RROutletContext` gains two fields

`isAdmin: boolean` and `accessLoading: boolean` are added to `RROutletContext` (`src/types/index.ts`). Both values already exist in `Layout` (`App.tsx`) from `useAuth()` — they're simply not threaded through the outlet context yet (today `App.tsx` only passes `isAdmin` directly to `Sidebar` as a prop). `Layout`'s `rrContext` object gains both fields alongside the existing ones.

### `AdminUsers.tsx` guard

At the top of the component, destructure `isAdmin` and `accessLoading` from `useOutletContext<RROutletContext>()`:

- While `accessLoading` is `true`, render the existing "Loading users…" state (reused as-is) — this is the same window `getWriteGate` already treats as "don't decide yet" elsewhere in the app, so the pattern is consistent.
- Once `accessLoading` is `false`: if `!isAdmin`, render `<Navigate to="/" replace />` (from `react-router-dom`, already a project dependency) instead of the page content.
- If `isAdmin` is `true`, render the page exactly as it does today (no change to the existing pending/approved list logic).

## Data flow / error handling

No new data flow — `isAdmin`/`accessLoading` are read-only values already computed by `useAuth`. The redirect is a pure render-time decision; no new requests, no new error states.

## Testing / verification

No test suite configured. Manual verification via dev server:
- As a non-admin (approved, non-admin `user_access` row): navigate directly to `/admin/users` → redirected to `/`.
- As an admin: navigate directly to `/admin/users` (hard refresh) → page loads normally, no flash of redirect.
- As a signed-out visitor: navigating to `/admin/users` → same redirect-to-`/` behavior as a non-admin (`accessLoading` resolves to `false` and `isAdmin` to `false` immediately, via the existing `refreshAccess` "no userId" branch — no `getUserAccess` call needed).

## Risks / things to verify during implementation

- Confirm the "no userId" branch in `useAuth.refreshAccess` sets `accessLoading` to `false` synchronously (it does, per existing code) so a signed-out visit to `/admin/users` doesn't hang on a permanent loading state before redirecting.
