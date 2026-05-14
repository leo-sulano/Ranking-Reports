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
}

export type SortDir = 'asc' | 'desc'

export interface AppState {
  snapshots: Snapshot[]
  activeSnapshotId: string | null  // null = most recent
}

// Shape of the React Router outlet context that the Layout supplies to
// every page (Home, BPSites, …). Defined here so pages don't have to
// reach into one another for the type.
export interface RROutletContext {
  snapshots: Snapshot[]
  activeSnapshotId: string | null
  bpFilterBrand: string | null
  onSelectSnapshot: (id: string) => void
  onSelectBPBrand: (name: string | null) => void
  onOpenUpload: () => void
  onDeleteSnapshot: (id: string) => void
}

export interface ToastItem {
  id: string
  message: string
  type: 'success' | 'warning' | 'error'
}

export type ParsedPosition = number | 'NR' | null
