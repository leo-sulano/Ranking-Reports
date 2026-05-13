export interface RankingRecord {
  domain: string
  keyword: string
  country: string
  position: string
  previous: string
  change: string
  date: string
}

export interface Snapshot {
  id: string
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
  type: 'success' | 'error'
}

export type ParsedPosition = number | 'NR' | null
