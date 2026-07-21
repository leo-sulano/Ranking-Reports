# Activity log / Log page

## Problem

When one teammate uploads a new snapshot, edits a ranking cell, or updates an FTD month, nobody else can tell who made the change or what it was before. There's no audit trail — the app only shows current state.

## Goals

- Every data-mutating action across the dashboard (upload, inline edit, delete) writes a row to a persistent, append-only activity log: who did it, when, and what changed.
- A new `/log` page lists the log, newest first, visible to any approved signed-in user.
- Edits capture before → after values so a viewer can see exactly what changed, not just that "something" changed.

## Non-goals

- No filtering/search/pagination UI on the Log page — a flat list of the most recent 200 entries only. Can be added later if needed.
- No logging of `/admin/users` actions (approve/revoke/promote/delete) — out of scope for this pass.
- No ability to edit or delete log entries once written (by anyone, including admins) — the log is a permanent record.
- No real-time/live updates on the Log page — it loads once on mount, same as every other page in the app (refresh to see newer entries).

## Architecture

### 1. Data model — `activity_log` table

New table, added via `supabase/activity-log.sql` (idempotent, run-once-in-SQL-editor, same pattern as `user-approval.sql`) and folded into `schema.sql` for fresh installs:

```sql
create table if not exists public.activity_log (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  email       text not null,
  action      text not null,   -- 'upload' | 'edit' | 'delete'
  section     text not null,   -- 'bp-sites' | 'lp-sites' | 'ftds'
  summary     text not null    -- human-readable description, e.g. "Edited SV for lucky7even.com / \"casino bonus\" (UK): '1200' → '1500'"
);

create index if not exists activity_log_created_at_idx
  on public.activity_log (created_at desc);
```

`user_id` uses `on delete set null` (not cascade) — if a user account is later deleted, their past log entries must survive; `email` is captured as a plain-text snapshot at write time for exactly this reason (it keeps displaying correctly even if the account is gone or the user's email changes).

RLS, following the existing approval-aware pattern from `user-approval.sql`:

```sql
alter table public.activity_log enable row level security;

create policy "approved read activity_log" on public.activity_log
  for select
  using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));

create policy "approved insert activity_log" on public.activity_log
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved')
  );
```

No update or delete policy is created — with RLS enabled and no policy for those commands, every UPDATE/DELETE is denied by default, making the table append-only at the database level regardless of what the client sends.

### 2. Client logging helper — `src/lib/activityLog.ts`

```ts
export type LogAction  = 'upload' | 'edit' | 'delete'
export type LogSection = 'bp-sites' | 'lp-sites' | 'ftds'

export interface ActivityLogEntry {
  id:        number
  createdAt: string
  email:     string
  action:    LogAction
  section:   LogSection
  summary:   string
}

export async function logActivity(action: LogAction, section: LogSection, summary: string): Promise<void>
export async function loadActivityLog(limit?: number): Promise<ActivityLogEntry[]>
```

`logActivity` reads the current user via `supabase.auth.getUser()`, inserts one row (`user_id`, `email: user.email ?? 'unknown'`, `action`, `section`, `summary`), and on error just `console.error`s — it never throws and callers never `await`-block their UI on it (fire-and-forget via `void logActivity(...)`). A failed log write must never roll back or block the real mutation, and must never surface as a user-facing error toast, since the log itself is a secondary concern to the actual data change.

`loadActivityLog(limit = 200)` selects all columns ordered by `created_at desc` with `.limit(limit)`, mapped from snake_case to the `ActivityLogEntry` shape (same mapping style as `loadFtdData` in `ftdStorage.ts`).

### 3. Call sites

Each handler captures the "before" value from its existing in-memory state *before* calling the mutating storage function, then fires `logActivity` *after* that storage call succeeds (inside the existing try block, after the `await requireAuth(...)` line, before `setState`). All calls are fire-and-forget (`void logActivity(...)`) — they don't affect the handler's existing return/error flow at all.

**`src/App.tsx`:**

| Handler | action | section | summary |
|---|---|---|---|
| `persistOneSnapshot` single-import caller (`handleImport`, `snapshots.length === 1` branch) | `upload` | `category` | `` `Uploaded ${records.length} records — ${displayDate}` `` |
| `handleImport` bulk branch (after the loop) | `upload` | `category` | `` `Bulk uploaded ${okCount} snapshot(s) · ${totalRecords} records total` `` |
| `handleReplaceDuplicate` | `upload` | `existing.category` | `` `Replaced snapshot — ${snap.displayDate} (${pendingRecords.length} records)` `` |
| `handleDeleteSnapshot` | `delete` | `snap.category` | `` `Deleted snapshot — ${snap.displayDate} (${snap.records.length} records)` `` |
| `handleEditCell` | `edit` | snapshot's `category` | see below |

`handleEditCell` before/after: before calling `updateRecordFields`, find the first record in `state.snapshots` matching `snapshotId` + the `matcher` (same matching logic already used in the `setState` updater a few lines below — domain/keyword/country, each field only compared when present on the matcher). For each field present in `patch` (`searchVolume`, `affiliateUrl`, `globalSearchVolume`), if the old value differs from the new one, append `` `${FieldLabel} ${old || '(empty)'} → ${new || '(empty)'}` `` to a list; join with `, `. Prefix with a context string built from the matched record and matcher, e.g.:

```
Edited SV for lucky7even.com / "casino bonus" (UK): '1200' → '1500'
```

For GSV edits (matcher = `{ keyword }` only, matching many records), the context string omits domain/country: `` `Edited GSV for "casino bonus": '5.2K' → '6.1K'` ``. If `patch` touches multiple fields at once (shouldn't currently happen via `EditableCell`, but the type allows it), join multiple change fragments with `; `.

**`src/pages/FTDs.tsx`** (all `section: 'ftds'`):

| Handler | action | summary |
|---|---|---|
| `handleEditRecord` | `edit` | before = `records.find(r => r.brand === brand && r.yearMonth === yearMonth)` (undefined for a brand-new brand/month row — treat as `reg: 0, ftd: 0, conversionPct: null`). For each key in `patch` whose value differs from before, append `` `${Label} ${old} → ${new}` ``; join with `, `. Prefix: `` `Edited ${brand} — ${formatMonthLabel(yearMonth)}: ${changes}` `` |
| `handleEditTotals` | `edit` | before = `totals.find(t => t.yearMonth === yearMonth)?.conversionPct ?? null`. `` `Edited ${formatMonthLabel(yearMonth)} totals conversion: ${old ?? '—'}% → ${new ?? '—'}%` `` |
| `handleEditStags` | `edit` | before = `stags.find(s => s.brand === brand)?.stags ?? ''`. `` `Edited ${brand} stags: '${old}' → '${new}'` `` |

`formatMonthLabel` is already exported from `FtdMatrixTable.tsx` and imported in `FTDs.tsx` — reused as-is for consistent month formatting.

If a handler's patch produces zero actual field changes (old === new for every field), skip the log call entirely — no-op edits shouldn't create log noise.

### 4. Log page — `src/pages/Log.tsx`

New page, added to `App.tsx`'s route table as `<Route path="/log" element={<Log />} />` (alongside the other top-level routes, not admin-gated).

On mount, calls `loadActivityLog()` and renders a flat, reverse-chronological list — no filters, no pagination controls. Loading state matches the existing `"Loading …"` pattern used by `FTDs.tsx`/`AdminUsers.tsx`. Empty state: a centered "No activity yet." message, matching `AdminUsers.tsx`'s empty-section text style.

Each row (divide-y list, same visual pattern as `AdminUsers.tsx`'s approved/pending rows):
- Timestamp — formatted with the same `toLocaleDateString`-based helper style as `AdminUsers.tsx`'s `formatDate`, extended to include time (e.g. `20 Jul 26, 3:42 PM`).
- Email.
- A small action badge (Upload / Edit / Delete) — colored consistent with existing badge usage (e.g. the `Admin` pill in `AdminUsers.tsx`): green-ish for upload, blue for edit, red for delete.
- A small section badge (BP Sites / LP Sites / FTDs).
- The `summary` text.

### 5. Navigation

`src/components/Sidebar.tsx`'s `PAGES` array gets a new entry after `/how-it-works`:

```ts
{ path: '/log', label: 'Activity Log', icon: <History size={18} /> }
```

(`History` imported from `lucide-react`, alongside the existing `CircleHelp`/`DollarSign`/`Users` imports.) Visible to every user — not added to the admin-only `ADMIN_PAGE` gating.

## Testing / verification

No test suite is configured. Manual verification via dev server, after running `supabase/activity-log.sql` against the project:

- **Upload (single):** import a flat-format XLSX for BP Sites → new "Uploaded N records — <date>" entry appears at the top of `/log`, tagged `upload` / `bp-sites`, with the correct email.
- **Upload (bulk):** import a matrix-format XLSX with multiple date sheets → one "Bulk uploaded N snapshot(s) …" entry, not one per snapshot.
- **Duplicate replace:** re-upload a date that already exists, confirm the replace dialog → one "Replaced snapshot …" entry.
- **Delete:** delete a snapshot from the sidebar/tabs → one "Deleted snapshot …" entry.
- **Inline edit (SV/AFF):** edit a cell on BP Sites → entry shows old → new values and the right domain/keyword/country context.
- **Inline edit (GSV):** edit a keyword's GSV → entry shows old → new with no domain/country in the context string.
- **No-op edit:** re-save a cell with the same value → confirm no log entry is created.
- **FTD record edit:** change REG and FTD together for one brand/month → single entry listing both field changes.
- **FTD totals / stags edit:** each produces its own correctly-worded entry.
- **Visibility:** sign in as a non-admin approved user → `/log` is reachable from the sidebar and shows the full list (not just that user's own actions).
- **RLS:** confirm a pending (not-yet-approved) user cannot read `/log` (either redirect-free empty state or an error toast, per how `loadActivityLog`'s rejection is surfaced — should degrade the same way other pages do for unapproved sessions) and cannot insert a row by calling `logActivity` manually from the console.
- **Immutability:** attempt an UPDATE/DELETE against `activity_log` directly via the Supabase client in the browser console while signed in (even as admin) → confirm RLS rejects it.

## Risks / things to verify during implementation

- `handleEditCell`'s matcher-based "find the before record" logic must mirror the exact matching rules already used in its `setState` updater (`App.tsx`) — any drift between the two would make the logged old-value wrong even though the actual data update is correct. Implement by extracting/reusing the same predicate rather than writing it twice.
- Running `supabase/activity-log.sql` against the live project (ref `assqmmenobaflmcabkpu`) is a manual step the user needs to do in the Supabase SQL editor before this feature works end-to-end — same deploy dependency shape as prior features that added tables/policies.
