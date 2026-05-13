import { useOutletContext } from 'react-router-dom'
import type { RankingRecord, Snapshot } from '../types'
import { BRANDS, BRAND_BY_NAME } from '../lib/brands'
import { parsePosition, parseChange } from '../lib/parser'

import { StatsRow }     from '../components/StatsRow'
import { FilterBar }    from '../components/FilterBar'
import { SnapshotTabs } from '../components/SnapshotTabs'
import { OverviewGrid } from '../components/OverviewGrid'
import { RankingTable } from '../components/RankingTable'

export interface RROutletContext {
  snapshots: Snapshot[]
  activeSnapshotId: string | null
  activeBrand: string | null
  activeCountries: string[]
  activeDomains: string[]
  kwFilter: string
  activeRecords: RankingRecord[]
  visibleRecords: RankingRecord[]
  availableCountries: string[]
  availableDomains: string[]
  onSelectSnapshot: (id: string) => void
  onSelectBrand: (name: string) => void
  onSelectOverview: () => void
  bpFilterBrand: string | null
  onSelectBPBrand: (name: string | null) => void
  onToggleCountry: (c: string) => void
  onToggleDomain: (d: string) => void
  onKwFilter: (v: string) => void
  onOpenUpload: () => void
  onDeleteSnapshot: (id: string) => void
}

function computeStats(records: RankingRecord[]) {
  return {
    total:      records.length,
    top3:       records.filter((r) => { const p = parsePosition(r.position); return typeof p === 'number' && p <= 3 }).length,
    improved:   records.filter((r) => (parseChange(r.change) ?? 0) > 0).length,
    dropped:    records.filter((r) => (parseChange(r.change) ?? 0) < 0).length,
    notRanking: records.filter((r) => parsePosition(r.position) === 'NR').length,
  }
}

export function RankingReports() {
  const ctx = useOutletContext<RROutletContext>()
  const {
    snapshots, activeSnapshotId, activeBrand,
    activeCountries, activeDomains, kwFilter,
    activeRecords, visibleRecords, availableCountries, availableDomains,
    onSelectSnapshot, onSelectBrand, onSelectOverview,
    onToggleCountry, onToggleDomain, onKwFilter, onOpenUpload,
  } = ctx

  const stats         = computeStats(visibleRecords)
  const activeBrandObj = activeBrand ? BRAND_BY_NAME[activeBrand] : null
  const brandColor     = activeBrandObj?.color ?? '#F59E0B'

  return (
    <>
      <StatsRow
        total={stats.total}
        top3={stats.top3}
        improved={stats.improved}
        dropped={stats.dropped}
        notRanking={stats.notRanking}
      />

      {snapshots.length > 0 && (
        <SnapshotTabs
          snapshots={snapshots}
          activeId={activeSnapshotId}
          onSelect={onSelectSnapshot}
        />
      )}

      {activeBrand && (
        <FilterBar
          countries={availableCountries}
          domains={availableDomains}
          activeCountries={activeCountries}
          activeDomains={activeDomains}
          kwFilter={kwFilter}
          brandColor={brandColor}
          onToggleCountry={onToggleCountry}
          onToggleDomain={onToggleDomain}
          onKwFilter={onKwFilter}
        />
      )}

      <div className="flex-1 overflow-auto px-7 pb-7">
        {activeBrand === null ? (
          activeRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4">
              <div className="text-5xl opacity-30">📊</div>
              <div className="font-display text-[28px] tracking-wider text-[#94A3B8]">No Data Yet</div>
              <p className="text-[14px] text-[#64748B] max-w-sm leading-relaxed">
                Upload your ranking data export to start tracking keyword positions across all
                brands and locations.
              </p>
              <button
                onClick={onOpenUpload}
                className="mt-2 px-6 py-2.5 bg-[#F59E0B] text-black rounded-md text-[14px] font-bold hover:bg-[#FBB03B] transition-colors"
              >
                Import Ranking Data
              </button>
            </div>
          ) : (
            <OverviewGrid
              brands={BRANDS}
              records={activeRecords}
              onSelectBrand={onSelectBrand}
            />
          )
        ) : (
          activeBrandObj && (
            <RankingTable
              brand={activeBrandObj}
              records={visibleRecords}
              activeCountries={activeCountries}
              activeDomains={activeDomains}
              kwFilter={kwFilter}
            />
          )
        )}
      </div>
    </>
  )
}
