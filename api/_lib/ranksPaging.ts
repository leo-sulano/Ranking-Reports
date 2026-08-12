// SHIPS IN THE BROWSER BUNDLE — src/lib/sitesApi.ts imports this, so being
// under api/ does not make it server code. No secrets, no process.env, no
// node: imports. (Server-only neighbours, where those are fine: ranks.ts,
// snapshotStore.ts, requestAuth.ts, ssoPortal.ts.)
import type { ApiRow } from './sitesNormalize.js'

/** The upstream caps `limit` at 1000. */
export const PAGE_SIZE = 1000

/** Hard stop for the pagination loop — far above any real dataset (2,826 today). */
const MAX_ROWS = 100_000

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
      throw new Error(
        `Sites API pagination exceeded ${MAX_ROWS} rows — aborting to avoid an unbounded loop`,
      )
    }
  }
}
