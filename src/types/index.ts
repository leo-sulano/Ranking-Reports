import type { CategoryId } from '../lib/categories'

export interface RankingRecord {
  domain: string
  keyword: string
  country: string
  position: string
  previous: string
  change: string
  date: string
  // Optional — captured from the legacy matrix-format upload (per-brand sheets
  // with stacked dates). The flat-format upload leaves them blank.
  searchVolume?: string         // per-(domain, country) search volume
  affiliateUrl?: string         // per-(domain, country) affiliate link
  globalSearchVolume?: string   // per-keyword GSV — same value on every record for the keyword in the snapshot
}

export interface Snapshot {
  id: string
  category: CategoryId
  rawDate: string      // from Last Check column e.g. "5/20/2026"
  displayDate: string  // formatted e.g. "20 May 26"
  records: RankingRecord[]
}

export interface Brand {
  name: string
  abbr: string
  color: string
  mainDomain: string
  domains: string[]
  // Landing-page domains for the same brand. Tracked separately from `domains`
  // (BP / MAIN) so the BP and LP namespaces stay independent during parse + display.
  lpDomains: string[]
}

export type SortDir = 'asc' | 'desc'

export interface AppState {
  snapshots: Snapshot[]
  activeSnapshotId: string | null  // null = most recent
}

// Shape of the React Router outlet context that the Layout supplies to
// every page (Home, BPSites, …). Defined here so pages don't have to
// reach into one another for the type.
export interface EditCellMatcher {
  keyword?: string
  domain?:  string
  country?: string
}

export interface EditCellPatch {
  searchVolume?:       string
  affiliateUrl?:       string
  globalSearchVolume?: string
}

export interface ToastItem {
  id: string
  message: string
  type: 'success' | 'warning' | 'error'
}

// Presentational-only gate for write-triggering buttons and inline edits.
// Does NOT replace requireAuth/RLS as the actual enforcement boundary; see
// getWriteGate() in lib/useAuth.ts for how it's derived.
export interface WriteGate {
  // For entry-point buttons (Import, Add/Edit Month) whose onClick already
  // routes through requireAuth: true ONLY when signed in but still pending,
  // since re-clicking can't fix that. Stays false while signed out so the
  // button remains clickable — clicking is what triggers the sign-in modal.
  disabled: boolean
  // For inline edits (EditableCell) that have no requireAuth step of their
  // own to fall back on: true whenever the user isn't an approved, signed-in
  // user — signed-out OR pending — since there's no "click to sign in"
  // recovery from inside an already-open cell.
  editDisabled: boolean
  title?: string
}

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

// FTD tracking — brand+month shaped, independent of the Snapshot model above.
export interface FtdRecord {
  brand: string
  yearMonth: string       // 'YYYY-MM', e.g. '2023-08'
  reg: number
  ftd: number
  conversionPct: number | null
}

export interface FtdRecordPatch {
  reg?: number
  ftd?: number
  conversionPct?: number | null
}

export interface FtdTotals {
  yearMonth: string
  conversionPct: number | null
}

export interface BrandStags {
  brand: string
  stags: string
}

export type UserAccessStatus = 'pending' | 'approved'

export interface UserAccessRow {
  userId: string
  email: string
  status: UserAccessStatus
  isAdmin: boolean
  createdAt: string
}

export type ParsedPosition = number | 'NR' | null
