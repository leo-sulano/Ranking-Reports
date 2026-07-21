# Write-Gated Auth (Login for Add/Edit/Upload) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone view the dashboard without logging in, but require a signed-in user (email/password or Google) before any add/edit/upload/delete action can write to Supabase.

**Architecture:** A single `useAuth()` hook (session state + a `requireAuth<T>(fn)` wrapper that runs `fn` immediately if signed in, or opens a shared `LoginModal` and resumes `fn` on successful sign-in) is instantiated once in `App.tsx`'s `Layout` and threaded to pages via `RROutletContext`. Every existing mutation callback (`upsertSnapshot`, `deleteSnapshot`, FTD upserts) gets wrapped in `requireAuth(...)` at its call site — no mutation function itself changes. Real enforcement is a Supabase RLS policy split (`anon` = read-only, `authenticated` = full write) across all six tables, so the client-side gate is UX only, not the security boundary.

**Tech Stack:** React 19 + TypeScript, Vite, `@supabase/supabase-js` 2.x (already configured with `persistSession`/`autoRefreshToken`/`detectSessionInUrl`), Tailwind v4. No component-testing infra exists (Vitest is configured `environment: 'node'`, one existing test file covers a pure function — no jsdom/@testing-library/react). This plan does not add that infra; it is out of scope for this feature.

## Global Constraints

- Do not modify `src/components/AuthGate.tsx`, `src/components/Login.tsx`, `supabase/auth-lockdown.sql`, or the `VITE_REQUIRE_AUTH` flag — they stay as dormant, unused fallback for a future all-or-nothing gate. This feature is fully independent of them.
- No public self-signup: don't add any UI or Supabase config that lets a new email/password user register themselves.
- Any Google account may attempt sign-in (no domain restriction), per approved spec.
- Every mutation callback keeps its exact existing signature and existing try/catch/toast error handling — `requireAuth` wraps the call to the underlying write function, not the whole handler's control flow, so diffs stay minimal and reviewable.
- Verification for hook/component/wiring tasks in this plan uses `npx tsc -b` (fast, catches wiring/type mistakes across the whole project) plus a manual dev-server smoke check described in each task — there is no automated way to test a React hook or Supabase-backed component in this repo's current test setup, and adding one is out of scope.
- The final task's manual smoke test is the one place actual sign-in behavior gets exercised end-to-end; don't skip it.

---

### Task 1: `signInWithGoogle()` in the auth module

**Files:**
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Produces: `signInWithGoogle(): Promise<void>` — later tasks (LoginModal) call this directly, same calling convention as the existing `signIn(email, password)`.

- [ ] **Step 1: Add the function**

Open `src/lib/auth.ts` and add this function after `signIn` (after line 31):

```ts
/** Sign in with Google. Redirects the browser to Google's consent screen and back to the current URL. */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  })
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: exits with no output and exit code 0 (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat: add Google OAuth sign-in helper"
```

---

### Task 2: `useAuth()` hook

**Files:**
- Create: `src/lib/useAuth.ts`

**Interfaces:**
- Consumes: `getSession(): Promise<Session | null>`, `onAuthChange(cb): () => void` — both already exist in `src/lib/auth.ts` (read them there, unchanged).
- Produces (used by Task 5 and Task 6):
  - `session: Session | null`
  - `modalOpen: boolean`
  - `requireAuth<T>(fn: () => T | Promise<T>): Promise<T>` — resolves with `fn`'s result once a session exists (immediately, or after sign-in); rejects with `Error('Sign-in required')` if the modal is closed without signing in.
  - `openLogin(): void` — opens the modal with no pending action (for a plain "Sign in" button).
  - `cancelAuth(): void` — closes the modal; rejects any pending `requireAuth` promise.

- [ ] **Step 1: Write the hook**

Create `src/lib/useAuth.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthChange } from './auth'

interface PendingAuth {
  run: () => unknown
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/**
 * Session state + a gate for mutating actions. `requireAuth(fn)` runs `fn`
 * immediately if a session exists; otherwise it opens the shared login modal
 * and resumes `fn` automatically once sign-in succeeds (email/password only —
 * Google's OAuth redirect reloads the page, so a pending `fn` from that path
 * is simply lost; the user re-clicks the action after returning).
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const pending = useRef<PendingAuth | null>(null)

  useEffect(() => {
    let cancelled = false

    getSession().then((s) => { if (!cancelled) setSession(s) })

    const unsub = onAuthChange((s) => {
      if (cancelled) return
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
    if (session) return Promise.resolve(fn())
    return new Promise<T>((resolve, reject) => {
      pending.current = { run: fn, resolve: resolve as (value: unknown) => void, reject }
      setModalOpen(true)
    })
  }, [session])

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

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: exits with no output and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/useAuth.ts
git commit -m "feat: add useAuth hook with requireAuth gate"
```

---

### Task 3: `LoginModal` component

**Files:**
- Create: `src/components/LoginModal.tsx`

**Interfaces:**
- Consumes: `signIn(email, password): Promise<void>` and `signInWithGoogle(): Promise<void>` from `src/lib/auth.ts` (existing + Task 1).
- Produces: `LoginModal({ open, onClose }: { open: boolean; onClose: () => void })` — a React component. Renders `null` when `open` is false. Task 5 renders this once, passing `modalOpen`/`cancelAuth` from `useAuth()`.

- [ ] **Step 1: Write the component**

Create `src/components/LoginModal.tsx`, adapting the existing card layout from `src/components/Login.tsx` into an overlay:

```tsx
import { useState, type FormEvent } from 'react'
import { Lock, LogIn, X } from 'lucide-react'
import { signIn, signInWithGoogle } from '../lib/auth'

/**
 * Shared login overlay opened by useAuth() whenever a signed-out user
 * triggers a gated action, or clicks "Sign in" in the Topbar. On successful
 * email/password sign-in, useAuth's onAuthChange listener closes this and
 * resumes whatever action was pending — no logic needed here beyond calling
 * signIn(). Google sign-in redirects the whole page away, so nothing after
 * that call runs.
 */
export function LoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
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
            Sign in
          </span>
        </div>
        <p className="text-[12px] font-mono text-[#64748B] mb-6">
          Sign in to make changes to the dashboard
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
          autoComplete="current-password"
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
          {busy ? 'Signing in…' : 'Sign in'}
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
Expected: exits with no output and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/LoginModal.tsx
git commit -m "feat: add shared LoginModal (email + Google)"
```

---

### Task 4: Topbar shows real sign-in state

**Files:**
- Modify: `src/components/Topbar.tsx`

**Interfaces:**
- Consumes: `session: Session | null` (from `@supabase/supabase-js`, passed in by `Layout` in Task 5), `onSignIn: () => void` (will be `openLogin` from `useAuth()`).
- No change to `signOut` usage — same import, same call.

- [ ] **Step 1: Update the component**

Replace the full contents of `src/components/Topbar.tsx`:

```tsx
import { LogIn, LogOut } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { signOut } from '../lib/auth'

interface Props {
  brandName: string
  domain: string
  session: Session | null
  onSignIn: () => void
  onMenuToggle?: () => void
}

export function Topbar({ brandName, domain, session, onSignIn, onMenuToggle }: Props) {
  return (
    <header className="h-16 min-h-[64px] shrink-0 flex flex-col bg-white border-b border-[#E5E4DF]">
      {/* German flag accent strip — black / red / gold */}
      <div className="flex h-[3px] shrink-0">
        <div className="flex-1 bg-[#0A0A0A]" />
        <div className="flex-1 bg-[#CC0000]" />
        <div className="flex-1 bg-[#FFCC00]" />
      </div>
      <div className="flex-1 flex items-center gap-2 sm:gap-4 px-3 sm:px-7">
        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={onMenuToggle}
          className="sm:hidden shrink-0 flex flex-col items-center justify-center gap-[5px] w-8 h-8 rounded-md hover:bg-[#F7F7F5] transition-colors"
          aria-label="Open navigation"
        >
          <span className="block w-[18px] h-[2px] bg-[#0A0A0A] rounded-full" />
          <span className="block w-[18px] h-[2px] bg-[#0A0A0A] rounded-full" />
          <span className="block w-[18px] h-[2px] bg-[#0A0A0A] rounded-full" />
        </button>
        <div className="flex items-baseline gap-3 flex-1 min-w-0">
          <span className="font-display text-[18px] sm:text-[26px] tracking-wider text-[#0A0A0A] whitespace-nowrap">
            {brandName}
          </span>
          {domain && (
            <span className="text-[12px] font-mono text-[#ABABAA] truncate">{domain}</span>
          )}
        </div>

        {session ? (
          <button
            type="button"
            onClick={() => { void signOut() }}
            title="Sign out"
            className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#E5E4DF] text-[12px] font-mono text-[#8A8A85] hover:text-[#0A0A0A] hover:border-[#ABABAA] transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            title="Sign in"
            className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#E5E4DF] text-[12px] font-mono text-[#8A8A85] hover:text-[#0A0A0A] hover:border-[#ABABAA] transition-colors"
          >
            <LogIn size={14} />
            Sign in
          </button>
        )}
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: FAILS — `Layout` (in `App.tsx`) still renders `<Topbar brandName={...} domain={...} onMenuToggle={...} />` without the new required `session`/`onSignIn` props. This is expected; Task 5 fixes the call site. Confirm the error mentions `Topbar` and missing `session`/`onSignIn` props before moving on.

- [ ] **Step 3: Commit**

```bash
git add src/components/Topbar.tsx
git commit -m "feat: Topbar reflects real session state (sign in/out)"
```

---

### Task 5: Wire `useAuth` + `LoginModal` into `Layout`; gate the three App.tsx write paths

**Files:**
- Modify: `src/types/index.ts:65-75` (`RROutletContext`)
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useAuth()` from Task 2, `LoginModal` from Task 3, updated `Topbar` props from Task 4.
- Produces: `RROutletContext.requireAuth: <T,>(fn: () => T | Promise<T>) => Promise<T>` — consumed by Task 6 (`FTDs.tsx`).

- [ ] **Step 1: Add `requireAuth` to `RROutletContext`**

In `src/types/index.ts`, in the `RROutletContext` interface (currently lines 65-75), add the new field. The interface becomes:

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
}
```

- [ ] **Step 2: Import `useAuth` and `LoginModal` in `App.tsx`**

At the top of `src/App.tsx`, add these imports (near the existing `AuthGate` import at line 3):

```ts
import { useAuth } from './lib/useAuth'
import { LoginModal } from './components/LoginModal'
```

- [ ] **Step 3: Instantiate `useAuth` in `Layout`**

In `src/App.tsx`, inside `function Layout()` (after the existing `useState`/`useCallback` declarations, e.g. right after the `bulkProgress` state at line 49), add:

```ts
  const { session, modalOpen, requireAuth, openLogin, cancelAuth } = useAuth()
```

- [ ] **Step 4: Gate the upload write path**

In `persistOneSnapshot` (`src/App.tsx:102-134`), change the line:

```ts
    try {
      await upsertSnapshot(newSnap)
    } catch (err) {
```

to:

```ts
    try {
      await requireAuth(() => upsertSnapshot(newSnap))
    } catch (err) {
```

Add `requireAuth` to `persistOneSnapshot`'s `useCallback` dependency array (currently `[addToast]` at line 134) — it becomes `[addToast, requireAuth]`.

- [ ] **Step 5: Gate the delete-snapshot write path**

In `handleDeleteSnapshot` (`src/App.tsx:264-287`), change:

```ts
    try {
      await deleteSnapshot(id)
    } catch (err) {
```

to:

```ts
    try {
      await requireAuth(() => deleteSnapshot(id))
    } catch (err) {
```

Add `requireAuth` to its dependency array (currently `[addToast, state.snapshots]` at line 287) — it becomes `[addToast, requireAuth, state.snapshots]`.

- [ ] **Step 6: Gate the duplicate-replace delete**

In `handleReplaceDuplicate` (`src/App.tsx:203-227`), change:

```ts
    try {
      await deleteSnapshot(existing.id)
    } catch (err) {
```

to:

```ts
    try {
      await requireAuth(() => deleteSnapshot(existing.id))
    } catch (err) {
```

Add `requireAuth` to its dependency array (currently `[addToast, duplicateWarning, persistOneSnapshot, reportUnknownDomains]` at line 227) — it becomes `[addToast, duplicateWarning, persistOneSnapshot, reportUnknownDomains, requireAuth]`.

- [ ] **Step 7: Gate the inline-edit write path**

In `handleEditCell` (`src/App.tsx:230-262`), change:

```ts
    try {
      await updateRecordFields(snapshotId, matcher, patch)
    } catch (err) {
```

to:

```ts
    try {
      await requireAuth(() => updateRecordFields(snapshotId, matcher, patch))
    } catch (err) {
```

Add `requireAuth` to its dependency array (currently `[addToast]` at line 262) — it becomes `[addToast, requireAuth]`.

- [ ] **Step 8: Add `requireAuth` to the outlet context**

In `src/App.tsx`, in the `rrContext` object (`src/App.tsx:319-327`), add the field:

```ts
  const rrContext: RROutletContext = {
    snapshots:         viewSnapshots,
    activeSnapshotId:  state.activeSnapshotId,
    onSelectSnapshot:  selectSnapshot,
    onOpenUpload:      () => setShowUpload(true),
    onDeleteSnapshot:  handleDeleteSnapshot,
    onEditCell:        handleEditCell,
    addToast,
    requireAuth,
  }
```

- [ ] **Step 9: Pass session state to `Topbar` and render `LoginModal`**

In `src/App.tsx`, update the `<Topbar>` element (`src/App.tsx:359-363`):

```tsx
        <Topbar
          brandName={topbarTitle}
          domain={topbarDomain}
          session={session}
          onSignIn={openLogin}
          onMenuToggle={() => setMobileNavOpen((v) => !v)}
        />
```

Then, near the other modal renders in `Layout`'s JSX (after the `{bulkProgress && (...)}` block, `src/App.tsx:384-404`), add:

```tsx
      <LoginModal open={modalOpen} onClose={cancelAuth} />
```

- [ ] **Step 10: Type-check**

Run: `npx tsc -b`
Expected: exits with no output and exit code 0 (this also resolves the expected failure left over from Task 4).

- [ ] **Step 11: Manual smoke check — anonymous view still works**

Run: `npm run dev`, open the printed local URL in a browser, without signing in. Confirm: the dashboard loads and shows existing snapshot data (Home, BP Sites, LP Sites, FTDs all render), and the Topbar shows a "Sign in" button (not "Sign out"). This confirms viewing stayed open and the wiring didn't break the read path.

- [ ] **Step 12: Manual smoke check — gated upload opens the login modal**

In the same dev server, without signing in, click "Upload" in the sidebar, pick or drag any `.xlsx` file used before, and complete the import flow through to its confirmation step. Confirm: instead of the snapshot silently saving, the `LoginModal` overlay appears (email/password form + "Sign in with Google" button). Closing the modal (X button) should leave no snapshot saved and should NOT crash the page — check the browser console for unhandled promise rejections.

*(Signing in to verify the resume-and-save behavior requires a real Supabase user and RLS policies from Task 7 to be in place — that full end-to-end check happens in Task 7's final step, once the database side is ready.)*

- [ ] **Step 13: Commit**

```bash
git add src/App.tsx src/types/index.ts
git commit -m "feat: gate uploads/edits/deletes behind requireAuth, wire LoginModal into Layout"
```

---

### Task 6: Gate the FTD write paths

**Files:**
- Modify: `src/pages/FTDs.tsx`

**Interfaces:**
- Consumes: `RROutletContext.requireAuth` (Task 5).

- [ ] **Step 1: Pull `requireAuth` from outlet context**

In `src/pages/FTDs.tsx`, change line 62:

```ts
  const { addToast } = useOutletContext<RROutletContext>()
```

to:

```ts
  const { addToast, requireAuth } = useOutletContext<RROutletContext>()
```

- [ ] **Step 2: Gate `handleEditRecord`**

Change (`src/pages/FTDs.tsx:175-197`):

```ts
  const handleEditRecord = useCallback(async (brand: string, yearMonth: string, patch: FtdRecordPatch) => {
    try {
      await upsertFtdRecord(brand, yearMonth, patch)
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
```

to:

```ts
  const handleEditRecord = useCallback(async (brand: string, yearMonth: string, patch: FtdRecordPatch) => {
    try {
      await requireAuth(() => upsertFtdRecord(brand, yearMonth, patch))
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
```

Add `requireAuth` to its dependency array (currently `[addToast]` at line 197) — it becomes `[addToast, requireAuth]`.

- [ ] **Step 3: Gate `handleEditTotals`**

Change (`src/pages/FTDs.tsx:199-213`):

```ts
  const handleEditTotals = useCallback(async (yearMonth: string, conversionPct: number | null) => {
    try {
      await upsertFtdTotals(yearMonth, conversionPct)
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
```

to:

```ts
  const handleEditTotals = useCallback(async (yearMonth: string, conversionPct: number | null) => {
    try {
      await requireAuth(() => upsertFtdTotals(yearMonth, conversionPct))
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
```

Add `requireAuth` to its dependency array (currently `[addToast]` at line 213) — it becomes `[addToast, requireAuth]`.

- [ ] **Step 4: Gate `handleEditStags`**

Change (`src/pages/FTDs.tsx:215-229`):

```ts
  const handleEditStags = useCallback(async (brand: string, stagsValue: string) => {
    try {
      await upsertBrandStags(brand, stagsValue)
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
```

to:

```ts
  const handleEditStags = useCallback(async (brand: string, stagsValue: string) => {
    try {
      await requireAuth(() => upsertBrandStags(brand, stagsValue))
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
```

Add `requireAuth` to its dependency array (currently `[addToast]` at line 229) — it becomes `[addToast, requireAuth]`.

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: exits with no output and exit code 0.

- [ ] **Step 6: Manual smoke check**

With `npm run dev` running and signed out, go to the FTDs page and try editing an inline REG/FTD cell (via the matrix table) and via the "+ Add / Edit Month" form. Confirm both surface the `LoginModal` instead of silently writing.

- [ ] **Step 7: Commit**

```bash
git add src/pages/FTDs.tsx
git commit -m "feat: gate FTD record/totals/stags edits behind requireAuth"
```

---

### Task 7: Database RLS split (anon read-only, authenticated full write)

**Files:**
- Create: `supabase/auth-write-lockdown.sql`
- Modify: `supabase/schema.sql:54-136` (RLS section, all six tables)

**Interfaces:**
- None (SQL only) — this is the actual security boundary; Tasks 1-6 are UX on top of it.

- [ ] **Step 1: Write the new migration file**

Create `supabase/auth-write-lockdown.sql`:

```sql
-- ============================================================================
-- Ranking Reports — WRITE LOCKDOWN (read stays open, writes require login)
-- ============================================================================
-- Run this in the Supabase SQL editor when you're ready to require login for
-- add/edit/upload/delete actions while keeping the dashboard viewable by
-- anyone (no login needed to read data).
--
-- Unlike auth-lockdown.sql (which blocks anon entirely — an all-or-nothing
-- gate for the dormant VITE_REQUIRE_AUTH flag), this keeps `anon` able to
-- SELECT, and only requires an authenticated session for INSERT/UPDATE/DELETE.
--
-- ── CHECKLIST ────────────────────────────────────────────────────────────────
--   1. Supabase Dashboard → Authentication → Providers → Google: enable it,
--      paste the Client ID/Secret from a Google Cloud OAuth client you create.
--   2. Supabase Dashboard → Authentication → Users → "Add user" for each
--      teammate who needs write access (set "Auto Confirm User").
--   3. Supabase Dashboard → Authentication → URL Configuration: add your
--      deployed app URL (and http://localhost:5173 for local dev) as a
--      Redirect URL, so signInWithOAuth's redirectTo is accepted.
--   4. Run THIS file: Supabase Dashboard → SQL Editor → New query → paste → Run.
--
-- Safe to re-run: every statement is idempotent.
-- To ROLL BACK (re-open writes to anon), re-run the policy section of schema.sql.
-- ============================================================================

alter table public.snapshots       enable row level security;
alter table public.ranking_records enable row level security;
alter table public.ftd_records     enable row level security;
alter table public.ftd_totals      enable row level security;
alter table public.brand_stags     enable row level security;

-- snapshots -------------------------------------------------------------------
drop policy if exists "anon read snapshots"   on public.snapshots;
drop policy if exists "anon write snapshots"  on public.snapshots;
drop policy if exists "anon update snapshots" on public.snapshots;
drop policy if exists "anon delete snapshots" on public.snapshots;
drop policy if exists "auth write snapshots"  on public.snapshots;
drop policy if exists "auth update snapshots" on public.snapshots;
drop policy if exists "auth delete snapshots" on public.snapshots;

create policy "anon read snapshots"   on public.snapshots for select using (true);
create policy "auth write snapshots"  on public.snapshots for insert to authenticated with check (true);
create policy "auth update snapshots" on public.snapshots for update to authenticated using (true) with check (true);
create policy "auth delete snapshots" on public.snapshots for delete to authenticated using (true);

-- ranking_records ---------------------------------------------------------------
drop policy if exists "anon read records"   on public.ranking_records;
drop policy if exists "anon write records"  on public.ranking_records;
drop policy if exists "anon update records" on public.ranking_records;
drop policy if exists "anon delete records" on public.ranking_records;
drop policy if exists "auth write records"  on public.ranking_records;
drop policy if exists "auth update records" on public.ranking_records;
drop policy if exists "auth delete records" on public.ranking_records;

create policy "anon read records"   on public.ranking_records for select using (true);
create policy "auth write records"  on public.ranking_records for insert to authenticated with check (true);
create policy "auth update records" on public.ranking_records for update to authenticated using (true) with check (true);
create policy "auth delete records" on public.ranking_records for delete to authenticated using (true);

-- ftd_records -------------------------------------------------------------------
drop policy if exists "anon read ftd_records"   on public.ftd_records;
drop policy if exists "anon write ftd_records"  on public.ftd_records;
drop policy if exists "anon update ftd_records" on public.ftd_records;
drop policy if exists "anon delete ftd_records" on public.ftd_records;
drop policy if exists "auth write ftd_records"  on public.ftd_records;
drop policy if exists "auth update ftd_records" on public.ftd_records;
drop policy if exists "auth delete ftd_records" on public.ftd_records;

create policy "anon read ftd_records"   on public.ftd_records for select using (true);
create policy "auth write ftd_records"  on public.ftd_records for insert to authenticated with check (true);
create policy "auth update ftd_records" on public.ftd_records for update to authenticated using (true) with check (true);
create policy "auth delete ftd_records" on public.ftd_records for delete to authenticated using (true);

-- ftd_totals ----------------------------------------------------------------
drop policy if exists "anon read ftd_totals"   on public.ftd_totals;
drop policy if exists "anon write ftd_totals"  on public.ftd_totals;
drop policy if exists "anon update ftd_totals" on public.ftd_totals;
drop policy if exists "anon delete ftd_totals" on public.ftd_totals;
drop policy if exists "auth write ftd_totals"  on public.ftd_totals;
drop policy if exists "auth update ftd_totals" on public.ftd_totals;
drop policy if exists "auth delete ftd_totals" on public.ftd_totals;

create policy "anon read ftd_totals"   on public.ftd_totals for select using (true);
create policy "auth write ftd_totals"  on public.ftd_totals for insert to authenticated with check (true);
create policy "auth update ftd_totals" on public.ftd_totals for update to authenticated using (true) with check (true);
create policy "auth delete ftd_totals" on public.ftd_totals for delete to authenticated using (true);

-- brand_stags -----------------------------------------------------------------
drop policy if exists "anon read brand_stags"   on public.brand_stags;
drop policy if exists "anon write brand_stags"  on public.brand_stags;
drop policy if exists "anon update brand_stags" on public.brand_stags;
drop policy if exists "anon delete brand_stags" on public.brand_stags;
drop policy if exists "auth write brand_stags"  on public.brand_stags;
drop policy if exists "auth update brand_stags" on public.brand_stags;
drop policy if exists "auth delete brand_stags" on public.brand_stags;

create policy "anon read brand_stags"   on public.brand_stags for select using (true);
create policy "auth write brand_stags"  on public.brand_stags for insert to authenticated with check (true);
create policy "auth update brand_stags" on public.brand_stags for update to authenticated using (true) with check (true);
create policy "auth delete brand_stags" on public.brand_stags for delete to authenticated using (true);
```

- [ ] **Step 2: Update `schema.sql` so fresh installs get the same split**

In `supabase/schema.sql`, replace the entire RLS section (lines 54-136, from `-- Row Level Security ---` through the end of the `brand_stags` policy block) with:

```sql
-- Row Level Security ---------------------------------------------------------
-- Read is open to everyone (the anon key ships in the browser bundle, and
-- viewing the dashboard requires no login). Writes require an authenticated
-- Supabase session — see auth-write-lockdown.sql for the same policies
-- applied to an existing database, plus the setup checklist (Google OAuth
-- provider, manually-added users, redirect URLs).
alter table public.snapshots         enable row level security;
alter table public.ranking_records   enable row level security;

drop policy if exists "anon read snapshots"   on public.snapshots;
drop policy if exists "anon write snapshots"  on public.snapshots;
drop policy if exists "anon update snapshots" on public.snapshots;
drop policy if exists "anon delete snapshots" on public.snapshots;
drop policy if exists "auth write snapshots"  on public.snapshots;
drop policy if exists "auth update snapshots" on public.snapshots;
drop policy if exists "auth delete snapshots" on public.snapshots;

create policy "anon read snapshots"   on public.snapshots for select using (true);
create policy "auth write snapshots"  on public.snapshots for insert to authenticated with check (true);
create policy "auth update snapshots" on public.snapshots for update to authenticated using (true) with check (true);
create policy "auth delete snapshots" on public.snapshots for delete to authenticated using (true);

drop policy if exists "anon read records"   on public.ranking_records;
drop policy if exists "anon write records"  on public.ranking_records;
drop policy if exists "anon update records" on public.ranking_records;
drop policy if exists "anon delete records" on public.ranking_records;
drop policy if exists "auth write records"  on public.ranking_records;
drop policy if exists "auth update records" on public.ranking_records;
drop policy if exists "auth delete records" on public.ranking_records;

create policy "anon read records"   on public.ranking_records for select using (true);
create policy "auth write records"  on public.ranking_records for insert to authenticated with check (true);
create policy "auth update records" on public.ranking_records for update to authenticated using (true) with check (true);
create policy "auth delete records" on public.ranking_records for delete to authenticated using (true);

-- ============================================================================
-- FTD tracking — REG / FTD / Conversion % per brand per month
-- ============================================================================
-- Deliberately independent of snapshots/ranking_records: FTD data is
-- brand+month shaped, not domain+keyword+country shaped.

create table if not exists public.ftd_records (
  brand           text not null,
  year_month      text not null,               -- 'YYYY-MM', e.g. '2023-08'
  reg             int not null default 0,
  ftd             int not null default 0,
  conversion_pct  numeric,                       -- manually entered, nullable
  primary key (brand, year_month)
);

create table if not exists public.ftd_totals (
  year_month      text primary key,
  conversion_pct  numeric                        -- manually entered; REG/FTD totals are derived client-side
);

create table if not exists public.brand_stags (
  brand  text primary key,
  stags  text not null default ''
);

alter table public.ftd_records enable row level security;
alter table public.ftd_totals  enable row level security;
alter table public.brand_stags enable row level security;

drop policy if exists "anon read ftd_records"   on public.ftd_records;
drop policy if exists "anon write ftd_records"  on public.ftd_records;
drop policy if exists "anon update ftd_records" on public.ftd_records;
drop policy if exists "anon delete ftd_records" on public.ftd_records;
drop policy if exists "auth write ftd_records"  on public.ftd_records;
drop policy if exists "auth update ftd_records" on public.ftd_records;
drop policy if exists "auth delete ftd_records" on public.ftd_records;

create policy "anon read ftd_records"   on public.ftd_records for select using (true);
create policy "auth write ftd_records"  on public.ftd_records for insert to authenticated with check (true);
create policy "auth update ftd_records" on public.ftd_records for update to authenticated using (true) with check (true);
create policy "auth delete ftd_records" on public.ftd_records for delete to authenticated using (true);

drop policy if exists "anon read ftd_totals"   on public.ftd_totals;
drop policy if exists "anon write ftd_totals"  on public.ftd_totals;
drop policy if exists "anon update ftd_totals" on public.ftd_totals;
drop policy if exists "anon delete ftd_totals" on public.ftd_totals;
drop policy if exists "auth write ftd_totals"  on public.ftd_totals;
drop policy if exists "auth update ftd_totals" on public.ftd_totals;
drop policy if exists "auth delete ftd_totals" on public.ftd_totals;

create policy "anon read ftd_totals"   on public.ftd_totals for select using (true);
create policy "auth write ftd_totals"  on public.ftd_totals for insert to authenticated with check (true);
create policy "auth update ftd_totals" on public.ftd_totals for update to authenticated using (true) with check (true);
create policy "auth delete ftd_totals" on public.ftd_totals for delete to authenticated using (true);

drop policy if exists "anon read brand_stags"   on public.brand_stags;
drop policy if exists "anon write brand_stags"  on public.brand_stags;
drop policy if exists "anon update brand_stags" on public.brand_stags;
drop policy if exists "anon delete brand_stags" on public.brand_stags;
drop policy if exists "auth write brand_stags"  on public.brand_stags;
drop policy if exists "auth update brand_stags" on public.brand_stags;
drop policy if exists "auth delete brand_stags" on public.brand_stags;

create policy "anon read brand_stags"   on public.brand_stags for select using (true);
create policy "auth write brand_stags"  on public.brand_stags for insert to authenticated with check (true);
create policy "auth update brand_stags" on public.brand_stags for update to authenticated using (true) with check (true);
create policy "auth delete brand_stags" on public.brand_stags for delete to authenticated using (true);
```

- [ ] **Step 3: Read both files back and diff column/table names against the original**

Open `supabase/schema.sql` and `supabase/auth-write-lockdown.sql` side by side. Confirm every table name (`snapshots`, `ranking_records`, `ftd_records`, `ftd_totals`, `brand_stags`) and every policy name matches exactly between the two files, and that no `anon` policy for insert/update/delete survives anywhere (only `select`). This file cannot be executed from this session — running it against the live Supabase project is a manual step for the project owner (Supabase Dashboard → SQL Editor), listed in the file's own checklist comment.

- [ ] **Step 4: Commit**

```bash
git add supabase/auth-write-lockdown.sql supabase/schema.sql
git commit -m "feat: split RLS policies — anon read-only, authenticated write"
```

- [ ] **Step 5: Full end-to-end manual verification (after the SQL has been run manually in Supabase)**

This step depends on the project owner completing the three manual setup steps (Google OAuth provider configured in Supabase, at least one user added, `auth-write-lockdown.sql` run) — flag this dependency clearly and pause here if they haven't been done yet.

Once done, with `npm run dev` running:
1. Signed out: confirm the dashboard still loads and shows data (read still works).
2. Signed out: click "Upload", complete an import — confirm the `LoginModal` opens.
3. In the modal, sign in with the email/password user created in Supabase — confirm the modal closes and the import completes automatically (no re-click needed), with the success toast appearing.
4. Sign out via the Topbar button, then repeat step 2 but click "Sign in with Google" instead — confirm the browser redirects to Google, and after completing Google's consent screen, returns to the app already signed in (Topbar shows "Sign out"). Click "Upload" again and confirm the import now goes straight through with no modal (expected: the original pending action was lost on redirect, per the documented trade-off — this is one extra click, not a bug).
5. Signed in, edit an FTD cell inline and via "+ Add / Edit Month" — confirm both save without any modal appearing.

Report back whether all five checks passed.

---

## Self-Review Notes

- **Spec coverage:** view-open/mutation-gated model (Task 5/6 wrap only write calls, reads untouched) ✓; inline login modal with auto-resume for email/password (Task 2/5) ✓; Google OAuth, any account (Task 1/3) ✓; admin-created-only — no self-signup UI added, flagged as a Supabase-side setting to verify (spec's Risks section, checklist in Task 7's SQL file) ✓; RLS split enforcement (Task 7) ✓; Topbar sign-in/out reflecting real session regardless of `VITE_REQUIRE_AUTH` (Task 4) ✓.
- **Dependency check:** Task 6 depends on Task 5's `RROutletContext.requireAuth` field existing — ordered correctly. Task 4 intentionally leaves a broken build for one step, called out explicitly so it isn't mistaken for a mistake.
- **No fabricated tests:** every verification step is either `npx tsc -b` (real, runnable, deterministic) or an explicit manual browser check — nothing claims automated coverage the repo can't actually run.
