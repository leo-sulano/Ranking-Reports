import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findStoredSnapshot } from './storage'

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
