import { useState, useCallback, useMemo, useEffect } from 'react'
import { Routes, Route, Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom'
import type { AppState, RankingRecord, Snapshot } from './types'
import { BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND } from './lib/brands'
import {
  countBrands, extractSnapshotDate, formatDisplayDate,
} from './lib/parser'
import { loadSnapshots, upsertSnapshot } from './lib/storage'

import { Sidebar }      from './components/Sidebar'
import { Topbar }       from './components/Topbar'
import { UploadModal }  from './components/UploadModal'
import { ToastContainer } from './components/Toast'
import type { ToastItem } from './types'

import { RankingReports } from './pages/RankingReports'
import type { RROutletContext } from './pages/RankingReports'
import { BPSites }      from './pages/BPSites'
import { Screenshots }  from './pages/Screenshots'
import { GMB }          from './pages/GMB'
import { FTDs }         from './pages/FTDs'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBrandRecords(brandName: string, records: RankingRecord[]): RankingRecord[] {
  const brand = BRAND_BY_NAME[brandName]
  if (!brand) return []
  const set = new Set(brand.domains.map((d) => d.toLowerCase()))
  return records.filter((r) => set.has(r.domain.toLowerCase()))
}

function getCountries(brandName: string, records: RankingRecord[]): string[] {
  return [...new Set(getBrandRecords(brandName, records).map((r) => r.country))].sort()
}

function getDomains(brandName: string, records: RankingRecord[]): string[] {
  const brand = BRAND_BY_NAME[brandName]
  const found = [...new Set(getBrandRecords(brandName, records).map((r) => r.domain.toLowerCase()))]
  return found.sort((a, b) => {
    if (a === brand.mainDomain.toLowerCase()) return -1
    if (b === brand.mainDomain.toLowerCase()) return 1
    return a.localeCompare(b)
  })
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL: AppState = {
  snapshots:         [],
  activeSnapshotId:  null,
  activeBrand:       null,
  activeCountries:   [],
  activeDomains:     [],
  kwFilter:          '',
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function Layout() {
  const [state, setState] = useState<AppState>(INITIAL)
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload]   = useState(false)
  const [toasts, setToasts]           = useState<ToastItem[]>([])
  const [bpFilterBrand, setBPFilterBrand] = useState<string | null>(null)
  const navigate = useNavigate()

  const addToast = useCallback((message: string, type: ToastItem['type'] = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // ── Initial load from Supabase ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    loadSnapshots()
      .then((snaps) => {
        if (cancelled) return
        setState((s) => ({
          ...s,
          snapshots:        snaps,
          activeSnapshotId: snaps[0]?.id ?? null,
        }))
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load snapshots:', err)
        addToast(`Load failed: ${err.message ?? err}`, 'error')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [addToast])

  const activeSnapshot: Snapshot | undefined = useMemo(() => {
    if (!state.snapshots.length) return undefined
    return state.snapshots.find((s) => s.id === state.activeSnapshotId) ?? state.snapshots[0]
  }, [state.snapshots, state.activeSnapshotId])

  const activeRecords = activeSnapshot?.records ?? []

  // ── Import ────────────────────────────────────────────────────────────────

  const handleImport = useCallback(async (records: RankingRecord[]) => {
    const rawDate     = extractSnapshotDate(records)
    const displayDate = formatDisplayDate(rawDate)
    const newId       = `snap-${rawDate || Date.now()}`
    const newSnap: Snapshot = { id: newId, rawDate, displayDate, records }

    try {
      await upsertSnapshot(newSnap)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Save failed: ${msg}`, 'error')
      return
    }

    setState((s) => {
      const existing = s.snapshots.findIndex((snap) => snap.rawDate === rawDate)
      const nextSnapshots =
        existing >= 0
          ? s.snapshots.map((snap, i) => (i === existing ? newSnap : snap))
          : [newSnap, ...s.snapshots]
      const brandName = s.activeBrand
      return {
        ...s,
        snapshots:        nextSnapshots,
        activeSnapshotId: newId,
        activeCountries:  brandName ? getCountries(brandName, records) : [],
        activeDomains:    brandName ? getDomains(brandName, records) : [],
        kwFilter:         '',
      }
    })

    setShowUpload(false)
    const brandCount = countBrands(records, DOMAIN_TO_BRAND)
    addToast(`✓ Imported ${records.length} records across ${brandCount} brands — ${displayDate}`)
  }, [addToast])

  // ── Snapshot ──────────────────────────────────────────────────────────────

  const selectSnapshot = useCallback((id: string) => {
    setState((s) => {
      const snap = s.snapshots.find((sn) => sn.id === id)
      if (!snap) return s
      return {
        ...s,
        activeSnapshotId: id,
        activeCountries: s.activeBrand ? getCountries(s.activeBrand, snap.records) : [],
        activeDomains:   s.activeBrand ? getDomains(s.activeBrand, snap.records) : [],
        kwFilter: '',
      }
    })
  }, [])

  // ── Navigation ────────────────────────────────────────────────────────────

  const selectOverview = useCallback(() => {
    setState((s) => ({ ...s, activeBrand: null, activeCountries: [], activeDomains: [], kwFilter: '' }))
  }, [])

  const selectBrand = useCallback((brandName: string) => {
    setState((s) => {
      const records = activeSnapshot?.records ?? []
      return {
        ...s,
        activeBrand:     brandName,
        activeCountries: getCountries(brandName, records),
        activeDomains:   getDomains(brandName, records),
        kwFilter:        '',
      }
    })
    navigate('/ranking-reports')
  }, [activeSnapshot, navigate])

  // ── Filter ────────────────────────────────────────────────────────────────

  const toggleCountry = useCallback((country: string) => {
    setState((s) => {
      const active = s.activeCountries
      if (active.includes(country) && active.length === 1) return s
      return {
        ...s,
        activeCountries: active.includes(country)
          ? active.filter((c) => c !== country)
          : [...active, country],
      }
    })
  }, [])

  const toggleDomain = useCallback((domain: string) => {
    setState((s) => {
      const active = s.activeDomains
      if (active.includes(domain) && active.length === 1) return s
      return {
        ...s,
        activeDomains: active.includes(domain)
          ? active.filter((d) => d !== domain)
          : [...active, domain],
      }
    })
  }, [])

  const setKwFilter = useCallback((val: string) => {
    setState((s) => ({ ...s, kwFilter: val }))
  }, [])

  // ── Derived ───────────────────────────────────────────────────────────────

  const visibleRecords = useMemo(
    () => state.activeBrand ? getBrandRecords(state.activeBrand, activeRecords) : activeRecords,
    [state.activeBrand, activeRecords],
  )

  const availableCountries = useMemo(
    () => state.activeBrand ? getCountries(state.activeBrand, activeRecords) : [],
    [state.activeBrand, activeRecords],
  )
  const availableDomains = useMemo(
    () => state.activeBrand ? getDomains(state.activeBrand, activeRecords) : [],
    [state.activeBrand, activeRecords],
  )

  const location       = useLocation()
  const activeBrandObj = state.activeBrand ? BRAND_BY_NAME[state.activeBrand] : null

  const SECTION_TITLES: Record<string, [string, string]> = {
    '/ranking-reports': [activeBrandObj?.name ?? 'Ranking Reports', activeBrandObj?.mainDomain ?? 'All brands overview'],
    '/bp-sites':        ['BP Sites', 'Brand website management'],
    '/screenshots':     ['Screenshots', 'Visual site monitoring'],
    '/gmb':             ['GMB', 'Google My Business'],
    '/ftds':            ['FTDs', 'First-time depositors'],
  }
  const currentPath = Object.keys(SECTION_TITLES).find((p) => location.pathname.startsWith(p)) ?? '/bp-sites'
  const [topbarTitle, topbarDomain] = SECTION_TITLES[currentPath]

  const rrContext: RROutletContext = {
    snapshots:         state.snapshots,
    activeSnapshotId:  state.activeSnapshotId,
    activeBrand:       state.activeBrand,
    activeCountries:   state.activeCountries,
    activeDomains:     state.activeDomains,
    kwFilter:          state.kwFilter,
    activeRecords,
    visibleRecords,
    availableCountries,
    availableDomains,
    onSelectSnapshot:  selectSnapshot,
    onSelectBrand:     selectBrand,
    onSelectOverview:  selectOverview,
    onToggleCountry:   toggleCountry,
    onToggleDomain:    toggleDomain,
    onKwFilter:        setKwFilter,
    onOpenUpload:      () => setShowUpload(true),
    bpFilterBrand,
    onSelectBPBrand:   setBPFilterBrand,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#07090F] text-[#64748B] font-mono text-[12px] tracking-wider">
        Loading rankings…
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#07090F] relative">
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(#1C2B3A 1px, transparent 1px), linear-gradient(90deg, #1C2B3A 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <Sidebar
        brands={BRANDS}
        records={activeRecords}
        activeBrand={state.activeBrand}
        uploadDate={activeSnapshot?.displayDate ?? null}
        onSelectBrand={selectBrand}
        onSelectOverview={selectOverview}
        onOpenUpload={() => setShowUpload(true)}
        activeBPBrand={bpFilterBrand}
        onSelectBPBrand={setBPFilterBrand}
      />

      <div className="flex flex-col flex-1 min-w-0 relative z-10 overflow-hidden">
        <Topbar
          brandName={topbarTitle}
          domain={topbarDomain}
          uploadDate={activeSnapshot?.displayDate ?? null}
        />

        <Outlet context={rrContext} />
      </div>

      {showUpload && (
        <UploadModal onImport={handleImport} onClose={() => setShowUpload(false)} />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/bp-sites" replace />} />
        <Route path="/bp-sites" element={<BPSites />} />
        <Route path="/ranking-reports" element={<RankingReports />} />
        <Route path="/screenshots"     element={<Screenshots />} />
        <Route path="/gmb"             element={<GMB />} />
        <Route path="/ftds"            element={<FTDs />} />
      </Route>
    </Routes>
  )
}
