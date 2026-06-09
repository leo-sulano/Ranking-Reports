import { useState, useCallback, useMemo, useEffect } from 'react'
import { Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { AuthGate } from './components/AuthGate'
import type { AppState, RROutletContext, RankingRecord, Snapshot, EditCellMatcher, EditCellPatch } from './types'
import type { CategoryId } from './lib/categories'
import type { UnknownDomain, ParsedSnapshot } from './lib/parser'
import { DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND } from './lib/brands'
import {
  summarizeRecords, formatDisplayDate, applyCarryForward,
} from './lib/parser'
import { loadSnapshots, upsertSnapshot, deleteSnapshot, updateRecordFields } from './lib/storage'

import { Sidebar }       from './components/Sidebar'
import { Topbar }        from './components/Topbar'
import { UploadModal }   from './components/UploadModal'
import { UploadSummary } from './components/UploadSummary'
import type { UploadSummaryData } from './components/UploadSummary'
import { DuplicateWarning } from './components/DuplicateWarning'
import { ToastContainer } from './components/Toast'
import { AssistantBubble } from './components/Assistant/AssistantBubble'
import type { ToastItem } from './types'

import { Home }         from './pages/Home'
import { BPSites }      from './pages/BPSites'
import { LPSites }      from './pages/LPSites'
import { FTDs }         from './pages/FTDs'
import { AskAI }        from './pages/AskAI'

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
  const [duplicateWarning, setDuplicateWarning] = useState<{ existing: Snapshot; pendingRecords: RankingRecord[]; unknownDomains: UnknownDomain[] } | null>(null)
  const [toasts, setToasts]           = useState<ToastItem[]>([])
  const [bpFilterBrand, setBPFilterBrand] = useState<string | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Bulk-import (matrix-format) progress overlay. null when not importing.
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

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
        // Store the RAW snapshots — carry-forward is applied in a useMemo
        // derived from this state, so edits can re-propagate downstream.
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

  // Derived view: snapshots with GSV / SV / AFF carry-forward applied. Kept
  // separate from raw state so live edits re-propagate downstream.
  const viewSnapshots: Snapshot[] = useMemo(
    () => applyCarryForward(state.snapshots),
    [state.snapshots],
  )

  const activeSnapshot: Snapshot | undefined = useMemo(() => {
    if (!viewSnapshots.length) return undefined
    return viewSnapshots.find((s) => s.id === state.activeSnapshotId) ?? viewSnapshots[0]
  }, [viewSnapshots, state.activeSnapshotId])

  // ── Import ────────────────────────────────────────────────────────────────

  // Low-level persist for ONE snapshot. Wipes any existing snapshot for the
  // same (category, rawDate) via upsertSnapshot's delete-cascade-insert.
  // Updates local state on success. Does NOT show toasts / summary — callers
  // decide how to surface the outcome.
  const persistOneSnapshot = useCallback(async (
    parsed: ParsedSnapshot,
    category: CategoryId,
  ): Promise<Snapshot | null> => {
    const { rawDate, records } = parsed
    const displayDate = formatDisplayDate(rawDate)
    const newId       = `snap-${category}-${rawDate || Date.now()}`
    const newSnap: Snapshot = { id: newId, category, rawDate, displayDate, records }

    try {
      await upsertSnapshot(newSnap)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Save failed (${displayDate}): ${msg}`, 'error')
      return null
    }

    setState((s) => {
      const filtered = s.snapshots.filter((sn) => !(sn.category === category && sn.rawDate === rawDate))
      // Keep snapshots sorted newest-first by rawDate.
      const next = [newSnap, ...filtered].sort((a, b) =>
        (a.rawDate < b.rawDate ? 1 : a.rawDate > b.rawDate ? -1 : 0),
      )
      // Carry-forward is applied in the derived useMemo; state stays raw.
      return {
        ...s,
        snapshots:        next,
        activeSnapshotId: s.activeSnapshotId ?? newId,
      }
    })

    return newSnap
  }, [addToast])

  const reportUnknownDomains = useCallback((unknownDomains: UnknownDomain[]) => {
    const skipped = unknownDomains.reduce((s, u) => s + u.count, 0)
    if (skipped === 0) return
    const list = unknownDomains.slice(0, 3).map((u) => u.domain).join(', ')
    const more = unknownDomains.length > 3 ? ` +${unknownDomains.length - 3} more` : ''
    addToast(
      `⚠ ${skipped} row${skipped !== 1 ? 's' : ''} skipped — domain not part of Rooster: ${list}${more}`,
      'warning',
    )
  }, [addToast])

  const handleImport = useCallback(async (
    snapshots:      ParsedSnapshot[],
    category:       CategoryId,
    unknownDomains: UnknownDomain[],
  ) => {
    if (snapshots.length === 0) return

    // Single-snapshot path (flat-format upload) — preserve duplicate-warning UX.
    if (snapshots.length === 1) {
      const parsed = snapshots[0]
      const dupe = state.snapshots.find((s) => s.category === category && s.rawDate === parsed.rawDate)
      if (dupe) {
        setShowUpload(false)
        setDuplicateWarning({ existing: dupe, pendingRecords: parsed.records, unknownDomains })
        return
      }
      const snap = await persistOneSnapshot(parsed, category)
      if (!snap) return
      setShowUpload(false)
      setUploadSummary({ displayDate: snap.displayDate, records: parsed.records, unknownDomains })
      const domainMap = category === 'lp-sites' ? LP_DOMAIN_TO_BRAND : DOMAIN_TO_BRAND
      const counts = summarizeRecords(parsed.records, domainMap)
      addToast(
        `✓ Imported ${parsed.records.length.toLocaleString()} records · ${counts.brands} brand${counts.brands !== 1 ? 's' : ''} · ${counts.sites} site${counts.sites !== 1 ? 's' : ''} · ${counts.keywords} keyword${counts.keywords !== 1 ? 's' : ''} — ${snap.displayDate}`,
      )
      reportUnknownDomains(unknownDomains)
      return
    }

    // Multi-snapshot bulk path (matrix-format upload). Replace any existing
    // (category, rawDate) silently — no per-snapshot dupe modal.
    setShowUpload(false)
    setBulkProgress({ done: 0, total: snapshots.length })

    let okCount = 0
    let totalRecords = 0
    const aggregateRecords: RankingRecord[] = []
    for (let i = 0; i < snapshots.length; i++) {
      const snap = await persistOneSnapshot(snapshots[i], category)
      if (snap) {
        okCount++
        totalRecords += snapshots[i].records.length
        aggregateRecords.push(...snapshots[i].records)
      }
      setBulkProgress({ done: i + 1, total: snapshots.length })
    }
    setBulkProgress(null)

    const domainMap = category === 'lp-sites' ? LP_DOMAIN_TO_BRAND : DOMAIN_TO_BRAND
    const counts = summarizeRecords(aggregateRecords, domainMap)
    addToast(
      `✓ Imported ${okCount} snapshot${okCount !== 1 ? 's' : ''} · ${counts.brands} brand${counts.brands !== 1 ? 's' : ''} · ${counts.sites} site${counts.sites !== 1 ? 's' : ''} · ${counts.keywords} keyword${counts.keywords !== 1 ? 's' : ''} — ${totalRecords.toLocaleString()} records total`,
    )
    reportUnknownDomains(unknownDomains)
  }, [addToast, persistOneSnapshot, reportUnknownDomains, state.snapshots])

  const handleReplaceDuplicate = useCallback(async () => {
    if (!duplicateWarning) return
    const { existing, pendingRecords, unknownDomains } = duplicateWarning
    setDuplicateWarning(null)
    try {
      await deleteSnapshot(existing.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Delete failed: ${msg}`, 'error')
      return
    }
    setState((s) => ({ ...s, snapshots: s.snapshots.filter((sn) => sn.id !== existing.id) }))
    const snap = await persistOneSnapshot(
      { rawDate: existing.rawDate, records: pendingRecords },
      existing.category,
    )
    if (!snap) return
    setUploadSummary({ displayDate: snap.displayDate, records: pendingRecords, unknownDomains })
    const domainMap = existing.category === 'lp-sites' ? LP_DOMAIN_TO_BRAND : DOMAIN_TO_BRAND
    const counts = summarizeRecords(pendingRecords, domainMap)
    addToast(
      `✓ Imported ${pendingRecords.length.toLocaleString()} records · ${counts.brands} brand${counts.brands !== 1 ? 's' : ''} · ${counts.sites} site${counts.sites !== 1 ? 's' : ''} · ${counts.keywords} keyword${counts.keywords !== 1 ? 's' : ''} — ${snap.displayDate}`,
    )
    reportUnknownDomains(unknownDomains)
  }, [addToast, duplicateWarning, persistOneSnapshot, reportUnknownDomains])

  // ── Inline-edit GSV / SV / AFF ────────────────────────────────────────────
  const handleEditCell = useCallback(async (
    snapshotId: string,
    matcher:    EditCellMatcher,
    patch:      EditCellPatch,
  ) => {
    try {
      await updateRecordFields(snapshotId, matcher, patch)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast(`Edit failed: ${msg}`, 'error')
      return
    }
    setState((s) => {
      const next = s.snapshots.map((snap) => {
        if (snap.id !== snapshotId) return snap
        const records = snap.records.map((r) => {
          if (matcher.keyword && r.keyword !== matcher.keyword) return r
          if (matcher.domain  && r.domain  !== matcher.domain)  return r
          if (matcher.country && r.country !== matcher.country) return r
          const np: RankingRecord = { ...r }
          if ('searchVolume'       in patch) np.searchVolume       = patch.searchVolume       ?? ''
          if ('affiliateUrl'       in patch) np.affiliateUrl       = patch.affiliateUrl       ?? ''
          if ('globalSearchVolume' in patch) np.globalSearchVolume = patch.globalSearchVolume ?? ''
          return np
        })
        return { ...snap, records }
      })
      // Carry-forward is applied in the derived useMemo. The raw state only
      // reflects the edited snapshot; downstream propagation happens in the
      // view layer.
      return { ...s, snapshots: next }
    })
  }, [addToast])

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

  const activeCategory: CategoryId = location.pathname.startsWith('/lp-sites') ? 'lp-sites' : 'bp-sites'

  const SECTION_TITLES: Record<string, [string, string]> = {
    '/bp-sites':    ['BP Sites', 'Brand website ranking report'],
    '/lp-sites':    ['LP Sites', 'Landing page ranking report'],
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
    snapshots:         viewSnapshots,
    activeSnapshotId:  state.activeSnapshotId,
    onSelectSnapshot:  selectSnapshot,
    onOpenUpload:      () => setShowUpload(true),
    onDeleteSnapshot:  handleDeleteSnapshot,
    onEditCell:        handleEditCell,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#F7F7F5] text-[#ABABAA] font-mono text-[12px] tracking-wider">
        Loading rankings…
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F7F7F5] relative">
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(#E5E4DF 1px, transparent 1px), linear-gradient(90deg, #E5E4DF 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <Sidebar
        uploadDate={activeSnapshot?.displayDate ?? null}
        onOpenUpload={() => setShowUpload(true)}
        activeBPBrand={bpFilterBrand}
        onSelectBPBrand={setBPFilterBrand}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="flex flex-col flex-1 min-w-0 relative z-10 overflow-hidden">
        <Topbar
          brandName={topbarTitle}
          domain={topbarDomain}
          onMenuToggle={() => setMobileNavOpen((v) => !v)}
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

      {bulkProgress && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white border border-[#E5E4DF] rounded-2xl w-[420px] max-w-[95vw] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.12)]">
            <h2 className="font-display text-[16px] tracking-wider text-[#0A0A0A] mb-4">
              Bulk import in progress
            </h2>
            <div className="h-[5px] bg-[#F0EFEA] rounded-full overflow-hidden mb-3">
              <div
                className="h-full rounded-full transition-[width] duration-150"
                style={{
                  width: `${Math.round((bulkProgress.done / bulkProgress.total) * 100)}%`,
                  background: 'linear-gradient(90deg, #0A0A0A 0%, #CC0000 50%, #FFCC00 100%)',
                }}
              />
            </div>
            <p className="text-center text-[12px] text-[#ABABAA]">
              Saving snapshot {bulkProgress.done} of {bulkProgress.total}…
            </p>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {location.pathname !== '/ask-ai' && (
        <AssistantBubble snapshots={viewSnapshots} category={activeCategory} />
      )}
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="/bp-sites"                          element={<BPSites />} />
          <Route path="/bp-sites/:brandSlug"               element={<BPSites />} />
          <Route path="/bp-sites/:brandSlug/:domainFilter" element={<BPSites />} />
          <Route path="/lp-sites"                          element={<LPSites />} />
          <Route path="/lp-sites/:brandSlug"               element={<LPSites />} />
          <Route path="/lp-sites/:brandSlug/:domainFilter" element={<LPSites />} />
          <Route path="/ftds"        element={<FTDs />} />
          <Route path="/ask-ai"      element={<AskAI />} />
        </Route>
      </Routes>
    </AuthGate>
  )
}
