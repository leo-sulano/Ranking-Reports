import { useCallback, useEffect, useState } from 'react'
import { disconnectGsc, fetchGscStatus, startGscConnect, type GscStatus } from '../lib/gscApi'
import { coverageSummary } from '../lib/gscToast'

const BTN_PRIMARY =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold text-white bg-[var(--btn-ink)] hover:bg-[var(--btn-ink-hover)] disabled:opacity-50 transition-colors'
const BTN_QUIET =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)] hover:border-[var(--border-strong)] disabled:opacity-50 transition-colors'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })
}

/** Admins only (the Users page already redirects everyone else). `userEmails` turns a user id into an email when known. */
export function GscConnectionPanel({ userEmails }: { userEmails: Record<string, string> }) {
  const [status, setStatus] = useState<GscStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchGscStatus())
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const connect = async () => {
    setBusy(true)
    setActionError(null)
    try {
      window.location.assign(await startGscConnect())
    } catch (err) {
      setActionError(`Could not start the Google sign-in: ${err instanceof Error ? err.message : String(err)}`)
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Search Console? The Real keywords tab stops working until an admin connects again.')) return
    setBusy(true)
    setActionError(null)
    try {
      await disconnectGsc()
      await refresh()
    } catch (err) {
      setActionError(`Could not disconnect: ${err instanceof Error ? err.message : String(err)}`)
    }
    setBusy(false)
  }

  const broken = status?.connected && status.status === 'broken'
  const by = status?.connectedBy ? (userEmails[status.connectedBy] ?? status.connectedBy) : null
  const cov = status?.coverage ? coverageSummary(status.coverage) : null

  return (
    <section className="mb-8" aria-label="Google Search Console">
      <h2 className="font-display text-[16px] tracking-wider text-[var(--ink)] mb-4">Google Search Console</h2>
      <div className="border border-[var(--border)] rounded-md px-4 py-3">
        {!status && !loadError && <p className="text-[12px] text-[var(--muted-2)]">Checking the Google connection…</p>}
        {loadError && <p className="text-[12px] text-[var(--neg)]">Could not read the Google connection: {loadError}</p>}

        {status && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-[13px] text-[var(--ink)] break-words">
              {!status.connected && <span className="text-[var(--muted)]">Not connected.</span>}
              {broken && <span className="font-semibold text-[var(--neg)]">The Google connection stopped working</span>}
              {status.connected && !broken && (
                <span>
                  Connected as <span className="font-semibold">{status.googleEmail}</span>
                  {by && <> · by {by}</>}
                  {status.connectedAt && <> · {formatDate(status.connectedAt)}</>}
                </span>
              )}
              {broken && status.googleEmail && (
                <div className="text-[11px] font-mono text-[var(--muted-2)] mt-0.5">Was connected as {status.googleEmail}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!status.connected && (
                <button onClick={connect} disabled={busy} className={BTN_PRIMARY}>Connect Google Search Console</button>
              )}
              {broken && <button onClick={connect} disabled={busy} className={BTN_PRIMARY}>Reconnect</button>}
              {status.connected && (
                <button onClick={disconnect} disabled={busy} className={BTN_QUIET}>Disconnect</button>
              )}
            </div>
          </div>
        )}

        {actionError && <p className="mt-2 text-[12px] text-[var(--neg)]">{actionError}</p>}

        {status?.coverageError && (
          <p className="mt-3 pt-3 border-t border-[var(--border-3)] text-[12px] text-[var(--neg)]">
            Could not check which BP sites are in Search Console: {status.coverageError}
          </p>
        )}

        {status?.coverage && cov && (
          <div className="mt-3 pt-3 border-t border-[var(--border-3)]">
            <div className="text-[12px] font-semibold text-[var(--ink)] mb-2">
              {cov.found} of {cov.total} BP sites found in Search Console
            </div>
            <ul className="divide-y divide-[var(--border-3)]">
              {status.coverage.map((c) => (
                <li key={c.domain} className="flex flex-wrap justify-between gap-x-3 py-1.5 text-[12px]">
                  <span className="font-mono text-[var(--ink)] break-all">{c.domain}</span>
                  <span className={`font-mono break-all ${c.properties.length ? 'text-[var(--muted)]' : 'text-[var(--muted-2)]'}`}>
                    {c.properties.length ? c.properties.join(', ') : 'not found'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
