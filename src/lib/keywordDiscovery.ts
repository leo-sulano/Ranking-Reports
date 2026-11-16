/**
 * Browser side of "Other ranking keywords": loads what the monthly job
 * (api/cron-discovery.ts) stored in supabase/keyword-discovery.sql, using the
 * signed-in user's session (RLS lets approved users read), and re-exports the
 * shared logic the page needs from api/_lib.
 */
import { supabase } from './supabase'
import type { DiscoveryCountry, DiscoveryRow } from '../../api/_lib/keywordDiscovery.js'
import type { DiscoveryFetchInfo } from './discoveryList'

export { DISCOVERY_COUNTRIES, normalizeKeyword, trackedIndex, trackedKey } from '../../api/_lib/keywordDiscovery.js'
export type { DiscoveryRow } from '../../api/_lib/keywordDiscovery.js'

/** PostgREST returns at most this many rows per request. */
const PAGE = 1000

const failure = (message: string) => new Error(`Could not load other ranking keywords: ${message}`)

/**
 * The fetch records for these domains, newest cycles first. One page: ordering
 * by cycle means the row cap can only ever drop the oldest cycles, and the page
 * needs only the newest two.
 */
export async function loadDiscoveryFetches(domains: readonly string[]): Promise<DiscoveryFetchInfo[]> {
  const { data, error } = await supabase
    .from('keyword_discovery_fetches')
    .select('cycle,domain,country,fetched_at,row_count')
    .in('domain', [...domains])
    .order('cycle', { ascending: false })
    .range(0, PAGE - 1)
  if (error) throw failure(error.message)
  return ((data ?? []) as Array<{ cycle: string; domain: string; country: string; fetched_at: string; row_count: number }>)
    .map((r) => ({ cycle: r.cycle, domain: r.domain, country: r.country, fetchedAt: r.fetched_at, rowCount: r.row_count }))
}

interface StoredRow {
  cycle:          string
  brand:          string
  domain:         string
  country:        string
  keyword:        string
  position:       number
  position_kind:  string | null
  url:            string
  volume:         number | null
  ahrefs_checked: string | null
}

/** Every stored keyword of these domains in these cycles, paged past the row cap. */
export async function loadDiscoveryRows(domains: readonly string[], cycles: readonly string[]): Promise<DiscoveryRow[]> {
  if (cycles.length === 0) return []
  const rows: DiscoveryRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('keyword_discovery')
      .select('id,cycle,brand,domain,country,keyword,position,position_kind,url,volume,ahrefs_checked')
      .in('domain', [...domains])
      .in('cycle', [...cycles])
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw failure(error.message)
    const page = (data ?? []) as StoredRow[]
    for (const r of page) {
      rows.push({
        cycle:         r.cycle,
        brand:         r.brand,
        domain:        r.domain,
        country:       r.country as DiscoveryCountry,
        keyword:       r.keyword,
        position:      r.position,
        positionKind:  r.position_kind,
        url:           r.url,
        volume:        r.volume,
        ahrefsChecked: r.ahrefs_checked,
      })
    }
    if (page.length < PAGE) return rows
  }
}
