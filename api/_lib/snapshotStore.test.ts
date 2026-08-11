// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { decideWrite, chunk, writeSnapshot, RECORD_CHUNK } from './snapshotStore.js'
import type { AdminClient } from './snapshotStore.js'

describe('decideWrite', () => {
  it('inserts when no snapshot exists for the date', () => {
    expect(decideWrite(null)).toBe('insert')
  })

  it('replaces a snapshot the sync itself created', () => {
    expect(decideWrite({ source: 'sync' })).toBe('replace')
  })

  it('skips a snapshot a person uploaded', () => {
    expect(decideWrite({ source: 'upload' })).toBe('skip')
  })

  it('skips when the source is missing — an un-migrated row is human work', () => {
    expect(decideWrite({})).toBe('skip')
    expect(decideWrite({ source: null })).toBe('skip')
  })

  it('skips an unrecognised source rather than guessing', () => {
    expect(decideWrite({ source: 'imported-by-some-future-thing' })).toBe('skip')
  })
})

describe('chunk', () => {
  it('splits on the 500-row boundary', () => {
    const rows = Array.from({ length: 1109 }, (_, i) => i)
    const out = chunk(rows, RECORD_CHUNK)
    expect(out.map((c) => c.length)).toEqual([500, 500, 109])
  })

  it('returns nothing for an empty list', () => {
    expect(chunk([], RECORD_CHUNK)).toEqual([])
  })

  it('returns one chunk when the input is shorter than the size', () => {
    expect(chunk([1, 2, 3], RECORD_CHUNK)).toEqual([[1, 2, 3]])
  })
})

describe('writeSnapshot', () => {
  /**
   * A stub whose record-insert fails on the Nth call. Everything else succeeds,
   * so the only thing under test is whether the failure surfaces.
   */
  function adminFailingInsertOn(n: number) {
    let inserts = 0
    return {
      from: (table: string) => ({
        delete: () => ({ eq: async () => ({ error: null }) }),
        insert: async () => {
          if (table !== 'ranking_records') return { error: null }
          inserts += 1
          return inserts === n ? { error: { message: 'payload too large' } } : { error: null }
        },
      }),
    } as unknown as AdminClient
  }

  const snap = (count: number) => ({
    id: 'snap-bp-sites-2026-08-04',
    category: 'bp-sites',
    rawDate: '2026-08-04',
    displayDate: '4 Aug 26',
    records: Array.from({ length: count }, (_, i) => ({
      domain: 'rooster.bet', keyword: `kw-${i}`, country: 'AU',
      position: '1', previous: '1', change: '0', date: '2026-08-04',
    })),
  })

  it('propagates a failure on the FIRST record chunk rather than swallowing it', async () => {
    await expect(writeSnapshot(adminFailingInsertOn(1), snap(1109)))
      .rejects.toThrow(/payload too large/)
  })

  it('propagates a failure on a LATER chunk — the loop must not ignore it', async () => {
    // The regression this guards: a for-loop that collects errors instead of
    // throwing would write chunks 1 and 2 and report success.
    await expect(writeSnapshot(adminFailingInsertOn(3), snap(1109)))
      .rejects.toThrow(/payload too large/)
  })

  it('resolves when every chunk succeeds', async () => {
    await expect(writeSnapshot(adminFailingInsertOn(99), snap(1109))).resolves.toBeUndefined()
  })
})
