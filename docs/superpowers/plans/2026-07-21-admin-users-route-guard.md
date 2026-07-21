# Guard /admin/users Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect non-admins away from `/admin/users` to `/` if they navigate to that URL directly, since today only the nav link (not the route) is hidden from them.

**Architecture:** Thread the already-computed `isAdmin` and `accessLoading` values (from `useAuth()` in `App.tsx`) through `RROutletContext`, then have `AdminUsers.tsx` render `<Navigate to="/" replace />` when `accessLoading` has resolved and `isAdmin` is `false`.

**Tech Stack:** React 19 + TypeScript + Vite + React Router. No test suite configured — verification is `npm run build` (type-check) after every task, plus a final manual pass in the dev server.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-admin-users-route-guard-design.md`
- The actual security enforcement stays exactly as-is (Postgres RLS on `user_access`) — this feature is a UX-layer redirect only, not a new permission check.
- The redirect must NOT fire while `accessLoading` is `true` (i.e., before the current session's `isAdmin` value has loaded) — a hard refresh on `/admin/users` as a real admin must never flash a redirect.
- Verification command after each task: `npm run build` — must exit 0 with no type errors.

---

### Task 1: Thread `isAdmin` / `accessLoading` through `RROutletContext`

**Files:**
- Modify: `src/types/index.ts:82-99` (`RROutletContext` interface)
- Modify: `src/App.tsx:332-343` (`rrContext` object)

**Interfaces:**
- Consumes: `isAdmin` and `accessLoading`, both already destructured from `useAuth()` at `App.tsx:53` — no new computation needed, just wiring.
- Produces: `RROutletContext.isAdmin: boolean` and `RROutletContext.accessLoading: boolean`, consumed by Task 2.

- [ ] **Step 1: Add the two fields to `RROutletContext`**

In `src/types/index.ts`, the interface currently ends like this:

```ts
export interface RROutletContext {
  snapshots: Snapshot[]
  activeSnapshotId: string | null
  onSelectSnapshot: (id: string) => void
  onOpenUpload: () => void
  onDeleteSnapshot: (id: string) => void
  // Inline-edit GSV / SV / AFF on a snapshot's records. The matcher narrows
  // which rows are patched within the snapshot.
  onEditCell: (snapshotId: string, matcher: EditCellMatcher, patch: EditCellPatch) => Promise<void>
  addToast: (message: string, type?: ToastItem['type']) => void
  // Gate for mutating actions — runs fn immediately if signed in, otherwise
  // opens the shared login modal and resumes fn on success. See useAuth().
  requireAuth: <T>(fn: () => T | Promise<T>) => Promise<T>
  // The signed-in user's id (null if signed out) — used e.g. by AdminUsers to
  // avoid showing destructive self-actions (like revoking your own access).
  currentUserId: string | null
  writeGate: WriteGate
}
```

Replace it with (adding two fields after `writeGate`):

```ts
export interface RROutletContext {
  snapshots: Snapshot[]
  activeSnapshotId: string | null
  onSelectSnapshot: (id: string) => void
  onOpenUpload: () => void
  onDeleteSnapshot: (id: string) => void
  // Inline-edit GSV / SV / AFF on a snapshot's records. The matcher narrows
  // which rows are patched within the snapshot.
  onEditCell: (snapshotId: string, matcher: EditCellMatcher, patch: EditCellPatch) => Promise<void>
  addToast: (message: string, type?: ToastItem['type']) => void
  // Gate for mutating actions — runs fn immediately if signed in, otherwise
  // opens the shared login modal and resumes fn on success. See useAuth().
  requireAuth: <T>(fn: () => T | Promise<T>) => Promise<T>
  // The signed-in user's id (null if signed out) — used e.g. by AdminUsers to
  // avoid showing destructive self-actions (like revoking your own access).
  currentUserId: string | null
  writeGate: WriteGate
  // Whether the signed-in user is an admin — used by AdminUsers to redirect
  // non-admins away from /admin/users if they navigate there directly.
  isAdmin: boolean
  // True until the current session's isAdmin/isApproved check has resolved.
  // Consumers must not make an admin-gated redirect decision while this is
  // true, to avoid a false redirect flash for a real admin on page load.
  accessLoading: boolean
}
```

- [ ] **Step 2: Add both fields to `rrContext` in `App.tsx`**

`src/App.tsx` already destructures both values from `useAuth()` at line 53 (`const { session, modalOpen, requireAuth, openLogin, cancelAuth, isAdmin, isApproved, accessLoading } = useAuth()`) — no change needed there.

The `rrContext` object currently reads:

```ts
  const rrContext: RROutletContext = {
    snapshots:         viewSnapshots,
    activeSnapshotId:  state.activeSnapshotId,
    onSelectSnapshot:  selectSnapshot,
    onOpenUpload:      openUpload,
    onDeleteSnapshot:  handleDeleteSnapshot,
    onEditCell:        handleEditCell,
    addToast,
    requireAuth,
    currentUserId:     session?.user.id ?? null,
    writeGate,
  }
```

Add `isAdmin` and `accessLoading` as the last two fields:

```ts
  const rrContext: RROutletContext = {
    snapshots:         viewSnapshots,
    activeSnapshotId:  state.activeSnapshotId,
    onSelectSnapshot:  selectSnapshot,
    onOpenUpload:      openUpload,
    onDeleteSnapshot:  handleDeleteSnapshot,
    onEditCell:        handleEditCell,
    addToast,
    requireAuth,
    currentUserId:     session?.user.id ?? null,
    writeGate,
    isAdmin,
    accessLoading,
  }
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors. (`AdminUsers.tsx` doesn't consume the two new fields yet — that's fine, Task 2 adds that.)

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/App.tsx
git commit -m "feat: thread isAdmin/accessLoading through RROutletContext"
```

---

### Task 2: Redirect non-admins away from `AdminUsers.tsx`

**Files:**
- Modify: `src/pages/AdminUsers.tsx:1-65` (imports, destructuring, loading/guard render)

**Interfaces:**
- Consumes: `RROutletContext.isAdmin: boolean` and `RROutletContext.accessLoading: boolean`, produced by Task 1.
- Produces: nothing new for other files — this is the leaf consumer.

- [ ] **Step 1: Import `Navigate` and destructure the two new context fields**

In `src/pages/AdminUsers.tsx`, the top of the file currently reads:

```ts
import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Check, RotateCcw } from 'lucide-react'
import { listUserAccess, updateUserStatus } from '../lib/userAccess'
import type { RROutletContext, UserAccessRow, UserAccessStatus } from '../types'
```

Change the `react-router-dom` import to also bring in `Navigate`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { Check, RotateCcw } from 'lucide-react'
import { listUserAccess, updateUserStatus } from '../lib/userAccess'
import type { RROutletContext, UserAccessRow, UserAccessStatus } from '../types'
```

Then change the context destructure inside `AdminUsers`:

```ts
  const { addToast, requireAuth, currentUserId } = useOutletContext<RROutletContext>()
```

to:

```ts
  const { addToast, requireAuth, currentUserId, isAdmin, accessLoading } = useOutletContext<RROutletContext>()
```

- [ ] **Step 2: Guard the render — loading state, then redirect for non-admins**

The component currently has this loading check right before the main `return`:

```ts
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-[#94A3B8] font-mono text-[12px] tracking-wider">
        Loading users…
      </div>
    )
  }
```

Replace it with:

```ts
  if (accessLoading || loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-[#94A3B8] font-mono text-[12px] tracking-wider">
        Loading users…
      </div>
    )
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />
  }
```

This keeps the existing "Loading users…" message during both the access check and the row fetch, and only decides on the redirect once `accessLoading` has resolved — so a real admin on a hard refresh sees the loading state, then the page, never a redirect flash.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Manual verification in the dev server**

Run: `npm run dev`, open `http://localhost:5173/admin/users` directly (not via nav click) in three states, using a test account's `user_access` row (toggle via Supabase SQL editor, e.g. `update public.user_access set is_admin = false where email = '...';`):

- Signed out: redirected to `/` (home).
- Signed in, `is_admin = false`: redirected to `/` — briefly shows "Loading users…" first, no flash of the pending/approved lists.
- Signed in, `is_admin = true`: page loads normally, "Loading users…" briefly, then the pending/approved lists — no redirect.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminUsers.tsx
git commit -m "fix: redirect non-admins away from /admin/users route"
```
