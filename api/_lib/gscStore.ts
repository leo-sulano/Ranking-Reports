/**
 * Supabase reads and writes for the "Real keywords (Google)" tab: the one
 * Search Console connection and the 6-hour answer cache. Server-only: it runs on
 * the service-role client from snapshotStore.ts, so nothing in src/ may import
 * this file.
 *
 * Tables: supabase/gsc.sql. Errors carry only an operator message, never row
 * data: the connection row holds the (encrypted) refresh token.
 */
import type { AdminClient } from './snapshotStore.js'

export type GscConnection = {
  refreshTokenEnc: string
  googleEmail: string | null
  connectedBy: string
  connectedAt: string
  status: 'ok' | 'broken'
}

type ConnectionRow = {
  refresh_token_enc: string
  google_email: string | null
  connected_by: string
  connected_at: string
  status: 'ok' | 'broken'
}

function fail(what: string, error: { message: string }): Error {
  return new Error(`Could not ${what}: ${error.message}`)
}

export async function loadConnection(admin: AdminClient): Promise<GscConnection | null> {
  const { data, error } = await admin
    .from('gsc_connection')
    .select('refresh_token_enc,google_email,connected_by,connected_at,status')
    .eq('id', 1)
  if (error) throw fail('read the Google connection', error)
  const row = ((data ?? []) as ConnectionRow[])[0]
  if (!row) return null
  return {
    refreshTokenEnc: row.refresh_token_enc,
    googleEmail:     row.google_email,
    connectedBy:     row.connected_by,
    connectedAt:     row.connected_at,
    status:          row.status,
  }
}

/** Connect (or reconnect): replaces the single row and marks it ok. */
export async function saveConnection(admin: AdminClient, c: Omit<GscConnection, 'status'>): Promise<void> {
  const { error } = await admin.from('gsc_connection').upsert(
    {
      id:                1,
      refresh_token_enc: c.refreshTokenEnc,
      google_email:      c.googleEmail,
      connected_by:      c.connectedBy,
      connected_at:      c.connectedAt,
      status:            'ok',
    },
    { onConflict: 'id' },
  )
  if (error) throw fail('save the Google connection', error)
}

export async function markBroken(admin: AdminClient): Promise<void> {
  const { error } = await admin.from('gsc_connection').update({ status: 'broken' }).eq('id', 1)
  if (error) throw fail('mark the Google connection broken', error)
}

export async function deleteConnection(admin: AdminClient): Promise<void> {
  const { error } = await admin.from('gsc_connection').delete().eq('id', 1)
  if (error) throw fail('remove the Google connection', error)
}

/** The cached payload for (domain, days), or null when missing or older than maxAgeMs. */
export async function readCache<T>(
  admin: AdminClient,
  domain: string,
  days: number,
  maxAgeMs: number,
  now: Date,
): Promise<T | null> {
  const { data, error } = await admin
    .from('gsc_cache')
    .select('payload,fetched_at')
    .eq('domain', domain)
    .eq('days', days)
  if (error) throw fail('read the Search Console cache', error)
  const row = ((data ?? []) as Array<{ payload: T; fetched_at: string }>)[0]
  if (!row) return null
  // A future-dated row (clock skew) is not trusted as fresh.
  const age = now.getTime() - new Date(row.fetched_at).getTime()
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs ? row.payload : null
}

export async function writeCache(
  admin: AdminClient,
  domain: string,
  days: number,
  payload: unknown,
  now: Date,
): Promise<void> {
  const { error } = await admin.from('gsc_cache').upsert(
    { domain, days, payload, fetched_at: now.toISOString() },
    { onConflict: 'domain,days' },
  )
  if (error) throw fail('save the Search Console cache', error)
}

export async function clearCache(admin: AdminClient): Promise<void> {
  // PostgREST refuses an unfiltered delete; days is never negative, so this matches every row.
  const { error } = await admin.from('gsc_cache').delete().neq('days', -1)
  if (error) throw fail('clear the Search Console cache', error)
}
