# User approval workflow (self-signup + admin approval)

## Problem

The write-gated auth feature just shipped requires an admin to manually create every user in the Supabase dashboard, with public signups disabled. That's fine for a handful of known teammates, but doesn't scale to "anyone can try to sign in, and an admin reviews and approves them" — which is what's actually wanted. Right now there's also no concept of an "admin" distinct from any other authenticated user (any signed-in user can write anything).

## Goals

- Anyone can self-register — via Google sign-in OR a new email/password sign-up form — creating an account on their own, without an admin pre-creating it.
- A newly self-registered account starts in a `pending` state and CANNOT write anything until an admin approves it. Viewing the dashboard stays open regardless (unchanged from before).
- A small set of designated admins can see a list of pending (and approved) users and approve or revoke them, enforced at the database level, not just hidden in the UI.
- Admin designation is data (a table), not code — adding a second admin later is a SQL statement, not a deploy.

## Non-goals

- No fine-grained per-page/per-table permissions. Approved (non-admin) users can still write anything, exactly as in the previous feature — the only new distinction is pending vs. approved vs. admin.
- No self-revocation or admin promotion/demotion UI. The first admin(s) are seeded via a manual SQL statement during setup; admins can revoke/approve other users' `status`, but nothing in this feature lets anyone change `is_admin` from the UI.
- No custom email-confirmation UI. Supabase's built-in "Confirm email" project setting (on or off) governs whether `signUp` requires clicking a verification link; this feature doesn't build anything on top of that either way.
- No change to the previous feature's `requireAuth`/`LoginModal`/RLS mechanics beyond what's described below — this extends that feature, it doesn't replace it.

## Architecture

### Data model: `user_access`

```sql
create table public.user_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  status     text not null default 'pending' check (status in ('pending', 'approved')),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
```

One row per Supabase Auth user. This is the single source of truth for both "can this user write?" (`status`) and "can this user approve others?" (`is_admin`).

### Auto-provisioning: a trigger on `auth.users`

A `security definer` Postgres function + `after insert` trigger on `auth.users` inserts a matching `pending`, non-admin row into `user_access` for every new account — regardless of whether the account was created via Google OAuth or email/password `signUp`. This guarantees no account can exist without a status row, and keeps the client from needing any special "create my profile" code path (which would otherwise need its own RLS carve-out).

### Backfill for existing users

A one-time migration statement inserts `user_access` rows for any `auth.users` row that predates the trigger (the teammates manually added during the previous feature's setup), defaulting them to `status = 'approved'` (they were already manually vetted by an admin). A second statement sets `is_admin = true` for the account(s) designated as admin (by email), run once during setup.

### RLS: `user_access`

- `select`: a user can read their own row; an admin can read every row.
  ```sql
  using (user_id = auth.uid() or exists (
    select 1 from public.user_access a where a.user_id = auth.uid() and a.is_admin
  ))
  ```
- `update`: admin-only, any row.
  ```sql
  using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.is_admin))
  with check (same)
  ```
- `insert` / `delete`: no policy for any role — rows are created exclusively by the trigger (which runs as the function owner, bypassing RLS), so no client can insert a self-approved row.

### RLS: the 5 existing app tables

The write policies shipped in the previous feature (`to authenticated using (true)`) on `snapshots`, `ranking_records`, `ftd_records`, `ftd_totals`, `brand_stags` are tightened to also require approval:

```sql
to authenticated
using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'))
with check (same)
```

`select` policies (open to `anon`) are unchanged — viewing stays open to everyone regardless of sign-in or approval state.

### Client: sign-up

`src/lib/auth.ts` gains `signUp(email, password): Promise<void>`, calling `supabase.auth.signUp`. `LoginModal` gains a toggle between "Sign in" and "Create account" modes; submitting the create-account form calls `signUp` and, on success, shows a toast: "Account created — an admin will approve your access shortly." (Exact behavior — whether a session is returned immediately or an email-confirmation step is required first — depends on the Supabase project's "Confirm email" setting, which this feature doesn't change; the UI handles both cases by showing the same confirmation toast and closing the modal, since either way the account now exists and is pending.)

Google sign-in is unchanged — it already creates a new account on first use, which the trigger picks up the same way.

### Client: knowing your own status

`useAuth` (from the previous feature) is extended to fetch the caller's `user_access` row once a session exists (and re-fetch on auth change), exposing two new fields alongside the existing ones: `isApproved: boolean` and `isAdmin: boolean`.

`requireAuth` gains an early check: if a session exists but `isApproved` is false, it rejects immediately with `new Error('Your account is awaiting admin approval')` instead of letting the write hit Supabase and bounce off RLS with a raw Postgres error. This surfaces through the exact same toast path every other `requireAuth` rejection already uses — no new UI needed, just a clearer message for this specific case.

Approved and pending users otherwise see the identical dashboard — no blocking screen, per the earlier decision.

### Client: admin page

A new route, `/admin/users`, rendering a new `AdminUsers` page component. A new nav entry in `Sidebar.tsx` renders only when `isAdmin` is true. The page lists every `user_access` row (pending first, then approved), showing email, status, and sign-up date, with:
- **Approve** button on pending rows → updates `status` to `'approved'`.
- **Revoke** button on approved rows → updates `status` to `'pending'`.

Both actions call a small new `src/lib/userAccess.ts` module (`listUserAccess()`, `updateUserStatus(userId, status)`), following the existing `ftdStorage.ts`/`storage.ts` pattern of thin Supabase-calling functions. The RLS `update` policy above is what actually prevents a non-admin from performing these actions even if they somehow reached the page directly — the nav-hiding is UX, not the security boundary.

## Setup work (manual, outside this codebase)

1. Run the new SQL migration (table, trigger, RLS policies, backfill, admin seed — see implementation plan for exact SQL).
2. In Supabase Dashboard → Authentication → Providers → Email: turn "Allow new users to sign up" back **ON** — this reverses the previous feature's setup step, since self-signup is now required for this flow to have any effect. Approval, not signup-blocking, is now the gate.
3. Confirm the Google provider (already configured) still works for first-time sign-ins — no change needed there, just re-verify no "signups disabled" project-level toggle blocks it.
4. Decide (project owner's call, not part of this build) whether to enable Supabase's "Confirm email" setting for email/password sign-ups.

## Risks / things to verify during implementation

- The trigger function must be `security definer` and owned by a role with insert rights on `user_access`, or new-user provisioning will silently fail (the auth.users insert would still succeed since the trigger failing on `after insert` can either roll back the whole signup or fail silently depending on trigger error handling — this needs to be verified against Supabase's documented pattern for profile-table triggers during implementation, not assumed).
- Re-enabling "Allow new users to sign up" also re-opens the *email/password* self-registration path, not just Google — confirm this is genuinely wanted for both (per the approved design) and not just Google.
