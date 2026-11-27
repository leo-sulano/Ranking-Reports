import { describe, it, expect } from 'vitest'
import { gscToastFor, withoutGscParams, coverageSummary } from './gscToast'

describe('gscToastFor', () => {
  const p = (s: string) => new URLSearchParams(s)
  it('says nothing without ?gsc', () => {
    expect(gscToastFor(p(''))).toBeNull()
    expect(gscToastFor(p('gsc=other'))).toBeNull()
  })
  it('connected', () => {
    expect(gscToastFor(p('gsc=connected'))).toEqual({ message: 'Google Search Console connected.', type: 'success' })
  })
  it('maps each error reason', () => {
    const msg = (r: string) => gscToastFor(p(`gsc=error&reason=${r}`))
    expect(msg('state')?.message).toBe('The sign-in link expired. Try Connect again.')
    expect(msg('nonce')?.message).toBe('The sign-in link expired. Try Connect again.')
    expect(msg('admin')?.message).toBe('Only admins can connect Google.')
    expect(msg('denied')?.message).toBe('Google access was not granted.')
    expect(msg('google')?.message).toBe('Google sign-in failed. Check the setup in docs/integrations/gsc.md.')
    expect(msg('config')?.message).toBe('Google sign-in failed. Check the setup in docs/integrations/gsc.md.')
    expect(msg('state')?.type).toBe('error')
  })
  it('unknown or missing reason uses the google copy', () => {
    const want = 'Google sign-in failed. Check the setup in docs/integrations/gsc.md.'
    expect(gscToastFor(p('gsc=error&reason=weird'))?.message).toBe(want)
    expect(gscToastFor(p('gsc=error'))?.message).toBe(want)
  })
})

describe('withoutGscParams', () => {
  it('removes only gsc and reason', () => {
    expect(withoutGscParams(new URLSearchParams('gsc=error&reason=state&view=google&days=28')).toString()).toBe('view=google&days=28')
  })
})

describe('coverageSummary', () => {
  it('counts sites with at least one property', () => {
    const c = [
      { domain: 'a.com', brand: 'A', properties: ['sc-domain:a.com'] },
      { domain: 'b.com', brand: 'B', properties: [] },
      { domain: 'c.com', brand: 'C', properties: ['https://c.com/'] },
    ]
    expect(coverageSummary(c)).toEqual({ found: 2, total: 3 })
    expect(coverageSummary([])).toEqual({ found: 0, total: 0 })
  })
})
