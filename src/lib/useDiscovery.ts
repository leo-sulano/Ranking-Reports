import { useEffect, useState } from 'react'
import type { Brand } from '../types'
import { brandCountries } from './brands'
import { loadDiscoveryFetches, loadDiscoveryRows, type DiscoveryRow } from './keywordDiscovery'
import { completeCycles, cycleCompletedAt, newEligibility, previousCycle } from './discoveryList'

/** One brand's ranking keywords from Ahrefs' index: the newest complete cycle, and the one before for NEW. */
export type DiscoveryLoad =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status:      'ready'
      /** The cycle shown; null until every one of the brand's sites has been fetched once. */
      shown:       string | null
      completedAt: string | null
      rows:        DiscoveryRow[]
      prevRows:    DiscoveryRow[]
      newEligible: (country: string) => boolean
    }

/**
 * Loads the brand's ranking keywords once per brand, for both the rows that
 * join its BP table and the other-countries list under it. Design:
 * docs/superpowers/specs/2026-11-25-all-countries-keywords-design.md
 */
export function useDiscovery(brand: Brand): DiscoveryLoad {
  const [loaded, setLoaded] = useState<DiscoveryLoad>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setLoaded({ status: 'loading' })
    ;(async () => {
      try {
        const fetches = await loadDiscoveryFetches(brand.domains)
        // A cycle is complete once every site has an ALL fetch, or (older
        // cycles) a fetch for each of the brand's markets.
        const shown = completeCycles(brand.domains, fetches, brandCountries(brand))[0] ?? null
        const prev = shown ? previousCycle(shown, brand.domains, fetches) : null
        const rows = await loadDiscoveryRows(brand.domains, [shown, prev].filter((c): c is string => c !== null))
        if (cancelled) return
        setLoaded({
          status:      'ready',
          shown,
          completedAt: shown ? cycleCompletedAt(shown, brand.domains, fetches) : null,
          rows:        rows.filter((r) => r.cycle === shown),
          prevRows:    rows.filter((r) => r.cycle === prev),
          newEligible: newEligibility(prev, brand.domains, fetches),
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

  return loaded
}
