// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { AdminClient } from './snapshotStore.js'
import {
  clearCache, deleteConnection, loadConnection, markBroken, readCache, saveConnection, writeCache,
} from './gscStore.js'

type Row = Record<string, unknown>

/** In-memory stand-in for the two GSC tables on the service-role client. */
function fakeAdmin(opts: { error?: string } = {}) {
  const tables: Record<string, Row[]> = { gsc_connection: [], gsc_cache: [] }
  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown, boolean]> = []
      let op = ''
      let payload: Row = {}
      let conflict = ''
      const match = (r: Row) => filters.every(([c, v, neg]) => (r[c] === v) !== neg)
      const run = () => {
        if (opts.error) return { data: null, error: { message: opts.error } }
        const rows = tables[table]
        if (op === 'select') return { data: rows.filter(match), error: null }
        if (op === 'upsert') {
          const keys = conflict.split(',')
          const i = rows.findIndex((r) => keys.every((k) => r[k] === payload[k]))
          if (i >= 0) rows[i] = { ...rows[i], ...payload }
          else rows.push({ ...payload })
        }
        if (op === 'update') rows.filter(match).forEach((r) => Object.assign(r, payload))
        if (op === 'delete') tables[table] = rows.filter((r) => !match(r))
        return { data: null, error: null }
      }
      const b: Record<string, unknown> = {
        select: () => { op = 'select'; return b },
        upsert: (p: Row, o?: { onConflict?: string }) => { op = 'upsert'; payload = p; conflict = o?.onConflict ?? 'id'; return b },
        update: (p: Row) => { op = 'update'; payload = p; return b },
        delete: () => { op = 'delete'; return b },
        eq: (c: string, v: unknown) => { filters.push([c, v, false]); return b },
        neq: (c: string, v: unknown) => { filters.push([c, v, true]); return b },
        then: (res: (v: unknown) => void) => res(run()),
      }
      return b
    },
  }
  return { admin: admin as unknown as AdminClient, tables }
}

const conn = { refreshTokenEnc: 'enc-blob', googleEmail: 'a@b.com', connectedBy: 'u1', connectedAt: '2026-11-27T00:00:00.000Z' }

describe('connection', () => {
  it('round-trips save and load, status ok', async () => {
    const { admin, tables } = fakeAdmin()
    expect(await loadConnection(admin)).toBeNull()
    await saveConnection(admin, conn)
    expect(await loadConnection(admin)).toEqual({ ...conn, status: 'ok' })
    expect(tables.gsc_connection[0].id).toBe(1)
  })
  it('markBroken sets the status', async () => {
    const { admin } = fakeAdmin()
    await saveConnection(admin, conn)
    await markBroken(admin)
    expect((await loadConnection(admin))?.status).toBe('broken')
  })
  it('saving again resets broken to ok', async () => {
    const { admin } = fakeAdmin()
    await saveConnection(admin, conn)
    await markBroken(admin)
    await saveConnection(admin, conn)
    expect((await loadConnection(admin))?.status).toBe('ok')
  })
  it('deleteConnection leaves null', async () => {
    const { admin } = fakeAdmin()
    await saveConnection(admin, conn)
    await deleteConnection(admin)
    expect(await loadConnection(admin)).toBeNull()
  })
  it('errors never carry row data', async () => {
    const { admin } = fakeAdmin({ error: 'boom' })
    const err = await saveConnection(admin, conn).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('enc-blob')
  })
})

describe('cache', () => {
  const now = new Date('2026-11-27T12:00:00.000Z')
  it('returns a young payload, null when older or missing', async () => {
    const { admin } = fakeAdmin()
    expect(await readCache(admin, 'x.com', 28, 6 * 3600_000, now)).toBeNull()
    await writeCache(admin, 'x.com', 28, { a: 1 }, new Date(now.getTime() - 3600_000))
    expect(await readCache(admin, 'x.com', 28, 6 * 3600_000, now)).toEqual({ a: 1 })
    expect(await readCache(admin, 'x.com', 28, 1800_000, now)).toBeNull()
    expect(await readCache(admin, 'x.com', 7, 6 * 3600_000, now)).toBeNull()
  })
  it('upserts on (domain, days) and refreshes fetched_at', async () => {
    const { admin, tables } = fakeAdmin()
    await writeCache(admin, 'x.com', 28, { a: 1 }, new Date(now.getTime() - 10 * 3600_000))
    await writeCache(admin, 'x.com', 28, { a: 2 }, now)
    expect(tables.gsc_cache).toHaveLength(1)
    expect(await readCache(admin, 'x.com', 28, 3600_000, now)).toEqual({ a: 2 })
  })
  it('clearCache empties the table', async () => {
    const { admin, tables } = fakeAdmin()
    await writeCache(admin, '*', 0, ['s'], now)
    await writeCache(admin, 'x.com', 28, {}, now)
    await clearCache(admin)
    expect(tables.gsc_cache).toHaveLength(0)
  })
})
