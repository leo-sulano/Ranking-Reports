# Scheduled Ranks API Sync — Design

**Date:** 2026-08-11
**Status:** Approved

## Purpose

The Ranks API sync shipped as a sidebar button (PR #25, #26). This spec adds the
scheduled half: a Vercel Cron that pulls BP Sites rankings twice a week with no
human in the loop, which is what the original request asked for. The button, the
xlsx import and all inline editing stay exactly as they are.

## Schedule

`vercel.json` gains one entry:

```json
"crons": [{ "path": "/api/cron-sync", "schedule": "0 4 * * 3,5" }]
```

04:00 UTC is 12:00 PHT on Wednesdays and Fridays. The Philippines has never
observed DST, so a UTC-anchored expression stays correct year-round — no
seasonal drift to correct for later.

**Hobby-plan precision.** This project is on Hobby, where cron jobs are capped
at once per day and Vercel may invoke them at any minute inside the stated hour
to spread load. Twice a week is within the cap and deploys fine, but the real
fire time is somewhere in 12:00–12:59 PHT. Pro would give exact-minute firing
with no code change.

## Authentication

`api/cron-sync.ts` is GET-only and requires `Authorization: Bearer $CRON_SECRET`.
Vercel sends that header automatically once `CRON_SECRET` exists in the project
environment.

It fails closed: if `CRON_SECRET` is unset the handler 401s every request,
including Vercel's own, so a half-configured deployment is inert rather than an
open endpoint.

The Supabase session path (`api/_lib/requestAuth.ts`) is deliberately not
involved. A cron has no user, so there is no token to verify and no
`user_access` row to check; `CRON_SECRET` is the whole of its identity.

## Shared code

The cron needs `normalizeRows` and `DOMAIN_TO_BRAND`, which live in `src/lib`
and cannot be imported from `api/` today: `tsconfig.api.json` uses
`module: NodeNext`, and Vercel's runtime has already been observed to require
explicit `.js` specifiers in `api/`.

Three modules move to `api/_lib/`, and their old paths become re-exports, so no
frontend import changes:

| New home | Contents | Old path |
|---|---|---|
| `api/_lib/brands.ts` | `BRANDS`, `DOMAIN_TO_BRAND`, `LP_DOMAIN_TO_BRAND`, `COUNTRY_LABELS`, `normalizeCountry` | `src/lib/brands.ts` re-exports these, keeps the UI-only `BRAND_LOGO_COLORS`, `BRAND_FAVICONS`, `brandToSlug`, `BRAND_BY_SLUG` |
| `api/_lib/sitesNormalize.ts` | `ApiRow`, `normalizeRows` and helpers | `src/lib/sitesNormalize.ts` re-exports |
| `api/_lib/ranksPaging.ts` | `fetchAllRows`, `MAX_ROWS` | `src/lib/sitesApi.ts` imports it |

`api/_lib/` was chosen over a new top-level `shared/` directory because it is an
already-proven location under Vercel's build — `requestAuth.ts` works there with
`.js` specifiers today — and adding a third tsconfig project would introduce a
new build target on a platform whose module resolution has already caught this
project out once. The cost is that brand configuration lives under `api/`, which
reads oddly; `src/lib/brands.ts` keeps its name and its role as the frontend's
import site, so the oddity is confined to one file header comment.

Moving `normalizeCountry` out of `parser.ts` also removes the `xlsx`
value-import from the sync module's dependency graph — a deferred finding from
the PR #25 review. `parser.ts` imports it back from `brands.ts` for its own use.

Two further modules are new and are **not** shared with the browser:

- `api/_lib/ranks.ts` — the upstream base URL plus a single-page fetch.
  `api/sites.ts` is refactored onto it, so the vendor URL, the action allow-list
  and the limit/offset clamps exist in exactly one place.
- `api/_lib/snapshotStore.ts` — service-role persistence: find a snapshot by
  (category, raw_date), delete-then-insert records in 500-row chunks, append an
  activity row. It mirrors `src/lib/storage.ts` but with the admin client,
  because `storage.ts` is bound to the browser client and cannot run here.

`SUPABASE_SERVICE_ROLE_KEY` already exists in the Vercel environment
(`api/portal-callback.ts` uses it), so the write path needs no new secret.

## Overwrite policy

One migration, `supabase/cron-sync.sql`:

```sql
alter table public.snapshots
  add column if not exists source text not null default 'upload';  -- 'upload' | 'sync'
```

No CHECK constraint, deliberately: `activity_log.action` being free text is why
adding `'sync'` there required no migration, and that tradeoff is worth
repeating for a column whose only writers are in this repo. The default matters
— all 89 existing snapshots become `'upload'`, which is accurate, since every
one is human work.

`upsertSnapshot` gains a `source` argument. The xlsx path passes `'upload'`; the
Sync button passes `'sync'`.

The cron's decision is a pure function,
`decideWrite(existing: { source: string } | null): 'insert' | 'replace' | 'skip'`.
The caller has already looked up whether a snapshot exists for the incoming
batch's (category, raw_date), so the rule depends on nothing else:

| Existing snapshot for that (category, date) | Action |
|---|---|
| none | `insert` |
| `source = 'sync'` | `replace` — the cron's own prior output, or a button sync of the same vendor data |
| `source = 'upload'` | `skip`, and log why |
| any other value | `skip` — an unrecognised source is protected, not overwritten |

**Inline edits mark a snapshot as human-touched.** A button-sync snapshot is
`'sync'`, so without this a hand-typed GSV value on it would be silently
replaced by the next cron run. `updateRecordFields` therefore also sets that
snapshot's `source` to `'upload'`. This is what makes "never destroys a snapshot
a person edited" a real guarantee rather than a nominal one, and it costs one
extra UPDATE on a path that is already writing.

## Failure handling

Every run writes exactly one `activity_log` row — `action: 'sync'`,
`section: 'bp-sites'`, `email: 'cron@ranking-reports'`, `user_id: null`. The
column is nullable, and the service-role client bypasses the RLS policy that
otherwise requires `user_id = auth.uid()`. `/log` therefore becomes the cron's
history, readable by any approved user with no new UI.

| Outcome | Logged summary |
|---|---|
| Inserted | `Scheduled sync — 1,109 records (4 Aug 26)` |
| Replaced | `Scheduled sync — replaced 4 Aug 26 (1,109 records)` |
| Skipped | `Scheduled sync — skipped 4 Aug 26: that snapshot was uploaded or edited by a person` |
| Zero matching rows | `Scheduled sync — 0 Rooster rows after filtering; nothing written` |
| Failed | `Scheduled sync failed: <message>` |

The handler returns a non-2xx status on failure so Vercel's cron log agrees with
the activity log rather than reporting a clean run. Nothing is written unless
the entire batch fetched and normalized cleanly — the same invariant the button
holds.

### Two limits, stated rather than buried

- **60s ceiling.** Hobby caps function duration at 60s, which `api/sites.ts`
  already uses. A run is roughly three upstream pages plus 1,109 rows in three
  chunks — on the order of 10–15s — so the headroom is real, but a slow vendor
  day fails the run rather than half-writing it. The next scheduled run retries;
  there is no retry within a run.
- **Delete-then-insert is not transactional** through PostgREST, so a failure
  *mid-insert* can leave a partially written snapshot. This risk already exists
  on the xlsx path via `storage.ts` and is not introduced here. Fixing it (an
  RPC wrapping both in one transaction) is out of scope.

## Testing

- `decideWrite` — all four rows of the table above, including the unknown-source
  case defaulting to `skip`.
- `api/cron-sync.ts` auth — no header → 401; wrong secret → 401; `CRON_SECRET`
  unset → 401; correct secret → proceeds.
- `api/_lib/snapshotStore.ts` — the 500-row chunk boundary, and that an error on
  any chunk propagates rather than being swallowed.
- The 63 existing sync tests (`sitesNormalize.test.ts` 21, `sitesApi.test.ts` 19,
  `api/sites.test.ts` 23) move with their modules and keep passing unchanged.
  Any test that has to change is a signal the move altered behaviour, which it
  must not.

The suite currently stands at 96 passing, 2 failing — both in
`api/_lib/ssoPortal.test.ts`, both pre-dating this work and unrelated to it.
That baseline must not get worse.

Not covered by tests: the schedule actually firing, which no unit test can
assert. Verified after deploy by calling the endpoint directly with the secret
and confirming the resulting `/log` row.

## Ops

Two manual steps, neither doable from the repo:

1. Add `CRON_SECRET` to the Vercel project environment (Production). Any long
   random string. Until it exists the endpoint 401s everything.
2. Run `supabase/cron-sync.sql` in the Supabase SQL editor.

**Step 2 must happen before this branch is deployed to production.** It is not
optional groundwork for the cron alone — without the column the app does not
work at all:

- `loadSnapshotMeta` **selects** `source`, so the initial load fails outright
  (PostgREST `42703`) and the dashboard renders no ranking data whatsoever.
- `src/lib/storage.ts` **writes** `source` on every snapshot insert and every
  inline edit, so the xlsx import, the Sync button and inline editing each fail
  with PostgREST `PGRST204` ("column snapshots.source does not exist").

If the column exists but reads or writes still fail on it, PostgREST is holding
a stale schema cache — refresh it with `notify pgrst, 'reload schema';`.

Step 1 has no such ordering constraint: a deployment without `CRON_SECRET` just
401s the cron, and nothing else in the app touches it.

`npx vercel build` should be run before merging to confirm the `api/_lib/`
imports resolve — this project has hit that failure mode before.

## Out of scope

- **Historical backfill** via `action=history`. Unchanged from the button spec.
- **LP Sites.** The API tracks none of those domains.
- **Email or webhook alerting.** Failures surface in `/log`; pushing them
  needs a provider and a secret this project does not have.
- **A staleness banner** in the app.
- **Transactional snapshot replacement.** Pre-existing behaviour, see above.
- **Changing the button, the xlsx import, or inline editing** beyond the
  `source` write described above.
