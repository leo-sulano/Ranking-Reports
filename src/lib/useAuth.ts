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
 *
 * `requireAuth` reads session state from a ref (not the `session` state
 * variable) and has a stable identity (empty dep array) so that a reference
 * to it captured by an already-running async function — e.g. a second
 * `requireAuth` call inside a multi-write operation that started before
 * sign-in completed — still sees the CURRENT session when it runs, instead
 * of the stale pre-sign-in value its enclosing closure was created with.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const pending = useRef<PendingAuth | null>(null)

  useEffect(() => {
    let cancelled = false

    getSession().then((s) => {
      if (cancelled) return
      sessionRef.current = s
      setSession(s)
    })

    const unsub = onAuthChange((s) => {
      if (cancelled) return
      sessionRef.current = s
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
    if (sessionRef.current) return Promise.resolve().then(fn)
    return new Promise<T>((resolve, reject) => {
      // Reject any existing pending auth to prevent orphaning
      if (pending.current) {
        pending.current.reject(new Error('Superseded by a newer sign-in request'))
      }
      pending.current = { run: fn, resolve: resolve as (value: unknown) => void, reject }
      setModalOpen(true)
    })
  }, [])

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
