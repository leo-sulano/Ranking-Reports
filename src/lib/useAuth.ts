import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthChange } from './auth'
import { getUserAccess } from './userAccess'
import type { WriteGate } from '../types'

interface PendingAuth {
  run: () => unknown
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/**
 * Session state + a gate for mutating actions. `requireAuth(fn)` runs `fn`
 * only once the caller is BOTH signed in AND approved (see user_access);
 * otherwise it opens the shared login modal (if signed out) or rejects
 * immediately with a friendly message (if signed in but still pending).
 *
 * `requireAuth` has a stable identity (empty dep array) and reads session /
 * approval state from refs, not React state variables, so that a reference
 * to it captured by an already-running async function — e.g. a second
 * `requireAuth` call inside a multi-write operation that started before
 * sign-in completed — still sees the CURRENT state when it runs, instead of
 * whatever was true when its enclosing closure was created. (This exact
 * failure mode was a real, fixed bug in the write-gated-auth feature — do
 * not reintroduce a `[session]`-style dependency on `requireAuth` itself.)
 *
 * Email/password sign-in resumes a pending action automatically (no page
 * reload). Google's OAuth redirect reloads the page, so a pending `fn` from
 * that path is simply lost; the user re-clicks the action after returning.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const pending = useRef<PendingAuth | null>(null)
  const [isApproved, setIsApproved] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [accessLoading, setAccessLoading] = useState(true)
  const approvedRef = useRef(false)
  // Resolves once the most recent approval check (for the current session)
  // has finished updating approvedRef/isAdmin. requireAuth and the
  // post-sign-in resume both wait on this before deciding.
  const accessCheck = useRef<Promise<void>>(Promise.resolve())
  const accessGen = useRef(0)

  const refreshAccess = useCallback((userId: string | undefined) => {
    const gen = ++accessGen.current
    if (!userId) {
      approvedRef.current = false
      setIsApproved(false)
      setIsAdmin(false)
      setAccessLoading(false)
      accessCheck.current = Promise.resolve()
      return
    }
    setAccessLoading(true)
    accessCheck.current = getUserAccess(userId)
      .then((access) => {
        if (gen !== accessGen.current) return
        approvedRef.current = access?.status === 'approved'
        setIsApproved(approvedRef.current)
        setIsAdmin(access?.isAdmin ?? false)
        setAccessLoading(false)
      })
      .catch(() => {
        if (gen !== accessGen.current) return
        approvedRef.current = false
        setIsApproved(false)
        setIsAdmin(false)
        setAccessLoading(false)
      })
  }, [])

  const runGated = useCallback(<T,>(fn: () => T | Promise<T>): Promise<T> => {
    return accessCheck.current.then(() => {
      if (!approvedRef.current) throw new Error('Your account is awaiting admin approval')
      return fn()
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    getSession().then((s) => {
      if (cancelled) return
      sessionRef.current = s
      setSession(s)
      refreshAccess(s?.user.id)
    })

    const unsub = onAuthChange((s) => {
      if (cancelled) return
      sessionRef.current = s
      setSession(s)
      refreshAccess(s?.user.id)
      if (s) {
        setModalOpen(false)
        if (pending.current) {
          const { run, resolve, reject } = pending.current
          pending.current = null
          runGated(run).then(resolve, reject)
        }
      }
    })

    return () => { cancelled = true; unsub() }
  }, [refreshAccess, runGated])

  const requireAuth = useCallback(<T,>(fn: () => T | Promise<T>): Promise<T> => {
    if (sessionRef.current) return runGated(fn)
    return new Promise<T>((resolve, reject) => {
      // Reject any existing pending auth to prevent orphaning
      if (pending.current) {
        pending.current.reject(new Error('Superseded by a newer sign-in request'))
      }
      pending.current = { run: fn, resolve: resolve as (value: unknown) => void, reject }
      setModalOpen(true)
    })
  }, [runGated])

  const openLogin = useCallback(() => setModalOpen(true), [])

  const cancelAuth = useCallback(() => {
    if (pending.current) {
      pending.current.reject(new Error('Sign-in required'))
      pending.current = null
    }
    setModalOpen(false)
  }, [])

  return { session, modalOpen, requireAuth, openLogin, cancelAuth, isApproved, isAdmin, accessLoading }
}

export function getWriteGate(session: Session | null, isApproved: boolean, accessLoading: boolean): WriteGate {
  if (!session) return { disabled: false, title: 'Sign in to make changes' }
  if (accessLoading) return { disabled: false }
  if (!isApproved) return { disabled: true, title: 'Awaiting admin approval' }
  return { disabled: false }
}
