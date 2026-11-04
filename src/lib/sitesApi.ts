import { supabase } from './supabase'
import type { NormalizeResult } from './sitesNormalize'

export class SitesApiError extends Error {
  status: number | null
  /**
   * The proxy's own machine-readable reason, when it set one:
   * - `'unauthenticated'` (401) — no valid Supabase session.
   * - `'unapproved'` (403) — a valid session whose account an admin has not
   *   approved.
   * Either way the `error` text is already user-facing, so callers surface it
   * verbatim rather than branching on the code.
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
 * Turn the proxy's response into a sync result, or throw the error the user
 * will read.
 *
 * Split out from `fetchSync` because this — not the transport — decides the
 * wording of every sync failure. The proxy words its own errors (no session,
 * unapproved, missing OPENSEO_RANKINGS_API_KEY, OpenSEO rejecting the key or
 * timing out) as `body.error`, and they are surfaced verbatim, so the message
 * the server wrote is the message the user sees.
 */
export function parseSyncBody(res: { ok: boolean; status: number }, body: unknown): NormalizeResult {
  const payload = body as { ok?: unknown; error?: unknown; data?: unknown; code?: unknown } | null

  if (!res.ok || payload?.ok === false) {
    const error =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error
        : `HTTP ${res.status}`
    const code = typeof payload?.code === 'string' ? payload.code : null
    throw new SitesApiError(error, res.status, code)
  }

  const data = payload?.data as Partial<NormalizeResult> | undefined
  if (!Array.isArray(data?.records) || !Array.isArray(data?.unknownDomains) || typeof data?.rawDate !== 'string') {
    throw new SitesApiError('The sync service returned an unexpected payload', res.status)
  }
  return data as NormalizeResult
}

/**
 * Every BP ranking OpenSEO holds, already normalized, from our own proxy —
 * never from OpenSEO directly, which needs a server-only key.
 *
 * The proxy requires the caller's Supabase session; a missing token is still
 * sent (headerless) rather than short-circuited here, so the single source of
 * truth for "who may sync" stays server-side. `signal` cancels the request —
 * the rejection is the raw `AbortError`, which the caller uses to skip the
 * failure toast.
 */
export async function fetchSync(signal?: AbortSignal): Promise<NormalizeResult> {
  let token: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token
  } catch {
    // Leave it unset — the proxy answers with its own 401 message.
  }

  let res: Response
  try {
    res = await fetch('/api/sites', {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
  } catch (err) {
    // A cancel is the user's choice, not a failure: propagate it untouched so
    // the caller can tell the two apart.
    if (isAbort(err)) throw err
    throw new SitesApiError(`Could not reach the dashboard's sync service: ${(err as Error).message}`)
  }

  const body = await res.json().catch(() => null)
  return parseSyncBody(res, body)
}
