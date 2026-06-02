import { useState, useEffect, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { REQUIRE_AUTH, getSession, onAuthChange } from '../lib/auth'
import { Login } from './Login'

/**
 * Wraps the app. When VITE_REQUIRE_AUTH is false (default today), it renders
 * children immediately — the app is unchanged. When true, it requires a
 * Supabase session: shows <Login /> until the user signs in, then the app.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // Flag off → no gating, ever. Resolve immediately so there's no flicker.
  const [session, setSession] = useState<Session | null>(null)
  const [checked, setChecked] = useState(!REQUIRE_AUTH)

  useEffect(() => {
    if (!REQUIRE_AUTH) return
    let cancelled = false

    getSession().then((s) => {
      if (cancelled) return
      setSession(s)
      setChecked(true)
    })

    const unsub = onAuthChange((s) => {
      if (cancelled) return
      setSession(s)
      setChecked(true)
    })

    return () => { cancelled = true; unsub() }
  }, [])

  if (!REQUIRE_AUTH) return <>{children}</>

  if (!checked) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#F8FAFC] text-[#64748B] font-mono text-[12px] tracking-wider">
        Checking session…
      </div>
    )
  }

  if (!session) return <Login />

  return <>{children}</>
}
