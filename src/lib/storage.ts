import type { Snapshot, SnapshotMeta, RankingRecord } from '../types'
import type { CategoryId } from './categories'
import { DEFAULT_CATEGORY } from './categories'
import { formatDisplayDate } from './parser'
import { supabase } from './supabase'

// Number of most-recent snapshots per category to hydrate (with records) on
// initial load — roughly 2 months at the weekly upload cadence. Older
// snapshots are loaded on demand via loadOlderSnapshots(). Tune here.
export const DEFAULT_RECENT_PER_CATEGORY = 8

type RecordRow = {
  snapshot_id: string
  domain: string
  keyword: string
  country: string
  position: string
  previous: string | null
  change: string | null
  date: string | null
  search_volume: string | null
  affiliate_url: string | null
  global_search_volume: string | null
}

const RECORD_COLS = 'snapshot_id, domain, keyword, country, position, previous, change, date, search_volume, affiliate_url, global_search_volume'
const PAGE = 1000

function toSnapshotMeta(s: { id: string; raw_date: string; display_date: string; category: string | null }): SnapshotMeta {
  return {
    id:          s.id,
    category:    (s.category as CategoryId | null) ?? DEFAULT_CATEGORY,
    rawDate:     s.raw_date,
    // Re-format on read so display matches the current formatter even for
    // older rows whose stored display_date used a previous format.
    displayDate: formatDisplayDate(s.raw_date),
  }
}

/**
 * Every snapshot's identity (id/date/category), newest first — no records.
 * Cheap (dozens to low hundreds of rows) and lets the UI know how much older
 * history exists without downloading it.
 */
export async function loadSnapshotMeta(): Promise<SnapshotMeta[]> {
  // Order by the snapshot's own date (newest first), not insert order — bulk
  // backfills write newest first, so created_at DESC would put oldest on top.
  const { data: snaps, error } = await supabase
    .from('snapshots')
    .select('id, raw_date, display_date, category')
    .order('raw_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (snaps ?? []).map(toSnapshotMeta)
}

/**
 * Fetch + page + dedupe ranking_records for an explicit, caller-bounded list
 * of snapshot ids. Returns a Map keyed by snapshot_id so callers can zip the
 * records back onto whichever SnapshotMeta entries they requested.
 *
 * Paginated in parallel (1 + ceil(N/PAGE) round trips) rather than
 * sequentially — the count query tells us how many pages to fetch, then all
 * pages fire at once.
 */
export async function loadSnapshotRecords(ids: string[]): Promise<Map<string, RankingRecord[]>> {
  const byId = new Map<string, Map<string, RankingRecord>>()
  if (ids.length === 0) return new Map()

  const { count, error: eCnt } = await supabase
    .from('ranking_records')
    .select('*', { count: 'exact', head: true })
    .in('snapshot_id', ids)
  if (eCnt) throw eCnt

  const total = count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE))
  const pagePromises = Array.from({ length: pageCount }, (_, i) =>
    supabase
      .from('ranking_records')
      .select(RECORD_COLS)
      .in('snapshot_id', ids)
      .range(i * PAGE, i * PAGE + PAGE - 1)
  )
  const pages = await Promise.all(pagePromises)
  const allRecords: RecordRow[] = []
  for (const { data, error } of pages) {
    if (error) throw error
    if (data) allRecords.push(...(data as RecordRow[]))
  }

  // Dedupe any rows that share (snapshot_id, domain, keyword, country).
  // Defensive guard for the case where prior uploads left orphans behind
  // because the FK CASCADE wasn't doing its job — without this, stats
  // counters read 2x (or more) what's actually rendered in the matrix.
  for (const r of allRecords) {
    let bucket = byId.get(r.snapshot_id)
    if (!bucket) {
      bucket = new Map()
      byId.set(r.snapshot_id, bucket)
    }
    const key = `${r.domain.toLowerCase()}|${r.keyword.toLowerCase()}|${r.country}`
    bucket.set(key, {
      domain:             r.domain,
      keyword:            r.keyword,
      country:            r.country,
      position:           r.position,
      previous:           r.previous ?? '',
      change:             r.change   ?? '',
      date:               r.date     ?? '',
      searchVolume:       r.search_volume ?? '',
      affiliateUrl:       r.affiliate_url ?? '',
      globalSearchVolume: r.global_search_volume ?? '',
    })
  }

  const result = new Map<string, RankingRecord[]>()
  for (const [snapId, bucket] of byId) result.set(snapId, Array.from(bucket.values()))
  return result
}

/**
 * Initial bounded load: metadata for every snapshot, but records only for the
 * most recent `perCategoryCount` snapshots per category. This is the only
 * query on mount that touches ranking_records — replaces the old
 * download-everything loadSnapshots().
 */
export async function loadRecentSnapshots(
  perCategoryCount: number = DEFAULT_RECENT_PER_CATEGORY,
): Promise<{ meta: SnapshotMeta[]; snapshots: Snapshot[] }> {
  const meta = await loadSnapshotMeta()
  if (meta.length === 0) return { meta, snapshots: [] }

  const byCategory = new Map<string, SnapshotMeta[]>()
  for (const m of meta) {
    const arr = byCategory.get(m.category) ?? []
    arr.push(m)
    byCategory.set(m.category, arr)
  }
  const recent: SnapshotMeta[] = []
  for (const arr of byCategory.values()) recent.push(...arr.slice(0, perCategoryCount))

  const recordsById = await loadSnapshotRecords(recent.map((m) => m.id))
  const snapshots = recent.map((m) => ({ ...m, records: recordsById.get(m.id) ?? [] }))
  return { meta, snapshots }
}

/**
 * On-demand hydration of an explicit set of older snapshots (metadata already
 * known from loadSnapshotMeta/loadRecentSnapshots). Caller merges the result
 * into whatever snapshots are already loaded.
 */
export async function loadOlderSnapshots(metaEntries: SnapshotMeta[]): Promise<Snapshot[]> {
  if (metaEntries.length === 0) return []
  const recordsById = await loadSnapshotRecords(metaEntries.map((m) => m.id))
  return metaEntries.map((m) => ({ ...m, records: recordsById.get(m.id) ?? [] }))
}

/**
 * Wipe-and-replace upsert for a single snapshot. Explicitly clears the child
 * ranking_records rows first instead of relying on FK ON DELETE CASCADE — if
 * the cascade isn't actually configured on the table, deleting just the
 * snapshot leaves orphan rows behind and the next insert silently doubles
 * the data on every re-upload. Doing it explicitly is idempotent and safe
 * regardless of how the FK is set up.
 *
 * Records are batched in 500-row chunks to stay well under PostgREST limits.
 */
export async function upsertSnapshot(snapshot: Snapshot): Promise<void> {
  const { error: eDelRecs } = await supabase
    .from('ranking_records')
    .delete()
    .eq('snapshot_id', snapshot.id)
  if (eDelRecs) throw eDelRecs

  const { error: eDel } = await supabase.from('snapshots').delete().eq('id', snapshot.id)
  if (eDel) throw eDel

  const { error: eIns } = await supabase.from('snapshots').insert({
    id:           snapshot.id,
    raw_date:     snapshot.rawDate,
    display_date: snapshot.displayDate,
    category:     snapshot.category,
  })
  if (eIns) throw eIns

  if (snapshot.records.length === 0) return

  const rows = snapshot.records.map((r) => ({
    snapshot_id:          snapshot.id,
    domain:               r.domain,
    keyword:              r.keyword,
    country:              r.country,
    position:             r.position,
    previous:             r.previous,
    change:               r.change,
    date:                 r.date,
    search_volume:        r.searchVolume ?? '',
    affiliate_url:        r.affiliateUrl ?? '',
    global_search_volume: r.globalSearchVolume ?? '',
  }))

  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('ranking_records').insert(slice)
    if (error) throw error
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  const { error } = await supabase.from('snapshots').delete().eq('id', id)
  if (error) throw error
}

/**
 * Patch GSV / SV / AFF on the ranking_records rows matched by
 * (snapshot_id, ...matcher). When the matcher omits a field, the patch
 * applies to every row that matches the rest — used for GSV which is
 * per-keyword (matcher = { keyword }) vs SV/AFF which are
 * per-(domain, keyword, country).
 */
export async function updateRecordFields(
  snapshotId: string,
  matcher: { keyword?: string; domain?: string; country?: string },
  patch:   { searchVolume?: string; affiliateUrl?: string; globalSearchVolume?: string },
): Promise<void> {
  const dbPatch: Record<string, string> = {}
  if ('searchVolume'       in patch) dbPatch.search_volume        = patch.searchVolume       ?? ''
  if ('affiliateUrl'       in patch) dbPatch.affiliate_url        = patch.affiliateUrl       ?? ''
  if ('globalSearchVolume' in patch) dbPatch.global_search_volume = patch.globalSearchVolume ?? ''
  if (Object.keys(dbPatch).length === 0) return

  let q = supabase.from('ranking_records').update(dbPatch).eq('snapshot_id', snapshotId)
  if (matcher.keyword) q = q.eq('keyword', matcher.keyword)
  if (matcher.domain)  q = q.eq('domain',  matcher.domain)
  if (matcher.country) q = q.eq('country', matcher.country)
  const { error } = await q
  if (error) throw error
}
