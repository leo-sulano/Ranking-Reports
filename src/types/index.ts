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
  activeBrand: string | null        // null = overview
  activeCountries: string[]
  activeDomains: string[]
  kwFilter: string
}

export interface ToastItem {
  id: string
  message: string
  type: 'success' | 'error'
}

export type ParsedPosition = number | 'NR' | null
