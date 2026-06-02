# Security — access control

## Current state (open)

The dashboard currently has **no login**. Supabase RLS is enabled but the
policies grant the public `anon` role full read/write/delete. Since the anon key
ships in the browser bundle, anyone with the deploy URL (or the key) can read or
delete the ranking data. This is acceptable only while the URL is kept private.

Secrets are clean: the OpenAI key lives only as a Supabase Edge Function secret
(server-side) and never reaches the browser. No real `.env` is committed.

## Locking it down (login required)

Everything is wired and dormant behind the `VITE_REQUIRE_AUTH` flag. To flip it:

1. **Frontend (Vercel):** set env var `VITE_REQUIRE_AUTH=true` and redeploy.
   The login screen now gates the app.
2. **Create a user:** Supabase Dashboard → Authentication → Users → *Add user*
   (enable *Auto Confirm User*). One shared account is fine for the team.
3. **Disable public signups** (recommended): Authentication → Providers → Email →
   turn off *Allow new users to sign up*.
4. **Run the lockdown migration:** Supabase Dashboard → SQL Editor → paste and run
   [`supabase/auth-lockdown.sql`](../supabase/auth-lockdown.sql). This revokes the
   anon role's access — only logged-in users can read/write afterward.

Once flipped: `supabase-js` attaches the logged-in user's JWT to every request,
which satisfies the `authenticated`-only RLS policies. The assistant is
unaffected (it answers from a client-supplied digest, not the DB).

### Rolling back

Re-run the policy section of `supabase/schema.sql` (restores anon access) and set
`VITE_REQUIRE_AUTH=false`.

## Relevant files

| File | Role |
|------|------|
| `supabase/auth-lockdown.sql` | The "flip the switch" RLS migration (run when ready) |
| `src/lib/auth.ts` | `VITE_REQUIRE_AUTH` flag + sign-in/out helpers |
| `src/components/AuthGate.tsx` | Renders the app or the login screen based on the flag + session |
| `src/components/Login.tsx` | Email/password login screen |
