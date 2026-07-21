// Supabase Edge Function: delete-user
// Permanently deletes a user's auth.users account (and, via cascade, their
// user_access row). Requires a signed-in admin caller — checked here against
// user_access.is_admin, since this function uses the service-role key to
// bypass RLS entirely via auth.admin.deleteUser().
//
// Deploy with default JWT verification ON (no --no-verify-jwt) — unlike the
// `assistant` function, this is a destructive, privileged action and must
// require a valid Supabase session before the function body even runs.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) return json({ error: 'Missing Authorization header' }, 401)

  let body: { userId?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const targetUserId = body.userId
  if (!targetUserId) return json({ error: 'userId is required' }, 400)

  // Resolve caller identity from their session JWT.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Invalid session' }, 401)
  const callerId = userData.user.id

  if (targetUserId === callerId) {
    return json({ error: 'You cannot delete your own account' }, 400)
  }

  // Service-role client — required both to check the caller's admin flag
  // (bypassing RLS is harmless here since we're checking the caller's own
  // row) and to perform the actual auth.admin.deleteUser call.
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: accessRow, error: accessErr } = await serviceClient
    .from('user_access')
    .select('is_admin')
    .eq('user_id', callerId)
    .maybeSingle()
  if (accessErr) return json({ error: accessErr.message }, 500)
  if (!accessRow?.is_admin) return json({ error: 'Admin access required' }, 403)

  const { error: deleteErr } = await serviceClient.auth.admin.deleteUser(targetUserId)
  if (deleteErr) return json({ error: deleteErr.message }, 500)

  return json({ ok: true }, 200)
})
