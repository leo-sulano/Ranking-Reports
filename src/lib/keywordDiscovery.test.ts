import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadDiscoveryFetches, loadDiscoveryRows } from './keywordDiscovery'

interface Call { table: string; cols: string; chain: Array<[string, unknown[]]> }

// A stand-in for the browser's Supabase client: records each query chain and
// answers it, when awaited, from the test's script.
const db = vi.hoisted(() => ({
  calls:  [] as Call[],
  answer: (_call: Call): { data?: unknown; error?: { message: string } | null } => ({ data: [] }),
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const call: Call = { table, cols: '', chain: [] }
      const query: Record<string, unknown> = {
        select: (cols: string) => {
          call.cols = cols
          db.calls.push(call)
          return query
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null, ...db.answer(call) }).then(resolve, reject),
      }
      for (const step of ['in', 'eq', 'order', 'range']) {
        query[step] = (...args: unknown[]) => {
          call.chain.push([step, args])
          return query
        }
      }
      return query
    },
  },
}))

const DOMAINS = ['spinsup.com', 'spinsup.io']
const stored = (i: number) => ({
  id: i + 1, cycle: '2026-12-05', brand: 'SpinsUp', domain: 'spinsup.com', country: 'AU', keyword: `spinsup kw ${i}`,
  position: 3, position_kind: 'ai_overview', url: 'https://spinsup.com/', volume: 120, ahrefs_checked: '2026-12-01T08:00:00+00:00',
})

beforeEach(() => {
  db.calls.length = 0
  db.answer = () => ({ data: [] })
})

describe('loadDiscoveryFetches', () => {
  it("reads the brand's fetches, newest cycles first", async () => {
    db.answer = () => ({ data: [{
      cycle: '2026-11-05', domain: 'spinsup.com', country: 'AU', row_count: 12, units: 230,
      fetched_at: '2026-11-06T05:00:00+00:00',
    }] })
    expect(await loadDiscoveryFetches(DOMAINS)).toEqual([
      { cycle: '2026-11-05', domain: 'spinsup.com', country: 'AU', fetchedAt: '2026-11-06T05:00:00+00:00', rowCount: 12 },
    ])
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0].table).toBe('keyword_discovery_fetches')
    expect(db.calls[0].chain).toEqual(expect.arrayContaining([
      ['in', ['domain', DOMAINS]], ['order', ['cycle', { ascending: false }]],
    ]))
  })

  it('names the failure', async () => {
    db.answer = () => ({ error: { message: 'permission denied' } })
    await expect(loadDiscoveryFetches(DOMAINS)).rejects.toThrow(/^Could not load other ranking keywords: permission denied$/)
  })
})

describe('loadDiscoveryRows', () => {
  it('reads every row of the given cycles, a page at a time', async () => {
    db.answer = (call) => {
      const [from] = call.chain.find(([step]) => step === 'range')![1] as [number, number]
      return { data: Array.from({ length: from === 0 ? 1000 : 250 }, (_, i) => stored(from + i)) }
    }
    const rows = await loadDiscoveryRows(DOMAINS, ['2026-12-05', '2026-11-05'])

    expect(rows).toHaveLength(1250)
    expect(rows[0]).toEqual({
      cycle: '2026-12-05', brand: 'SpinsUp', domain: 'spinsup.com', country: 'AU', keyword: 'spinsup kw 0', position: 3,
      positionKind: 'ai_overview', url: 'https://spinsup.com/', volume: 120, ahrefsChecked: '2026-12-01T08:00:00+00:00',
    })
    expect(db.calls.map((c) => [c.table, c.chain])).toEqual([0, 1000].map((from) => ['keyword_discovery', [
      ['in', ['domain', DOMAINS]], ['in', ['cycle', ['2026-12-05', '2026-11-05']]],
      ['order', ['id', { ascending: true }]], ['range', [from, from + 999]],
    ]]))
  })

  it('asks for nothing when there are no cycles', async () => {
    expect(await loadDiscoveryRows(DOMAINS, [])).toEqual([])
    expect(db.calls).toEqual([])
  })

  it('names the failure', async () => {
    db.answer = () => ({ error: { message: 'relation "keyword_discovery" does not exist' } })
    await expect(loadDiscoveryRows(DOMAINS, ['2026-12-05'])).rejects.toThrow(/^Could not load other ranking keywords: /)
  })
})
