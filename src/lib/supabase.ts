import { createClient } from '@supabase/supabase-js'

const url     = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Supabase env vars missing — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  )
}

// persistSession/autoRefreshToken are enabled so that once a user logs in
// (when VITE_REQUIRE_AUTH=true), supabase-js stores their session and
// automatically attaches their JWT to every DB request — which is what
// satisfies the authenticated-only RLS policies in auth-lockdown.sql. When no
// one is logged in (the default today), requests fall back to the anon key, so
// this is harmless until auth is switched on.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
