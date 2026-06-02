// Auth gate — dormant until VITE_REQUIRE_AUTH=true.
//
// While the flag is false (the default), the whole app behaves exactly as
// before: no login screen, requests use the anon key. Flipping the flag to
// 'true' (and running supabase/auth-lockdown.sql) turns the dashboard into a
// login-gated, authenticated-only app. See supabase/auth-lockdown.sql for the
// full flip-the-switch checklist.

import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

/** When false, the AuthGate renders the app immediately with no login. */
export const REQUIRE_AUTH = import.meta.env.VITE_REQUIRE_AUTH === 'true'

/** Current session (null when signed out). */
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session))
  return () => data.subscription.unsubscribe()
}

/** Sign in with email + password. Throws with a readable message on failure. */
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

/** Sign out the current user. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
