import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createRemoteJWKSet } from 'jose'
import { createClient } from '@supabase/supabase-js'
import { requireEnv, verifyPortalAssertion, ensureUserExists, resolveAppOrigin } from './_lib/ssoPortal.js'

/**
 * SSO callback the dashboard portal redirects to with ?token=<portal JWT>.
 *
 * Flow: verify the portal token (JWKS + issuer + audience + expiry) →
 * JIT-provision the user in Supabase Auth → auto-approve them in user_access →
 * mint a magic link and bounce the browser through it. Supabase verifies the
 * link and redirects back to APP_URL with tokens in the URL hash, where the
 * browser client (detectSessionInUrl: true) picks up the session.
 *
 * All failures land on `/?error=<step>` — the SPA has no /login route; the
 * unauthenticated app shell shows the login modal.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = resolveAppOrigin(process.env, req.headers.host)

  try {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    if (!token) {
      console.error('[sso] missing token')
      res.redirect(302, `${origin}/?error=sso`)
      return
    }

    const PORTAL_JWKS_URL = requireEnv(process.env, 'PORTAL_JWKS_URL')
    const PORTAL_ISSUER = requireEnv(process.env, 'PORTAL_ISSUER')
    const SSO_AUDIENCE = requireEnv(process.env, 'SSO_AUDIENCE')
    // SUPABASE_URL is preferred; VITE_SUPABASE_URL (same value, set for the
    // client bundle) works as a fallback — the VITE_ prefix only governs
    // Vite's inlining, not server-side process.env access.
    const SUPABASE_URL = process.env.SUPABASE_URL ?? requireEnv(process.env, 'VITE_SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = requireEnv(process.env, 'SUPABASE_SERVICE_ROLE_KEY')

    // 1) Verify the portal token.
    const jwks = createRemoteJWKSet(new URL(PORTAL_JWKS_URL))
    let email: string
    try {
      const assertion = await verifyPortalAssertion(token, jwks, {
        issuer: PORTAL_ISSUER,
        audience: SSO_AUDIENCE,
      })
      email = assertion.email
    } catch (err) {
      console.error('[sso] token verification failed', err)
      res.redirect(302, `${origin}/?error=sso`)
      return
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 2) JIT-provision by email ("already registered" counts as success).
    try {
      await ensureUserExists(admin, email)
    } catch (err) {
      console.error('[sso] user provisioning failed', err)
      res.redirect(302, `${origin}/?error=provision`)
      return
    }

    // 3) Mint the browser session; the link response carries the user id.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${origin}/` },
    })
    if (linkErr || !link?.properties?.action_link || !link.user) {
      console.error('[sso] generateLink failed', linkErr)
      res.redirect(302, `${origin}/?error=session`)
      return
    }

    // 2b) Auto-approve in user_access (the auth.users trigger has already
    // inserted a 'pending' row; this flips it without touching is_admin).
    const { error: upsertErr } = await admin
      .from('user_access')
      .upsert({ user_id: link.user.id, email, status: 'approved' }, { onConflict: 'user_id' })
    if (upsertErr) {
      console.error('[sso] user_access upsert failed', upsertErr)
      res.redirect(302, `${origin}/?error=access`)
      return
    }

    res.redirect(302, link.properties.action_link)
  } catch (err) {
    console.error('[sso] unexpected error', err)
    res.redirect(302, `${origin}/?error=sso`)
  }
}
