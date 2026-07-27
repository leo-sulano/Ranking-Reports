# SSO portal callback must not re-approve revoked users

Date: 2026-07-27
Scope: `api/portal-callback.ts`, `api/_lib/ssoPortal.ts`. No schema or UI change.

## Problem

`api/portal-callback.ts` unconditionally upserted `user_access.status = 'approved'`
on **every** SSO login. An admin could revoke a portal user in `/admin/users`, and the
revoke held only until that user's next visit through the portal, which silently
restored their access. Since RLS gates every write on `status = 'approved'`, this
handed back full write access to someone an admin had deliberately cut off.

## Why it isn't a one-line fix

Revoking writes `status = 'pending'` (`AdminUsers.tsx`), and the `on_auth_user_created`
trigger also inserts `status = 'pending'` for every brand-new user. The schema's CHECK
constraint allows only `('pending', 'approved')`. So **`pending` means both "brand new,
awaiting the portal's auto-approval" and "revoked by an admin"** — the status column
alone cannot distinguish them, and any fix must find another signal.

## Approach

Use *whether we just created the auth user* as that signal. `ensureUserExists` already
knows: `createUser` either succeeds (new) or fails with `email_exists` (existing). It
discarded that information by returning `void`.

**`api/_lib/ssoPortal.ts`** — `ensureUserExists` returns `Promise<boolean>`:

| Case | Return |
|---|---|
| `createUser` succeeds | `true` — we just created them |
| `error.code === 'email_exists'` | `false` |
| legacy GoTrue "already registered" / "already exists" message | `false` |
| any other error | throws (unchanged) |

Unknown errors still throw, so a real provisioning failure can never be mistaken for
"existing user" and silently skip approval.

**`api/portal-callback.ts`** — gate the upsert on that flag:

- **First arrival** → upsert `status: 'approved'`, preserving the SSO design decision
  that portal users are auto-approved with no admin step.
- **Returning user** → no write at all. Whatever the admin last set stands. A revoked
  user still receives their magic link and a valid session, then lands on the existing
  awaiting-approval screen because RLS keys off `status = 'approved'`.

The upsert stays after `generateLink` (it needs `link.user.id`), and the `?error=access`
failure path is unchanged for new users.

## Accepted trade-off

A user who self-signed-up in the app first (row exists, `pending`) and *then* arrives via
the portal is no longer auto-approved — an admin must approve them. Previously the portal
would have promoted them. This is the deliberate cost of not being able to tell that case
apart from a revoke, and it fails closed.

## Side effect

Returning users no longer have their `user_access.email` refreshed on each login.
Harmless: email is the key used to resolve the auth user in the first place, so a changed
email is a different user.

## Verification

- `ensureUserExists` driven with a stub `AdminUserCreator` across all five cases above
  (four return values + the throw). No test framework is configured, so this ran as a
  throwaway script rather than a committed test.
- `npm run build` clean; `npx vercel build` completes and emits
  `.vercel/output/functions/api/portal-callback.func`.
- **Not verifiable locally:** the real SSO round-trip needs a signed portal token against
  production. After deploy, confirm on prod: revoke a portal user in `/admin/users`, have
  them return through the portal, and check they land on the awaiting-approval screen and
  their `user_access` row still reads `pending`.
