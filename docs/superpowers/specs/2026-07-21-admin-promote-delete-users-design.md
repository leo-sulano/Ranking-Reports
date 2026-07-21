# Admin: promote users to admin, delete users

## Problem

`AdminUsers.tsx` currently lets an admin approve or revoke a user's access, but has no way to:
1. Promote an approved user to admin (or demote an existing admin back to a regular user).
2. Permanently delete a user's account.

Both are needed so admins can fully manage the user base without going into the Supabase dashboard by hand.

## Goals

- An admin can toggle `is_admin` on any approved user other than themself.
- An admin can permanently delete any user (pending or approved) other than themself, removing their `auth.users` account entirely.
- Both actions follow the existing UX conventions in `AdminUsers.tsx` (busy-state disabling, toasts, self-row exclusion, `window.confirm` for destructive actions).

## Non-goals

- No change to the approve/revoke flow, which is unaffected by this work.
- No bulk actions (multi-select promote/delete) — one row at a time, same as today.
- No email notification to the deleted/promoted user.
- No UI to *re-create* a deleted user's account — deletion is final; they'd have to sign up again from scratch.

## Architecture

### 1. Promote / demote admin (client-only, no migration)

The existing `admin update user_access` RLS policy (`supabase/user-approval.sql`) already permits an admin caller to update any column — including `is_admin` — on any row via `using (public.user_is_admin()) with check (public.user_is_admin())`. No SQL changes are needed.

- `src/lib/userAccess.ts` gains `updateUserAdmin(userId: string, isAdmin: boolean): Promise<void>`, mirroring `updateUserStatus`.
- `AdminUsers.tsx`: each row in the **Approved** section gets a "Make admin" / "Remove admin" button next to the existing Revoke button, styled the same way (secondary/outline button). Hidden on the current user's own row (`r.userId === currentUserId`), matching the existing Revoke exclusion — this blocks self-demote, so an admin can never strip their own access with no one left to undo it.
- On click: `busyUserId` gates the row, `requireAuth(() => updateUserAdmin(userId, next))` runs, local `rows` state is patched optimistically on success, and a toast fires (`✓ Made admin` / `✓ Admin removed`).

### 2. Delete user (new Edge Function + client call)

Full account deletion requires Supabase's `auth.admin.deleteUser()`, which only works with the **service-role key** — never exposed to the browser. This needs a new server-side Edge Function.

**New function: `supabase/functions/delete-user/index.ts`**

Deployed with default JWT verification enabled (unlike the existing `assistant` function, which runs `--no-verify-jwt` — this function performs a destructive, privileged action and must require a valid caller session).

Request: `POST { userId: string }` with the caller's session `Authorization` header (sent automatically by `supabase.functions.invoke`).

Handler flow:
1. Resolve the caller's identity: create an anon-key Supabase client using the incoming `Authorization` header, call `.auth.getUser()` to get the caller's `userId`. Reject (401) if this fails.
2. Create a **service-role** Supabase client (server-side only; `SUPABASE_SERVICE_ROLE_KEY` secret). Query `user_access` for the caller's `is_admin` — reject (403) if not true.
3. Reject (400) if `body.userId === callerUserId` (no self-delete).
4. Call `serviceClient.auth.admin.deleteUser(body.userId)`. The `user_access` row cascades away automatically — its FK is `user_id uuid primary key references auth.users(id) on delete cascade` — so no separate table delete step is needed.
5. Return `{ ok: true }` (200) on success, or `{ error: message }` with the appropriate status on failure.

**Client: `src/lib/userAccess.ts`** gains `deleteUser(userId: string): Promise<void>`, calling `supabase.functions.invoke('delete-user', { body: { userId } })` and throwing on a non-ok response — same invoke pattern already used for the `assistant` function elsewhere in the app.

**Deploy dependency:** deploying this function requires `supabase login` as the account that owns this project's org (`cuxifdybutimtugduqdi`), then:
```
supabase functions deploy delete-user --project-ref assqmmenobaflmcabkpu
```
(No `--no-verify-jwt` flag this time — default JWT verification should stay on.) `SUPABASE_SERVICE_ROLE_KEY` is already available to every Edge Function automatically as an environment variable; no manual secret-setting step is needed for it.

### 3. UI + error handling

- A "Delete" button (destructive styling — red text/border, consistent with the codebase's existing warning/error color use) appears on every row in **both** the Pending and Approved sections, except the current user's own row.
- Clicking calls `window.confirm(`Delete ${r.email}? This cannot be undone.`)` — the same pattern `handleDeleteSnapshot` already uses in `App.tsx`. Only proceeds if confirmed.
- On confirm: `busyUserId` gates the row, `requireAuth(() => deleteUser(userId))` runs. On success, the row is removed from local `rows` state and a toast fires (`✓ User deleted`). On failure, `formatError` renders the error in an error toast — identical error-handling shape to the existing approve/revoke handler.
- Busy-state reuses the existing `busyUserId` single-in-flight-action mechanic — no new concurrency handling needed.

## Testing / verification

No test suite is configured. Manual verification via dev server, once the Edge Function is deployed:

- **Promote:** as an admin, click "Make admin" on an approved non-admin row → badge appears, button flips to "Remove admin". Refresh page → state persists (confirms the RLS update actually landed, not just local state).
- **Demote:** click "Remove admin" on another admin's row → badge disappears. Confirm the button never renders on your own row.
- **Delete (pending row):** click Delete on a pending sign-up → confirm dialog → row disappears from Pending; confirm in the Supabase dashboard that the `auth.users` row is gone too (not just `user_access`).
- **Delete (approved row):** same, from the Approved section.
- **Self-delete blocked:** confirm no Delete button renders on your own row.
- **Non-admin caller rejected:** call the Edge Function directly (e.g. via `curl` with a non-admin user's JWT) → expect 403.
- **Unauthenticated caller rejected:** call with no/garbage `Authorization` header → expect 401.

## Risks / things to verify during implementation

- Confirm `SUPABASE_SERVICE_ROLE_KEY` is actually present in the deployed function's environment (Supabase injects it automatically for all Edge Functions, but worth a sanity `Deno.env.get` check during manual testing).
- Confirm the CLI is logged into the account owning org `cuxifdybutimtugduqdi` before attempting deploy — `supabase projects list` should show `assqmmenobaflmcabkpu` in the output. As of this session it did not (CLI was logged into the `wqshwzsvdpazlcgyntge` "Optinet Solutions" account instead); the user is logging in separately before implementation proceeds.
