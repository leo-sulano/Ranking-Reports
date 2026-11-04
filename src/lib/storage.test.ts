import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findExistingSnapshot, findStoredSnapshot } from './storage'
import type { Snapshot, SnapshotMeta } from '../types'

// findStoredSnapshot asks the database, not the page's loaded state, whether a
// snapshot already exists — the sync's last line of defence against replacing
// one the page has not loaded yet. Stub the query chain it uses.
const query = vi.hoisted(() => ({
  table:  '',
  cols:   '',
  filter: [] as unknown[],
  result: { data: [] as unknown[] | null, error: null as { message: string } | null },
}))
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      query.table = table
      return {
        select: (cols: string) => {
          query.cols = cols
          return {
            eq: (column: string, value: unknown) => {
              query.filter = [column, value]
              return Promise.resolve(query.result)
            },
          }
        },
      }
    },
  },
}))

function row(over: Record<string, unknown> = {}) {
  return {
    id:           'snap-bp-sites-2026-11-03',
    raw_date:     '2026-11-03',
    display_date: 'old format',
    category:     'bp-sites',
    source:       'upload',
    ...over,
  }
}

beforeEach(() => {
  query.table = ''
  query.cols = ''
  query.filter = []
  query.result = { data: [], error: null }
})

describe('findStoredSnapshot', () => {
  it('finds a stored snapshot of the same category and date', async () => {
    query.result = { data: [row()], error: null }
    const found = await findStoredSnapshot('bp-sites', '2026-11-03')
    expect(query.table).toBe('snapshots')
    expect(query.filter).toEqual(['raw_date', '2026-11-03'])
    expect(found).toMatchObject({ id: 'snap-bp-sites-2026-11-03', category: 'bp-sites', rawDate: '2026-11-03', source: 'upload' })
  })

  it('ignores another category on the same date', async () => {
    query.result = { data: [row({ id: 'snap-lp-sites-2026-11-03', category: 'lp-sites' })], error: null }
    await expect(findStoredSnapshot('bp-sites', '2026-11-03')).resolves.toBeNull()
  })

  it('matches the id the write would replace, even on a row with no category', async () => {
    // upsertSnapshot deletes by id, so an id match is the destructive case.
    query.result = { data: [row({ category: null })], error: null }
    await expect(findStoredSnapshot('bp-sites', '2026-11-03')).resolves.toMatchObject({ id: 'snap-bp-sites-2026-11-03' })
  })

  it('returns null when nothing is stored for that date', async () => {
    await expect(findStoredSnapshot('bp-sites', '2026-11-03')).resolves.toBeNull()
  })

  it('throws when the lookup fails, so the caller writes nothing', async () => {
    query.result = { data: null, error: { message: 'network down' } }
    await expect(findStoredSnapshot('bp-sites', '2026-11-03')).rejects.toMatchObject({ message: 'network down' })
  })
})

// The one check both write paths (sync and single-file upload) run before
// writing: loaded state first, then the database, hydrating what it finds so
// the duplicate warning can show the snapshot it would replace.
describe('findExistingSnapshot', () => {
  const META: SnapshotMeta = {
    id: 'snap-bp-sites-2026-11-03', category: 'bp-sites', rawDate: '2026-11-03', displayDate: 'Nov 3, 2026', source: 'upload',
  }
  const SNAP: Snapshot = { ...META, records: [] }

  function deps(stored: SnapshotMeta | null = null) {
    return {
      findStored: vi.fn(async () => stored),
      hydrate:    vi.fn(async (meta: SnapshotMeta[]) => meta.map((m) => ({ ...m, records: [] }))),
    }
  }

  it('returns the loaded snapshot without asking the database', async () => {
    const d = deps()
    await expect(findExistingSnapshot([SNAP], 'bp-sites', '2026-11-03', d)).resolves.toBe(SNAP)
    expect(d.findStored).not.toHaveBeenCalled()
  })

  it('falls back to the database and loads what it finds, so the warning can show it', async () => {
    const d = deps(META)
    const found = await findExistingSnapshot([], 'bp-sites', '2026-11-03', d)
    expect(d.findStored).toHaveBeenCalledWith('bp-sites', '2026-11-03')
    expect(d.hydrate).toHaveBeenCalledWith([META])
    expect(found).toMatchObject({ id: META.id, source: 'upload', records: [] })
  })

  it('ignores a loaded snapshot of another category on the same date', async () => {
    const lp: Snapshot = { ...SNAP, id: 'snap-lp-sites-2026-11-03', category: 'lp-sites' }
    const d = deps()
    await expect(findExistingSnapshot([lp], 'bp-sites', '2026-11-03', d)).resolves.toBeNull()
    expect(d.findStored).toHaveBeenCalled()
  })

  it('returns null when neither the page nor the database has one', async () => {
    await expect(findExistingSnapshot([], 'bp-sites', '2026-11-03', deps())).resolves.toBeNull()
  })

  it('lets a failed lookup throw, so the caller writes nothing', async () => {
    const d = { ...deps(), findStored: vi.fn(async () => { throw new Error('network down') }) }
    await expect(findExistingSnapshot([], 'bp-sites', '2026-11-03', d)).rejects.toThrow('network down')
  })
})
