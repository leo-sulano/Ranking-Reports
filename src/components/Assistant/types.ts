import type { CategoryId } from '../../lib/categories'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CountryStat {
  country: string
  rankingKeywords: number
  avgPosition: number
  top3: number
  top10: number
}

export interface TopKeyword {
  keyword: string
  country: string
  position: number
}

// Per-brand aggregate for one snapshot date.
export interface BrandSnapshotStat {
  brand: string
  rankingKeywords: number
  avgPosition: number
  top3: number
  top10: number
  byCountry: CountryStat[]    // top 8 countries by rankingKeywords
  topKeywords: TopKeyword[]   // 5 best numeric positions
}

// A single keyword's position change between two snapshots.
export interface Mover {
  brand: string
  keyword: string
  country: string
  from: string
  to: string
  delta: number
}

// NR transition entry. `to` present on gained; `from` present on lost.
export interface Transition {
  brand: string
  keyword: string
  country: string
  to?: string
  from?: string
}

// Movement across the full retained snapshot window.
export interface RangeMovers {
  fromDate: string
  toDate: string
  movers: Mover[]
}

export interface HistoryDigest {
  category: CategoryId
  generatedFor: string
  brands: string[]
  timeline: {
    date: string
    rawDate: string
    perBrand: BrandSnapshotStat[]
  }[]
  movers: Mover[]
  gained: Transition[]
  lost: Transition[]
  rangeMovers: RangeMovers
}
