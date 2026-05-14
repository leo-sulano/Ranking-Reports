import type { Snapshot, RankingRecord } from '../types'
import { supabase } from './supabase'

/**
 * Load every snapshot + its records from Supabase, newest first.
 *
 * Two queries (snapshots, then records by snapshot_id IN) rather than a join
 * — keeps the response shape predictable and avoids the PostgREST nested
 * object handling.
 */
export async function loadSnapshots(): Promise<Snapshot[]> {
  const { data: snaps, error: e1 } = await supabase
    .from('snapshots')
    .select('id, raw_date, display_date')
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
  }> = []
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: e2 } = await supabase
      .from('ranking_records')
      .select('snapshot_id, domain, keyword, country, position, previous, change, date')
      .in('snapshot_id', ids)
      .range(from, from + PAGE - 1)
    if (e2) throw e2
    if (!page || page.length === 0) break
    allRecords.push(...page)
    if (page.length < PAGE) break
  }

  const byId = new Map<string, RankingRecord[]>()
  for (const r of allRecords) {
    let list = byId.get(r.snapshot_id)
    if (!list) {
      list = []
      byId.set(r.snapshot_id, list)
    }
    list.push({
      domain:   r.domain,
      keyword:  r.keyword,
      country:  r.country,
      position: r.position,
      previous: r.previous ?? '',
      change:   r.change   ?? '',
      date:     r.date     ?? '',
    })
  }

  return snaps.map((s) => ({
    id:          s.id,
    rawDate:     s.raw_date,
    displayDate: s.display_date,
    records:     byId.get(s.id) ?? [],
  }))
}

/**
 * Wipe-and-replace upsert for a single snapshot. Cascades delete the prior
 * snapshot's records (via FK ON DELETE CASCADE) before inserting fresh.
 *
 * Records are batched in 500-row chunks to stay well under PostgREST limits.
 */
export async function upsertSnapshot(snapshot: Snapshot): Promise<void> {
  const { error: eDel } = await supabase.from('snapshots').delete().eq('id', snapshot.id)
  if (eDel) throw eDel

  const { error: eIns } = await supabase.from('snapshots').insert({
    id:           snapshot.id,
    raw_date:     snapshot.rawDate,
    display_date: snapshot.displayDate,
  })
  if (eIns) throw eIns

  if (snapshot.records.length === 0) return

  const rows = snapshot.records.map((r) => ({
    snapshot_id: snapshot.id,
    domain:      r.domain,
    keyword:     r.keyword,
    country:     r.country,
    position:    r.position,
    previous:    r.previous,
    change:      r.change,
    date:        r.date,
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
