import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import type { Brand, RROutletContext } from '../types'
import { fetchGscKeywords, startGscConnect, type GscKeywordsResult } from '../lib/gscApi'
import {
  PAGE_STEP, countriesOf, defaultSite, filterRows, readGscParams, reportedBpDomains, sortByImpressions,
  type GscDays,
} from '../lib/gscView'
import { formatDisplayDate } from '../lib/parser'

const AVG_POSITION_TIP =
  "Google's average position over the period, weighted by how often the site was shown. It is not a single check like the Rankings tab."

const FIELD =
  'rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--ink)] hover:border-[var(--border-strong)]'

type Load =
  | { status: 'loading' }
  | { status: 'done'; result: GscKeywordsResult }

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export function RealKeywordsTab({ brand, domainFilter }: { brand: Brand; domainFilter?: string }) {
  const { isAdmin } = useOutletContext<RROutletContext>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { gsite, days } = readGscParams(searchParams)
  const site = defaultSite(brand, domainFilter, searchParams.get('site'), gsite)
  const sites = useMemo(() => reportedBpDomains(brand), [brand])

  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [countries, setCountries] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [page1, setPage1] = useState(false)
  const [shown, setShown] = useState(PAGE_STEP)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const setView = useCallback(
    (nextSite: string, nextDays: GscDays) => {
      const next = new URLSearchParams(searchParams)
      next.set('gsite', nextSite)
      next.set('days', String(nextDays))
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  // Fetch on mount and on a site or period change; the previous request is aborted.
  useEffect(() => {
    const ctrl = new AbortController()
    setLoad({ status: 'loading' })
    fetchGscKeywords(site, days, ctrl.signal).then(
      (result) => { if (!ctrl.signal.aborted) setLoad({ status: 'done', result }) },
      () => {
        if (!ctrl.signal.aborted) {
          setLoad({ status: 'done', result: { ok: false, error: 'Could not reach the dashboard server.' } })
        }
      },
    )
    return () => ctrl.abort()
  }, [site, days, attempt])

  // A new site starts with clean filters.
  useEffect(() => {
    setCountries([])
    setSearch('')
    setPage1(false)
  }, [site])
  useEffect(() => setShown(PAGE_STEP), [countries, search, page1, site, days])

  const result = load.status === 'done' && load.result.ok ? load.result : null
  const allRows = result?.rows
  const countryList = useMemo(() => countriesOf(allRows ?? []), [allRows])
  const sorted = useMemo(
    () => sortByImpressions(filterRows(allRows ?? [], { countries, search, page1 })),
    [allRows, countries, search, page1],
  )

  async function connect() {
    setConnecting(true)
    setConnectError(null)
    try {
      window.location.assign(await startGscConnect())
    } catch (err) {
      setConnectError(`Couldn't start the connection: ${err instanceof Error ? err.message : 'unknown error'}`)
      setConnecting(false)
    }
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Site" className={FIELD} value={site} onChange={(e) => setView(e.target.value, days)}>
        {sites.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select
        aria-label="Period"
        className={FIELD}
        value={days}
        onChange={(e) => setView(site, Number(e.target.value) as GscDays)}
      >
        {[7, 28, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
      </select>
      {result?.dataUpTo && (
        <span className="font-mono text-[11px] text-[var(--muted)]">
          Google data up to {formatDisplayDate(result.dataUpTo.slice(0, 10))}
        </span>
      )}
    </div>
  )

  const note = (text: string, action?: React.ReactNode) => (
    <div className="flex flex-col items-start gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-[12px] text-[var(--text-2)]">{text}</p>
      {action}
    </div>
  )

  const connectBlock = (text: string) =>
    isAdmin
      ? note(text, (
        <>
          <button
            onClick={connect}
            disabled={connecting}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[12px] font-semibold text-[var(--ink)] hover:border-[var(--border-strong)] disabled:opacity-60"
          >
            Connect Google Search Console
          </button>
          {connectError && <p className="text-[12px] text-[var(--muted)]">{connectError}</p>}
        </>
      ))
      : note(text)

  let body: React.ReactNode
  if (load.status === 'loading') {
    body = <p className="text-[12px] text-[var(--muted)]">Loading Google Search Console data…</p>
  } else if (!load.result.ok) {
    const r = load.result
    if (r.code === 'not_connected') body = connectBlock("Google Search Console isn't connected yet")
    else if (r.code === 'reconnect') body = connectBlock('The Google connection stopped working')
    else {
      body = note(
        r.error || 'Something went wrong loading the Google data.',
        <button
          onClick={() => setAttempt((n) => n + 1)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[12px] font-semibold text-[var(--ink)] hover:border-[var(--border-strong)]"
        >
          Try again
        </button>,
      )
    }
  } else if (load.result.property === null) {
    body = note(`${site} isn't in the connected Search Console account`)
  } else if (!allRows || allRows.length === 0) {
    body = note(`Google shows no searches for this site in the last ${days} days`)
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search keywords"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${FIELD} w-full sm:w-56`}
          />
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-2)]">
            <input type="checkbox" checked={page1} onChange={(e) => setPage1(e.target.checked)} />
            Page 1 only
          </label>
          <span className="font-mono text-[11px] text-[var(--muted)] sm:ml-auto">
            {sorted.length.toLocaleString()} of {allRows.length.toLocaleString()} searches
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Countries">
          {countryList.map((c) => {
            const on = countries.includes(c)
            return (
              <button
                key={c}
                title={countryName(c)}
                aria-pressed={on}
                onClick={() => setCountries(on ? countries.filter((x) => x !== c) : [...countries, c])}
                className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                  on
                    ? 'border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--ink)]'
                    : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
              >
                {c}
              </button>
            )
          })}
        </div>
        {result?.truncated && (
          <p className="text-[12px] text-[var(--muted)]">Showing the top 25,000 searches by clicks</p>
        )}
        <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                <th className="px-2 py-2 sm:px-3 font-semibold">Search</th>
                <th className="px-2 py-2 sm:px-3 font-semibold">Country</th>
                <th className="px-2 py-2 sm:px-3 text-right font-semibold" title={AVG_POSITION_TIP}>Avg position</th>
                <th className="px-2 py-2 sm:px-3 text-right font-semibold">Clicks</th>
                <th className="px-2 py-2 sm:px-3 text-right font-semibold">Impressions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, shown).map((r) => (
                <tr key={`${r.query}|${r.country}`} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="px-2 py-2 sm:px-3 text-[var(--ink)]">{r.query}</td>
                  <td className="px-2 py-2 sm:px-3 font-mono text-[var(--text-2)]" title={countryName(r.country)}>{r.country}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono text-[var(--ink)]">{r.position.toFixed(1)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono text-[var(--text-2)]">{r.clicks.toLocaleString()}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono text-[var(--text-2)]">{r.impressions.toLocaleString()}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-[var(--muted)]">Nothing matches the filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {sorted.length > shown && (
          <button
            onClick={() => setShown((n) => n + PAGE_STEP)}
            className="self-start rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[12px] font-semibold text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--ink)]"
          >
            Show more
          </button>
        )}
      </>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-7 pt-4 sm:px-7">
      {header}
      {body}
    </div>
  )
}
