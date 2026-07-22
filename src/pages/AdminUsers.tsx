import { useCallback, useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { Check, RotateCcw, ShieldPlus, ShieldMinus, Trash2 } from 'lucide-react'
import { listUserAccess, updateUserStatus, updateUserAdmin, deleteUser } from '../lib/userAccess'
import type { RROutletContext, UserAccessRow, UserAccessStatus } from '../types'

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return String(err)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function AdminUsers() {
  const { addToast, requireAuth, currentUserId, isAdmin, accessLoading } = useOutletContext<RROutletContext>()
  const [rows, setRows] = useState<UserAccessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  useEffect(() => {
    // Skip the fetch entirely for non-admins (and while access is still
    // resolving) — they're redirected away before this data would ever be
    // shown, so fetching it would be a wasted request that can also flash
    // a stray "Failed to load users" toast for a signed-out visitor.
    if (accessLoading || !isAdmin) return
    let cancelled = false
    listUserAccess()
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        addToast(`Failed to load users: ${formatError(err)}`, 'error')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [addToast, accessLoading, isAdmin])

  const handleSetStatus = useCallback(async (userId: string, status: UserAccessStatus) => {
    setBusyUserId(userId)
    try {
      await requireAuth(() => updateUserStatus(userId, status))
    } catch (err) {
      addToast(`Update failed: ${formatError(err)}`, 'error')
      setBusyUserId(null)
      return
    }
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, status } : r)))
    setBusyUserId(null)
    addToast(status === 'approved' ? '✓ User approved' : '✓ User access revoked')
  }, [addToast, requireAuth])

  const handleSetAdmin = useCallback(async (userId: string, isAdmin: boolean) => {
    setBusyUserId(userId)
    try {
      await requireAuth(() => updateUserAdmin(userId, isAdmin))
    } catch (err) {
      addToast(`Update failed: ${formatError(err)}`, 'error')
      setBusyUserId(null)
      return
    }
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, isAdmin } : r)))
    setBusyUserId(null)
    addToast(isAdmin ? '✓ Made admin' : '✓ Admin removed')
  }, [addToast, requireAuth])

  const handleDeleteUser = useCallback(async (userId: string, email: string) => {
    if (!window.confirm(`Delete ${email}? This cannot be undone.`)) return
    setBusyUserId(userId)
    try {
      await requireAuth(() => deleteUser(userId))
    } catch (err) {
      addToast(`Delete failed: ${formatError(err)}`, 'error')
      setBusyUserId(null)
      return
    }
    setRows((prev) => prev.filter((r) => r.userId !== userId))
    setBusyUserId(null)
    addToast('✓ User deleted')
  }, [addToast, requireAuth])

  const pending  = rows.filter((r) => r.status === 'pending')
  const approved = rows.filter((r) => r.status === 'approved')

  const loadingView = (
    <div className="flex-1 flex items-center justify-center h-full text-[var(--muted-2)] font-mono text-[12px] tracking-wider">
      Loading users…
    </div>
  )

  if (accessLoading) return loadingView
  if (!isAdmin) return <Navigate to="/" replace />
  if (loading) return loadingView

  return (
    <div className="flex-1 overflow-auto px-3 sm:px-7 pb-7 pt-5">
      <h2 className="font-display text-[16px] tracking-wider text-[var(--ink)] mb-4">
        Pending approval ({pending.length})
      </h2>
      <div className="border border-[var(--border)] rounded-md overflow-hidden mb-8">
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-center text-[var(--muted-2)] text-[12px]">No pending sign-ups.</p>
        ) : (
          <div className="divide-y divide-[#F1F5F9]">
            {pending.map((r) => (
              <div key={r.userId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[13px] font-semibold text-[var(--ink)]">{r.email}</div>
                  <div className="text-[11px] font-mono text-[var(--muted-2)]">Signed up {formatDate(r.createdAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSetStatus(r.userId, 'approved')}
                    disabled={busyUserId === r.userId}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold text-white bg-[var(--btn-ink)] hover:bg-[var(--btn-ink-hover)] disabled:opacity-50 transition-colors"
                  >
                    <Check size={13} strokeWidth={2.5} />
                    Approve
                  </button>
                  {r.userId !== currentUserId && (
                    <button
                      onClick={() => handleDeleteUser(r.userId, r.email)}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[var(--neg)] border border-[var(--neg-border)] hover:bg-[var(--neg-surface)] disabled:opacity-50 transition-colors"
                    >
                      <Trash2 size={13} strokeWidth={2.25} />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="font-display text-[16px] tracking-wider text-[var(--ink)] mb-4">
        Approved ({approved.length})
      </h2>
      <div className="border border-[var(--border)] rounded-md overflow-hidden">
        {approved.length === 0 ? (
          <p className="px-4 py-6 text-center text-[var(--muted-2)] text-[12px]">No approved users yet.</p>
        ) : (
          <div className="divide-y divide-[#F1F5F9]">
            {approved.map((r) => (
              <div key={r.userId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[13px] font-semibold text-[var(--ink)] flex items-center gap-2">
                    {r.email}
                    {r.isAdmin && (
                      <span className="text-[9px] uppercase tracking-wide font-bold text-white bg-[var(--brand-blue-deep)] rounded px-1.5 py-0.5">
                        Admin
                      </span>
                    )}
                    {r.userId === currentUserId && (
                      <span className="text-[9px] uppercase tracking-wide font-bold text-[var(--muted-2)] bg-[var(--surface-3)] rounded px-1.5 py-0.5">
                        You
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--muted-2)]">Signed up {formatDate(r.createdAt)}</div>
                </div>
                {r.userId !== currentUserId && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSetAdmin(r.userId, !r.isAdmin)}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)] hover:border-[var(--border-strong)] disabled:opacity-50 transition-colors"
                    >
                      {r.isAdmin ? <ShieldMinus size={13} strokeWidth={2.25} /> : <ShieldPlus size={13} strokeWidth={2.25} />}
                      {r.isAdmin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button
                      onClick={() => handleSetStatus(r.userId, 'pending')}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[var(--muted)] border border-[var(--border)] hover:text-[var(--ink)] hover:border-[var(--border-strong)] disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw size={13} strokeWidth={2.25} />
                      Revoke
                    </button>
                    <button
                      onClick={() => handleDeleteUser(r.userId, r.email)}
                      disabled={busyUserId === r.userId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-[var(--neg)] border border-[var(--neg-border)] hover:bg-[var(--neg-surface)] disabled:opacity-50 transition-colors"
                    >
                      <Trash2 size={13} strokeWidth={2.25} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
