import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Brand, RankingRecord } from '../types'
import { DOMAIN_TO_BRAND } from '../lib/brands'
import { formatDisplayDate } from '../lib/parser'
import { loadDiscoveryFetches, loadDiscoveryRows, trackedIndex, type DiscoveryRow } from '../lib/keywordDiscovery'
import {
  buildDiscoveryList, completeCycles, cycleCompletedAt, newEligibleCountries, positionKindLabel, previousCycle,
} from '../lib/discoveryList'

/**
 * "Other ranking keywords · not tracked" — under the matrix on a BP Sites
 * brand page. Shows what the monthly Ahrefs job (api/cron-discovery.ts) found
 * the brand's sites ranking for, minus what the newest snapshot tracks.
 * Design: docs/superpowers/specs/2026-11-13-other-ranking-keywords-design.md
 */

const INITIAL_ROWS = 25
const ALL_COUNTRIES = ['AU', 'CA', 'DE', 'IT', 'NZ']

type Loaded =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status:      'ready'
      shown:       string | null
      completedAt: string | null
      rows:        DiscoveryRow[]
      prevRows:    DiscoveryRow[]
      newEligible: Set<string>
    }

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url)

export function OtherRankingKeywords({
  brand,
  trackedRecords,
  selectedDomains,
  countries,
  kwFilter,
  kwExact,
}: {
  brand:           Brand
  /** The brand's records in the newest BP snapshot: what is tracked now. */
  trackedRecords:  readonly RankingRecord[]
  selectedDomains: readonly string[]
  countries:       readonly string[]
  kwFilter:        string
  kwExact:         boolean
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded({ status: 'loading' })
    setShowAll(false)
    ;(async () => {
      try {
        const fetches = await loadDiscoveryFetches(brand.domains)
        const shown = completeCycles(brand.domains, fetches)[0] ?? null
        const prev = shown ? previousCycle(shown, brand.domains, fetches) : null
        const rows = await loadDiscoveryRows(brand.domains, [shown, prev].filter((c): c is string => c !== null))
        if (cancelled) return
        setLoaded({
          status:      'ready',
          shown,
          completedAt: shown ? cycleCompletedAt(shown, brand.domains, fetches) : null,
          rows:        rows.filter((r) => r.cycle === shown),
          prevRows:    rows.filter((r) => r.cycle === prev),
          newEligible: newEligibleCountries(prev, brand.domains, fetches),
        })
      } catch (err) {
        console.error(err)
        if (!cancelled) setLoaded({ status: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [brand])

  const tracked = useMemo(() => trackedIndex(trackedRecords, DOMAIN_TO_BRAND), [trackedRecords])

  const list = useMemo(() => {
    if (loaded.status !== 'ready') return []
    return buildDiscoveryList({
      rows: loaded.rows, prevRows: loaded.prevRows, newEligible: loaded.newEligible, tracked, brand,
      selectedDomains, countries, kwFilter, kwExact,
    })
  }, [loaded, tracked, brand, selectedDomains, countries, kwFilter, kwExact])

  // Tells "everything is tracked" apart from "the filters hide everything".
  const untrackedTotal = useMemo(() => {
    if (loaded.status !== 'ready') return 0
    return buildDiscoveryList({
      rows: loaded.rows, prevRows: loaded.prevRows, newEligible: loaded.newEligible, tracked, brand,
      selectedDomains: brand.domains, countries: ALL_COUNTRIES, kwFilter: '', kwExact: false,
    }).length
  }, [loaded, tracked, brand])

  const visible = showAll ? list : list.slice(0, INITIAL_ROWS)

  let body: ReactNode
  if (loaded.status === 'loading') {
    body = <p className="text-[12px] text-[var(--muted)]">Loading other ranking keywords…</p>
  } else if (loaded.status === 'error') {
    body = <p className="text-[12px] text-[var(--muted)]">Couldn't load other ranking keywords.</p>
  } else if (loaded.shown === null) {
    body = (
      <p className="text-[12px] text-[var(--muted)]">
        No list yet — it appears once Ahrefs has been checked for all of this brand's sites.
      </p>
    )
  } else if (list.length === 0) {
    body = (
      <p className="text-[12px] text-[var(--muted)]">
        {untrackedTotal === 0 ? 'Every keyword Ahrefs sees for these sites is already tracked.' : 'Nothing matches the filters.'}
      </p>
    )
  } else {
    body = (
      <>
        <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                <th className="px-3 py-2 font-semibold">Keyword</th>
                <th className="px-3 py-2 font-semibold">Country</th>
                <th className="hidden px-3 py-2 font-semibold sm:table-cell">Best site</th>
                <th className="px-3 py-2 text-right font-semibold">Pos</th>
                <th className="px-3 py-2 text-right font-semibold">Search vol</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const kind = positionKindLabel(item.positionKind)
                const checked = item.ahrefsChecked
                  ? `Ahrefs checked ${formatDisplayDate(item.ahrefsChecked.slice(0, 10))}`
                  : undefined
                return (
                  <tr key={`${item.keyword}|${item.country}`} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-3 py-2 align-top text-[var(--ink)]">
                      <div className="flex flex-wrap items-center gap-2">
                        {isHttpUrl(item.url) ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer" title={checked} className="hover:underline">
                            {item.keyword}
                          </a>
                        ) : (
                          <span title={checked}>{item.keyword}</span>
                        )}
                        {item.isNew && (
                          <span className="rounded-full border border-[var(--pos-border)] bg-[var(--pos-surface)] px-1.5 py-px text-[9px] font-bold tracking-wider text-[var(--pos)]">
                            NEW
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--muted)] sm:hidden">{item.site}</div>
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-[var(--text-2)]">{item.country}</td>
                    <td className="hidden px-3 py-2 align-top text-[var(--text-2)] sm:table-cell">{item.site}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right align-top font-mono text-[var(--ink)]">
                      {item.position}
                      {kind && <span className="text-[var(--muted)]"> · {kind}</span>}
                    </td>
                    <td className="px-3 py-2 text-right align-top font-mono text-[var(--text-2)]">
                      {item.volume === null ? '—' : item.volume.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {list.length > INITIAL_ROWS && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="self-start flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <ChevronDown size={14} />
            Show all {list.length}
          </button>
        )}
      </>
    )
  }

  return (
    <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="font-display text-[15px] tracking-wider text-[var(--ink)]">Other ranking keywords · not tracked</h2>
        {loaded.status === 'ready' && loaded.completedAt && (
          <span className="font-mono text-[11px] text-[var(--muted)]">
            As of {formatDisplayDate(loaded.completedAt.slice(0, 10))} · from Ahrefs, monthly
          </span>
        )}
      </div>
      <p className="max-w-3xl text-[12px] leading-relaxed text-[var(--muted)]">
        Keywords Ahrefs has seen these sites rank for in the top 100 that aren't in the tracked list. Ahrefs re-checks
        these less often than the weekly tracker, so a position can be a few weeks old.
      </p>
      {body}
    </section>
  )
}
