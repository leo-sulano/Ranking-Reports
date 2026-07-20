import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthChange } from './auth'

interface PendingAuth {
  run: () => unknown
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/**
 * Session state + a gate for mutating actions. `requireAuth(fn)` runs `fn`
 * immediately if a session exists; otherwise it opens the shared login modal
 * and resumes `fn` automatically once sign-in succeeds (email/password only —
 * Google's OAuth redirect reloads the page, so a pending `fn` from that path
 * is simply lost; the user re-clicks the action after returning).
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const pending = useRef<PendingAuth | null>(null)

  useEffect(() => {
    let cancelled = false

    getSession().then((s) => { if (!cancelled) setSession(s) })

    const unsub = onAuthChange((s) => {
      if (cancelled) return
      setSession(s)
      if (s) {
        setModalOpen(false)
        if (pending.current) {
          const { run, resolve, reject } = pending.current
          pending.current = null
          Promise.resolve().then(run).then(resolve, reject)
        }
      }
    })

    return () => { cancelled = true; unsub() }
  }, [])

  const requireAuth = useCallback(<T,>(fn: () => T | Promise<T>): Promise<T> => {
    if (session) return Promise.resolve(fn())
    return new Promise<T>((resolve, reject) => {
      pending.current = { run: fn, resolve: resolve as (value: unknown) => void, reject }
      setModalOpen(true)
    })
  }, [session])

  const openLogin = useCallback(() => setModalOpen(true), [])

  const cancelAuth = useCallback(() => {
    if (pending.current) {
      pending.current.reject(new Error('Sign-in required'))
      pending.current = null
    }
    setModalOpen(false)
  }, [])

  return { session, modalOpen, requireAuth, openLogin, cancelAuth }
}
