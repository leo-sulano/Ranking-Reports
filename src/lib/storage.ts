import type { Snapshot, RankingRecord } from '../types'
import type { CategoryId } from './categories'
import { DEFAULT_CATEGORY } from './categories'
import { formatDisplayDate } from './parser'
import { supabase } from './supabase'

/**
 * Load every snapshot + its records from Supabase, newest first.
 *
 * Two queries (snapshots, then records by snapshot_id IN) rather than a join
 * — keeps the response shape predictable and avoids the PostgREST nested
 * object handling.
 */
export async function loadSnapshots(): Promise<Snapshot[]> {
  // Order by the snapshot's own date (newest first), not insert order — bulk
  // backfills write newest first, so created_at DESC would put oldest on top.
  const { data: snaps, error: e1 } = await supabase
    .from('snapshots')
    .select('id, raw_date, display_date, category')
    .order('raw_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (e1) throw e1
  if (!snaps || snaps.length === 0) return []

  const ids = snaps.map((s) => s.id)

  // Supabase/PostgREST caps a single response at 1000 rows by default. Page
  // through with .range() until a short page comes back.
  const PAGE = 1000
  const allRecords: Array<{
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
  }> = []
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: e2 } = await supabase
      .from('ranking_records')
      .select('snapshot_id, domain, keyword, country, position, previous, change, date, search_volume, affiliate_url, global_search_volume')
      .in('snapshot_id', ids)
      .range(from, from + PAGE - 1)
    if (e2) throw e2
    if (!page || page.length === 0) break
    allRecords.push(...page)
    if (page.length < PAGE) break
  }

  // Group records by snapshot, deduping any rows that share
  // (snapshot_id, domain, keyword, country). Defensive guard for the case
  // where prior uploads left orphans behind because the FK CASCADE wasn't
  // doing its job — without this, stats counters read 2x (or more) what's
  // actually rendered in the matrix.
  const byId = new Map<string, Map<string, RankingRecord>>()
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

  return snaps.map((s) => ({
    id:          s.id,
    category:    (s.category as CategoryId | null) ?? DEFAULT_CATEGORY,
    rawDate:     s.raw_date,
    // Re-format on read so display matches the current formatter even for
    // older rows whose stored display_date used a previous format.
    displayDate: formatDisplayDate(s.raw_date),
    records:     Array.from(byId.get(s.id)?.values() ?? []),
  }))
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
