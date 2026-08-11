// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { fetchAllRows } from './ranksPaging.js'
import type { ApiRow } from './sitesNormalize.js'

/** n placeholder rows — only the count matters to the pager. */
function page(n: number): ApiRow[] {
  return Array.from({ length: n }, (_, i) => ({
    domain: 'rooster.bet',
    keyword: `kw-${i}`,
    country: 'AU',
    position: 1,
    previous_position: 1,
    change: 0,
    url_found: null,
    checked_at: '2026-08-04 10:00:00',
  }))
}

describe('fetchAllRows', () => {
  it('stops on the first short page', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(4))
    const rows = await fetchAllRows(fetchPage, undefined, 10)
    expect(rows).toHaveLength(24)
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([0, 10, 20])
  })

  it('stops immediately when the first page is empty', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce([])
    expect(await fetchAllRows(fetchPage, undefined, 10)).toEqual([])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('keeps paging on a full page even though meta.total would say stop', async () => {
    // The live endpoint reported total:135 for a 154-row response, so the
    // pager must never terminate on a count.
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(3))
    expect(await fetchAllRows(fetchPage, undefined, 10)).toHaveLength(13)
  })

  it('reports cumulative progress after each page', async () => {
    const onProgress = vi.fn()
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockResolvedValueOnce(page(2))
    await fetchAllRows(fetchPage, onProgress, 10)
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([10, 12])
  })

  it('rejects when a page fails mid-pagination, yielding nothing', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(10))
      .mockRejectedValueOnce(new Error('upstream exploded'))
    await expect(fetchAllRows(fetchPage, undefined, 10)).rejects.toThrow('upstream exploded')
  })

  it('aborts rather than looping past the row cap', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(10))
    await expect(fetchAllRows(fetchPage, undefined, 10)).rejects.toThrow(/exceeded/)
  })
})
