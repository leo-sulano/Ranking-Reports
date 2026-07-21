# Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an append-only activity log that records every upload, inline edit, and snapshot delete across the dashboard (who, when, what changed), and a new `/log` page visible to any approved user to view it.

**Architecture:** A new Supabase table (`activity_log`) with approval-aware RLS (read: any approved user; insert: only your own rows; no update/delete policy for anyone, making it append-only by construction). A small client module (`src/lib/activityLog.ts`) exposes a fire-and-forget `logActivity()` writer and a `loadActivityLog()` reader. Every existing mutation handler in `App.tsx` and `FTDs.tsx` calls `logActivity()` right after its Supabase write succeeds, using state it already holds to compute a before → after summary string. A new `Log.tsx` page renders the log as a flat, reverse-chronological list.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + RLS). No test suite configured — verification is `npm run build` (type-check) after each code task, plus manual testing in the dev server and the Supabase dashboard (SQL editor / Table editor).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-activity-log-design.md`
- Verification command after every code task: `npm run build` — must exit 0 with no TypeScript errors.
- `activity_log` RLS must have no update/delete policy for any role — the table is append-only at the database level, not just by client convention.
- `logActivity()` must never throw and callers must never `await`-block on it — a failed log write must never roll back or surface as an error for the real mutation it describes. Callers fire it as `void logActivity(...)`.
- `handleEditCell`'s "find the before record" logic (Task 3) must reuse the exact same matcher predicate used to apply the patch — implemented as one shared `matchRecord` function, not duplicated logic, so the logged old value can never drift from what's actually being changed.
- Running `supabase/activity-log.sql` against the live project (ref `assqmmenobaflmcabkpu`, Supabase SQL editor) is a manual step required before Task 3's manual verification will show real rows — do this at the start of Task 1.

---

### Task 1: `activity_log` table + RLS

**Files:**
- Create: `supabase/activity-log.sql`
- Modify: `supabase/schema.sql` (append a new section at the end)

**Interfaces:**
- Produces: `public.activity_log(id, created_at, user_id, email, action, section, summary)` with RLS allowing SELECT for any approved user and INSERT only for `user_id = auth.uid()` (also approved). Consumed by Task 2's `logActivity`/`loadActivityLog`.

- [ ] **Step 1: Write `supabase/activity-log.sql`**

Create `supabase/activity-log.sql`:

```sql
-- ============================================================================
-- Ranking Reports — ACTIVITY LOG (audit trail for uploads/edits/deletes)
-- ============================================================================
-- Adds an append-only activity_log table: every upload, inline edit, and
-- snapshot delete across the dashboard writes one row here, so any approved
-- user can see who changed what and when on the /log page.
--
-- ── CHECKLIST ────────────────────────────────────────────────────────────────
--   1. Run THIS file: Supabase Dashboard → SQL Editor → New query → paste → Run.
--   2. No other setup needed — reads/writes go through the anon key + RLS,
--      same as every other table in this app. Requires user-approval.sql to
--      have already been run (this policy depends on public.user_access).
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create table if not exists public.activity_log (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  email       text not null,
  action      text not null,   -- 'upload' | 'edit' | 'delete'
  section     text not null,   -- 'bp-sites' | 'lp-sites' | 'ftds'
  summary     text not null
);

create index if not exists activity_log_created_at_idx
  on public.activity_log (created_at desc);

-- Row Level Security ---------------------------------------------------------
-- Append-only: any approved user can read the full log; a user can only
-- insert rows attributed to themselves; no update/delete policy exists for
-- any role, so RLS denies those commands outright — nobody (including
-- admins) can edit or erase a log entry once written.
alter table public.activity_log enable row level security;

drop policy if exists "approved read activity_log" on public.activity_log;
drop policy if exists "approved insert activity_log" on public.activity_log;

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

- [ ] **Step 2: Append the same section to `supabase/schema.sql`**

`supabase/schema.sql` currently ends at line 266 with:

```sql
create policy "auth delete brand_stags" on public.brand_stags for delete to authenticated using (exists (select 1 from public.user_access a where a.user_id = auth.uid() and a.status = 'approved'));
```

Append this new section immediately after it (so fresh installs get the table automatically):

```sql

-- ============================================================================
-- Activity log — see activity-log.sql for the full setup checklist. Table/RLS
-- below are identical; append-only (no update/delete policy for any role).
-- ============================================================================

create table if not exists public.activity_log (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  email       text not null,
  action      text not null,   -- 'upload' | 'edit' | 'delete'
  section     text not null,   -- 'bp-sites' | 'lp-sites' | 'ftds'
  summary     text not null
);

create index if not exists activity_log_created_at_idx
  on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists "approved read activity_log" on public.activity_log;
drop policy if exists "approved insert activity_log" on public.activity_log;

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

- [ ] **Step 3: Run the migration against the live project**

In the Supabase Dashboard → SQL Editor → New query, paste the full contents of `supabase/activity-log.sql` and run it.

Expected: query succeeds with no errors (idempotent — safe even if run twice).

- [ ] **Step 4: Verify the table and policies exist**

In the same SQL editor, run:

```sql
select policyname, cmd from pg_policies where tablename = 'activity_log';
```

Expected: two rows — `approved read activity_log` (`cmd = SELECT`) and `approved insert activity_log` (`cmd = INSERT`). No `UPDATE` or `DELETE` rows.

- [ ] **Step 5: Commit**

```bash
git add supabase/activity-log.sql supabase/schema.sql
git commit -m "feat: add activity_log table with append-only RLS"
```

---

### Task 2: `src/lib/activityLog.ts` — logging helper

**Files:**
- Create: `src/lib/activityLog.ts`

**Interfaces:**
- Consumes: `supabase` from `./supabase` (existing client), and the `activity_log` table from Task 1.
- Produces:
  - `type LogAction = 'upload' | 'edit' | 'delete'`
  - `type LogSection = 'bp-sites' | 'lp-sites' | 'ftds'`
  - `interface ActivityLogEntry { id: number; createdAt: string; email: string; action: LogAction; section: LogSection; summary: string }`
  - `logActivity(action: LogAction, section: LogSection, summary: string): Promise<void>` — never throws.
  - `loadActivityLog(limit?: number): Promise<ActivityLogEntry[]>` — throws on error, same convention as `loadFtdData`.
  - Consumed by Task 3 (`App.tsx`), Task 4 (`FTDs.tsx`), and Task 5 (`Log.tsx`).

- [ ] **Step 1: Write `src/lib/activityLog.ts`**

```ts
import { supabase } from './supabase'

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

/**
 * Best-effort activity log write. Never throws — a failed log write must
 * never block or roll back the real mutation it's describing. Callers fire
 * this without awaiting: `void logActivity(...)`.
 */
export async function logActivity(action: LogAction, section: LogSection, summary: string): Promise<void> {
  const { data, error: userErr } = await supabase.auth.getUser()
  if (userErr || !data.user) {
    console.error('logActivity: no signed-in user, skipping', userErr)
    return
  }
  const { error } = await supabase.from('activity_log').insert({
    user_id: data.user.id,
    email:   data.user.email ?? 'unknown',
    action,
    section,
    summary,
  })
  if (error) console.error('Failed to write activity log:', error)
}

export async function loadActivityLog(limit = 200): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, created_at, email, action, section, summary')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((r) => ({
    id:        r.id as number,
    createdAt: r.created_at as string,
    email:     r.email as string,
    action:    r.action as LogAction,
    section:   r.section as LogSection,
    summary:   r.summary as string,
  }))
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Manual smoke test via the browser console**

Run `npm run dev`, open the app, sign in as an approved user. Open browser dev tools console and run:

```js
const { logActivity, loadActivityLog } = await import('/src/lib/activityLog.ts')
await logActivity('edit', 'bp-sites', 'Console smoke test entry')
const rows = await loadActivityLog()
console.log(rows[0])
```

Expected: no error thrown; `rows[0]` is an object with `summary: 'Console smoke test entry'`, `action: 'edit'`, `section: 'bp-sites'`, and your signed-in email. Then in the Supabase Dashboard → Table Editor → `activity_log`, confirm the row is there with the correct `user_id`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/activityLog.ts
git commit -m "feat: add activityLog client module (logActivity, loadActivityLog)"
```

---

### Task 3: Wire logging into `App.tsx` (uploads, delete, inline cell edits)

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `logActivity` from `./lib/activityLog` (Task 2).
- Produces: nothing new for other files — this task only adds log calls to existing handlers.

- [ ] **Step 1: Import `logActivity`**

Current imports (`src/App.tsx:14`):

```ts
import { loadSnapshots, upsertSnapshot, deleteSnapshot, updateRecordFields } from './lib/storage'
```

Add immediately after it:

```ts
import { logActivity } from './lib/activityLog'
```

- [ ] **Step 2: Log the single-snapshot upload path**

Current code (`src/App.tsx:161-171`):

```ts
    if (snapshots.length === 1) {
      const parsed = snapshots[0]
      const dupe = state.snapshots.find((s) => s.category === category && s.rawDate === parsed.rawDate)
      if (dupe) {
        setShowUpload(false)
        setDuplicateWarning({ existing: dupe, pendingRecords: parsed.records, unknownDomains })
        return
      }
      const snap = await persistOneSnapshot(parsed, category)
      if (!snap) return
      setShowUpload(false)
```

Replace with:

```ts
    if (snapshots.length === 1) {
      const parsed = snapshots[0]
      const dupe = state.snapshots.find((s) => s.category === category && s.rawDate === parsed.rawDate)
      if (dupe) {
        setShowUpload(false)
        setDuplicateWarning({ existing: dupe, pendingRecords: parsed.records, unknownDomains })
        return
      }
      const snap = await persistOneSnapshot(parsed, category)
      if (!snap) return
      void logActivity('upload', category, `Uploaded ${parsed.records.length} records — ${snap.displayDate}`)
      setShowUpload(false)
```

- [ ] **Step 3: Log the bulk upload path**

Current code (`src/App.tsx:197-199`):

```ts
      setBulkProgress({ done: i + 1, total: snapshots.length })
    }
    setBulkProgress(null)
```

Replace with:

```ts
      setBulkProgress({ done: i + 1, total: snapshots.length })
    }
    setBulkProgress(null)

    if (okCount > 0) {
      void logActivity('upload', category, `Bulk uploaded ${okCount} snapshot(s) · ${totalRecords.toLocaleString()} records total`)
    }
```

- [ ] **Step 4: Log the duplicate-replace path**

Current code (`src/App.tsx:221-226`):

```ts
    const snap = await persistOneSnapshot(
      { rawDate: existing.rawDate, records: pendingRecords },
      existing.category,
    )
    if (!snap) return
    setUploadSummary({ displayDate: snap.displayDate, records: pendingRecords, unknownDomains })
```

Replace with:

```ts
    const snap = await persistOneSnapshot(
      { rawDate: existing.rawDate, records: pendingRecords },
      existing.category,
    )
    if (!snap) return
    void logActivity('upload', existing.category, `Replaced snapshot — ${snap.displayDate} (${pendingRecords.length} records)`)
    setUploadSummary({ displayDate: snap.displayDate, records: pendingRecords, unknownDomains })
```

- [ ] **Step 5: Log inline cell edits (SV / AFF / GSV), with before → after values**

Current code (`src/App.tsx:236-268`):

```ts
  const handleEditCell = useCallback(async (
    snapshotId: string,
    matcher:    EditCellMatcher,
    patch:      EditCellPatch,
  ) => {
    try {
      await requireAuth(() => updateRecordFields(snapshotId, matcher, patch))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Edit failed: ${msg}`, 'error')
      return
    }
    setState((s) => {
      const next = s.snapshots.map((snap) => {
        if (snap.id !== snapshotId) return snap
        const records = snap.records.map((r) => {
          if (matcher.keyword && r.keyword !== matcher.keyword) return r
          if (matcher.domain  && r.domain  !== matcher.domain)  return r
          if (matcher.country && r.country !== matcher.country) return r
          const np: RankingRecord = { ...r }
          if ('searchVolume'       in patch) np.searchVolume       = patch.searchVolume       ?? ''
          if ('affiliateUrl'       in patch) np.affiliateUrl       = patch.affiliateUrl       ?? ''
          if ('globalSearchVolume' in patch) np.globalSearchVolume = patch.globalSearchVolume ?? ''
          return np
        })
        return { ...snap, records }
      })
      // Carry-forward is applied in the derived useMemo. The raw state only
      // reflects the edited snapshot; downstream propagation happens in the
      // view layer.
      return { ...s, snapshots: next }
    })
  }, [addToast, requireAuth])
```

Replace the whole function with:

```ts
  const handleEditCell = useCallback(async (
    snapshotId: string,
    matcher:    EditCellMatcher,
    patch:      EditCellPatch,
  ) => {
    // Shared by the "find the before value" lookup below and the setState
    // updater's own row selection, so the logged old value can never drift
    // from the row that's actually being patched.
    const matchRecord = (r: RankingRecord) => {
      if (matcher.keyword && r.keyword !== matcher.keyword) return false
      if (matcher.domain  && r.domain  !== matcher.domain)  return false
      if (matcher.country && r.country !== matcher.country) return false
      return true
    }
    const targetSnapshot = state.snapshots.find((s) => s.id === snapshotId)
    const before = targetSnapshot?.records.find(matchRecord)

    try {
      await requireAuth(() => updateRecordFields(snapshotId, matcher, patch))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Edit failed: ${msg}`, 'error')
      return
    }

    if (targetSnapshot && before) {
      const FIELD_LABELS: Record<string, string> = {
        searchVolume:       'SV',
        affiliateUrl:       'AFF',
        globalSearchVolume: 'GSV',
      }
      const changes: string[] = []
      for (const field of ['searchVolume', 'affiliateUrl', 'globalSearchVolume'] as const) {
        if (!(field in patch)) continue
        const oldVal = before[field] ?? ''
        const newVal = patch[field] ?? ''
        if (oldVal === newVal) continue
        changes.push(`${FIELD_LABELS[field]} '${oldVal || '(empty)'}' → '${newVal || '(empty)'}'`)
      }
      if (changes.length > 0) {
        const context = matcher.domain
          ? `${matcher.domain} / "${matcher.keyword ?? before.keyword}" (${matcher.country ?? before.country})`
          : `"${matcher.keyword ?? before.keyword}"`
        void logActivity('edit', targetSnapshot.category, `Edited ${context}: ${changes.join(', ')}`)
      }
    }

    setState((s) => {
      const next = s.snapshots.map((snap) => {
        if (snap.id !== snapshotId) return snap
        const records = snap.records.map((r) => {
          if (!matchRecord(r)) return r
          const np: RankingRecord = { ...r }
          if ('searchVolume'       in patch) np.searchVolume       = patch.searchVolume       ?? ''
          if ('affiliateUrl'       in patch) np.affiliateUrl       = patch.affiliateUrl       ?? ''
          if ('globalSearchVolume' in patch) np.globalSearchVolume = patch.globalSearchVolume ?? ''
          return np
        })
        return { ...snap, records }
      })
      // Carry-forward is applied in the derived useMemo. The raw state only
      // reflects the edited snapshot; downstream propagation happens in the
      // view layer.
      return { ...s, snapshots: next }
    })
  }, [addToast, requireAuth, state.snapshots])
```

- [ ] **Step 6: Log snapshot deletes**

Current code (`src/App.tsx:270-293`):

```ts
  const handleDeleteSnapshot = useCallback(async (id: string) => {
    const snap = state.snapshots.find((s) => s.id === id)
    if (!snap) return
    if (!window.confirm(`Delete snapshot for ${snap.displayDate}? This cannot be undone.`)) return

    try {
      await requireAuth(() => deleteSnapshot(id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Delete failed: ${msg}`, 'error')
      return
    }

    setState((s) => {
```

Replace with:

```ts
  const handleDeleteSnapshot = useCallback(async (id: string) => {
    const snap = state.snapshots.find((s) => s.id === id)
    if (!snap) return
    if (!window.confirm(`Delete snapshot for ${snap.displayDate}? This cannot be undone.`)) return

    try {
      await requireAuth(() => deleteSnapshot(id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Delete failed: ${msg}`, 'error')
      return
    }

    void logActivity('delete', snap.category, `Deleted snapshot — ${snap.displayDate} (${snap.records.length} records)`)

    setState((s) => {
```

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 8: Manual verification via the dev server + Supabase Table Editor**

Run `npm run dev`, sign in as an approved user, and perform each action, checking the Supabase Dashboard → Table Editor → `activity_log` after each one (newest row on top if sorted by `created_at` descending):

- Upload a flat-format XLSX for BP Sites → row with `action=upload`, `section=bp-sites`, summary like `Uploaded N records — <date>`.
- Re-upload the same date → confirm the duplicate-replace dialog → confirm replace → row with summary `Replaced snapshot — <date> (N records)`.
- Delete that snapshot from the sidebar/tabs → row with `action=delete`, summary `Deleted snapshot — <date> (N records)`.
- Re-upload a matrix-format (multi-date) file → one row with `action=upload`, summary `Bulk uploaded N snapshot(s) · N records total` (not one row per snapshot).
- On the BP Sites table, edit an SV or AFF cell → row with `action=edit`, summary showing the old and new values and correct domain/keyword/country context.
- Edit a keyword's GSV cell → row with summary showing old/new GSV with no domain/country in the context.
- Edit a cell and re-save the exact same value → confirm **no new row** is created (no-op edits are skipped).

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat: log uploads, deletes, and cell edits to activity_log"
```

---

### Task 4: Wire logging into `FTDs.tsx` (record / totals / stags edits)

**Files:**
- Modify: `src/pages/FTDs.tsx`

**Interfaces:**
- Consumes: `logActivity` from `../lib/activityLog` (Task 2); `formatMonthLabel` already imported from `../components/FtdMatrixTable`.
- Produces: nothing new for other files.

- [ ] **Step 1: Import `logActivity`**

Current imports (`src/pages/FTDs.tsx:7`):

```ts
import { loadFtdData, upsertFtdRecord, upsertFtdTotals, upsertBrandStags } from '../lib/ftdStorage'
```

Add immediately after it:

```ts
import { logActivity } from '../lib/activityLog'
```

- [ ] **Step 2: Log FTD record edits (REG / FTD / conversion)**

Current code (`src/pages/FTDs.tsx:175-197`):

```ts
  const handleEditRecord = useCallback(async (brand: string, yearMonth: string, patch: FtdRecordPatch) => {
    try {
      await requireAuth(() => upsertFtdRecord(brand, yearMonth, patch))
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
    setRecords((prev) => {
      const idx = prev.findIndex((r) => r.brand === brand && r.yearMonth === yearMonth)
      if (idx === -1) {
        return [...prev, {
          brand,
          yearMonth,
          reg:           patch.reg ?? 0,
          ftd:           patch.ftd ?? 0,
          conversionPct: patch.conversionPct ?? null,
        }]
      }
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }, [addToast, requireAuth])
```

Replace with:

```ts
  const handleEditRecord = useCallback(async (brand: string, yearMonth: string, patch: FtdRecordPatch) => {
    const before = records.find((r) => r.brand === brand && r.yearMonth === yearMonth)
      ?? { brand, yearMonth, reg: 0, ftd: 0, conversionPct: null }

    try {
      await requireAuth(() => upsertFtdRecord(brand, yearMonth, patch))
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }

    const changes: string[] = []
    if ('reg' in patch && patch.reg !== undefined && patch.reg !== before.reg) {
      changes.push(`REG ${before.reg} → ${patch.reg}`)
    }
    if ('ftd' in patch && patch.ftd !== undefined && patch.ftd !== before.ftd) {
      changes.push(`FTD ${before.ftd} → ${patch.ftd}`)
    }
    if ('conversionPct' in patch && patch.conversionPct !== before.conversionPct) {
      changes.push(`Conversion ${before.conversionPct ?? '—'}% → ${patch.conversionPct ?? '—'}%`)
    }
    if (changes.length > 0) {
      void logActivity('edit', 'ftds', `Edited ${brand} — ${formatMonthLabel(yearMonth)}: ${changes.join(', ')}`)
    }

    setRecords((prev) => {
      const idx = prev.findIndex((r) => r.brand === brand && r.yearMonth === yearMonth)
      if (idx === -1) {
        return [...prev, {
          brand,
          yearMonth,
          reg:           patch.reg ?? 0,
          ftd:           patch.ftd ?? 0,
          conversionPct: patch.conversionPct ?? null,
        }]
      }
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }, [addToast, requireAuth, records])
```

- [ ] **Step 3: Log FTD totals edits**

Current code (`src/pages/FTDs.tsx:199-213`):

```ts
  const handleEditTotals = useCallback(async (yearMonth: string, conversionPct: number | null) => {
    try {
      await requireAuth(() => upsertFtdTotals(yearMonth, conversionPct))
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
    setTotals((prev) => {
      const idx = prev.findIndex((t) => t.yearMonth === yearMonth)
      if (idx === -1) return [...prev, { yearMonth, conversionPct }]
      const next = [...prev]
      next[idx] = { ...next[idx], conversionPct }
      return next
    })
  }, [addToast, requireAuth])
```

Replace with:

```ts
  const handleEditTotals = useCallback(async (yearMonth: string, conversionPct: number | null) => {
    const before = totals.find((t) => t.yearMonth === yearMonth)?.conversionPct ?? null

    try {
      await requireAuth(() => upsertFtdTotals(yearMonth, conversionPct))
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }

    if (before !== conversionPct) {
      void logActivity('edit', 'ftds', `Edited ${formatMonthLabel(yearMonth)} totals conversion: ${before ?? '—'}% → ${conversionPct ?? '—'}%`)
    }

    setTotals((prev) => {
      const idx = prev.findIndex((t) => t.yearMonth === yearMonth)
      if (idx === -1) return [...prev, { yearMonth, conversionPct }]
      const next = [...prev]
      next[idx] = { ...next[idx], conversionPct }
      return next
    })
  }, [addToast, requireAuth, totals])
```

- [ ] **Step 4: Log brand stags edits**

Current code (`src/pages/FTDs.tsx:215-229`):

```ts
  const handleEditStags = useCallback(async (brand: string, stagsValue: string) => {
    try {
      await requireAuth(() => upsertBrandStags(brand, stagsValue))
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }
    setStags((prev) => {
      const idx = prev.findIndex((s) => s.brand === brand)
      if (idx === -1) return [...prev, { brand, stags: stagsValue }]
      const next = [...prev]
      next[idx] = { ...next[idx], stags: stagsValue }
      return next
    })
  }, [addToast, requireAuth])
```

Replace with:

```ts
  const handleEditStags = useCallback(async (brand: string, stagsValue: string) => {
    const before = stags.find((s) => s.brand === brand)?.stags ?? ''

    try {
      await requireAuth(() => upsertBrandStags(brand, stagsValue))
    } catch (err) {
      addToast(`Save failed: ${formatError(err)}`, 'error')
      return
    }

    if (before !== stagsValue) {
      void logActivity('edit', 'ftds', `Edited ${brand} stags: '${before}' → '${stagsValue}'`)
    }

    setStags((prev) => {
      const idx = prev.findIndex((s) => s.brand === brand)
      if (idx === -1) return [...prev, { brand, stags: stagsValue }]
      const next = [...prev]
      next[idx] = { ...next[idx], stags: stagsValue }
      return next
    })
  }, [addToast, requireAuth, stags])
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Manual verification via the dev server + Supabase Table Editor**

Run `npm run dev`, sign in as an approved user, go to `/ftds`, and check the Supabase Dashboard → Table Editor → `activity_log` after each action:

- Use "+ Add / Edit Month" to set REG and FTD together for one brand/month → one row, `section=ftds`, summary listing both `REG x → y` and `FTD x → y`.
- Edit just the conversion % inline on the matrix → row showing the totals-conversion change if it was a totals cell, or the record's own conversion change if it was a per-brand cell.
- Edit a brand's stags value → row with the old/new stags text.
- Re-save a field with the same value → confirm **no new row** is created.

- [ ] **Step 7: Commit**

```bash
git add src/pages/FTDs.tsx
git commit -m "feat: log FTD record, totals, and stags edits to activity_log"
```

---

### Task 5: `/log` page, route, and sidebar navigation

**Files:**
- Create: `src/pages/Log.tsx`
- Modify: `src/App.tsx` (import + route)
- Modify: `src/components/Sidebar.tsx` (import + nav entry)

**Interfaces:**
- Consumes: `loadActivityLog`, `ActivityLogEntry`, `LogAction`, `LogSection` from `../lib/activityLog` (Task 2); `RROutletContext` from `../types` (existing, for `addToast`).
- Produces: the `/log` route, rendered in `App.tsx`'s route table; a sidebar nav entry visible to all users.

- [ ] **Step 1: Write `src/pages/Log.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { loadActivityLog } from '../lib/activityLog'
import type { ActivityLogEntry, LogAction, LogSection } from '../lib/activityLog'
import type { RROutletContext } from '../types'

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const datePart = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${datePart}, ${timePart}`
}

const ACTION_STYLES: Record<LogAction, { label: string; bg: string; fg: string }> = {
  upload: { label: 'Upload', bg: '#DCFCE7', fg: '#15803D' },
  edit:   { label: 'Edit',   bg: '#DBEAFE', fg: '#1D4ED8' },
  delete: { label: 'Delete', bg: '#FEE2E2', fg: '#B91C1C' },
}

const SECTION_LABELS: Record<LogSection, string> = {
  'bp-sites': 'BP Sites',
  'lp-sites': 'LP Sites',
  ftds:       'FTDs',
}

export function Log() {
  const { addToast } = useOutletContext<RROutletContext>()
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadActivityLog()
      .then((data) => {
        if (cancelled) return
        setEntries(data)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        addToast(`Failed to load activity log: ${formatError(err)}`, 'error')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [addToast])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-[#94A3B8] font-mono text-[12px] tracking-wider">
        Loading activity log…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto px-3 sm:px-7 pb-7 pt-5">
      <h2 className="font-display text-[16px] tracking-wider text-[#0F172A] mb-4">
        Activity Log ({entries.length})
      </h2>
      <div className="border border-[#E2E8F0] rounded-md overflow-hidden">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-[#94A3B8] text-[12px]">No activity yet.</p>
        ) : (
          <div className="divide-y divide-[#F1F5F9]">
            {entries.map((e) => {
              const actionStyle = ACTION_STYLES[e.action]
              return (
                <div key={e.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[9px] uppercase tracking-wide font-bold rounded px-1.5 py-0.5"
                        style={{ background: actionStyle.bg, color: actionStyle.fg }}
                      >
                        {actionStyle.label}
                      </span>
                      <span className="text-[9px] uppercase tracking-wide font-bold text-[#64748B] bg-[#F1F5F9] rounded px-1.5 py-0.5">
                        {SECTION_LABELS[e.section]}
                      </span>
                      <span className="text-[13px] font-semibold text-[#0F172A]">{e.email}</span>
                    </div>
                    <div className="text-[12px] text-[#334155] break-words">{e.summary}</div>
                  </div>
                  <div className="text-[11px] font-mono text-[#94A3B8] whitespace-nowrap shrink-0">
                    {formatDateTime(e.createdAt)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the `/log` route in `App.tsx`**

Current imports (`src/App.tsx:26-32`):

```ts
import { Home }         from './pages/Home'
import { BPSites }      from './pages/BPSites'
import { LPSites }      from './pages/LPSites'
import { FTDs }         from './pages/FTDs'
import { AskAI }        from './pages/AskAI'
import { HowItWorks }   from './pages/HowItWorks'
import { AdminUsers }   from './pages/AdminUsers'
```

Replace with:

```ts
import { Home }         from './pages/Home'
import { BPSites }      from './pages/BPSites'
import { LPSites }      from './pages/LPSites'
import { FTDs }         from './pages/FTDs'
import { AskAI }        from './pages/AskAI'
import { HowItWorks }   from './pages/HowItWorks'
import { AdminUsers }   from './pages/AdminUsers'
import { Log }          from './pages/Log'
```

Current route table (`src/App.tsx:461-464`):

```tsx
        <Route path="/ftds"             element={<FTDs />} />
        <Route path="/ask-ai"           element={<AskAI />} />
        <Route path="/how-it-works"     element={<HowItWorks />} />
        <Route path="/admin/users"      element={<AdminUsers />} />
```

Replace with:

```tsx
        <Route path="/ftds"             element={<FTDs />} />
        <Route path="/ask-ai"           element={<AskAI />} />
        <Route path="/how-it-works"     element={<HowItWorks />} />
        <Route path="/log"              element={<Log />} />
        <Route path="/admin/users"      element={<AdminUsers />} />
```

- [ ] **Step 3: Add the Topbar title for `/log`**

Current code (`src/App.tsx:319-324`):

```ts
  const SECTION_TITLES: Record<string, [string, string]> = {
    '/bp-sites':      ['BP Sites', 'Brand website ranking report'],
    '/lp-sites':      ['LP Sites', 'Landing page ranking report'],
    '/ftds':          ['Reg & FTD Metrics', 'First-time depositors'],
    '/how-it-works':  ['How It Works', 'A quick guide to using the dashboard'],
  }
```

Replace with:

```ts
  const SECTION_TITLES: Record<string, [string, string]> = {
    '/bp-sites':      ['BP Sites', 'Brand website ranking report'],
    '/lp-sites':      ['LP Sites', 'Landing page ranking report'],
    '/ftds':          ['Reg & FTD Metrics', 'First-time depositors'],
    '/how-it-works':  ['How It Works', 'A quick guide to using the dashboard'],
    '/log':           ['Activity Log', 'Who changed what, and when'],
  }
```

- [ ] **Step 4: Add the sidebar nav entry**

Current imports (`src/components/Sidebar.tsx:1-7`):

```tsx
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AiIcon } from './Assistant/AiIcon'
import { CircleHelp, DollarSign, Users } from 'lucide-react'
import { BRANDS, brandToSlug } from '../lib/brands'
import type { WriteGate } from '../types'
```

Replace with:

```tsx
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AiIcon } from './Assistant/AiIcon'
import { CircleHelp, DollarSign, History, Users } from 'lucide-react'
import { BRANDS, brandToSlug } from '../lib/brands'
import type { WriteGate } from '../types'
```

Current `PAGES` array (`src/components/Sidebar.tsx:9-37`) ends with:

```tsx
  { path: '/how-it-works', label: 'How It Works', icon: (
    <CircleHelp size={18} />
  )},
]
```

Replace with:

```tsx
  { path: '/how-it-works', label: 'How It Works', icon: (
    <CircleHelp size={18} />
  )},
  { path: '/log', label: 'Activity Log', icon: (
    <History size={18} />
  )},
]
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Full end-to-end manual verification in the dev server**

Run `npm run dev`.

- Sign in as a non-admin approved user → the sidebar shows "Activity Log" → click it → `/log` loads and shows the full list of entries created in Tasks 3 and 4 (not just that user's own actions), newest first, each with a correctly colored action badge, section badge, email, summary, and timestamp.
- Perform a fresh upload, a fresh cell edit, and a fresh FTD edit in another tab/window, then reload `/log` → the new entries appear at the top.
- Sign out (or open an incognito window) and load `/log` without signing in → confirm it behaves like the app's other read-open pages under the current auth mode (no crash; either shows data if reads are open to anon, or shows the app's standard sign-in prompt — matches whatever `loadActivityLog`'s RLS rejection produces, consistent with how other pages degrade for a signed-out session).
- In the browser console (signed in), attempt `await supabase.from('activity_log').delete().eq('id', 1)` and `await supabase.from('activity_log').update({ summary: 'tampered' }).eq('id', 1)` (import `supabase` via `const { supabase } = await import('/src/lib/supabase.ts')` first) → both must fail/no-op due to RLS (no update/delete policy exists).

- [ ] **Step 7: Commit**

```bash
git add src/pages/Log.tsx src/App.tsx src/components/Sidebar.tsx
git commit -m "feat: add /log activity log page and sidebar navigation"
```
