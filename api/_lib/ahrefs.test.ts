// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AhrefsError, KEY_REJECTED, ahrefsConfig, compareDate, fetchBpProjects, type AhrefsConfig } from './ahrefs.js'

const CONFIG: AhrefsConfig = { key: 'ahk_test' }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const ROW = { keyword: 'roosterbet casino', country: 'AU', language: 'en', serp_updated: '2026-11-03T10:42:38Z',
  serp_updated_prev: '2026-10-27T10:42:38Z', competitors_list: [{ url: 'https://roostersbet.com/', position: 1, position_prev: 2 }] }
const PROJECTS = [
  { project_id: 1, project_name: 'Roostersbet.com', url: 'roostersbet.com/', keyword_count: 45 },
  { project_id: 2, project_name: 'Trybet.ca', url: 'trybet.ca/', keyword_count: 45 },                 // another client
  { project_id: 3, project_name: 'Casinorocketspin.com', url: 'casinorocketspin.com/', keyword_count: 0 },
  { project_id: 4, project_name: 'Luckyvibe.net', url: 'luckyvibe.net/', keyword_count: 10 },          // LP
]

let fetchMock: ReturnType<typeof vi.fn>
/** Routes by path. `override` answers first whenever it returns a Response. */
function stubAhrefs(override?: (path: string, url: URL) => Response | undefined) {
  fetchMock = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    if (init.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
    const url = new URL(String(input))
    const path = url.pathname.replace(/^\/v3\//, '')
    const hit = override?.(path, url)
    if (hit) return hit
    if (path === 'management/projects') return json({ projects: PROJECTS })
    if (path === 'management/project-competitors') return json({ competitors: [{ url: 'rooster.bet/', mode: 'subdomains' }] })
    return json({ keywords: [ROW] })
  })
  vi.stubGlobal('fetch', fetchMock)
}
const projectIdsFetched = () =>
  fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('project_id')).filter(Boolean)

beforeEach(() => stubAhrefs())
afterEach(() => vi.unstubAllGlobals())

describe('ahrefsConfig / compareDate', () => {
  it('returns null without a key and trims it', () => {
    expect(ahrefsConfig({})).toBeNull()
    expect(ahrefsConfig({ AHREFS_API_KEY: '  ' })).toBeNull()
    expect(ahrefsConfig({ AHREFS_API_KEY: ' k ' })).toEqual({ key: 'k' })
  })
  it('compares against 7 days earlier, across month and year ends', () => {
    expect(compareDate('2026-11-11')).toBe('2026-11-04')
    expect(compareDate('2026-03-03')).toBe('2026-02-24')
    expect(compareDate('2026-01-05')).toBe('2025-12-29')
  })
})

describe('fetchBpProjects', () => {
  it('fetches only BP projects that have keywords', async () => {
    const projects = await fetchBpProjects(CONFIG, { asOf: '2026-11-11' })
    expect(projects).toEqual([{ projectId: 1, name: 'Roostersbet.com', target: 'roostersbet.com/',
      competitors: ['rooster.bet/'], rows: [ROW] }])
    // Another client's project, an empty one and an LP one are never read.
    expect(new Set(projectIdsFetched())).toEqual(new Set(['1']))
  })

  it('sends only GETs with the Bearer key, to the three free endpoints', async () => {
    await fetchBpProjects(CONFIG, { asOf: '2026-11-11' })
    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://api.ahrefs.com')
      expect(['/v3/management/projects', '/v3/management/project-competitors', '/v3/rank-tracker/competitors-overview'])
        .toContain(url.pathname)
      expect((init as RequestInit).method ?? 'GET').toBe('GET')
      expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer ahk_test')
    }
  })

  it('asks for desktop, the as-of date and the week before, with every slot', async () => {
    await fetchBpProjects(CONFIG, { asOf: '2026-11-11' })
    const call = fetchMock.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.pathname.endsWith('competitors-overview'))!
    expect(call.searchParams.get('device')).toBe('desktop')
    expect(call.searchParams.get('date')).toBe('2026-11-11')
    expect(call.searchParams.get('date_compared')).toBe('2026-11-04')
    expect(call.searchParams.get('select')).toContain('competitors_list')
    expect(call.searchParams.get('select')).toContain('serp_updated_prev')
  })

  it('names a rejected key and does not retry it', async () => {
    for (const status of [401, 403]) {
      stubAhrefs(() => json({ error: 'nope' }, status))
      await expect(fetchBpProjects(CONFIG)).rejects.toThrow(KEY_REJECTED)
      await expect(fetchBpProjects(CONFIG)).rejects.toBeInstanceOf(AhrefsError)
      expect(fetchMock).toHaveBeenCalledTimes(2)   // one per attempt above, no retries
    }
  })

  it('retries a 5xx or 429 once, then names the request', async () => {
    let n = 0
    stubAhrefs((path) => (path === 'management/projects' && n++ === 0 ? json({}, 503) : undefined))
    await expect(fetchBpProjects(CONFIG, { asOf: '2026-11-11', retryDelayMs: 0 })).resolves.toHaveLength(1)
    stubAhrefs((path) => (path === 'management/projects' ? json({}, 429) : undefined))
    await expect(fetchBpProjects(CONFIG, { retryDelayMs: 0 })).rejects.toThrow('Ahrefs returned HTTP 429 for the project list')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("waits as long as Ahrefs' Retry-After says before retrying a 429", async () => {
    let n = 0
    stubAhrefs((path) => (path === 'management/projects' && n++ === 0
      ? new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }) : undefined))
    // A one-minute default pause would time this test out; Retry-After: 0 overrides it.
    await expect(fetchBpProjects(CONFIG, { asOf: '2026-11-11', retryDelayMs: 60_000 })).resolves.toHaveLength(1)
  })

  it("passes Ahrefs' own error text through for other refusals", async () => {
    stubAhrefs((path) => (path === 'management/projects' ? json({ error: 'API units limit reached' }, 402) : undefined))
    await expect(fetchBpProjects(CONFIG)).rejects.toThrow('Ahrefs returned HTTP 402 for the project list: API units limit reached')
  })

  it('stops when a response says it cost API units', async () => {
    stubAhrefs((path) => (path === 'management/projects'
      ? json({ projects: PROJECTS }, 200, { 'x-api-units-cost-total': '50' }) : undefined))
    await expect(fetchBpProjects(CONFIG)).rejects.toThrow(
      'Ahrefs charged API units for the project list — the sync stopped; it should only call free endpoints')
  })

  it('fails the whole fetch when one project fails, naming it', async () => {
    stubAhrefs((path) => (path.endsWith('competitors-overview') ? json({}, 500) : undefined))
    await expect(fetchBpProjects(CONFIG, { retryDelayMs: 0 })).rejects.toThrow('Ahrefs returned HTTP 500 for Roostersbet.com')
  })

  it('refuses a full page rather than truncating it', async () => {
    stubAhrefs((path) => (path.endsWith('competitors-overview') ? json({ keywords: Array(1000).fill(ROW) }) : undefined))
    await expect(fetchBpProjects(CONFIG)).rejects.toThrow(
      'Ahrefs returned 1000 rows for Roostersbet.com — more than one request can hold, so nothing was saved')
  })

  it('refuses an unexpected shape', async () => {
    stubAhrefs((path) => (path === 'management/projects' ? json({}) : undefined))
    await expect(fetchBpProjects(CONFIG)).rejects.toThrow('Ahrefs returned an unexpected project list')
  })

  it("lets the caller's cancel through untouched", async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(fetchBpProjects(CONFIG, { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
