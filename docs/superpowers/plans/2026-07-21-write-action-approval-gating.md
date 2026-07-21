# Proactive Approval Gating on Write Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable every edit/add/upload button with an explanatory tooltip when the signed-in user is awaiting admin approval, instead of letting them click through to a reactive error toast.

**Architecture:** A new pure helper, `getWriteGate(session, isApproved, accessLoading)` in `src/lib/useAuth.ts`, derives a single `{ disabled, title }` pair (`WriteGate`, defined in `src/types/index.ts`) from `useAuth()`'s existing session/approval state plus a new `accessLoading` flag. `App.tsx` computes it once and threads it through `RROutletContext` and direct props to every write-triggering button.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind v4. No test suite configured — verification is `npm run build` (type-check) after every task, plus a final manual pass in the dev server.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-write-action-approval-gating-design.md`
- The actual security enforcement stays exactly as-is (Postgres RLS + `requireAuth`'s reactive throw) — this feature is presentational only.
- Signed-out users must NOT be blocked by this change: their buttons stay enabled (existing `requireAuth` → login-modal → resume-on-sign-in flow is unaffected). Only "signed in but pending" disables a button.
- No flash of "disabled" for approved users on page load — buttons must render as enabled while `accessLoading` is `true`.
- Type name: `WriteGate` (in `src/types/index.ts`). Helper name: `getWriteGate` (in `src/lib/useAuth.ts`). Prop name on every gated button-owning component: `writeGate`. `EditableCell`'s new props: `disabled` / `disabledTitle`.
- Verification command after each task: `npm run build` (runs `tsc -b && vite build`) — must exit 0 with no type errors.

---

### Task 1: `WriteGate` type + `useAuth` support + `App.tsx` wiring

**Files:**
- Modify: `src/types/index.ts:63-81`
- Modify: `src/lib/useAuth.ts` (imports, state, `refreshAccess`, return statement, new export)
- Modify: `src/App.tsx:4, 53, 323-333`
- Test: manual — `npm run build`

**Interfaces:**
- Produces: `WriteGate { disabled: boolean; title?: string }` (exported from `src/types/index.ts`), `RROutletContext.writeGate: WriteGate`, `useAuth()`'s returned object gains `accessLoading: boolean`, and a new export `getWriteGate(session: Session | null, isApproved: boolean, accessLoading: boolean): WriteGate` from `src/lib/useAuth.ts`.
- Consumes: nothing new — this task only touches existing `useAuth`/`App.tsx` state.

- [ ] **Step 1: Add the `WriteGate` type and add it to `RROutletContext`**

In `src/types/index.ts`, insert this new interface right after the `ToastItem` interface (after line 63, before `export interface RROutletContext {`):

```ts
// Presentational-only gate for write-triggering buttons (Import, Save,
// Add, inline edits, Delete) — disables the button with an explanatory
// tooltip when a signed-in user is awaiting admin approval. Does NOT
// replace requireAuth/RLS as the actual enforcement boundary; see
// getWriteGate() in lib/useAuth.ts for how it's derived.
export interface WriteGate {
  disabled: boolean
  title?: string
}
```

Then add a field to `RROutletContext` (currently ending at line 81), right after `currentUserId: string | null`:

```ts
export interface RROutletContext {
  snapshots: Snapshot[]
  activeSnapshotId: string | null
  onSelectSnapshot: (id: string) => void
  onOpenUpload: () => void
  onDeleteSnapshot: (id: string) => void
  onEditCell: (snapshotId: string, matcher: EditCellMatcher, patch: EditCellPatch) => Promise<void>
  addToast: (message: string, type?: ToastItem['type']) => void
  requireAuth: <T>(fn: () => T | Promise<T>) => Promise<T>
  currentUserId: string | null
  writeGate: WriteGate
}
```

- [ ] **Step 2: Add `accessLoading` state and export `getWriteGate` in `useAuth.ts`**

In `src/lib/useAuth.ts`, add an import at the top (after the existing `import { getUserAccess } from './userAccess'` line):

```ts
import type { WriteGate } from '../types'
```

Add a new state variable right after `const [isAdmin, setIsAdmin] = useState(false)`:

```ts
  const [accessLoading, setAccessLoading] = useState(true)
```

Replace the `refreshAccess` callback body so it sets `accessLoading` appropriately (signed-out resolves immediately; signed-in starts `true` and flips to `false` once the check settles, guarded by the existing staleness check):

```ts
  const refreshAccess = useCallback((userId: string | undefined) => {
    const gen = ++accessGen.current
    if (!userId) {
      approvedRef.current = false
      setIsApproved(false)
      setIsAdmin(false)
      setAccessLoading(false)
      accessCheck.current = Promise.resolve()
      return
    }
    setAccessLoading(true)
    accessCheck.current = getUserAccess(userId)
      .then((access) => {
        if (gen !== accessGen.current) return
        approvedRef.current = access?.status === 'approved'
        setIsApproved(approvedRef.current)
        setIsAdmin(access?.isAdmin ?? false)
        setAccessLoading(false)
      })
      .catch(() => {
        if (gen !== accessGen.current) return
        approvedRef.current = false
        setIsApproved(false)
        setIsAdmin(false)
        setAccessLoading(false)
      })
  }, [])
```

Update the hook's return statement (`return { session, modalOpen, requireAuth, openLogin, cancelAuth, isApproved, isAdmin }`) to also return `accessLoading`:

```ts
  return { session, modalOpen, requireAuth, openLogin, cancelAuth, isApproved, isAdmin, accessLoading }
```

Finally, add this new exported function at the end of the file (after the `useAuth` function's closing brace):

```ts
export function getWriteGate(session: Session | null, isApproved: boolean, accessLoading: boolean): WriteGate {
  if (!session) return { disabled: false, title: 'Sign in to make changes' }
  if (accessLoading) return { disabled: false }
  if (!isApproved) return { disabled: true, title: 'Awaiting admin approval' }
  return { disabled: false }
}
```

- [ ] **Step 3: Compute `writeGate` in `App.tsx` and add it to `rrContext`**

In `src/App.tsx`, change the import on line 4:

```ts
import { useAuth, getWriteGate } from './lib/useAuth'
```

Change line 53 to also destructure `isApproved` and `accessLoading`:

```ts
  const { session, modalOpen, requireAuth, openLogin, cancelAuth, isAdmin, isApproved, accessLoading } = useAuth()
```

Immediately after that line, add:

```ts
  const writeGate = getWriteGate(session, isApproved, accessLoading)
```

In the `rrContext` object (lines 323-333), add `writeGate` as the last field:

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
    currentUserId:     session?.user.id ?? null,
    writeGate,
  }
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors. (Home.tsx, FTDs.tsx etc. don't reference `.writeGate` yet — that's fine, nothing requires them to consume every context field.)

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/useAuth.ts src/App.tsx
git commit -m "feat: compute a presentational write-gate from approval status"
```

---

### Task 2: Gate the Sidebar "Import Data" button

**Files:**
- Modify: `src/components/Sidebar.tsx:1-6, 41-59, 183-194`
- Modify: `src/App.tsx:355-363`
- Test: manual — `npm run build` + dev server check

**Interfaces:**
- Consumes: `WriteGate` (from Task 1, `src/types/index.ts`), `writeGate` computed in `App.tsx` (Task 1).
- Produces: `Sidebar`'s `Props` gains `writeGate: WriteGate`.

- [ ] **Step 1: Accept and apply `writeGate` in `Sidebar.tsx`**

Add an import for the type (after the existing `import { BRANDS, brandToSlug } from '../lib/brands'` line):

```ts
import type { WriteGate } from '../types'
```

Add `writeGate: WriteGate` to the `Props` interface (after `isAdmin: boolean`):

```ts
interface Props {
  uploadDate: string | null
  onOpenUpload: () => void
  activeBPBrand: string | null
  onSelectBPBrand: (name: string | null) => void
  mobileOpen?: boolean
  onMobileClose?: () => void
  isAdmin: boolean
  writeGate: WriteGate
}
```

Add `writeGate` to the destructured props (after `isAdmin,`):

```ts
export function Sidebar({
  uploadDate,
  onOpenUpload,
  activeBPBrand,
  onSelectBPBrand,
  mobileOpen = false,
  onMobileClose,
  isAdmin,
  writeGate,
}: Props) {
```

Replace the footer "Import Data" button:

```tsx
          <button
            onClick={onOpenUpload}
            title={writeGate.disabled ? writeGate.title : 'Import Data'}
            disabled={writeGate.disabled}
            className="w-full flex items-center gap-3 px-3 py-2 bg-[#CC0000] text-white rounded-lg text-[12px] font-bold transition-all hover:bg-[#AA0000] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
```

(The rest of that button — the SVG icon and `<span className={labelCls}>Import Data</span>` — is unchanged.)

- [ ] **Step 2: Pass `writeGate` from `App.tsx`**

In `src/App.tsx`, add `writeGate={writeGate}` to the `<Sidebar>` element (after `isAdmin={isAdmin}`):

```tsx
      <Sidebar
        uploadDate={activeSnapshot?.displayDate ?? null}
        onOpenUpload={() => setShowUpload(true)}
        activeBPBrand={bpFilterBrand}
        onSelectBPBrand={setBPFilterBrand}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        isAdmin={isAdmin}
        writeGate={writeGate}
      />
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Manual check**

Run: `npm run dev`, open the app. With no test account changes yet, you're signed out — confirm the Import Data button is still enabled and hovering shows "Sign in to make changes".

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat: gate Sidebar's Import Data button on approval status"
```

---

### Task 3: Add `disabled`/`disabledTitle` support to `EditableCell`

**Files:**
- Modify: `src/components/EditableCell.tsx`
- Test: manual — `npm run build`

**Interfaces:**
- Produces: `EditableCell` gains two new optional props, `disabled?: boolean` (default `false`) and `disabledTitle?: string` (default `'Awaiting admin approval'`). When `disabled`, the resting-state button is a native disabled `<button>` (click is a no-op) and shows `disabledTitle` instead of `title`.

- [ ] **Step 1: Add the new props**

Replace the function signature:

```tsx
export function EditableCell({
  value,
  onSave,
  renderDisplay,
  placeholder = '–',
  className   = '',
  inputClassName = '',
  title       = 'Click to edit',
  disabled    = false,
  disabledTitle = 'Awaiting admin approval',
}: {
  value: string
  onSave: (next: string) => Promise<void> | void
  renderDisplay?: (value: string) => ReactNode
  placeholder?: string
  className?: string
  inputClassName?: string
  title?: string
  disabled?: boolean
  disabledTitle?: string
}) {
```

- [ ] **Step 2: Apply `disabled`/`disabledTitle` to the resting-state button**

Replace the final `return` block (the non-editing button):

```tsx
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={disabled ? disabledTitle : title}
      disabled={disabled}
      className={`w-full text-center rounded-[2px] transition-colors cursor-text hover:bg-[rgba(15,23,42,0.06)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent ${className}`}
    >
      {value
        ? (renderDisplay ? renderDisplay(value) : value)
        : <span className="opacity-30">{placeholder}</span>}
    </button>
  )
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exits 0. No existing callers pass `disabled`, so they're unaffected (defaults to `false`, identical behavior to before).

- [ ] **Step 4: Commit**

```bash
git add src/components/EditableCell.tsx
git commit -m "feat: add disabled/disabledTitle support to EditableCell"
```

---

### Task 4: Gate Home.tsx's two "Import Data" triggers

**Files:**
- Modify: `src/pages/Home.tsx:202-207, 379, 502-521`
- Test: manual — `npm run build` + dev server check

**Interfaces:**
- Consumes: `ctx.writeGate` (from `RROutletContext`, Task 1).
- Produces: `NavCard`'s props gain `disabled?: boolean` and `title?: string`.

- [ ] **Step 1: Gate the empty-state "Import data" button**

Replace (lines 202-207):

```tsx
          <button
            onClick={ctx.onOpenUpload}
            disabled={ctx.writeGate.disabled}
            title={ctx.writeGate.disabled ? ctx.writeGate.title : undefined}
            className="px-5 py-1.5 bg-[#CC0000] text-white text-[13px] font-semibold rounded-xl hover:bg-[#AA0000] transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import data
          </button>
```

- [ ] **Step 2: Extend `NavCard` with `disabled`/`title` props**

Replace the `NavCard` function (lines 502-521):

```tsx
function NavCard({
  label, hint, onClick, highlight, bgColor, borderColor, disabled = false, title,
}: { label: string; hint: string; onClick: () => void; highlight?: boolean; bgColor?: string; borderColor?: string; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="group text-left p-4 rounded-xl border transition-all duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.07)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:translate-y-0"
      style={{
        background:  bgColor ?? (highlight ? '#FFFDE6' : '#FAFAF7'),
        borderColor: borderColor ?? (highlight ? '#FFCC00' : '#E5E4DF'),
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-[#0A0A0A] leading-tight">{label}</span>
        <span className="text-[#ABABAA] text-[13px] transition-all duration-150 group-hover:translate-x-0.5 opacity-0 group-hover:opacity-100 shrink-0">→</span>
      </div>
      <div className="text-[11px] text-[#ABABAA] mt-1.5">{hint}</div>
    </button>
  )
}
```

- [ ] **Step 3: Pass `disabled`/`title` to the "Import Data" `NavCard`**

Replace the `NavCard` usage on line 379:

```tsx
            <NavCard
              label="Import Data"
              hint="Upload an XLSX snapshot"
              onClick={ctx.onOpenUpload}
              bgColor="#FFF0F0"
              borderColor="#CC0000"
              disabled={ctx.writeGate.disabled}
              title={ctx.writeGate.disabled ? ctx.writeGate.title : undefined}
            />
```

(The `BP Sites` and `LP Sites` `NavCard`s on the surrounding lines are untouched — `disabled`/`title` default to `false`/`undefined` for them.)

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 5: Manual check**

In the dev server, confirm both Home page "Import Data" entry points (empty-state view and the Navigate section card) still work normally while signed out.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "feat: gate Home page's Import Data triggers on approval status"
```

---

### Task 5: Gate DuplicateWarning's "Delete & replace"

**Files:**
- Modify: `src/components/DuplicateWarning.tsx`
- Modify: `src/App.tsx:385-391`
- Test: manual — `npm run build`

**Interfaces:**
- Consumes: `WriteGate` (Task 1), `writeGate` computed in `App.tsx` (Task 1).
- Produces: `DuplicateWarning`'s `Props` gains `writeGate: WriteGate`.

- [ ] **Step 1: Accept and apply `writeGate` in `DuplicateWarning.tsx`**

Replace the top of the file through the function signature:

```tsx
import type { Snapshot, WriteGate } from '../types'

export interface DuplicateWarningData {
  existing: Snapshot
}

interface Props {
  data: DuplicateWarningData
  onClose: () => void
  onDelete: () => void
  writeGate: WriteGate
}

export function DuplicateWarning({ data, onClose, onDelete, writeGate }: Props) {
```

Replace the "Delete & replace" button:

```tsx
          <button
            onClick={onDelete}
            disabled={writeGate.disabled}
            title={writeGate.disabled ? writeGate.title : undefined}
            className="px-4 py-1.5 bg-[#F43F5E] text-white rounded-md text-[12px] font-bold hover:bg-[#E11D48] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete &amp; replace
          </button>
```

- [ ] **Step 2: Pass `writeGate` from `App.tsx`**

Replace the `DuplicateWarning` render block:

```tsx
      {duplicateWarning && (
        <DuplicateWarning
          data={{ existing: duplicateWarning.existing }}
          onClose={() => setDuplicateWarning(null)}
          onDelete={handleReplaceDuplicate}
          writeGate={writeGate}
        />
      )}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/DuplicateWarning.tsx src/App.tsx
git commit -m "feat: gate DuplicateWarning's Delete & replace on approval status"
```

---

### Task 6: Gate FTD add/edit/save actions

**Files:**
- Modify: `src/pages/FTDs.tsx:62, 313-318, 322-336, 339-346`
- Modify: `src/components/FtdMatrixTable.tsx:1-5, 80-90, 249-254, 396-417`
- Modify: `src/components/FtdEntryForm.tsx:1-5, 36-44, 179-185`
- Test: manual — `npm run build` + dev server check

**Interfaces:**
- Consumes: `WriteGate` (Task 1), `writeGate` from `RROutletContext` (Task 1), `EditableCell`'s `disabled`/`disabledTitle` props (Task 3).
- Produces: `FtdMatrixTable`'s and `FtdEntryForm`'s `Props` both gain `writeGate: WriteGate`.

- [ ] **Step 1: Read `writeGate` from context and gate the "+ Add/Edit Month" button in `FTDs.tsx`**

Change line 62:

```ts
  const { addToast, requireAuth, writeGate } = useOutletContext<RROutletContext>()
```

Replace the "+ Add/Edit Month" button (lines 313-318):

```tsx
        <button
          onClick={() => setShowEntryForm(true)}
          disabled={writeGate.disabled}
          title={writeGate.disabled ? writeGate.title : undefined}
          className="px-4 py-2 rounded-md text-[12px] font-bold text-white bg-[#0F172A] hover:bg-[#1E293B] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Add / Edit Month
        </button>
```

Pass `writeGate` to `FtdMatrixTable` (in the render block around lines 322-336), adding it as the last prop:

```tsx
        <FtdMatrixTable
          records={filteredRecords}
          totals={filteredTotals}
          stags={stags}
          onEditRecord={handleEditRecord}
          onEditStags={handleEditStags}
          visibleMetric={activeMetric}
          summaryLabel={
            periodFilter === 'all'
              ? 'TOTAL'
              : periodFilter.length === 4
                ? `${periodFilter} TOTAL`
                : `${formatMonthLabel(periodFilter)} TOTAL`
          }
          writeGate={writeGate}
        />
```

Pass `writeGate` to `FtdEntryForm` (lines 339-346):

```tsx
      {showEntryForm && (
        <FtdEntryForm
          records={records}
          totals={totals}
          onEditRecord={handleEditRecord}
          onEditTotals={handleEditTotals}
          onClose={() => setShowEntryForm(false)}
          writeGate={writeGate}
        />
      )}
```

- [ ] **Step 2: Accept `writeGate` in `FtdMatrixTable.tsx` and gate its three `EditableCell`s**

Change the type import (line 5):

```ts
import type { FtdRecord, FtdRecordPatch, FtdTotals, BrandStags, WriteGate } from '../types'
```

Add `writeGate: WriteGate` to `Props` (currently lines 80-88):

```ts
interface Props {
  records: FtdRecord[]
  totals:  FtdTotals[]
  stags:   BrandStags[]
  onEditRecord: (brand: string, yearMonth: string, patch: FtdRecordPatch) => Promise<void>
  onEditStags:  (brand: string, stags: string) => Promise<void>
  summaryLabel?: string
  visibleMetric?: FtdMetric | null
  writeGate: WriteGate
}
```

Add `writeGate` to the destructured function params (line 90):

```ts
export function FtdMatrixTable({ records, totals, stags, onEditRecord, onEditStags, summaryLabel = 'TOTAL', visibleMetric = null, writeGate }: Props) {
```

Update the Stags `EditableCell` (lines 249-254) to add the two new props:

```tsx
                <EditableCell
                  value={stagsMap.get(b.name) ?? ''}
                  onSave={(next) => onEditStags(b.name, next)}
                  placeholder="—"
                  title={`Edit ${b.name} Stags`}
                  disabled={writeGate.disabled}
                  disabledTitle={writeGate.title}
                />
```

Update the REG `EditableCell` (lines 396-404):

```tsx
                              <EditableCell
                                value={rec?.reg != null ? String(rec.reg) : ''}
                                onSave={(next) => {
                                  const reg = parseIntSafe(next)
                                  return onEditRecord(b.name, ym, { reg, conversionPct: ratioPct(reg, rec?.ftd ?? 0) })
                                }}
                                placeholder="—"
                                title={`Edit ${b.name} REG`}
                                disabled={writeGate.disabled}
                                disabledTitle={writeGate.title}
                              />
```

Update the FTD `EditableCell` (lines 409-417):

```tsx
                              <EditableCell
                                value={rec?.ftd != null ? String(rec.ftd) : ''}
                                onSave={(next) => {
                                  const ftd = parseIntSafe(next)
                                  return onEditRecord(b.name, ym, { ftd, conversionPct: ratioPct(rec?.reg ?? 0, ftd) })
                                }}
                                placeholder="—"
                                title={`Edit ${b.name} FTD`}
                                disabled={writeGate.disabled}
                                disabledTitle={writeGate.title}
                              />
```

- [ ] **Step 3: Accept `writeGate` in `FtdEntryForm.tsx` and gate "Save Month"**

Change the type import (line 5):

```ts
import type { FtdRecord, FtdRecordPatch, FtdTotals, WriteGate } from '../types'
```

Add `writeGate: WriteGate` to `Props` (currently lines 36-42):

```ts
interface Props {
  records: FtdRecord[]
  totals:  FtdTotals[]
  onEditRecord: (brand: string, yearMonth: string, patch: FtdRecordPatch) => Promise<void>
  onEditTotals: (yearMonth: string, conversionPct: number | null) => Promise<void>
  onClose: () => void
  writeGate: WriteGate
}
```

Add `writeGate` to the destructured function params (line 44):

```ts
export function FtdEntryForm({ records, totals, onEditRecord, onEditTotals, onClose, writeGate }: Props) {
```

Replace the "Save Month" button (lines 179-185):

```tsx
          <button
            onClick={handleSubmit}
            disabled={saving || writeGate.disabled}
            title={writeGate.disabled ? writeGate.title : undefined}
            className="px-4 py-2 rounded-md text-[13px] font-bold text-white bg-[#0F172A] hover:bg-[#1E293B] disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Month'}
          </button>
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Manual check**

In the dev server, open `/ftds`, confirm "+ Add/Edit Month" opens the form and inline Stags/REG/FTD cells are still editable while signed out.

- [ ] **Step 6: Commit**

```bash
git add src/pages/FTDs.tsx src/components/FtdMatrixTable.tsx src/components/FtdEntryForm.tsx
git commit -m "feat: gate FTD add/edit/save actions on approval status"
```

---

### Task 7: Full manual verification pass

**Files:** none (verification only; fix-forward commits only if something's wrong)

- [ ] **Step 1: Set up a pending test account**

In the Supabase dashboard's SQL editor (or table editor), sign up a throwaway test account through the app's `LoginModal` sign-up mode, then confirm its row in `user_access` has `status = 'pending'`.

- [ ] **Step 2: Verify the pending state**

Signed in as the pending test account, confirm every one of these is disabled with the tooltip "Awaiting admin approval" and does NOT open/save anything when clicked:
- Sidebar footer "Import Data"
- Home page empty-state "Import data" button (if no snapshots) and/or the Navigate section's "Import Data" card
- `/ftds` "+ Add/Edit Month" button
- `FtdEntryForm`'s "Save Month" button (open the form first — it should still open, only Save is gated)
- `FtdMatrixTable`'s inline Stags / REG / FTD cells (clicking should not enter edit mode)
- The "Delete & replace" button in `DuplicateWarning` (trigger it by re-uploading a file matching an existing snapshot's date)

- [ ] **Step 3: Verify the signed-out state**

Sign out. Confirm all of the same buttons/cells are enabled (not disabled), each shows the tooltip "Sign in to make changes" on hover, and clicking one that leads to an actual write (e.g. saving an FTD edit) still opens the login modal via the existing `requireAuth` flow, exactly as before this change.

- [ ] **Step 4: Verify the approved state + no reload flash**

In the Supabase dashboard, set the test account's `user_access.status` to `'approved'`. Reload the app while signed in as that account. Confirm: no visible flash of disabled buttons before they settle, and once settled, all of the same buttons/cells are fully enabled with no tooltip, and actually saving works end-to-end (e.g. edit an FTD REG cell and confirm it persists after a reload).

- [ ] **Step 5: Clean up**

Delete the throwaway test account/`user_access` row from Supabase (or leave it as a permanent test fixture, per your preference — no code change either way).
