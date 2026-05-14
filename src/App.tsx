import { useState, useCallback, useMemo, useEffect } from 'react'
import { Routes, Route, Outlet, useLocation } from 'react-router-dom'
import type { AppState, RROutletContext, RankingRecord, Snapshot } from './types'
import type { CategoryId } from './lib/categories'
import { DOMAIN_TO_BRAND } from './lib/brands'
import {
  countBrands, extractSnapshotDate, formatDisplayDate,
} from './lib/parser'
import { loadSnapshots, upsertSnapshot, deleteSnapshot } from './lib/storage'

import { Sidebar }       from './components/Sidebar'
import { Topbar }        from './components/Topbar'
import { UploadModal }   from './components/UploadModal'
import { UploadSummary } from './components/UploadSummary'
import type { UploadSummaryData } from './components/UploadSummary'
import { DuplicateWarning } from './components/DuplicateWarning'
import { ToastContainer } from './components/Toast'
import type { ToastItem } from './types'

import { Home }         from './pages/Home'
import { BPSites }      from './pages/BPSites'
import { FTDs }         from './pages/FTDs'

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL: AppState = {
  snapshots:         [],
  activeSnapshotId:  null,
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function Layout() {
  const [state, setState] = useState<AppState>(INITIAL)
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload]   = useState(false)
  const [uploadSummary, setUploadSummary] = useState<UploadSummaryData | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<{ existing: Snapshot; pendingRecords: RankingRecord[] } | null>(null)
  const [toasts, setToasts]           = useState<ToastItem[]>([])
  const [bpFilterBrand, setBPFilterBrand] = useState<string | null>(null)

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

  // ── Import ────────────────────────────────────────────────────────────────

  const persistSnapshot = useCallback(async (records: RankingRecord[], category: CategoryId) => {
    const rawDate     = extractSnapshotDate(records)
    const displayDate = formatDisplayDate(rawDate)
    const newId       = `snap-${category}-${rawDate || Date.now()}`
    const newSnap: Snapshot = { id: newId, category, rawDate, displayDate, records }

    try {
      await upsertSnapshot(newSnap)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Save failed: ${msg}`, 'error')
      return
    }

    setState((s) => {
      const filtered = s.snapshots.filter((sn) => !(sn.category === category && sn.rawDate === rawDate))
      return {
        ...s,
        snapshots:        [newSnap, ...filtered],
        activeSnapshotId: newId,
      }
    })

    setShowUpload(false)
    setUploadSummary({ displayDate, records })
    const brandCount = countBrands(records, DOMAIN_TO_BRAND)
    addToast(`✓ Imported ${records.length} records across ${brandCount} brands — ${displayDate}`)
  }, [addToast])

  const handleImport = useCallback(async (records: RankingRecord[], category: CategoryId) => {
    const rawDate = extractSnapshotDate(records)
    const dupe = state.snapshots.find((s) => s.category === category && s.rawDate === rawDate)
    if (dupe) {
      setShowUpload(false)
      setDuplicateWarning({ existing: dupe, pendingRecords: records })
      return
    }
    await persistSnapshot(records, category)
  }, [persistSnapshot, state.snapshots])

  const handleReplaceDuplicate = useCallback(async () => {
    if (!duplicateWarning) return
    const { existing, pendingRecords } = duplicateWarning
    setDuplicateWarning(null)
    try {
      await deleteSnapshot(existing.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Delete failed: ${msg}`, 'error')
      return
    }
    setState((s) => ({ ...s, snapshots: s.snapshots.filter((sn) => sn.id !== existing.id) }))
    await persistSnapshot(pendingRecords, existing.category)
  }, [addToast, duplicateWarning, persistSnapshot])

  const handleDeleteSnapshot = useCallback(async (id: string) => {
    const snap = state.snapshots.find((s) => s.id === id)
    if (!snap) return
    if (!window.confirm(`Delete snapshot for ${snap.displayDate}? This cannot be undone.`)) return

    try {
      await deleteSnapshot(id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Delete failed: ${msg}`, 'error')
      return
    }

    setState((s) => {
      const nextSnapshots = s.snapshots.filter((sn) => sn.id !== id)
      return {
        ...s,
        snapshots:        nextSnapshots,
        activeSnapshotId: s.activeSnapshotId === id ? (nextSnapshots[0]?.id ?? null) : s.activeSnapshotId,
      }
    })

    addToast(`✓ Deleted snapshot for ${snap.displayDate}`)
  }, [addToast, state.snapshots])

  // ── Snapshot ──────────────────────────────────────────────────────────────

  const selectSnapshot = useCallback((id: string) => {
    setState((s) => {
      const snap = s.snapshots.find((sn) => sn.id === id)
      if (!snap) return s
      return { ...s, activeSnapshotId: id }
    })
  }, [])

  // ── Topbar title ──────────────────────────────────────────────────────────

  const location = useLocation()

  const SECTION_TITLES: Record<string, [string, string]> = {
    '/bp-sites':    ['BP Sites', 'Brand website ranking report'],
    '/ftds':        ['FTDs', 'First-time depositors'],
  }
  const currentPath =
    location.pathname === '/'
      ? null
      : Object.keys(SECTION_TITLES).find((p) => location.pathname.startsWith(p)) ?? null
  const [topbarTitle, topbarDomain] = currentPath
    ? SECTION_TITLES[currentPath]
    : ['Ranking Reports', 'Command center · Rooster Partners']

  const rrContext: RROutletContext = {
    snapshots:         state.snapshots,
    activeSnapshotId:  state.activeSnapshotId,
    onSelectSnapshot:  selectSnapshot,
    onOpenUpload:      () => setShowUpload(true),
    onDeleteSnapshot:  handleDeleteSnapshot,
    bpFilterBrand,
    onSelectBPBrand:   setBPFilterBrand,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#F8FAFC] text-[#64748B] font-mono text-[12px] tracking-wider">
        Loading rankings…
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC] relative">
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(#E2E8F0 1px, transparent 1px), linear-gradient(90deg, #E2E8F0 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <Sidebar
        uploadDate={activeSnapshot?.displayDate ?? null}
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

      {uploadSummary && (
        <UploadSummary data={uploadSummary} onClose={() => setUploadSummary(null)} />
      )}

      {duplicateWarning && (
        <DuplicateWarning
          data={{ existing: duplicateWarning.existing }}
          onClose={() => setDuplicateWarning(null)}
          onDelete={handleReplaceDuplicate}
        />
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
        <Route index element={<Home />} />
        <Route path="/bp-sites"    element={<BPSites />} />
        <Route path="/ftds"        element={<FTDs />} />
      </Route>
    </Routes>
  )
}
