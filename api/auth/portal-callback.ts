import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createRemoteJWKSet } from 'jose'
import { createClient } from '@supabase/supabase-js'
import { requireEnv, verifyPortalAssertion } from '../_lib/ssoPortal'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = `https://${req.headers.host ?? ''}`

  try {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    if (!token) {
      res.redirect(302, `${origin}/?error=sso`)
      return
    }

    const PORTAL_JWKS_URL = requireEnv(process.env, 'PORTAL_JWKS_URL')
    const PORTAL_ISSUER = requireEnv(process.env, 'PORTAL_ISSUER')
    const SSO_AUDIENCE = requireEnv(process.env, 'SSO_AUDIENCE')
    const SUPABASE_URL = requireEnv(process.env, 'VITE_SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY = requireEnv(process.env, 'SUPABASE_SERVICE_ROLE_KEY')

    const jwks = createRemoteJWKSet(new URL(PORTAL_JWKS_URL))
    const { email } = await verifyPortalAssertion(token, jwks, {
      issuer: PORTAL_ISSUER,
      audience: SSO_AUDIENCE,
    })

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${origin}/` },
    })
    if (linkErr || !link?.properties?.action_link || !link.user) {
      res.redirect(302, `${origin}/?error=sso`)
      return
    }

    const { error: upsertErr } = await admin
      .from('user_access')
      .upsert({ user_id: link.user.id, email, status: 'approved' }, { onConflict: 'user_id' })
    if (upsertErr) {
      res.redirect(302, `${origin}/?error=sso`)
      return
    }

    res.redirect(302, link.properties.action_link)
  } catch {
    res.redirect(302, `${origin}/?error=sso`)
  }
}
