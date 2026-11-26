import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Brand, RankingRecord } from '../types'
import { DOMAIN_TO_BRAND, brandCountries } from '../lib/brands'
import { formatDisplayDate } from '../lib/parser'
import { trackedIndex } from '../lib/keywordDiscovery'
import { buildDiscoveryList, positionKindLabel } from '../lib/discoveryList'
import type { DiscoveryLoad } from '../lib/useDiscovery'

/**
 * "Ranking in other countries · not tracked" — under the matrix on a BP Sites
 * brand page. Countries outside the brand's markets where the monthly Ahrefs
 * job (api/cron-discovery.ts) found its sites ranking, minus what the newest
 * snapshot tracks. Keywords in the brand's markets join the table instead.
 * Design: docs/superpowers/specs/2026-11-25-all-countries-keywords-design.md
 */

const INITIAL_ROWS = 25

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url)

/** "Norway" for "NO"; the code itself when the browser can't name it. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export function OtherRankingKeywords({
  brand,
  discovery: loaded,
  trackedRecords,
  kwFilter,
  kwExact,
}: {
  brand:           Brand
  /** The page's single load of the brand's ranking keywords (useDiscovery). */
  discovery:       DiscoveryLoad
  /** The brand's records in the newest BP snapshot: what is tracked now. */
  trackedRecords:  readonly RankingRecord[]
  kwFilter:        string
  kwExact:         boolean
}) {
  const [showAll, setShowAll] = useState(false)
  useEffect(() => setShowAll(false), [brand])

  const tracked = useMemo(() => trackedIndex(trackedRecords, DOMAIN_TO_BRAND), [trackedRecords])
  // Outside the brand's markets, whatever the page's Countries chips show:
  // the chips only hold the markets, whose keywords join the table.
  const isOther = useMemo(() => {
    const markets = brandCountries(brand)
    return (country: string) => !markets.includes(country)
  }, [brand])

  const list = useMemo(() => {
    if (loaded.status !== 'ready') return []
    return buildDiscoveryList({
      rows: loaded.rows, prevRows: loaded.prevRows, newEligible: loaded.newEligible, tracked, brand,
      country: isOther, kwFilter, kwExact,
    })
  }, [loaded, tracked, brand, isOther, kwFilter, kwExact])

  // Tells "everything is tracked" apart from "the filters hide everything".
  const untrackedTotal = useMemo(() => {
    if (loaded.status !== 'ready') return 0
    return buildDiscoveryList({
      rows: loaded.rows, prevRows: loaded.prevRows, newEligible: loaded.newEligible, tracked, brand,
      country: isOther, kwFilter: '', kwExact: false,
    }).length
  }, [loaded, tracked, brand, isOther])

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
        {untrackedTotal === 0 ? "Ahrefs' index shows no rankings in other countries for these sites." : 'Nothing matches the search.'}
      </p>
    )
  } else {
    body = (
      <>
        <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                <th className="px-2 py-2 sm:px-3 font-semibold">Keyword</th>
                <th className="px-2 py-2 sm:px-3 font-semibold">Country</th>
                <th className="hidden px-2 py-2 sm:px-3 font-semibold sm:table-cell">Best site</th>
                <th className="px-2 py-2 sm:px-3 text-right font-semibold">Pos</th>
                <th className="px-2 py-2 sm:px-3 text-right font-semibold">Search vol</th>
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
                    <td className="px-2 py-2 sm:px-3 align-top text-[var(--ink)]">
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
                    <td className="px-2 py-2 sm:px-3 align-top font-mono text-[var(--text-2)]" title={countryName(item.country)}>{item.country}</td>
                    <td className="hidden px-2 py-2 sm:px-3 align-top text-[var(--text-2)] sm:table-cell">{item.site}</td>
                    <td className="px-2 py-2 sm:px-3 text-right align-top font-mono text-[var(--ink)]">
                      <span className="whitespace-nowrap">{item.position}</span>
                      {/* On phones the kind drops under the number, so Search vol stays on screen. */}
                      {kind && (
                        <span className="block whitespace-nowrap text-[10px] text-[var(--muted)] sm:inline sm:text-[12px]">
                          <span className="hidden sm:inline"> · </span>
                          {kind}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 sm:px-3 text-right align-top font-mono text-[var(--text-2)]">
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
        <h2 className="font-display text-[15px] tracking-wider text-[var(--ink)]">Ranking in other countries · not tracked</h2>
        {loaded.status === 'ready' && loaded.completedAt && (
          <span className="font-mono text-[11px] text-[var(--muted)]">
            As of {formatDisplayDate(loaded.completedAt.slice(0, 10))} · from Ahrefs, monthly
          </span>
        )}
      </div>
      <p className="max-w-3xl text-[12px] leading-relaxed text-[var(--muted)]">
        Countries outside this brand's markets where Ahrefs' index shows its sites, the main site included, in Google's
        top 100, and the keywords aren't tracked. From Ahrefs' index, refreshed monthly. It knows fewer keywords than
        Google really shows; Google Search Console is the complete source.
      </p>
      {body}
    </section>
  )
}
