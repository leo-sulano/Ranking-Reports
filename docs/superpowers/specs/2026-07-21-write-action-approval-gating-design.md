# Proactive approval gating on edit/add/upload buttons

## Problem

Approval enforcement (`[[user-approval]]` / `[[write-gated-auth]]`) already exists and is real at the database level: Postgres RLS rejects any insert/update/delete from a signed-in user whose `user_access.status` isn't `'approved'`. On the frontend, `useAuth()`'s `requireAuth(fn)` mirrors that check, but only reactively — it runs `fn`, and only at that point throws `'Your account is awaiting admin approval'` if the user isn't approved. Every button that triggers a write (Import Data, inline cell edits, FTD add/edit/save, delete-and-replace-duplicate) is fully clickable regardless of approval status; an unapproved user can click through an entire flow (open the upload modal, pick a file, wait for the parse) only to get an error toast at the very end.

`isApproved` is already computed inside `useAuth` but isn't read anywhere in the UI — `App.tsx` doesn't even destructure it.

## Goals

- Buttons that trigger a write (Import Data, FTD "+ Add/Edit Month" / "Save Month", inline `EditableCell` edits in `FtdMatrixTable`, "Delete & replace" in `DuplicateWarning`) are disabled with an explanatory tooltip when the signed-in user is signed in but not yet approved.
- Signed-out users are NOT blocked by this change — those buttons stay exactly as clickable as they are today (the existing `requireAuth` → open-login-modal → resume-on-sign-in flow is unaffected), just with an added informational tooltip.
- No flash of "disabled" for approved users while the async approval check is still resolving on page load.

## Non-goals

- No change to the actual enforcement boundary — RLS and `requireAuth`'s reactive throw stay exactly as they are; this is a UI/UX layer on top, not a new security control.
- `AdminUsers.tsx`'s approve/revoke buttons are unaffected — that page is already gated by `isAdmin` at the nav level and has its own busy-state disable pattern; an admin's own approval status isn't the relevant gate for acting on other users.
- `BPSites`/`LPSites`'s `onEditCell`/GSV/SV/AFF inline-edit wiring is unaffected. Per research, that plumbing exists in state/props but nothing in the current render tree actually invokes it (no live UI trigger) — there's nothing to gate yet. If a live trigger is added later, it should reuse `getWriteGate`/the `EditableCell` `disabled` prop added here.

## Architecture

### `useAuth.ts`: new `accessLoading` state

`isApproved` currently defaults to `false` and there's no way for a consumer to distinguish "checked, and not approved" from "still checking." Add `accessLoading` (state, defaults `true`) alongside the existing `isApproved`/`isAdmin`:

- Set `true` at the start of `refreshAccess` whenever a session with a `userId` exists (a real check is starting).
- Set `false` in both the `.then` and `.catch` branches of the `getUserAccess(userId)` call (guarded by the existing `gen !== accessGen.current` staleness check, same as `approvedRef`/`isApproved`/`isAdmin` today).
- In the `!userId` branch (signed out — no check needed at all), set it `false` immediately.

Returned object becomes `{ session, modalOpen, requireAuth, openLogin, cancelAuth, isApproved, isAdmin, accessLoading }`.

### New helper: `getWriteGate`

A pure function (added to `src/lib/useAuth.ts` and exported, since it's a small derivation of that hook's own state — no new file needed):

```ts
export interface WriteGate {
  disabled: boolean
  title?: string
}

export function getWriteGate(session: Session | null, isApproved: boolean, accessLoading: boolean): WriteGate {
  if (!session) return { title: 'Sign in to make changes', disabled: false }
  if (accessLoading) return { disabled: false }
  if (!isApproved) return { title: 'Awaiting admin approval', disabled: true }
  return { disabled: false }
}
```

| State | `disabled` | `title` |
|---|---|---|
| Signed out | `false` | "Sign in to make changes" |
| Signed in, access check in flight | `false` | — |
| Signed in, pending | `true` | "Awaiting admin approval" |
| Signed in, approved | `false` | — |

### Wiring

`App.tsx` (`Layout`) destructures `isApproved` and `accessLoading` from `useAuth()` (today it only pulls `isAdmin`), computes `const writeGate = getWriteGate(session, isApproved, accessLoading)` once per render, and threads it to:

- **`Sidebar`**: new `writeGate` prop, applied to the "Import Data" footer button (`disabled`/`title`).
- **`Home.tsx`**: both "Import Data" triggers, via the existing `rrContext` (add `writeGate` to `RROutletContext` in `types/index.ts`).
- **`DuplicateWarning`**: new `writeGate` prop, applied to "Delete & replace".
- **`FTDs.tsx`**: "+ Add/Edit Month" button, via `rrContext`; passed through to **`FtdEntryForm`**'s "Save Month" button as a prop.
- **`FtdMatrixTable`**: `writeGate` passed as a prop, applied to each `EditableCell` instance (Stags/REG/FTD).

**`EditableCell`** gains two new optional props, `disabled?: boolean` and `disabledTitle?: string`:
- When `disabled`, the click/tap handler that normally enters edit mode is a no-op.
- The cell's wrapper element gets `title={disabledTitle}` so hovering explains why.
- Existing behavior (no `disabled` passed) is unchanged — this is additive.

Buttons apply `writeGate` directly: `disabled={writeGate.disabled} title={writeGate.title}`.

## Data flow / error handling

Unchanged from the existing reactive path: `requireAuth`'s throw (`'Your account is awaiting admin approval'`) remains the actual last-resort enforcement, for any request that's already in flight when approval status changes, or any write path this change doesn't cover. `writeGate` is purely presentational and never itself blocks a request — it only prevents the click from starting one.

## Testing / verification

No test suite is configured in this repo. Verification is manual via the dev server, toggling a test account's `user_access.status` between `pending` and `approved` (and testing fully signed-out) and confirming, for each of the five gated entry points:
- Signed out: button enabled, tooltip present, existing sign-in-then-resume flow still works unchanged.
- Pending: button disabled, tooltip reads "Awaiting admin approval", no request is attempted.
- Approved: button enabled, no tooltip, write succeeds.
- On a hard page reload as an approved user, confirm no visible flash of disabled buttons before `accessLoading` resolves.

## Risks / things to verify during implementation

- `accessLoading` starting at `true` means on very first mount (before `getSession()` resolves) every gated button is briefly in the "loading" (non-disabled, no tooltip) state even for a signed-out visitor — this is intentional per the "no flash" goal, but means a signed-out user could see an enabled-with-no-tooltip button for a moment before it settles to enabled-with-tooltip. Cosmetic only; no functional gap since `requireAuth` still gates the actual write.
