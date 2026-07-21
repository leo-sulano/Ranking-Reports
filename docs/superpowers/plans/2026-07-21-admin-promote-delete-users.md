# Admin Promote/Delete Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin promote/demote another user's admin status, and permanently delete a user's account, from `AdminUsers.tsx`.

**Architecture:** Promote/demote is a pure client + RLS change (the existing `admin update user_access` policy already allows it). Delete requires a new Edge Function (`delete-user`) that uses the service-role key to call `auth.admin.deleteUser()`, since that capability can never be exposed to the browser client.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + Auth + Edge Functions / Deno). No test suite configured — verification is `npm run build` (type-check) after each task, plus manual testing in the dev server and via `curl` for the Edge Function.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-admin-promote-delete-users-design.md`
- No self-demote and no self-delete — both actions must stay hidden on the current user's own row (`r.userId === currentUserId`), matching the existing Revoke exclusion.
- Delete is irreversible — the UI must confirm via `window.confirm(...)` before calling the Edge Function, same pattern as `handleDeleteSnapshot` in `App.tsx:272`.
- The `delete-user` Edge Function must be deployed with default JWT verification (no `--no-verify-jwt`), unlike the existing `assistant` function.
- Verification command after each task: `npm run build` — must exit 0 with no type errors.
- Deploying the Edge Function (Task 2) requires the Supabase CLI to be logged into the account that owns org `cuxifdybutimtugduqdi` — confirm with `supabase projects list` showing `assqmmenobaflmcabkpu` before attempting deploy. As of this plan being written, the CLI was still logged into a different account (`wqshwzsvdpazlcgyntge`); re-check before Task 2's deploy step.

---

### Task 1: Promote / demote admin

**Files:**
- Modify: `src/lib/userAccess.ts` (add `updateUserAdmin`)
- Modify: `src/pages/AdminUsers.tsx` (imports, `handleSetAdmin`, Approved-row JSX)

**Interfaces:**
- Consumes: existing `UserAccessRow.isAdmin: boolean`, `busyUserId`, `requireAuth`, `addToast`, `formatError` — all already defined in `AdminUsers.tsx`.
- Produces: `updateUserAdmin(userId: string, isAdmin: boolean): Promise<void>` in `userAccess.ts`, consumed by this task's own `handleSetAdmin` (no other task depends on it).

- [ ] **Step 1: Add `updateUserAdmin` to `userAccess.ts`**

`src/lib/userAccess.ts` currently ends with:

```ts
/** Approve or revoke a user. RLS only allows this for an admin caller. */
export async function updateUserStatus(userId: string, status: UserAccessStatus): Promise<void> {
  const { error } = await supabase.from('user_access').update({ status }).eq('user_id', userId)
  if (error) throw error
}
```

Add this function after it:

```ts

/** Promote or demote a user's admin flag. RLS only allows this for an admin caller. */
export async function updateUserAdmin(userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase.from('user_access').update({ is_admin: isAdmin }).eq('user_id', userId)
  if (error) throw error
}
```

- [ ] **Step 2: Import the icons and the new function in `AdminUsers.tsx`**

Current imports (`src/pages/AdminUsers.tsx:1-5`):

```ts
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { Check, RotateCcw } from 'lucide-react'
import { listUserAccess, updateUserStatus } from '../lib/userAccess'
import type { RROutletContext, UserAccessRow, UserAccessStatus } from '../types'
```

Replace with:

```ts
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { Check, RotateCcw, ShieldPlus, ShieldMinus } from 'lucide-react'
import { listUserAccess, updateUserStatus, updateUserAdmin } from '../lib/userAccess'
import type { RROutletContext, UserAccessRow, UserAccessStatus } from '../types'
```

- [ ] **Step 3: Add the `handleSetAdmin` callback**

Directly after `handleSetStatus` (`src/pages/AdminUsers.tsx:47-59`):

```ts
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
```

Add this new callback immediately after it:

```ts

  const handleSetAdmin = useCallback(async (userId: string, isAdmin: boolean) => {
    setBusyUserId(userId)
    try {
      await requireAuth(() => updateUserAdmin(userId, isAdmin))
    } catch (err) {
      addToast(`Update failed: ${formatError(err)}`, 'error')
      setBusyUserId(null)
      return
    }
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, isAdmin } : r)))
    setBusyUserId(null)
    addToast(isAdmin ? '✓ Made admin' : '✓ Admin removed')
  }, [addToast, requireAuth])
```

- [ ] **Step 4: Add the Make admin / Remove admin button to the Approved list**

The Approved row block (`src/pages/AdminUsers.tsx:112-140`) currently reads:

```tsx
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
                    {r.userId === currentUserId && (
                      <span className="text-[9px] uppercase tracking-wide font-bold text-[#94A3B8] bg-[#F1F5F9] rounded px-1.5 py-0.5">
                        You
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-[#94A3B8]">Signed up {formatDate(r.createdAt)}</div>
                </div>
                {r.userId !== currentUserId && (
                  <button
                    onClick={() => handleSetStatus(r.userId, 'pending')}
                    disabled={busyUserId === r.userId}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A] hover:border-[#CBD5E1] disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw size={13} strokeWidth={2.25} />
                    Revoke
                  </button>
                )}
              </div>
            ))}
```

Replace it with:

```tsx
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
                    {r.userId === currentUserId && (
                      <span className="text-[9px] uppercase tracking-wide font-bold text-[#94A3B8] bg-[#F1F5F9] rounded px-1.5 py-0.5">
                        You
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-[#94A3B8]">Signed up {formatDate(r.createdAt)}</div>
                </div>
                {r.userId !== currentUserId && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSetAdmin(r.userId, !r.isAdmin)}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A] hover:border-[#CBD5E1] disabled:opacity-50 transition-colors"
                    >
                      {r.isAdmin ? <ShieldMinus size={13} strokeWidth={2.25} /> : <ShieldPlus size={13} strokeWidth={2.25} />}
                      {r.isAdmin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button
                      onClick={() => handleSetStatus(r.userId, 'pending')}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A] hover:border-[#CBD5E1] disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw size={13} strokeWidth={2.25} />
                      Revoke
                    </button>
                  </div>
                )}
              </div>
            ))}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Manual verification in the dev server**

Run: `npm run dev`, sign in as an admin, go to `/admin/users`:

- Click "Make admin" on an approved non-admin row → Admin badge appears, button flips to "Remove admin". Hard-refresh the page → the badge is still there (confirms the DB update landed, not just local state).
- Click "Remove admin" on a different admin's row → badge disappears, button flips back to "Make admin".
- Confirm neither button renders on your own row.

- [ ] **Step 7: Commit**

```bash
git add src/lib/userAccess.ts src/pages/AdminUsers.tsx
git commit -m "feat: let admins promote/demote other users' admin status"
```

---

### Task 2: `delete-user` Edge Function

**Files:**
- Create: `supabase/functions/delete-user/index.ts`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — all auto-injected into every Edge Function's environment by Supabase, no manual secret-setting needed.
- Produces: a deployed `POST /functions/v1/delete-user` endpoint accepting `{ userId: string }` with the caller's session `Authorization: Bearer <jwt>` header, returning `{ ok: true }` (200) or `{ error: string }` (401/403/400/500). Consumed by Task 3's `deleteUser()` client function.

- [ ] **Step 1: Write the function**

Create `supabase/functions/delete-user/index.ts`:

```ts
// Supabase Edge Function: delete-user
// Permanently deletes a user's auth.users account (and, via cascade, their
// user_access row). Requires a signed-in admin caller — checked here against
// user_access.is_admin, since this function uses the service-role key to
// bypass RLS entirely via auth.admin.deleteUser().
//
// Deploy with default JWT verification ON (no --no-verify-jwt) — unlike the
// `assistant` function, this is a destructive, privileged action and must
// require a valid Supabase session before the function body even runs.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) return json({ error: 'Missing Authorization header' }, 401)

  let body: { userId?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const targetUserId = body.userId
  if (!targetUserId) return json({ error: 'userId is required' }, 400)

  // Resolve caller identity from their session JWT.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Invalid session' }, 401)
  const callerId = userData.user.id

  if (targetUserId === callerId) {
    return json({ error: 'You cannot delete your own account' }, 400)
  }

  // Service-role client — required both to check the caller's admin flag
  // (bypassing RLS is harmless here since we're checking the caller's own
  // row) and to perform the actual auth.admin.deleteUser call.
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: accessRow, error: accessErr } = await serviceClient
    .from('user_access')
    .select('is_admin')
    .eq('user_id', callerId)
    .maybeSingle()
  if (accessErr) return json({ error: accessErr.message }, 500)
  if (!accessRow?.is_admin) return json({ error: 'Admin access required' }, 403)

  const { error: deleteErr } = await serviceClient.auth.admin.deleteUser(targetUserId)
  if (deleteErr) return json({ error: deleteErr.message }, 500)

  return json({ ok: true }, 200)
})
```

- [ ] **Step 2: Confirm CLI access, then deploy**

Run: `supabase projects list`
Expected: the table includes a row with reference ID `assqmmenobaflmcabkpu`. If it's missing, stop here and run `supabase login` (opens a browser) as the account that owns org `cuxifdybutimtugduqdi`, then re-run `supabase projects list` to confirm before continuing.

Once confirmed, run:

```bash
supabase functions deploy delete-user --project-ref assqmmenobaflmcabkpu
```

Expected: deploy succeeds (no `--no-verify-jwt` flag — JWT verification stays on, the default).

- [ ] **Step 3: Manual verification via `curl`**

This step deletes a real `auth.users` row, so test against a throwaway account, not a real teammate's:

1. In the app (or any browser), sign up a brand-new scratch account (e.g. `delete-test-<timestamp>@example.com`) — it lands in `user_access` as `pending`.
2. Sign in as an existing admin in the app, open browser dev tools → Application/Storage → Local Storage → find the `sb-assqmmenobaflmcabkpu-auth-token` entry → copy the `access_token` value. This is `<ADMIN_JWT>`.
3. In the Supabase dashboard (Authentication → Users), copy the scratch account's user id. This is `<TARGET_USER_ID>`.
4. Run:

```bash
curl -i --location --request POST 'https://assqmmenobaflmcabkpu.supabase.co/functions/v1/delete-user' \
  --header "Authorization: Bearer <ADMIN_JWT>" \
  --header 'Content-Type: application/json' \
  --data '{"userId":"<TARGET_USER_ID>"}'
```

Expected: `HTTP/2 200` with body `{"ok":true}`. Confirm in the Supabase dashboard that the scratch account is gone from both Authentication → Users and the `user_access` table (the cascade deletes the row automatically).

5. Repeat the curl call with a non-admin account's JWT (or reuse `<ADMIN_JWT>` but pass your own admin user id as `<TARGET_USER_ID>`) to confirm rejection:
   - Non-admin caller → `HTTP/2 403` `{"error":"Admin access required"}`.
   - Self-delete attempt → `HTTP/2 400` `{"error":"You cannot delete your own account"}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/delete-user/index.ts
git commit -m "feat: add delete-user Edge Function for admin account deletion"
```

---

### Task 3: Wire delete into the UI

**Files:**
- Modify: `src/lib/userAccess.ts` (add `deleteUser`)
- Modify: `src/pages/AdminUsers.tsx` (imports, `handleDeleteUser`, Pending + Approved row JSX)

**Interfaces:**
- Consumes: the deployed `delete-user` Edge Function from Task 2; `handleSetAdmin`/Approved-row JSX shape produced by Task 1.
- Produces: nothing new for other files — this is the leaf consumer.

- [ ] **Step 1: Add `deleteUser` to `userAccess.ts`**

`src/lib/userAccess.ts` needs the `FunctionsHttpError` import added to its existing `supabase` import line. Current top of file:

```ts
import { supabase } from './supabase'
import type { UserAccessRow, UserAccessStatus } from '../types'
```

Replace with:

```ts
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { UserAccessRow, UserAccessStatus } from '../types'
```

Then add this function at the end of the file (after `updateUserAdmin`, added in Task 1):

```ts

/** Permanently delete a user's account via the delete-user Edge Function. RLS is bypassed server-side; the function itself only allows an admin caller. */
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-user', { body: { userId } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null)
      if (body?.error) throw new Error(body.error)
    }
    throw error
  }
}
```

- [ ] **Step 2: Import `Trash2` and `deleteUser` in `AdminUsers.tsx`**

Current imports (after Task 1's changes):

```ts
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { Check, RotateCcw, ShieldPlus, ShieldMinus } from 'lucide-react'
import { listUserAccess, updateUserStatus, updateUserAdmin } from '../lib/userAccess'
import type { RROutletContext, UserAccessRow, UserAccessStatus } from '../types'
```

Replace with:

```ts
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { Check, RotateCcw, ShieldPlus, ShieldMinus, Trash2 } from 'lucide-react'
import { listUserAccess, updateUserStatus, updateUserAdmin, deleteUser } from '../lib/userAccess'
import type { RROutletContext, UserAccessRow, UserAccessStatus } from '../types'
```

- [ ] **Step 3: Add the `handleDeleteUser` callback**

Directly after `handleSetAdmin` (added in Task 1):

```ts

  const handleDeleteUser = useCallback(async (userId: string, email: string) => {
    if (!window.confirm(`Delete ${email}? This cannot be undone.`)) return
    setBusyUserId(userId)
    try {
      await requireAuth(() => deleteUser(userId))
    } catch (err) {
      addToast(`Delete failed: ${formatError(err)}`, 'error')
      setBusyUserId(null)
      return
    }
    setRows((prev) => prev.filter((r) => r.userId !== userId))
    setBusyUserId(null)
    addToast('✓ User deleted')
  }, [addToast, requireAuth])
```

- [ ] **Step 4: Add the Delete button to the Pending list**

The Pending row block currently reads:

```tsx
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
```

Replace it with:

```tsx
          <div className="divide-y divide-[#F1F5F9]">
            {pending.map((r) => (
              <div key={r.userId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[13px] font-semibold text-[#0F172A]">{r.email}</div>
                  <div className="text-[11px] font-mono text-[#94A3B8]">Signed up {formatDate(r.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSetStatus(r.userId, 'approved')}
                    disabled={busyUserId === r.userId}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold text-white bg-[#0F172A] hover:bg-[#1E293B] disabled:opacity-50 transition-colors"
                  >
                    <Check size={13} strokeWidth={2.5} />
                    Approve
                  </button>
                  {r.userId !== currentUserId && (
                    <button
                      onClick={() => handleDeleteUser(r.userId, r.email)}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#EF4444] border border-[#FECACA] hover:bg-[#FEF2F2] disabled:opacity-50 transition-colors"
                    >
                      <Trash2 size={13} strokeWidth={2.25} />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
```

- [ ] **Step 5: Add the Delete button to the Approved list**

The Approved row's action group (from Task 1) currently reads:

```tsx
                {r.userId !== currentUserId && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSetAdmin(r.userId, !r.isAdmin)}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A] hover:border-[#CBD5E1] disabled:opacity-50 transition-colors"
                    >
                      {r.isAdmin ? <ShieldMinus size={13} strokeWidth={2.25} /> : <ShieldPlus size={13} strokeWidth={2.25} />}
                      {r.isAdmin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button
                      onClick={() => handleSetStatus(r.userId, 'pending')}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A] hover:border-[#CBD5E1] disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw size={13} strokeWidth={2.25} />
                      Revoke
                    </button>
                  </div>
                )}
```

Replace it with:

```tsx
                {r.userId !== currentUserId && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSetAdmin(r.userId, !r.isAdmin)}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A] hover:border-[#CBD5E1] disabled:opacity-50 transition-colors"
                    >
                      {r.isAdmin ? <ShieldMinus size={13} strokeWidth={2.25} /> : <ShieldPlus size={13} strokeWidth={2.25} />}
                      {r.isAdmin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button
                      onClick={() => handleSetStatus(r.userId, 'pending')}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A] hover:border-[#CBD5E1] disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw size={13} strokeWidth={2.25} />
                      Revoke
                    </button>
                    <button
                      onClick={() => handleDeleteUser(r.userId, r.email)}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[#EF4444] border border-[#FECACA] hover:bg-[#FEF2F2] disabled:opacity-50 transition-colors"
                    >
                      <Trash2 size={13} strokeWidth={2.25} />
                      Delete
                    </button>
                  </div>
                )}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 7: Manual verification in the dev server**

Run: `npm run dev`, sign in as an admin, go to `/admin/users`:

- Sign up a new scratch account in another browser/incognito window so it shows up as Pending.
- Click Delete on that pending row → confirm dialog appears with the account's email → confirm → row disappears, success toast shows. Refresh the page → still gone (confirms it's actually deleted, not just removed from local state).
- Repeat for an approved (non-self, non-important) test account, confirming the auth.users row is also gone from the Supabase dashboard afterward.
- Confirm no Delete button renders on your own row in either list.
- Click Delete then dismiss the `window.confirm` dialog (Cancel) → nothing happens, row remains.

- [ ] **Step 8: Commit**

```bash
git add src/lib/userAccess.ts src/pages/AdminUsers.tsx
git commit -m "feat: let admins permanently delete user accounts"
```
