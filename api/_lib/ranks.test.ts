// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchRanksPage } from './ranks.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch() {
  const mock = vi.fn(async (_url: unknown, _init?: unknown) => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', mock)
  return mock
}

function signalOf(mock: ReturnType<typeof stubFetch>): AbortSignal {
  const init = mock.mock.calls[0][1] as { signal: AbortSignal }
  return init.signal
}

const URL_ = new URL('https://example.test/ranks.php?action=results')

describe('fetchRanksPage abort wiring', () => {
  it('bounds the request by the timeout when no signal is supplied', async () => {
    const mock = stubFetch()
    await fetchRanksPage('k', URL_, 20_000)
    expect(signalOf(mock)).toBeInstanceOf(AbortSignal)
    expect(signalOf(mock).aborted).toBe(false)
  })

  it("honours a caller's already-expired deadline", async () => {
    const mock = stubFetch()
    // api/cron-sync.ts hands in one run-wide deadline for every page; a page
    // started after it expired must not get a fresh 20s of its own.
    await fetchRanksPage('k', URL_, 20_000, AbortSignal.abort())
    expect(signalOf(mock).aborted).toBe(true)
  })

  it('keeps the per-page ceiling even when a caller signal is supplied', async () => {
    const mock = stubFetch()
    const neverAborts = new AbortController().signal
    await fetchRanksPage('k', URL_, 1, neverAborts)
    const signal = signalOf(mock)
    await new Promise((r) => setTimeout(r, 20))
    expect(signal.aborted).toBe(true)
  })
})
