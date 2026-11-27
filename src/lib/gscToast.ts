import type { GscStatus } from './gscApi'

const EXPIRED = 'The sign-in link expired. Try Connect again.'
const FAILED = 'Google sign-in failed. Check the setup in docs/integrations/gsc.md.'

const REASON_COPY: Record<string, string> = {
  state: EXPIRED,
  nonce: EXPIRED,
  admin: 'Only admins can connect Google.',
  denied: 'Google access was not granted.',
  scope: "Google didn't grant Search Console access. Click Connect again and allow it when Google asks.",
  google: FAILED,
  config: FAILED,
}

/** The notice for what gsc-callback put in the URL, or null when it left nothing. Unknown reasons get the generic failure copy. */
export function gscToastFor(params: URLSearchParams): { message: string; type: 'success' | 'error' } | null {
  const gsc = params.get('gsc')
  if (gsc === 'connected') return { message: 'Google Search Console connected.', type: 'success' }
  if (gsc === 'error') {
    const reason = params.get('reason') ?? ''
    return { message: Object.prototype.hasOwnProperty.call(REASON_COPY, reason) ? REASON_COPY[reason] : FAILED, type: 'error' }
  }
  return null
}

/** The same parameters minus the callback's `gsc` and `reason`. */
export function withoutGscParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('gsc')
  next.delete('reason')
  return next
}

/** "N of M BP sites found in Search Console": a site counts when it matched at least one property. */
export function coverageSummary(coverage: NonNullable<GscStatus['coverage']>): { found: number; total: number } {
  return { found: coverage.filter((c) => c.properties.length > 0).length, total: coverage.length }
}
