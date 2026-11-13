/**
 * Supabase reads and writes for the monthly "other ranking keywords" job
 * (api/cron-discovery.ts). Server-only: it runs on the service-role client from
 * snapshotStore.ts, so nothing in src/ may import this file.
 *
 * Tables: supabase/keyword-discovery.sql.
 */
import { chunk, RECORD_CHUNK, type AdminClient } from './snapshotStore.js'
import { pairKey, type DiscoveryCountry, type DiscoveryRow } from './keywordDiscovery.js'

/** PostgREST returns at most this many rows per request. */
const PAGE = 1000

/** The cycle's already-fetched pairs, as pairKey values. */
export async function loadFetchedPairs(admin: AdminClient, cycle: string): Promise<Set<string>> {
  const { data, error } = await admin.from('keyword_discovery_fetches').select('domain,country').eq('cycle', cycle)
  if (error) throw new Error(`Could not read keyword discovery progress: ${error.message}`)
  return new Set(((data ?? []) as Array<{ domain: string; country: string }>).map((r) => pairKey(r.domain, r.country)))
}

/** Every record of the newest BP Sites snapshot: what the report tracks now. */
export async function loadTrackedRecords(
  admin: AdminClient,
): Promise<Array<{ domain: string; keyword: string; country: string }>> {
  const { data: snapshots, error } = await admin
    .from('snapshots')
    .select('id')
    .eq('category', 'bp-sites')
    .order('raw_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`Could not read the tracked keywords: ${error.message}`)
  const id = (snapshots as Array<{ id: string }> | null)?.[0]?.id
  if (!id) return []

  const records: Array<{ domain: string; keyword: string; country: string }> = []
  for (let from = 0; ; from += PAGE) {
    const { data, error: pageError } = await admin
      .from('ranking_records')
      .select('domain,keyword,country')
      .eq('snapshot_id', id)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (pageError) throw new Error(`Could not read the tracked keywords: ${pageError.message}`)
    const page = (data ?? []) as Array<{ domain: string; keyword: string; country: string }>
    records.push(...page)
    if (page.length < PAGE) return records
  }
}

/**
 * Replace one pair's rows for the cycle, then record the fetch — last, so a
 * pair only counts as fetched once its rows are in. A failure part-way leaves
 * no fetch record, and the next run fetches that pair again.
 */
export async function saveFetch(
  admin: AdminClient,
  input: { cycle: string; domain: string; country: DiscoveryCountry; rows: DiscoveryRow[]; units: number },
): Promise<void> {
  const fail = (message: string) =>
    new Error(`Could not save keyword discovery for ${input.domain} (${input.country}): ${message}`)

  const { error: clearError } = await admin
    .from('keyword_discovery')
    .delete()
    .eq('cycle', input.cycle)
    .eq('domain', input.domain)
    .eq('country', input.country)
  if (clearError) throw fail(clearError.message)

  for (const slice of chunk(input.rows, RECORD_CHUNK)) {
    const { error } = await admin.from('keyword_discovery').insert(
      slice.map((r) => ({
        cycle:          r.cycle,
        brand:          r.brand,
        domain:         r.domain,
        country:        r.country,
        keyword:        r.keyword,
        position:       r.position,
        position_kind:  r.positionKind,
        url:            r.url,
        volume:         r.volume,
        ahrefs_checked: r.ahrefsChecked,
      })),
    )
    if (error) throw fail(error.message)
  }

  const { error: fetchError } = await admin.from('keyword_discovery_fetches').upsert(
    {
      cycle:      input.cycle,
      domain:     input.domain,
      country:    input.country,
      row_count:  input.rows.length,
      units:      input.units,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'cycle,domain,country' },
  )
  if (fetchError) throw fail(fetchError.message)
}

/** How many pairs the cycle holds and what they cost in total. */
export async function cycleTotals(admin: AdminClient, cycle: string): Promise<{ pairs: number; units: number }> {
  const { data, error } = await admin.from('keyword_discovery_fetches').select('units').eq('cycle', cycle)
  if (error) throw new Error(`Could not read keyword discovery progress: ${error.message}`)
  const rows = (data ?? []) as Array<{ units: number }>
  return { pairs: rows.length, units: rows.reduce((sum, r) => sum + (Number(r.units) || 0), 0) }
}
