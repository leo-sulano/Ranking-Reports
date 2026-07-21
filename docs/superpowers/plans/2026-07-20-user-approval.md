# User Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone self-register (Google sign-in or a new email/password sign-up form), landing in a `pending` state that can view the dashboard but cannot write anything, until a designated admin approves them from a new admin-only page.

**Architecture:** A new Supabase table `user_access` (one row per auth user: `status` pending/approved, `is_admin` flag) is auto-populated by a Postgres trigger on `auth.users` insert, covering both Google and email/password sign-ups uniformly. The existing `useAuth()` hook (from the write-gated-auth feature) is extended to fetch this row after sign-in and expose `isApproved`/`isAdmin`; its `requireAuth` gate now also rejects with a friendly message when signed in but not yet approved. RLS on the 5 existing app tables is tightened from "any authenticated user" to "authenticated AND approved." A new admin-only page (`/admin/users`) lists all users with Approve/Revoke buttons, backed by an RLS policy that only lets admins update other users' status.

**Tech Stack:** React 19 + TypeScript, Vite, `@supabase/supabase-js`, Tailwind v4. Same testing constraints as the previous feature: no component-testing infrastructure exists (Vitest is node-environment-only, pure-function tests). Verification is `npx tsc -b` plus manual dev-server smoke checks, exactly as before.

## Global Constraints

- This extends the write-gated-auth feature just shipped (`src/lib/useAuth.ts`, `src/components/LoginModal.tsx`, `supabase/auth-write-lockdown.sql`, etc.) — it does not replace any of that mechanism, only adds an approval layer on top of it.
- Do not modify `src/components/AuthGate.tsx`, `src/components/Login.tsx`, `supabase/auth-lockdown.sql`, or the `VITE_REQUIRE_AUTH` flag — unrelated, dormant, out of scope, exactly as in the previous feature.
- `requireAuth`'s identity MUST remain stable (this was the subject of a real bug fixed in the previous feature — a stale closure holding an old `requireAuth` reference must still behave correctly when invoked later, because closures captured before sign-in don't get refreshed mid-execution). Any change to `useAuth.ts` must preserve this: no new `useCallback` dependency that changes on sign-in/sign-out should be added to `requireAuth`'s own dependency array.
- No per-user roles/permissions beyond the two new distinctions (`status`, `is_admin`) — approved non-admin users can still write anything, exactly as before.
- No component-testing infrastructure exists. Verification for each task is `npx tsc -b` plus a manual dev-server smoke check described in the task — there is no automated way to test these React hooks/components/RLS policies in this repo's current test setup.
- Code style: no semicolons at statement ends, 2-space indentation — match the existing files being modified (see `src/lib/auth.ts`, `src/lib/useAuth.ts`, `src/lib/ftdStorage.ts` for reference).

---

### Task 1: Database — `user_access` table, auto-provisioning trigger, and RLS

**Files:**
- Create: `supabase/user-approval.sql`
- Modify: `supabase/schema.sql` (append the same table/trigger/policy definitions, so fresh installs start with this model)

**Interfaces:**
- Produces: table `public.user_access(user_id uuid primary key, email text, status text, is_admin boolean, created_at timestamptz)` — consumed by Task 2's `userAccess.ts` module via columns `user_id`, `email`, `status`, `is_admin`, `created_at`.

- [ ] **Step 1: Write the new migration file**

Create `supabase/user-approval.sql`:

```sql
-- ============================================================================
-- Ranking Reports — USER APPROVAL (self-signup + admin approval)
-- ============================================================================
-- Adds a user_access table tracking approval status + admin flag per user,
-- auto-provisioned via a trigger on auth.users (covers both Google OAuth and
-- email/password signUp), and tightens the write policies from
-- auth-write-lockdown.sql to require an APPROVED session, not just an
-- authenticated one.
--
-- ── CHECKLIST ────────────────────────────────────────────────────────────────
--   1. Run THIS file: Supabase Dashboard → SQL Editor → New query → paste → Run.
--   2. Set your own account as admin (replace the email, then run this
--      statement in the SQL editor):
--        update public.user_access set is_admin = true, status = 'approved'
--        where email = 'you@example.com';
--   3. Supabase Dashboard → Authentication → Providers → Email: turn "Allow
--      new users to sign up" back ON — this reverses auth-write-lockdown.sql's
--      checklist step 3. Approval, not signup-blocking, is now the gate.
--
-- Safe to re-run: every statement is idempotent. The backfill insert uses
-- `on conflict do nothing`, so re-running never resets anyone's status.
-- ============================================================================

create table if not exists public.user_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  status     text not null default 'pending' check (status in ('pending', 'approved')),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.user_access enable row level security;

-- Auto-provision a pending row for every new auth.users insert -----------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_access (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill existing users (created manually during the previous feature's
-- setup) as already-approved, since an admin already vetted them by hand.
insert into public.user_access (user_id, email, status)
select id, email, 'approved' from auth.users
on conflict (user_id) do nothing;

-- RLS: user_access --------------------------------------------------------------
drop policy if exists "self or admin read user_access" on public.user_access;
drop policy if exists "admin update user_access" on public.user_access;

create policy "self or admin read user_access" on public.user_access
  for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.is_admin)
  );

create policy "admin update user_access" on public.user_access
  for update
  using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.is_admin))
  with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.is_admin));

-- RLS: tighten the 5 app tables' write policies to require APPROVAL -----------
-- (not just authentication — replaces the `using (true)` / `with check (true)`
-- policies from auth-write-lockdown.sql with an approval-aware check).

drop policy if exists "auth write snapshots"  on public.snapshots;
drop policy if exists "auth update snapshots" on public.snapshots;
drop policy if exists "auth delete snapshots" on public.snapshots;
create policy "auth write snapshots"  on public.snapshots for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update snapshots" on public.snapshots for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete snapshots" on public.snapshots for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

drop policy if exists "auth write records"  on public.ranking_records;
drop policy if exists "auth update records" on public.ranking_records;
drop policy if exists "auth delete records" on public.ranking_records;
create policy "auth write records"  on public.ranking_records for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update records" on public.ranking_records for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete records" on public.ranking_records for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

drop policy if exists "auth write ftd_records"  on public.ftd_records;
drop policy if exists "auth update ftd_records" on public.ftd_records;
drop policy if exists "auth delete ftd_records" on public.ftd_records;
create policy "auth write ftd_records"  on public.ftd_records for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update ftd_records" on public.ftd_records for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete ftd_records" on public.ftd_records for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

drop policy if exists "auth write ftd_totals"  on public.ftd_totals;
drop policy if exists "auth update ftd_totals" on public.ftd_totals;
drop policy if exists "auth delete ftd_totals" on public.ftd_totals;
create policy "auth write ftd_totals"  on public.ftd_totals for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update ftd_totals" on public.ftd_totals for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete ftd_totals" on public.ftd_totals for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

drop policy if exists "auth write brand_stags"  on public.brand_stags;
drop policy if exists "auth update brand_stags" on public.brand_stags;
drop policy if exists "auth delete brand_stags" on public.brand_stags;
create policy "auth write brand_stags"  on public.brand_stags for insert to authenticated with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth update brand_stags" on public.brand_stags for update to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')) with check (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
create policy "auth delete brand_stags" on public.brand_stags for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
```

- [ ] **Step 2: Append the same definitions to `schema.sql`**

Open `supabase/schema.sql`. At the very end of the file (after the existing `brand_stags` policy block, which currently ends the file), append everything from Step 1's SQL EXCEPT the top comment block (the checklist header) — i.e. append starting from `create table if not exists public.user_access (` through the final `create policy "auth delete brand_stags"...` statement, verbatim. This keeps a fresh install self-contained in one file while the separate `user-approval.sql` remains the migration path for the already-deployed database.

Add a short comment above the appended block instead of the full checklist:
```sql
-- ============================================================================
-- User approval — see user-approval.sql for the full setup checklist
-- (admin seeding, re-enabling signups). Table/trigger/RLS below are identical.
-- ============================================================================
```

- [ ] **Step 3: Read back and verify**

Open both files. Confirm:
- Every table name and policy name matches exactly between `user-approval.sql` and the appended section of `schema.sql`.
- All 5 app tables' write policies (`insert`/`update`/`delete`) now reference `user_access` with `status = 'approved'` — none left as bare `using (true)`.
- The `user_access` table's own `select`/`update` policies are present in both files.
- No `anon` policy anywhere grants insert/update/delete (unchanged from before — this task doesn't touch `anon`'s read-only access).

This file cannot be executed from this session — running it against the live Supabase project is a manual step for the project owner (per the checklist comment in the new file).

- [ ] **Step 4: Commit**

```bash
git add supabase/user-approval.sql supabase/schema.sql
git commit -m "feat: add user_access table, auto-provisioning trigger, and approval-gated RLS"
```

---

### Task 2: Types + `userAccess.ts` data-access module

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/lib/userAccess.ts`

**Interfaces:**
- Consumes: `src/lib/supabase.ts`'s `supabase` client (unchanged).
- Produces (used by Task 4's `useAuth.ts` and Task 7's `AdminUsers.tsx`):
  - `type UserAccessStatus = 'pending' | 'approved'`
  - `interface UserAccessRow { userId: string; email: string; status: UserAccessStatus; isAdmin: boolean; createdAt: string }`
  - `getUserAccess(userId: string): Promise<{ status: UserAccessStatus; isAdmin: boolean } | null>`
  - `listUserAccess(): Promise<UserAccessRow[]>`
  - `updateUserStatus(userId: string, status: UserAccessStatus): Promise<void>`

- [ ] **Step 1: Add the shared types**

In `src/types/index.ts`, add after the `BrandStags` interface (currently the last interface before `ParsedPosition`, around line 100-103):

```ts
export type UserAccessStatus = 'pending' | 'approved'

export interface UserAccessRow {
  userId: string
  email: string
  status: UserAccessStatus
  isAdmin: boolean
  createdAt: string
}
```

- [ ] **Step 2: Write the data-access module**

Create `src/lib/userAccess.ts`:

```ts
import { supabase } from './supabase'
import type { UserAccessRow, UserAccessStatus } from '../types'

interface UserAccessSelf {
  status: UserAccessStatus
  isAdmin: boolean
}

/**
 * The current user's own approval status + admin flag. Returns null if no
 * row exists yet (shouldn't happen once the trigger has run for this user,
 * but callers treat a null result as "not approved" defensively).
 */
export async function getUserAccess(userId: string): Promise<UserAccessSelf | null> {
  const { data, error } = await supabase
    .from('user_access')
    .select('status, is_admin')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { status: data.status as UserAccessStatus, isAdmin: data.is_admin as boolean }
}

/** All users, newest first — for the admin approval page. RLS only returns rows to an admin; a non-admin caller gets just their own row. */
export async function listUserAccess(): Promise<UserAccessRow[]> {
  const { data, error } = await supabase
    .from('user_access')
    .select('user_id, email, status, is_admin, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => ({
    userId: r.user_id as string,
    email: r.email as string,
    status: r.status as UserAccessStatus,
    isAdmin: r.is_admin as boolean,
    createdAt: r.created_at as string,
  }))
}

/** Approve or revoke a user. RLS only allows this for an admin caller. */
export async function updateUserStatus(userId: string, status: UserAccessStatus): Promise<void> {
  const { error } = await supabase.from('user_access').update({ status }).eq('user_id', userId)
  if (error) throw error
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: exits with no output and exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/userAccess.ts
git commit -m "feat: add user_access types and data-access module"
```

---

### Task 3: `signUp()` in the auth module

**Files:**
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Produces: `signUp(email: string, password: string): Promise<void>` — consumed by Task 5's `LoginModal.tsx`.

- [ ] **Step 1: Add the function**

In `src/lib/auth.ts`, add after the existing `signIn` function (after its closing brace, before `signInWithGoogle`):

```ts
/** Create a new account with email + password. The account starts pending admin approval — see user_access. */
export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: exits with no output and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat: add email/password sign-up helper"
```

---

### Task 4: `useAuth()` becomes approval-aware

**Files:**
- Modify: `src/lib/useAuth.ts`

**Interfaces:**
- Consumes: `getUserAccess` (Task 2).
- Produces (used by Task 6's `App.tsx`/`Sidebar.tsx` wiring):
  - `isApproved: boolean` — new field in the hook's return object.
  - `isAdmin: boolean` — new field in the hook's return object.
  - `requireAuth`'s existing signature (`<T>(fn: () => T | Promise<T>) => Promise<T>`) is UNCHANGED, but it now rejects with `Error('Your account is awaiting admin approval')` when the caller is signed in but not approved, instead of always running `fn` when signed in.

This task replaces the ENTIRE contents of `src/lib/useAuth.ts`. Read the current file first — it should match exactly what's shown as the "current" reference below (this is the version left by the write-gated-auth feature, unmodified since).

**Current `src/lib/useAuth.ts` (for reference — do not skip reading the live file, but it should match this):**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthChange } from './auth'

interface PendingAuth {
  run: () => unknown
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const pending = useRef<PendingAuth | null>(null)

  useEffect(() => {
    let cancelled = false

    getSession().then((s) => {
      if (cancelled) return
      sessionRef.current = s
      setSession(s)
    })

    const unsub = onAuthChange((s) => {
      if (cancelled) return
      sessionRef.current = s
      setSession(s)
      if (s) {
        setModalOpen(false)
        if (pending.current) {
          const { run, resolve, reject } = pending.current
          pending.current = null
          Promise.resolve().then(run).then(resolve, reject)
        }
      }
    })

    return () => { cancelled = true; unsub() }
  }, [])

  const requireAuth = useCallback(<T,>(fn: () => T | Promise<T>): Promise<T> => {
    if (sessionRef.current) return Promise.resolve().then(fn)
    return new Promise<T>((resolve, reject) => {
      if (pending.current) {
        pending.current.reject(new Error('Superseded by a newer sign-in request'))
      }
      pending.current = { run: fn, resolve: resolve as (value: unknown) => void, reject }
      setModalOpen(true)
    })
  }, [])

  const openLogin = useCallback(() => setModalOpen(true), [])

  const cancelAuth = useCallback(() => {
    if (pending.current) {
      pending.current.reject(new Error('Sign-in required'))
      pending.current = null
    }
    setModalOpen(false)
  }, [])

  return { session, modalOpen, requireAuth, openLogin, cancelAuth }
}
```

**Why this needs to change, precisely:** today, once a session exists, `requireAuth` immediately runs `fn` — "signed in" was sufficient. Now "signed in" is not enough; the caller must also be *approved*. But approval status requires an async database lookup (`getUserAccess`), so `requireAuth` can't just check a synchronous boolean the instant it's called — it must wait for whatever approval check is currently in flight (or already resolved) before deciding. The SAME wait-then-decide logic is also needed for the "resume after sign-in" path (the `pending.current` mechanism): right after a brand-new sign-up signs someone in, they are unapproved by construction, so resuming their pending write must reject, not run it. Sharing one `runGated` helper between both call sites (immediate `requireAuth` calls and the post-sign-in resume) avoids duplicating this wait-then-decide logic.

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/lib/useAuth.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthChange } from './auth'
import { getUserAccess } from './userAccess'

interface PendingAuth {
  run: () => unknown
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/**
 * Session state + a gate for mutating actions. `requireAuth(fn)` runs `fn`
 * only once the caller is BOTH signed in AND approved (see user_access);
 * otherwise it opens the shared login modal (if signed out) or rejects
 * immediately with a friendly message (if signed in but still pending).
 *
 * `requireAuth` has a stable identity (empty dep array) and reads session /
 * approval state from refs, not React state variables, so that a reference
 * to it captured by an already-running async function — e.g. a second
 * `requireAuth` call inside a multi-write operation that started before
 * sign-in completed — still sees the CURRENT state when it runs, instead of
 * whatever was true when its enclosing closure was created. (This exact
 * failure mode was a real, fixed bug in the write-gated-auth feature — do
 * not reintroduce a `[session]`-style dependency on `requireAuth` itself.)
 *
 * Email/password sign-in resumes a pending action automatically (no page
 * reload). Google's OAuth redirect reloads the page, so a pending `fn` from
 * that path is simply lost; the user re-clicks the action after returning.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const pending = useRef<PendingAuth | null>(null)
  const [isApproved, setIsApproved] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const approvedRef = useRef(false)
  // Resolves once the most recent approval check (for the current session)
  // has finished updating approvedRef/isAdmin. requireAuth and the
  // post-sign-in resume both wait on this before deciding.
  const accessCheck = useRef<Promise<void>>(Promise.resolve())

  const refreshAccess = useCallback((userId: string | undefined) => {
    if (!userId) {
      approvedRef.current = false
      setIsApproved(false)
      setIsAdmin(false)
      accessCheck.current = Promise.resolve()
      return
    }
    accessCheck.current = getUserAccess(userId).then((access) => {
      approvedRef.current = access?.status === 'approved'
      setIsApproved(approvedRef.current)
      setIsAdmin(access?.isAdmin ?? false)
    })
  }, [])

  const runGated = useCallback(<T,>(fn: () => T | Promise<T>): Promise<T> => {
    return accessCheck.current.then(() => {
      if (!approvedRef.current) throw new Error('Your account is awaiting admin approval')
      return fn()
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    getSession().then((s) => {
      if (cancelled) return
      sessionRef.current = s
      setSession(s)
      refreshAccess(s?.user.id)
    })

    const unsub = onAuthChange((s) => {
      if (cancelled) return
      sessionRef.current = s
      setSession(s)
      refreshAccess(s?.user.id)
      if (s) {
        setModalOpen(false)
        if (pending.current) {
          const { run, resolve, reject } = pending.current
          pending.current = null
          runGated(run).then(resolve, reject)
        }
      }
    })

    return () => { cancelled = true; unsub() }
  }, [refreshAccess, runGated])

  const requireAuth = useCallback(<T,>(fn: () => T | Promise<T>): Promise<T> => {
    if (sessionRef.current) return runGated(fn)
    return new Promise<T>((resolve, reject) => {
      // Reject any existing pending auth to prevent orphaning
      if (pending.current) {
        pending.current.reject(new Error('Superseded by a newer sign-in request'))
      }
      pending.current = { run: fn, resolve: resolve as (value: unknown) => void, reject }
      setModalOpen(true)
    })
  }, [runGated])

  const openLogin = useCallback(() => setModalOpen(true), [])

  const cancelAuth = useCallback(() => {
    if (pending.current) {
      pending.current.reject(new Error('Sign-in required'))
      pending.current = null
    }
    setModalOpen(false)
  }, [])

  return { session, modalOpen, requireAuth, openLogin, cancelAuth, isApproved, isAdmin }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: FAILS — `App.tsx` destructures `{ session, modalOpen, requireAuth, openLogin, cancelAuth }` from `useAuth()`, which still works (those 5 fields still exist), so this should actually still pass at this point. Run it anyway and confirm it's clean — if it fails, the failure must be about something else (report it, don't guess).
Expected (corrected): exits with no output and exit code 0. `isApproved`/`isAdmin` are additive fields; nothing currently destructures them, so no existing call site breaks.

- [ ] **Step 3: Manual smoke check — existing behavior unaffected**

Run: `npm run dev`. Without signing in, confirm the dashboard still loads normally (no console errors). Sign in with an existing (already-approved, from the previous feature's manual setup) test account if you have credentials; confirm you can still perform a gated action (e.g. an inline edit) without any "awaiting approval" message — this confirms `runGated` correctly passes through for an already-approved user. If you don't have live credentials to test this, note that in your report and rely on the code trace instead: `getUserAccess` will return `{status: 'approved', ...}` for any user backfilled by Task 1's migration, so `approvedRef.current` becomes `true` and `runGated` lets `fn` through — this depends on Task 1's SQL having been run against the live database, which is a separate manual step; if it hasn't been run yet, `user_access` won't exist yet and `getUserAccess` will throw (table doesn't exist) rather than return null — note this clearly if you observe it, it is expected until Task 1's SQL is actually executed live.

- [ ] **Step 4: Commit**

```bash
git add src/lib/useAuth.ts
git commit -m "feat: useAuth gates on approval status, not just sign-in"
```

---

### Task 5: `LoginModal` gains a sign-up mode

**Files:**
- Modify: `src/components/LoginModal.tsx`

**Interfaces:**
- Consumes: `signUp` (Task 3), existing `signIn`/`signInWithGoogle`.
- Produces: `LoginModal`'s props gain an optional `onSignedUp?: () => void` callback, called after a successful sign-up (before `onClose()`). Consumed by Task 6's `App.tsx`, which will wire it to `addToast`.

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/components/LoginModal.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Lock, LogIn, X } from 'lucide-react'
import { signIn, signInWithGoogle, signUp } from '../lib/auth'

type Mode = 'signin' | 'signup'

/**
 * Shared login/sign-up overlay opened by useAuth() whenever a signed-out
 * user triggers a gated action, or clicks "Sign in" in the Topbar. On
 * successful email/password sign-in, useAuth's onAuthChange listener closes
 * this and resumes whatever action was pending — no logic needed here beyond
 * calling signIn(). Google sign-in redirects the whole page away, so nothing
 * after that call runs. Signing up always closes the modal immediately
 * (via onClose, which useAuth wires to cancelAuth) — a brand-new account is
 * never approved yet, so there's nothing to resume.
 */
export function LoginModal({
  open,
  onClose,
  onSignedUp,
}: {
  open: boolean
  onClose: () => void
  onSignedUp?: () => void
}) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  function toggleMode() {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        await signUp(email.trim(), password)
        onSignedUp?.()
        onClose()
      } else {
        await signIn(email.trim(), password)
      }
    } catch (err) {
      const fallback = mode === 'signup' ? 'Sign-up failed' : 'Sign-in failed'
      setError(err instanceof Error ? err.message : fallback)
      setBusy(false)
    }
  }

  async function handleGoogle() {
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
    }
  }

  return (
    <div
      className="fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-md z-[60] flex items-center justify-center px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        className="relative w-[380px] max-w-full bg-white border border-[#E2E8F0] rounded-[14px] p-7 shadow-[0_40px_80px_rgba(15,23,42,0.18)] animate-[modalIn_0.2s_ease]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center bg-[#F1F5F9] border border-[#E2E8F0] rounded-md text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1] transition-all"
        >
          <X size={14} strokeWidth={2.25} />
        </button>

        <div className="flex items-center gap-2.5 mb-1">
          <span className="grid place-items-center w-8 h-8 rounded-[9px] bg-[#0F172A] text-white">
            <Lock size={15} />
          </span>
          <span className="font-display text-[20px] tracking-wider text-[#0F172A]">
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </span>
        </div>
        <p className="text-[12px] font-mono text-[#64748B] mb-6">
          {mode === 'signup'
            ? 'Create an account — an admin will approve it before you can make changes'
            : 'Sign in to make changes to the dashboard'}
        </p>

        <label className="block text-[11px] font-mono uppercase tracking-wider text-[#64748B] mb-1.5">
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 h-10 rounded-[9px] border border-[#E2E8F0] bg-[#F8FAFC] text-[14px] text-[#0F172A] outline-none focus:border-[#0F172A] focus:bg-white transition-colors"
          placeholder="you@optinetsolutions.com"
        />

        <label className="block text-[11px] font-mono uppercase tracking-wider text-[#64748B] mb-1.5">
          Password
        </label>
        <input
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-5 px-3 h-10 rounded-[9px] border border-[#E2E8F0] bg-[#F8FAFC] text-[14px] text-[#0F172A] outline-none focus:border-[#0F172A] focus:bg-white transition-colors"
          placeholder="••••••••"
        />

        {error && (
          <p className="mb-4 text-[12px] text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-[9px] px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full h-10 rounded-[9px] bg-[#0F172A] text-white text-[13px] font-medium tracking-wider flex items-center justify-center gap-2 hover:bg-[#1E293B] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <LogIn size={15} />
          {busy
            ? (mode === 'signup' ? 'Creating account…' : 'Signing in…')
            : (mode === 'signup' ? 'Create account' : 'Sign in')}
        </button>

        <button
          type="button"
          onClick={toggleMode}
          className="w-full mt-3 text-[12px] font-mono text-[#64748B] hover:text-[#0F172A] transition-colors"
        >
          {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-[#E2E8F0]" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8]">or</span>
          <div className="flex-1 h-px bg-[#E2E8F0]" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="w-full h-10 rounded-[9px] border border-[#E2E8F0] text-[#0F172A] text-[13px] font-medium tracking-wider flex items-center justify-center gap-2 hover:bg-[#F8FAFC] transition-colors"
        >
          Sign in with Google
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: FAILS — `App.tsx` currently renders `<LoginModal open={modalOpen} onClose={cancelAuth} />` without the new optional `onSignedUp` prop. Since `onSignedUp` is OPTIONAL (`onSignedUp?:`), this should NOT actually cause a type error — confirm the type-check is clean. If it unexpectedly fails, the error is not about a missing required prop (there isn't one) — investigate and report the actual cause rather than assuming it's the same "expected failure" pattern from the previous feature's Task 4.
Expected (corrected): exits with no output and exit code 0.

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`. Trigger the login modal (e.g. click "Sign in" in the Topbar while signed out). Confirm:
- The modal defaults to "Sign in" mode.
- Clicking "Don't have an account? Create one" switches to "Create account" mode (heading, subtext, button label, and password `autoComplete` all change; the "or / Sign in with Google" section stays visible in both modes).
- Clicking "Already have an account? Sign in" switches back.
- Submitting the create-account form with a test email/password (this WILL attempt a real Supabase signUp call — if Supabase's public signups are currently disabled per the previous feature's checklist, expect this to fail with a Supabase error message shown in the red error banner; that is expected until the operator re-enables signups per Task 1's checklist, not a bug in this component).

- [ ] **Step 4: Commit**

```bash
git add src/components/LoginModal.tsx
git commit -m "feat: LoginModal gains a sign-up mode"
```

---

### Task 6: Wire approval state into `Layout`, `Topbar` unaffected, add the admin route + nav entry

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `useAuth()`'s new `isApproved`/`isAdmin` fields (Task 4), `LoginModal`'s new `onSignedUp` prop (Task 5).
- Produces: a new route `/admin/users` in `App.tsx` (element supplied by Task 7, not yet created — this task adds the route pointing at a component that Task 7 will create at `src/pages/AdminUsers.tsx`; until Task 7 lands, the import will fail, which is fine since Task 7 runs immediately after and this task's own verification only needs to get as far as confirming the wiring is otherwise correct — see Step 4's expected failure).

- [ ] **Step 1: Destructure the new fields and pass `onSignedUp` to `LoginModal`**

In `src/App.tsx`, change line 52:
```ts
  const { session, modalOpen, requireAuth, openLogin, cancelAuth } = useAuth()
```
to:
```ts
  const { session, modalOpen, requireAuth, openLogin, cancelAuth, isAdmin } = useAuth()
```

Change the `<LoginModal>` render (currently `<LoginModal open={modalOpen} onClose={cancelAuth} />`, around line 412):
```tsx
      <LoginModal
        open={modalOpen}
        onClose={cancelAuth}
        onSignedUp={() => addToast('Account created — an admin will approve your access shortly.')}
      />
```

- [ ] **Step 2: Pass `isAdmin` to `Sidebar`**

In `src/App.tsx`, update the `<Sidebar>` element (currently lines 353-360):
```tsx
      <Sidebar
        uploadDate={activeSnapshot?.displayDate ?? null}
        onOpenUpload={() => setShowUpload(true)}
        activeBPBrand={bpFilterBrand}
        onSelectBPBrand={setBPFilterBrand}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        isAdmin={isAdmin}
      />
```

- [ ] **Step 3: Add the admin route**

In `src/App.tsx`, add the import near the other page imports (after `import { HowItWorks } from './pages/HowItWorks'`):
```ts
import { AdminUsers }   from './pages/AdminUsers'
```

Add the route inside the existing `<Route element={<Layout />}>` block, after the `/how-it-works` route:
```tsx
          <Route path="/admin/users"      element={<AdminUsers />} />
```

- [ ] **Step 4: Type-check (expected to fail until Task 7)**

Run: `npx tsc -b`
Expected: FAILS with a module-not-found error for `./pages/AdminUsers` (it doesn't exist yet — Task 7 creates it next). Confirm the ONLY error is this missing-module error — no other unrelated type errors from this task's own changes (the `isAdmin`/`onSignedUp` wiring should be otherwise clean). This is the same "intentionally left failure" pattern used in the previous feature's Task 4/Task 5 boundary.

- [ ] **Step 5: Update `Sidebar.tsx`**

Replace the full contents of `src/components/Sidebar.tsx`:

```tsx
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AiIcon } from './Assistant/AiIcon'
import { CircleHelp, DollarSign, ShieldCheck } from 'lucide-react'
import { BRANDS, brandToSlug } from '../lib/brands'

const PAGES: Array<{ path: string; label: string; icon: ReactNode; activePath?: string }> = [
  { path: '/', label: 'Home', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )},
  { path: '/bp-sites', label: 'BP Sites', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  )},
  { path: '/lp-sites', label: 'LP Sites', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="9" y1="21" x2="9" y2="9"/>
    </svg>
  )},
  { path: '/ftds', label: 'FTDs', icon: (
    <DollarSign size={18} />
  )},
  { path: '/ask-ai', label: 'Ask AI', icon: (
    <AiIcon size={18} />
  )},
  { path: '/how-it-works', label: 'How It Works', icon: (
    <CircleHelp size={18} />
  )},
]

const ADMIN_PAGE = { path: '/admin/users', label: 'Admin', icon: <ShieldCheck size={18} /> }

interface Props {
  uploadDate: string | null
  onOpenUpload: () => void
  activeBPBrand: string | null
  onSelectBPBrand: (name: string | null) => void
  mobileOpen?: boolean
  onMobileClose?: () => void
  isAdmin: boolean
}

export function Sidebar({
  uploadDate,
  onOpenUpload,
  activeBPBrand,
  onSelectBPBrand,
  mobileOpen = false,
  onMobileClose,
  isAdmin,
}: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const isBPSitesRoute = location.pathname.startsWith('/bp-sites')
  const isLPSitesRoute = location.pathname.startsWith('/lp-sites')
  const hasBrandList   = isBPSitesRoute || isLPSitesRoute
  const pages = isAdmin ? [...PAGES, ADMIN_PAGE] : PAGES

  const isActivePath = (p: string) =>
    p === '/' ? location.pathname === '/' : location.pathname.startsWith(p)

  // Close drawer on route change
  useEffect(() => { onMobileClose?.() }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  function SidebarInner({ isMobile }: { isMobile: boolean }) {
    const labelCls = isMobile
      ? 'whitespace-nowrap'
      : 'whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150'

    return (
      <aside
        className={
          isMobile
            ? 'flex flex-col bg-white h-full w-[240px] border-r border-[#E5E4DF] overflow-hidden'
            : 'group absolute top-0 left-0 bottom-0 w-[64px] hover:w-[240px] flex flex-col bg-white border-r border-[#E5E4DF] overflow-hidden transition-[width] duration-200 ease-out hover:shadow-[8px_0_32px_rgba(0,0,0,0.06)]'
        }
      >
        {/* Logo */}
        <div className="px-3 pt-5 pb-4 border-b border-[#EEEEE9] shrink-0 flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#0A0A0A] text-white font-display text-[13px] tracking-wider shrink-0">
            RR
          </div>
          <div className={labelCls}>
            <div className="font-display text-[14px] tracking-widest text-[#0A0A0A] leading-none">
              RANKING REPORTS
            </div>
            <div className="text-[9px] text-[#ABABAA] uppercase tracking-[0.12em] mt-1">
              Rooster Partners
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="px-2 pt-3 pb-3 border-b border-[#EEEEE9] space-y-0.5 shrink-0">
          {pages.map((p) => {
            const active = isActivePath(p.activePath ?? p.path)
            return (
              <button
                key={p.path}
                onClick={() => navigate(p.path)}
                title={p.label}
                className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors relative ${
                  active ? 'bg-[#FFF5F5]' : 'hover:bg-[#F7F7F5]'
                }`}
                style={active ? { borderLeft: '2px solid #CC0000', paddingLeft: '10px' } : {}}
              >
                <span
                  className="w-[18px] flex items-center justify-center shrink-0"
                  style={{ color: active ? '#CC0000' : '#ABABAA' }}
                >
                  {p.icon}
                </span>
                <span
                  className={`text-[12px] font-semibold ${labelCls}`}
                  style={{ color: active ? '#0A0A0A' : '#6B6B65' }}
                >
                  {p.label}
                </span>
              </button>
            )
          })}
        </nav>

        {/* Brand sub-list */}
        {hasBrandList ? (
          <div className={`flex-1 flex flex-col min-h-0 ${labelCls}`}>
            <div className="flex items-center gap-2 px-5 pt-4 pb-2 shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ABABAA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ABABAA] whitespace-nowrap">
                {isBPSitesRoute ? 'BP Sites' : 'LP Sites'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 space-y-0.5">
              {BRANDS.map((brand) => {
                const activeSlug = isBPSitesRoute
                  ? (location.pathname.startsWith('/bp-sites/') ? location.pathname.slice('/bp-sites/'.length).split('/')[0] : null)
                  : (location.pathname.startsWith('/lp-sites/') ? location.pathname.slice('/lp-sites/'.length).split('/')[0] : null)
                const isActive = activeSlug === brandToSlug(brand.name)
                return (
                  <button
                    key={brand.name}
                    onClick={() => {
                      navigate(isBPSitesRoute
                        ? `/bp-sites/${brandToSlug(brand.name)}`
                        : `/lp-sites/${brandToSlug(brand.name)}`)
                    }}
                    className={`flex items-center w-full px-3 py-2 rounded-lg text-left transition-colors ${
                      isActive ? 'bg-[#F7F7F5]' : 'hover:bg-[#F7F7F5]'
                    }`}
                  >
                    <div className="text-[12px] font-semibold text-[#0A0A0A] truncate whitespace-nowrap">
                      {brand.name}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* Footer */}
        <div className="p-2 border-t border-[#EEEEE9] shrink-0">
          <button
            onClick={onOpenUpload}
            title="Import Data"
            className="w-full flex items-center gap-3 px-3 py-2 bg-[#CC0000] text-white rounded-lg text-[12px] font-bold transition-all hover:bg-[#AA0000] active:scale-95"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className={labelCls}>Import Data</span>
          </button>
          {uploadDate && (
            <p className={`text-center text-[10px] text-[#ABABAA] font-mono mt-2 ${labelCls}`}>
              Updated: {uploadDate}
            </p>
          )}
        </div>
      </aside>
    )
  }

  return (
    <>
      {/* Desktop — fixed-width placeholder keeps layout stable */}
      <div className="hidden sm:block w-[64px] shrink-0 h-screen relative z-30">
        <SidebarInner isMobile={false} />
      </div>

      {/* Mobile drawer + backdrop */}
      <div
        className={`sm:hidden fixed inset-0 bg-black/40 z-[39] transition-opacity duration-200 ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onMobileClose}
      />
      <div
        className={`sm:hidden fixed top-0 left-0 bottom-0 z-40 shadow-[8px_0_32px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarInner isMobile={true} />
      </div>
    </>
  )
}
```

(The only changes from the current file: `ShieldCheck` added to the `lucide-react` import; the new `ADMIN_PAGE` constant; `isAdmin` added to `Props` and the destructured params; `const pages = isAdmin ? [...PAGES, ADMIN_PAGE] : PAGES` replacing the direct use of `PAGES`; and the nav `.map` now iterates `pages` instead of `PAGES`. Everything else — brand sub-list, footer, mobile drawer — is unchanged.)

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat: wire approval state into Layout, add admin nav entry and route"
```

(Type-check will still fail here exactly as confirmed in Step 4 — that's expected and resolved by Task 7. Do not attempt to work around it by stubbing `AdminUsers` yourself.)

---

### Task 7: Admin page — list users, approve/revoke

**Files:**
- Create: `src/pages/AdminUsers.tsx`

**Interfaces:**
- Consumes: `listUserAccess`, `updateUserStatus` (Task 2); `RROutletContext.addToast` and `RROutletContext.requireAuth` (existing, via `useOutletContext`).

- [ ] **Step 1: Write the page**

Create `src/pages/AdminUsers.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Check, RotateCcw } from 'lucide-react'
import { listUserAccess, updateUserStatus } from '../lib/userAccess'
import type { RROutletContext, UserAccessRow, UserAccessStatus } from '../types'

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function AdminUsers() {
  const { addToast, requireAuth } = useOutletContext<RROutletContext>()
  const [rows, setRows] = useState<UserAccessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listUserAccess()
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        addToast(`Failed to load users: ${formatError(err)}`, 'error')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [addToast])

  const handleSetStatus = useCallback(async (userId: string, status: UserAccessStatus) => {
    setBusyUserId(userId)
    try {
      await requireAuth(() => updateUserStatus(userId, status))
    } catch (err) {
      addToast(`Update failed: ${formatError(err)}`, 'error')
      setBusyUserId(null)
      return
    }
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, status } : r)))
    setBusyUserId(null)
    addToast(status === 'approved' ? '✓ User approved' : '✓ User access revoked')
  }, [addToast, requireAuth])

  const pending  = rows.filter((r) => r.status === 'pending')
  const approved = rows.filter((r) => r.status === 'approved')

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-[#94A3B8] font-mono text-[12px] tracking-wider">
        Loading users…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto px-3 sm:px-7 pb-7 pt-5">
      <h2 className="font-display text-[16px] tracking-wider text-[#0F172A] mb-4">
        Pending approval ({pending.length})
      </h2>
      <div className="border border-[#E2E8F0] rounded-md overflow-hidden mb-8">
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-center text-[#94A3B8] text-[12px]">No pending sign-ups.</p>
        ) : (
          <div className="divide-y divide-[#F1F5F9]">
            {pending.map((r) => (
              <div key={r.userId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[13px] font-semibold text-[#0F172A]">{r.email}</div>
                  <div className="text-[11px] font-mono text-[#94A3B8]">Signed up {formatDate(r.createdAt)}</div>
                </div>
                <button
                  onClick={() => handleSetStatus(r.userId, 'approved')}
                  disabled={busyUserId === r.userId}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold text-white bg-[#0F172A] hover:bg-[#1E293B] disabled:opacity-50 transition-colors"
                >
                  <Check size={13} strokeWidth={2.5} />
                  Approve
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="font-display text-[16px] tracking-wider text-[#0F172A] mb-4">
        Approved ({approved.length})
      </h2>
      <div className="border border-[#E2E8F0] rounded-md overflow-hidden">
        {approved.length === 0 ? (
          <p className="px-4 py-6 text-center text-[#94A3B8] text-[12px]">No approved users yet.</p>
        ) : (
          <div className="divide-y divide-[#F1F5F9]">
            {approved.map((r) => (
              <div key={r.userId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[13px] font-semibold text-[#0F172A] flex items-center gap-2">
                    {r.email}
                    {r.isAdmin && (
                      <span className="text-[9px] uppercase tracking-wide font-bold text-white bg-[#8B5CF6] rounded px-1.5 py-0.5">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-[#94A3B8]">Signed up {formatDate(r.createdAt)}</div>
                </div>
                <button
                  onClick={() => handleSetStatus(r.userId, 'pending')}
                  disabled={busyUserId === r.userId}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A] hover:border-[#CBD5E1] disabled:opacity-50 transition-colors"
                >
                  <RotateCcw size={13} strokeWidth={2.25} />
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: exits with no output and exit code 0. This resolves Task 6's intentionally-left failure (`./pages/AdminUsers` now exists).

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`. This step depends on Task 1's SQL having been run against the live database, and on your own account having `is_admin = true` set (per Task 1's checklist step 2) — if that hasn't happened yet, note it and skip to reasoning about the code instead.

If the database side is ready:
1. Sign in with your admin account. Confirm an "Admin" nav entry now appears in the Sidebar (it should NOT appear when signed out or signed in as a non-admin).
2. Navigate to `/admin/users`. Confirm it lists pending and approved sections. If you have a pending self-registered test account (from Task 5's smoke check, if that signUp succeeded), confirm it shows under "Pending approval" with an "Approve" button.
3. Click "Approve" on a pending user. Confirm it moves to the "Approved" section without a page reload, and a success toast appears.
4. Click "Revoke" on an approved (non-admin) user. Confirm it moves back to "Pending" and a success toast appears.
5. Check the browser console for errors during these actions.

If the database side is NOT ready yet, report that clearly as a deferred manual step (same pattern as the previous feature's Task 7) rather than attempting to fake or skip the check silently.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminUsers.tsx
git commit -m "feat: add admin users page (approve/revoke)"
```

---

## Self-Review Notes

- **Spec coverage:** self-signup via Google (unchanged flow) AND email/password (new `signUp` + `LoginModal` toggle) ✓; pending users get full read-only dashboard, no blocking screen (nothing added that would block viewing — only `requireAuth`'s write gate changed) ✓; admin designation via table (`user_access.is_admin`, seeded by SQL, not code) ✓; write gate now requires signed-in AND approved (RLS + client-side `runGated`) ✓; admin page with approve AND revoke ✓.
- **Dependency ordering:** Task 4 depends on Task 2's `getUserAccess`; Task 5 depends on Task 3's `signUp`; Task 6 depends on Tasks 2/4/5's new fields/props and references Task 7's not-yet-created page (explicitly called out as an expected intermediate failure, same pattern as the previous feature); Task 7 depends on Task 2's `listUserAccess`/`updateUserStatus`.
- **`requireAuth` identity stability:** re-verified in Task 4's replacement code — `requireAuth`'s own `useCallback` still has no dependency that changes across sign-in/out (`[runGated]`, and `runGated` itself has `[]`), preserving the fix from the previous feature's final review.
- **No fabricated tests:** every verification step is `npx tsc -b` (real, runnable) or an explicit manual browser check, several of which are explicitly gated on the operator having completed Task 1's live SQL execution — none of these claim automated coverage the repo can't actually run.
