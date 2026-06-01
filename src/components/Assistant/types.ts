import type { CategoryId } from '../../lib/categories'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Per-brand aggregate for one snapshot date.
export interface BrandSnapshotStat {
  brand: string
  rankingKeywords: number  // records with a numeric position
  avgPosition: number      // mean of numeric positions, 1 decimal
  top3: number
  top10: number
}

// A single keyword's position change between the latest two snapshots.
export interface Mover {
  brand: string
  keyword: string
  country: string
  from: string    // previous position or 'NR'
  to: string      // current position or 'NR'
  delta: number   // negative = improved (moved toward #1)
}

export interface HistoryDigest {
  category: CategoryId
  generatedFor: string          // active snapshot displayDate (newest)
  brands: string[]
  timeline: {
    date: string                // displayDate
    rawDate: string
    perBrand: BrandSnapshotStat[]
  }[]                           // newest-first, capped at 12
  movers: Mover[]              // top 20 by absolute delta
}
