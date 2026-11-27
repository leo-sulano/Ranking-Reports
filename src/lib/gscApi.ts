import { supabase } from './supabase'
import type { GscRow } from '../../api/_lib/gsc.js'

export type { GscRow }

/** What GET /api/gsc-status answers (always 200 when healthy). Admin-only fields are absent for others. */
export type GscStatus = {
  ok: true
  connected: boolean
  status?: 'ok' | 'broken'
  googleEmail?: string
  connectedBy?: string
  connectedAt?: string
  /** Plain words for why the coverage list is missing (admins only). */
  coverageError?: string
  coverage?: { domain: string; brand: string; properties: string[] }[]
}

export type GscKeywordsResult =
  | {
      ok: true
      property: string | null
      startDate?: string | null
      dataUpTo?: string | null
      truncated?: boolean
      rows?: GscRow[]
    }
  | { ok: false; code?: 'not_connected' | 'reconnect'; error: string }

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    // Unset: the server answers with its own 401.
    return {}
  }
}

async function readBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const b = await res.json()
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export async function fetchGscKeywords(
  domain: string,
  days: 7 | 28 | 90,
  signal?: AbortSignal,
): Promise<GscKeywordsResult> {
  const headers = await authHeaders()
  let res: Response
  try {
    res = await fetch(`/api/gsc-keywords?domain=${encodeURIComponent(domain)}&days=${days}`, { signal, headers })
  } catch (err) {
    if (signal?.aborted) throw err
    return { ok: false, error: 'Could not reach the dashboard server.' }
  }
  const body = await readBody(res)

  if (res.ok && body?.ok === true) return body as unknown as GscKeywordsResult

  const code = body?.code === 'not_connected' || body?.code === 'reconnect' ? body.code : undefined
  const serverText = text(body?.error)
  if (code) return { ok: false, code, error: serverText ?? '' }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: serverText ?? 'You are not allowed to see this.' }
  }
  return { ok: false, error: serverText ?? `HTTP ${res.status}` }
}

export async function fetchGscStatus(): Promise<GscStatus> {
  const res = await fetch('/api/gsc-status', { headers: await authHeaders() })
  const body = await readBody(res)
  if (!res.ok || body?.ok !== true) {
    throw new Error(text(body?.error) ?? `HTTP ${res.status}`)
  }
  return body as unknown as GscStatus
}

/** The Google consent URL; the caller does window.location.assign. */
export async function startGscConnect(): Promise<string> {
  const res = await fetch('/api/gsc-connect', { method: 'POST', headers: await authHeaders() })
  const body = await readBody(res)
  const url = text(body?.url)
  if (!res.ok || body?.ok !== true || !url) {
    throw new Error(text(body?.error) ?? `HTTP ${res.status}`)
  }
  return url
}

export async function disconnectGsc(): Promise<void> {
  const res = await fetch('/api/gsc-disconnect', { method: 'POST', headers: await authHeaders() })
  if (!res.ok) {
    const body = await readBody(res)
    throw new Error(text(body?.error) ?? `HTTP ${res.status}`)
  }
}
