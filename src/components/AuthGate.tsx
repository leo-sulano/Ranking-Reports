import { useState, useEffect, type ReactNode } from 'react'
import { LogOut, Hourglass } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { REQUIRE_AUTH, getSession, onAuthChange, signOut } from '../lib/auth'
import { getUserAccess } from '../lib/userAccess'
import { Login } from './Login'

type Access = 'checking' | 'pending' | 'approved'

/**
 * Wraps the app. When VITE_REQUIRE_AUTH is false, it renders children
 * immediately — the app is unchanged. When true, it requires a Supabase
 * session AND an approved user_access row: signed out → <Login />; signed in
 * but pending → an "awaiting approval" screen; approved → the app.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // Flag off → no gating, ever. Resolve immediately so there's no flicker.
  const [session, setSession] = useState<Session | null>(null)
  const [checked, setChecked] = useState(!REQUIRE_AUTH)
  const [access, setAccess] = useState<Access>('checking')

  useEffect(() => {
    if (!REQUIRE_AUTH) return
    let cancelled = false
    // Generation counter so a slow approval lookup for an old session can't
    // clobber the state of a newer one (e.g. quick sign-out/sign-in).
    let gen = 0

    const applySession = (s: Session | null) => {
      setSession(s)
      setChecked(true)
      const my = ++gen
      setAccess('checking')
      if (!s) return
      getUserAccess(s.user.id)
        .then((a) => {
          if (cancelled || my !== gen) return
          setAccess(a?.status === 'approved' ? 'approved' : 'pending')
        })
        .catch(() => {
          // Treat lookup failure as not-approved; the user can sign out/in.
          if (cancelled || my !== gen) return
          setAccess('pending')
        })
    }

    getSession().then((s) => { if (!cancelled) applySession(s) })
    const unsub = onAuthChange((s) => { if (!cancelled) applySession(s) })
    return () => { cancelled = true; unsub() }
  }, [])

  if (!REQUIRE_AUTH) return <>{children}</>

  if (!checked) return <GateNote text="Checking session…" />
  if (!session) return <Login />
  if (access === 'checking') return <GateNote text="Checking access…" />
  if (access === 'pending') return <PendingApproval email={session.user.email ?? 'your account'} />

  return <>{children}</>
}

function GateNote({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-screen bg-[var(--surface-2)] text-[var(--muted)] font-mono text-[12px] tracking-wider">
      {text}
    </div>
  )
}

/** Signed in, but user_access.status is still 'pending'. */
function PendingApproval({ email }: { email: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--surface-2)] px-4">
      <div className="w-full max-w-[400px] bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 text-center shadow-[0_24px_60px_rgba(0,0,0,0.12)]">
        <div className="mx-auto mb-4 w-11 h-11 rounded-full bg-[var(--warn-surface)] border border-[var(--warn-border)] flex items-center justify-center">
          <Hourglass size={18} className="text-[var(--warn)]" />
        </div>
        <h1 className="font-display text-[18px] text-[var(--ink)] mb-2">Awaiting approval</h1>
        <p className="text-[13px] text-[var(--text-2)] leading-relaxed mb-1">
          You're signed in as <span className="font-semibold text-[var(--ink)]">{email}</span>.
        </p>
        <p className="text-[13px] text-[var(--text-2)] leading-relaxed mb-6">
          An admin needs to approve your account before you can view the
          dashboard. Check back once you've been approved.
        </p>
        <button
          type="button"
          onClick={() => { void signOut() }}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-[var(--border-2)] text-[12px] font-mono text-[var(--muted)] hover:text-[var(--ink-2)] hover:border-[var(--muted-3)] transition-colors"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </div>
  )
}
