/**
 * Test-only helpers for the api/gsc-*.test.ts files: an in-memory stand-in for
 * the Supabase client (callers' auth, user_access, gsc_connection, gsc_cache),
 * request/response doubles and a stub Google fetch. Never imported by a handler.
 */
import { encryptToken } from './gsc.js'

export const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64')
export const STATE_SECRET = 'state-secret-state-secret-state-secret-0123'
export const SERVICE_KEY = 'service_test'

type Row = Record<string, unknown>

export const fake = {
  userId: 'user-1',
  status: 'approved' as string,
  isAdmin: false,
  /** User ids that are admins when read with the service-role client (the callback's check). */
  admins: new Set<string>(),
  connection: null as Row | null,
  cache: [] as Row[],
  writes: [] as string[],
  reset() {
    this.userId = 'user-1'
    this.status = 'approved'
    this.isAdmin = false
    this.admins = new Set()
    this.connection = null
    this.cache = []
    this.writes = []
  },
}

function builder(table: string, key: string) {
  const filters: Array<[string, unknown, 'eq' | 'neq']> = []
  let op: { kind: 'select' | 'upsert' | 'update' | 'delete'; row?: Row } = { kind: 'select' }
  const run = (): { data: unknown; error: null } => {
    if (table === 'gsc_connection') {
      if (op.kind === 'select') return { data: fake.connection ? [fake.connection] : [], error: null }
      if (op.kind === 'upsert') { fake.connection = op.row!; fake.writes.push('connection.save') }
      if (op.kind === 'update' && fake.connection) { fake.connection = { ...fake.connection, ...op.row }; fake.writes.push('connection.broken') }
      if (op.kind === 'delete') { fake.connection = null; fake.writes.push('connection.delete') }
      return { data: null, error: null }
    }
    if (table === 'gsc_cache') {
      const match = (r: Row) => filters.every(([c, v, k]) => (k === 'eq' ? r[c] === v : r[c] !== v))
      if (op.kind === 'select') return { data: fake.cache.filter(match), error: null }
      if (op.kind === 'upsert') {
        fake.cache = fake.cache.filter((r) => !(r.domain === op.row!.domain && r.days === op.row!.days))
        fake.cache.push(op.row!)
        fake.writes.push(`cache.write:${String(op.row!.domain)}:${String(op.row!.days)}`)
      }
      if (op.kind === 'delete') { fake.cache = fake.cache.filter((r) => !match(r)); fake.writes.push('cache.clear') }
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { filters.push([c, v, 'eq']); return b },
    neq: (c: string, v: unknown) => { filters.push([c, v, 'neq']); return b },
    upsert: (row: Row) => { op = { kind: 'upsert', row }; return b },
    update: (row: Row) => { op = { kind: 'update', row }; return b },
    delete: () => { op = { kind: 'delete' }; return b },
    maybeSingle: async () => {
      if (table !== 'user_access') return { data: null, error: null }
      return key === SERVICE_KEY
        ? { data: { is_admin: fake.admins.has(String(filters[0]?.[1])) || (fake.isAdmin && filters[0]?.[1] === fake.userId) }, error: null }
        : { data: { status: fake.status }, error: null }
    },
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
  }
  return b
}

/** The module shape of `@supabase/supabase-js` the handlers use. */
export const supabaseMock = {
  createClient: (_url: string, key: string) => ({
    auth: {
      getUser: async (jwt: string) =>
        jwt === 'bad-token'
          ? { data: { user: null }, error: { message: 'invalid JWT' } }
          : { data: { user: { id: fake.userId, email: 'a@b.co' } }, error: null },
    },
    from: (table: string) => builder(table, key),
  }),
}

export const GOOD_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon_test',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  APP_URL: 'https://app.example.com',
  GOOGLE_OAUTH_CLIENT_ID: 'client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret-xyz',
  GSC_STATE_SECRET: STATE_SECRET,
  GSC_TOKEN_KEY: TOKEN_KEY,
}

export const encryptedRefresh = (plain = 'refresh-token-abc') => encryptToken(TOKEN_KEY, plain)

export function setConnection(status: 'ok' | 'broken' = 'ok') {
  fake.connection = {
    refresh_token_enc: encryptedRefresh(), google_email: 'seo@example.com',
    connected_by: 'admin-1', connected_at: '2026-11-01T00:00:00.000Z', status,
  }
}

export function makeReq(
  method: string,
  query: Record<string, string> = {},
  headers: Record<string, string> = { authorization: 'Bearer good-token' },
) {
  return { method, query, headers } as never
}

export function makeRes() {
  const res: Record<string, unknown> & { statusCode?: number; body?: unknown; headers: Record<string, string>; redirected?: [number, string] } = { headers: {} }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: unknown) => { res.body = b; return res }
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res }
  res.redirect = (c: number, u: string) => { res.redirected = [c, u]; return res }
  return res as typeof res & { statusCode: number; body: any }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
