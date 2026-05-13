import type { Snapshot, RankingRecord } from '../types'

const KEY_SNAPSHOTS = 'rr_snapshots'

// Legacy keys — migrate on first load
const KEY_LEGACY_RECORDS = 'rr_records'
const KEY_LEGACY_DATE    = 'rr_uploadDate'

export function saveSnapshots(snapshots: Snapshot[]): void {
  try {
    localStorage.setItem(KEY_SNAPSHOTS, JSON.stringify(snapshots))
  } catch {
    // quota exceeded — silently ignore
  }
}

export function loadSnapshots(): Snapshot[] {
  try {
    const raw = localStorage.getItem(KEY_SNAPSHOTS)
    if (raw) return JSON.parse(raw) as Snapshot[]

    // Migrate legacy flat-records format
    const legacyRaw  = localStorage.getItem(KEY_LEGACY_RECORDS)
    const legacyDate = localStorage.getItem(KEY_LEGACY_DATE) ?? 'Imported'
    if (legacyRaw) {
      const records = JSON.parse(legacyRaw) as RankingRecord[]
      const snapshot: Snapshot = {
        id:          'migrated-' + Date.now(),
        rawDate:     legacyDate,
        displayDate: legacyDate,
        records,
      }
      saveSnapshots([snapshot])
      return [snapshot]
    }
  } catch {
    // corrupted data — start fresh
  }
  return []
}
