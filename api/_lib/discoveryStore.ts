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

const STATE = 'keyword_discovery_state'
/** Longer than a run can last (maxDuration 60 s), so a killed run's lease simply runs out. */
export const LOCK_LEASE_MS = 90_000
const UNLOCKED = '1970-01-01T00:00:00.000Z'

/**
 * Take the run lease, so two overlapping runs (a duplicate cron delivery, a
 * manual trigger during the scheduled one) never both buy the same pairs. The
 * conditional update is atomic: of two racing runs, only one gets the row
 * back. Also returns any halt stored on the row.
 */
export async function acquireRunLock(
  admin: AdminClient,
  now: Date = new Date(),
): Promise<{ acquired: true; haltedReason: string | null } | { acquired: false }> {
  const fail = (message: string) => new Error(`Could not take the keyword discovery lock: ${message}`)
  const { data, error } = await admin
    .from(STATE)
    .update({ locked_until: new Date(now.getTime() + LOCK_LEASE_MS).toISOString() })
    .eq('id', 1)
    .lt('locked_until', now.toISOString())
    .select('id,halted_reason')
  if (error) throw fail(error.message)
  const row = (data as Array<{ halted_reason: string | null }> | null)?.[0]
  if (row) return { acquired: true, haltedReason: row.halted_reason ?? null }

  // No row back: another run holds the lease — or the row was never created,
  // which would otherwise look like a lease that is never free.
  const { data: rows, error: readError } = await admin.from(STATE).select('id').eq('id', 1)
  if (readError) throw fail(readError.message)
  if (!rows || (rows as unknown[]).length === 0) {
    throw fail('keyword_discovery_state has no row — re-run supabase/keyword-discovery.sql')
  }
  return { acquired: false }
}

export async function releaseRunLock(admin: AdminClient): Promise<void> {
  const { error } = await admin.from(STATE).update({ locked_until: UNLOCKED }).eq('id', 1)
  if (error) throw new Error(`Could not release the keyword discovery lock: ${error.message}`)
}

/**
 * Stop all paid calls until a person clears the halt in Supabase. Used when
 * Ahrefs changed something (pricing, response shape) that would otherwise make
 * every run buy and fail on the same pair.
 */
export async function haltDiscovery(admin: AdminClient, reason: string, now: Date = new Date()): Promise<void> {
  const { error } = await admin.from(STATE).update({ halted_reason: reason, halted_at: now.toISOString() }).eq('id', 1)
  if (error) throw new Error(`Could not save the keyword discovery halt: ${error.message}`)
}
