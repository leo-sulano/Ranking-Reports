import { supabase } from './supabase'
import type { ApiRow } from './sitesNormalize'
export { PAGE_SIZE, fetchAllRows } from '../../api/_lib/ranksPaging.js'
import { PAGE_SIZE, fetchAllRows } from '../../api/_lib/ranksPaging.js'

export class SitesApiError extends Error {
  status: number | null
  /**
   * The proxy's own machine-readable reason, when it set one:
   * - `'unauthenticated'` (401) — no valid Supabase session. Distinguishes our
   *   401 from an upstream 401 passed through with the same status, which means
   *   the vendor rejected `SITES_API_KEY` and reads very differently.
   * - `'unapproved'` (403) — a valid session whose account an admin has not
   *   approved. Its `error` text is already user-facing, so callers surface it
   *   verbatim rather than branching on the code.
   */
  code: string | null
  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message)
    this.name = 'SitesApiError'
    this.status = status
    this.code = code
  }
}

/** True for the DOMException a cancelled fetch rejects with. */
function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError'
}

/**
 * Turn one proxy response into rows, or throw the error the user will read.
 *
 * Split out from `fetchProxyPage` because this — not the transport — is what
 * decides the wording of every sync failure. Three shapes reach here:
 * a non-2xx status, a 2xx envelope with `ok: false`, and a success envelope
 * with no `data` array. The proxy's own errors (401 no session, 500 naming
 * `SITES_API_KEY`, 504 timeout) all arrive as `body.error` and are surfaced
 * verbatim, so the message the server wrote is the message the user sees.
 */
export function parsePageBody(res: { ok: boolean; status: number }, body: unknown): ApiRow[] {
  const payload = body as { ok?: unknown; error?: unknown; data?: unknown; code?: unknown } | null

  if (!res.ok || payload?.ok === false) {
    const error =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error
        : `HTTP ${res.status}`
    const code = typeof payload?.code === 'string' ? payload.code : null
    throw new SitesApiError(error, res.status, code)
  }
  if (!Array.isArray(payload?.data)) {
    throw new SitesApiError('Sites service returned an unexpected payload (no data array)', res.status)
  }
  return payload.data as ApiRow[]
}

/**
 * Fetch one page from our own proxy. Never talks to the upstream directly.
 *
 * The proxy requires the caller's Supabase session — it is a read of live
 * ranking data, gated exactly like every other read in the app. A missing
 * token is still sent (headerless) rather than short-circuited here, so the
 * single source of truth for "who may sync" stays server-side.
 */
export async function fetchProxyPage(offset: number, signal?: AbortSignal): Promise<ApiRow[]> {
  const url = `/api/sites?action=results&limit=${PAGE_SIZE}&offset=${offset}`

  let token: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token
  } catch {
    // Leave it unset — the proxy answers with its own 401 message.
  }

  let res: Response
  try {
    res = await fetch(url, {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
  } catch (err) {
    // A cancel is the user's choice, not a failure: propagate it untouched so
    // the caller can tell the two apart.
    if (isAbort(err)) throw err
    throw new SitesApiError(`Could not reach the sites service: ${(err as Error).message}`)
  }

  const body = await res.json().catch(() => null)
  return parsePageBody(res, body)
}

/**
 * Every ranking row the caller can see, paged to completion.
 *
 * `signal` cancels an in-flight sync — the rejection is the raw `AbortError`,
 * which the caller uses to skip the failure toast.
 */
export function fetchSitesRows(
  onProgress?: (rows: number) => void,
  signal?: AbortSignal,
): Promise<ApiRow[]> {
  return fetchAllRows((offset) => fetchProxyPage(offset, signal), onProgress)
}
