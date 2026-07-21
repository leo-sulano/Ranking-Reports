import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { loadActivityLog } from '../lib/activityLog'
import type { ActivityLogEntry, LogAction, LogSection } from '../lib/activityLog'
import type { RROutletContext } from '../types'

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const datePart = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${datePart}, ${timePart}`
}

const ACTION_STYLES: Record<LogAction, { label: string; bg: string; fg: string }> = {
  upload: { label: 'Upload', bg: '#DCFCE7', fg: '#15803D' },
  edit:   { label: 'Edit',   bg: '#DBEAFE', fg: '#1D4ED8' },
  delete: { label: 'Delete', bg: '#FEE2E2', fg: '#B91C1C' },
}

const SECTION_LABELS: Record<LogSection, string> = {
  'bp-sites': 'BP Sites',
  'lp-sites': 'LP Sites',
  ftds:       'FTDs',
}

export function Log() {
  const { addToast } = useOutletContext<RROutletContext>()
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    loadActivityLog()
      .then((data) => {
        if (cancelled) return
        setEntries(data)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        addToast(`Failed to load activity log: ${formatError(err)}`, 'error')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [addToast])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-[#94A3B8] font-mono text-[12px] tracking-wider">
        Loading activity log…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto px-3 sm:px-7 pb-7 pt-5">
      <h2 className="font-display text-[16px] tracking-wider text-[#0F172A] mb-4">
        Activity Log ({entries.length})
      </h2>
      <div className="border border-[#E2E8F0] rounded-md overflow-hidden">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-[#94A3B8] text-[12px]">No activity yet.</p>
        ) : (
          <div className="divide-y divide-[#F1F5F9]">
            {entries.map((e) => {
              const actionStyle = ACTION_STYLES[e.action]
              return (
                <div key={e.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[9px] uppercase tracking-wide font-bold rounded px-1.5 py-0.5"
                        style={{ background: actionStyle.bg, color: actionStyle.fg }}
                      >
                        {actionStyle.label}
                      </span>
                      <span className="text-[9px] uppercase tracking-wide font-bold text-[#64748B] bg-[#F1F5F9] rounded px-1.5 py-0.5">
                        {SECTION_LABELS[e.section]}
                      </span>
                      <span className="text-[13px] font-semibold text-[#0F172A]">{e.email}</span>
                    </div>
                    <div className="text-[12px] text-[#334155] break-words">{e.summary}</div>
                  </div>
                  <div className="text-[11px] font-mono text-[#94A3B8] whitespace-nowrap shrink-0">
                    {formatDateTime(e.createdAt)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
