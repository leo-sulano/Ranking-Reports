/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  // 'true' to require login (see supabase/auth-lockdown.sql). Optional/absent ⇒ open.
  readonly VITE_REQUIRE_AUTH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
