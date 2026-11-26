// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { AdminClient } from './snapshotStore.js'
import type { DiscoveryRow } from './keywordDiscovery.js'
import {
  acquireRunLock, cycleTotals, haltDiscovery, loadFetchedPairs, releaseRunLock, saveFetch,
} from './discoveryStore.js'

interface Call { table: string; op: string; args: unknown[]; chain: Array<[string, unknown[]]> }
type Answer = { data?: unknown; error?: { message: string } | null }

/**
 * A stand-in for the service-role client: records every query chain (table,
 * operation, filters, payload) and answers each one, when awaited, from the
 * test's script.
 */
function fakeAdmin(answer: (call: Call) => Answer) {
  const calls: Call[] = []
  const admin = {
    from(table: string) {
      const call: Call = { table, op: '', args: [], chain: [] }
      const builder: Record<string, unknown> = {}
      for (const op of ['select', 'insert', 'upsert', 'update', 'delete']) {
        builder[op] = (...args: unknown[]) => {
          // `.update(...).select(...)`: the select only shapes what comes back.
          if (call.op) {
            call.chain.push([op, args])
            return builder
          }
          call.op = op
          call.args = args
          calls.push(call)
          return builder
        }
      }
      for (const step of ['eq', 'lt', 'in', 'order', 'limit', 'range']) {
        builder[step] = (...args: unknown[]) => {
          call.chain.push([step, args])
          return builder
        }
      }
      builder.then = (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
        try {
          resolve({ data: null, error: null, ...answer(call) })
        } catch (err) {
          reject(err)
        }
      }
      return builder
    },
  }
  return { admin: admin as unknown as AdminClient, calls }
}

describe('loadFetchedPairs', () => {
  it("reads which domain × country pairs this cycle already holds", async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: [{ domain: 'SpinsUp.com', country: 'AU' }] }))
    expect(await loadFetchedPairs(admin, '2026-11-05')).toEqual(new Set(['spinsup.com|AU']))
    expect(calls).toEqual([{
      table: 'keyword_discovery_fetches', op: 'select', args: ['domain,country'], chain: [['eq', ['cycle', '2026-11-05']]],
    }])
  })

  it('names the failure', async () => {
    const { admin } = fakeAdmin(() => ({ error: { message: 'relation does not exist' } }))
    await expect(loadFetchedPairs(admin, '2026-11-05'))
      .rejects.toThrow('Could not read keyword discovery progress: relation does not exist')
  })
})

describe('saveFetch', () => {
  const ROW: DiscoveryRow = {
    cycle: '2026-11-05', brand: 'SpinsUp', domain: 'spinsup.com', country: 'AU', keyword: 'spinsup login',
    position: 3, positionKind: 'ai_overview', url: 'https://spinsup.com/login', volume: 900,
    ahrefsChecked: '2026-11-01T10:00:00Z',
  }
  const INPUT = { cycle: '2026-11-05', domain: 'spinsup.com' } as const

  it("replaces the site's rows for the cycle in every country, then records an ALL fetch last", async () => {
    const { admin, calls } = fakeAdmin(() => ({}))
    const rows = Array.from({ length: 501 }, (_, i) => ({ ...ROW, keyword: `kw ${i}` }))
    await saveFetch(admin, { ...INPUT, rows, units: 750 })

    expect(calls.map((c) => `${c.op} ${c.table}`)).toEqual([
      'delete keyword_discovery', 'insert keyword_discovery', 'insert keyword_discovery', 'upsert keyword_discovery_fetches',
    ])
    expect(calls[0].chain).toEqual([['eq', ['cycle', '2026-11-05']], ['eq', ['domain', 'spinsup.com']]])
    expect((calls[1].args[0] as unknown[]).length).toBe(500)
    expect((calls[2].args[0] as unknown[]).length).toBe(1)
    expect((calls[1].args[0] as unknown[])[0]).toEqual({
      cycle: '2026-11-05', brand: 'SpinsUp', domain: 'spinsup.com', country: 'AU', keyword: 'kw 0', position: 3,
      position_kind: 'ai_overview', url: 'https://spinsup.com/login', volume: 900, ahrefs_checked: '2026-11-01T10:00:00Z',
    })
    const [fetchRow, options] = calls[3].args as [Record<string, unknown>, unknown]
    expect(fetchRow).toMatchObject({ cycle: '2026-11-05', domain: 'spinsup.com', country: 'ALL', row_count: 501, units: 750 })
    expect(Number.isNaN(Date.parse(String(fetchRow.fetched_at)))).toBe(false)
    expect(options).toEqual({ onConflict: 'cycle,domain,country' })
  })

  it('records a site that returned nothing, without inserting rows', async () => {
    const { admin, calls } = fakeAdmin(() => ({}))
    await saveFetch(admin, { ...INPUT, rows: [], units: 50 })
    expect(calls.map((c) => `${c.op} ${c.table}`)).toEqual(['delete keyword_discovery', 'upsert keyword_discovery_fetches'])
    expect(calls[1].args[0]).toMatchObject({ row_count: 0, units: 50 })
  })

  it('does not record the fetch when its rows failed to save', async () => {
    const { admin, calls } = fakeAdmin((call) => (call.op === 'insert' ? { error: { message: 'duplicate key' } } : {}))
    await expect(saveFetch(admin, { ...INPUT, rows: [ROW], units: 65 }))
      .rejects.toThrow('Could not save keyword discovery for spinsup.com: duplicate key')
    expect(calls.some((c) => c.op === 'upsert')).toBe(false)
  })

  it('does not insert or record anything when clearing the old rows failed', async () => {
    const { admin, calls } = fakeAdmin((call) => (call.op === 'delete' ? { error: { message: 'locked' } } : {}))
    await expect(saveFetch(admin, { ...INPUT, rows: [ROW], units: 65 }))
      .rejects.toThrow('Could not save keyword discovery for spinsup.com: locked')
    expect(calls.map((c) => c.op)).toEqual(['delete'])
  })
})

describe('cycleTotals', () => {
  it("counts the cycle's fetches and sums their units", async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: [{ units: 700 }, { units: 740 }, { units: 700 }] }))
    expect(await cycleTotals(admin, '2026-11-05')).toEqual({ pairs: 3, units: 2140 })
    expect(calls).toEqual([{
      table: 'keyword_discovery_fetches', op: 'select', args: ['units'], chain: [['eq', ['cycle', '2026-11-05']]],
    }])
  })
})

describe('acquireRunLock', () => {
  const NOW = new Date('2026-11-14T05:00:00.000Z')

  it('takes the lease when it has run out, returning any stored halt', async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: [{ id: 1, halted_reason: null }] }))
    expect(await acquireRunLock(admin, NOW)).toEqual({ acquired: true, haltedReason: null })
    expect(calls).toEqual([{
      table: 'keyword_discovery_state', op: 'update', args: [{ locked_until: '2026-11-14T05:01:30.000Z' }],
      chain: [['eq', ['id', 1]], ['lt', ['locked_until', '2026-11-14T05:00:00.000Z']], ['select', ['id,halted_reason']]],
    }])
  })

  it('passes on a halt stored on the row', async () => {
    const { admin } = fakeAdmin(() => ({ data: [{ id: 1, halted_reason: 'Ahrefs charged 1000 units' }] }))
    expect(await acquireRunLock(admin, NOW)).toEqual({ acquired: true, haltedReason: 'Ahrefs charged 1000 units' })
  })

  it('does not take a lease another run still holds', async () => {
    const { admin, calls } = fakeAdmin((call) => (call.op === 'update' ? { data: [] } : { data: [{ id: 1 }] }))
    expect(await acquireRunLock(admin, NOW)).toEqual({ acquired: false })
    expect(calls[1]).toEqual({ table: 'keyword_discovery_state', op: 'select', args: ['id'], chain: [['eq', ['id', 1]]] })
  })

  it('says the state row is missing instead of waiting on it forever', async () => {
    const { admin } = fakeAdmin(() => ({ data: [] }))
    await expect(acquireRunLock(admin, NOW)).rejects.toThrow(/keyword_discovery_state has no row/)
  })

  it('names the failure', async () => {
    const { admin } = fakeAdmin(() => ({ error: { message: 'relation "keyword_discovery_state" does not exist' } }))
    await expect(acquireRunLock(admin, NOW))
      .rejects.toThrow('Could not take the keyword discovery lock: relation "keyword_discovery_state" does not exist')
  })
})

describe('releaseRunLock', () => {
  it('ends the lease at once', async () => {
    const { admin, calls } = fakeAdmin(() => ({}))
    await releaseRunLock(admin)
    expect(calls).toEqual([{
      table: 'keyword_discovery_state', op: 'update', args: [{ locked_until: '1970-01-01T00:00:00.000Z' }],
      chain: [['eq', ['id', 1]]],
    }])
  })
})

describe('haltDiscovery', () => {
  it('stores why and when, so later runs refuse until a person clears it', async () => {
    const { admin, calls } = fakeAdmin(() => ({}))
    await haltDiscovery(admin, 'Ahrefs charged 1000 units', new Date('2026-11-14T05:00:00.000Z'))
    expect(calls).toEqual([{
      table: 'keyword_discovery_state', op: 'update',
      args: [{ halted_reason: 'Ahrefs charged 1000 units', halted_at: '2026-11-14T05:00:00.000Z' }],
      chain: [['eq', ['id', 1]]],
    }])
  })

  it('names the failure', async () => {
    const { admin } = fakeAdmin(() => ({ error: { message: 'timeout' } }))
    await expect(haltDiscovery(admin, 'r')).rejects.toThrow('Could not save the keyword discovery halt: timeout')
  })
})
