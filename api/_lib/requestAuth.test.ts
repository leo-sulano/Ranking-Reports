// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { AdminClient } from './snapshotStore.js'
import { isAdminUser } from './requestAuth.js'

function fakeAdmin(result: () => { data: unknown; error: { message: string } | null }) {
  const seen: unknown[] = []
  const admin = {
    from(table: string) {
      seen.push(table)
      return {
        select: (cols: string) => {
          seen.push(cols)
          return { eq: (c: string, v: string) => { seen.push([c, v]); return { maybeSingle: async () => result() } } }
        },
      }
    },
  }
  return { admin: admin as unknown as AdminClient, seen }
}

describe('isAdminUser', () => {
  it('reads user_access.is_admin for the user', async () => {
    const t = fakeAdmin(() => ({ data: { is_admin: true }, error: null }))
    expect(await isAdminUser(t.admin, 'u1')).toBe(true)
    expect(t.seen).toEqual(['user_access', 'is_admin', ['user_id', 'u1']])
    expect(await isAdminUser(fakeAdmin(() => ({ data: { is_admin: false }, error: null })).admin, 'u1')).toBe(false)
  })
  it('is false for a missing row or a query error', async () => {
    expect(await isAdminUser(fakeAdmin(() => ({ data: null, error: null })).admin, 'u1')).toBe(false)
    expect(await isAdminUser(fakeAdmin(() => ({ data: { is_admin: true }, error: { message: 'x' } })).admin, 'u1')).toBe(false)
  })
  it('never throws', async () => {
    expect(await isAdminUser(fakeAdmin(() => { throw new Error('net') }).admin, 'u1')).toBe(false)
  })
})
