import type { ApiRow } from './sitesNormalize'

/** The upstream caps `limit` at 1000. */
export const PAGE_SIZE = 1000

/** Hard stop for the pagination loop — far above any real dataset (2,826 today). */
const MAX_ROWS = 100_000

export class SitesApiError extends Error {
  status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'SitesApiError'
    this.status = status
  }
}

/**
 * Page until a page comes back shorter than requested.
 *
 * Deliberately ignores the response's `meta.total`: the live endpoint reported
 * `total: 135` for a request that returned 154 rows, so terminating on a count
 * would silently truncate. Page length is the only trustworthy signal.
 *
 * A failure on any page rejects — callers must not persist a partial batch.
 */
export async function fetchAllRows(
  fetchPage: (offset: number) => Promise<ApiRow[]>,
  onProgress?: (rows: number) => void,
  pageSize: number = PAGE_SIZE,
): Promise<ApiRow[]> {
  const all: ApiRow[] = []
  let offset = 0
  for (;;) {
    const pageRows = await fetchPage(offset)
    all.push(...pageRows)
    onProgress?.(all.length)
    if (pageRows.length < pageSize) return all
    offset += pageSize
    if (all.length >= MAX_ROWS) {
      throw new SitesApiError(
        `Sites API pagination exceeded ${MAX_ROWS} rows — aborting to avoid an unbounded loop`,
      )
    }
  }
}

/** Fetch one page from our own proxy. Never talks to the upstream directly. */
async function fetchProxyPage(offset: number): Promise<ApiRow[]> {
  const url = `/api/sites?action=results&limit=${PAGE_SIZE}&offset=${offset}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new SitesApiError(`Could not reach the sites service: ${(err as Error).message}`)
  }

  const body = await res.json().catch(() => null)

  if (!res.ok || body?.ok === false) {
    throw new SitesApiError(body?.error ?? `HTTP ${res.status}`, res.status)
  }
  if (!Array.isArray(body?.data)) {
    throw new SitesApiError('Sites service returned an unexpected payload (no data array)', res.status)
  }
  return body.data as ApiRow[]
}

/** Every ranking row the key can see, paged to completion. */
export function fetchSitesRows(onProgress?: (rows: number) => void): Promise<ApiRow[]> {
  return fetchAllRows(fetchProxyPage, onProgress)
}
