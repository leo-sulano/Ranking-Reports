// SERVER-ONLY. Unlike brands.ts, sitesNormalize.ts and ranksPaging.ts in this
// same directory, nothing in src/ may import this file — it runs on the
// service-role key.
//
// The "never overwrites human work" guarantee lives in the CALLER, not here:
// decideWrite returns a verdict and writeSnapshot has no internal guard, so a
// caller that writes on a 'skip' verdict destroys an uploaded snapshot with no
// complaint from this module.
import { createClient } from '@supabase/supabase-js'
import type { SyncRecord } from './sitesNormalize.js'

/** PostgREST handles far more, but 500 keeps request bodies comfortably small. */
export const RECORD_CHUNK = 500

/**
 * Whether the scheduled sync may write over what is already there.
 *
 * Fails safe in every uncertain case: only a snapshot explicitly marked as the
 * sync's own output is replaceable. A row with no source predates the migration
 * and is therefore human work, and an unrecognised source belongs to something
 * this function does not know about — neither is ours to destroy.
 */
export function decideWrite(
  existing: { source?: string | null } | null,
): 'insert' | 'replace' | 'skip' {
  if (!existing) return 'insert'
  return existing.source === 'sync' ? 'replace' : 'skip'
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The admin client. This is the one place the service-role key is used on the
 * sync path, and it is used because a cron has no user session to act as — RLS
 * would reject every write. api/sites.ts deliberately does NOT use it: there a
 * real caller exists, so their own token is the right authority.
 */
// Generics pinned explicitly to `any`: left at their defaults, ReturnType's
// generic-function inference resolves the library's conditional Schema type
// to `never` instead of the `any` a real call produces, which makes every
// `.insert(...)` below reject its row object. Pinning avoids that collapse
// without narrowing the type or touching the runtime call.
export type AdminClient = ReturnType<typeof createClient<any, any, any>>

export function createAdminClient(env: Record<string, string | undefined>): AdminClient {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Scheduled sync is not configured — set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY',
    )
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function findSnapshot(
  admin: AdminClient,
  category: string,
  rawDate: string,
): Promise<{ id: string; source?: string | null } | null> {
  const { data, error } = await admin
    .from('snapshots')
    .select('id, source')
    .eq('category', category)
    .eq('raw_date', rawDate)
    .maybeSingle()
  if (error) throw new Error(`Could not read existing snapshots: ${error.message}`)
  return (data as { id: string; source?: string | null } | null) ?? null
}

/**
 * Delete-then-insert, matching src/lib/storage.ts. Records are cleared
 * explicitly rather than trusting ON DELETE CASCADE — if the FK is not actually
 * configured that way, deleting only the snapshot leaves orphans and the next
 * write silently doubles the data.
 *
 * Not transactional: PostgREST cannot wrap these in one transaction, so a
 * failure mid-insert leaves a partial snapshot. That risk already exists on the
 * upload path and is out of scope here; the run fails loudly and the next one
 * rewrites the same date.
 *
 * `snap.id` MUST be the id resolved by the same findSnapshot call that fed
 * decideWrite, not one recomputed from (category, rawDate). This function
 * deletes by id while findSnapshot matches on (category, raw_date), and the two
 * only agree because every id happens to be `snap-${category}-${rawDate}` —
 * snapshots.category is nullable and nothing enforces that convention, so a row
 * that breaks it would be found by the lookup and missed by the delete,
 * doubling the records under a live snapshot.
 */
export async function writeSnapshot(
  admin: AdminClient,
  snap: { id: string; category: string; rawDate: string; displayDate: string; records: SyncRecord[] },
): Promise<void> {
  const { error: eRecs } = await admin.from('ranking_records').delete().eq('snapshot_id', snap.id)
  if (eRecs) throw new Error(`Could not clear existing records: ${eRecs.message}`)

  const { error: eSnap } = await admin.from('snapshots').delete().eq('id', snap.id)
  if (eSnap) throw new Error(`Could not clear the existing snapshot: ${eSnap.message}`)

  const { error: eIns } = await admin.from('snapshots').insert({
    id:           snap.id,
    raw_date:     snap.rawDate,
    display_date: snap.displayDate,
    category:     snap.category,
    source:       'sync',
  })
  if (eIns) throw new Error(`Could not write the snapshot: ${eIns.message}`)

  for (const slice of chunk(snap.records, RECORD_CHUNK)) {
    const { error } = await admin.from('ranking_records').insert(
      slice.map((r) => ({
        snapshot_id:          snap.id,
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
      })),
    )
    if (error) throw new Error(`Could not write records: ${error.message}`)
  }
}

/**
 * One row per run, success or failure — /log is the cron's only history.
 * user_id is null because no user ran this; the column is nullable, and the
 * service-role client bypasses the RLS policy that would demand auth.uid().
 */
export async function logCronActivity(
  admin: AdminClient,
  section: string,
  summary: string,
): Promise<void> {
  const { error } = await admin.from('activity_log').insert({
    user_id: null,
    email:   'cron@ranking-reports',
    action:  'sync',
    section,
    summary,
  })
  // Never let a failed log write mask the outcome it was describing.
  if (error) console.error('logCronActivity failed:', error.message)
}
