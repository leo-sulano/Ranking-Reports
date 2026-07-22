We're integrating our dashboard with a central "portal" that does cross-dashboard SSO:
a user logs into the portal once, clicks our dashboard's card, and should land in our app
already logged in — no second login. The portal signs a short-lived token asserting the
user's email; our job is to add ONE route that verifies that token and starts a normal
Supabase session in OUR project.

Our dashboard is a Supabase Auth app. The portal is a SEPARATE Supabase project — we keep
our own users/keys; on first SSO we just create the user by email (JIT provisioning).

## Task
Add a GET route at `app/auth/portal-callback/route.ts` that:
1) reads `?token`, verifies it against the portal's JWKS (signature + issuer + audience + expiry),
2) finds-or-creates the user by email in OUR Supabase (service role),
3) mints a session (cookies) in OUR app, and redirects to `/`.

## Concrete values (already provisioned on the portal side)
- PORTAL_JWKS_URL = https://dashboard-portal-tawny.vercel.app/api/sso/jwks
- PORTAL_ISSUER   = https://dashboard-portal-tawny.vercel.app   (exact, no trailing slash)
- SSO_AUDIENCE    = 3b3a26b1-c89d-4d2f-ba2e-d88f743f062d        (our dashboard's id in the portal)

## Steps
1) Confirm stack: this reference is **Next.js App Router + `@supabase/ssr` (cookie-based
   sessions)**. If our app is Pages Router or a client-only SPA that stores the Supabase
   session in localStorage, ADAPT it — same three steps (verify JWKS → JIT-provision → mint
   session) but establish the session the way our app actually reads it. Verify our app reads
   its Supabase session from cookies before assuming this works as-is.
2) `npm install jose @supabase/ssr @supabase/supabase-js` (whichever are missing).
3) Create `app/auth/portal-callback/route.ts` with the code below.
4) Set these env vars in our dashboard's Vercel project (Production):
   - PORTAL_JWKS_URL, PORTAL_ISSUER, SSO_AUDIENCE  (values above)
   - SUPABASE_SERVICE_ROLE_KEY = OUR project's service_role key (Supabase → our project →
     Settings → API). Server-only — never NEXT_PUBLIC_, never sent to the client.
   - (Our own NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY should already be set.)
5) Deploy. Then the portal owner enables SSO for our dashboard (callback URL =
   https://ranking-reports-alpha.vercel.app/auth/portal-callback) and tests by clicking the card.

## Security must-nots
- Do NOT weaken the `jwtVerify` checks (issuer + audience are what stop a token minted for a
  DIFFERENT dashboard from working here). The env asserts below make it fail-closed — keep them.
- Keep the service-role key server-only.

## The route
```ts
import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Fail closed: if PORTAL_ISSUER/SSO_AUDIENCE are unset, jose would treat them as
// "no constraint" and SKIP the checks — a token for another dashboard would be accepted.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for SSO`);
  return v;
}
const PORTAL_JWKS_URL = requireEnv("PORTAL_JWKS_URL");
const PORTAL_ISSUER = requireEnv("PORTAL_ISSUER");
const SSO_AUDIENCE = requireEnv("SSO_AUDIENCE");
const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const JWKS = createRemoteJWKSet(new URL(PORTAL_JWKS_URL));

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/login", req.url));

  // 1) Verify the portal's assertion
  let email: string;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: PORTAL_ISSUER,
      audience: SSO_AUDIENCE,
    });
    email = String(payload.email);
    if (!email) throw new Error("no email claim");
  } catch {
    return NextResponse.redirect(new URL("/login?error=sso", req.url));
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 2) JIT-provision by email (NOTE: listUsers is paginated ~50/page; page or use a
  //    filtered lookup if this project has many users)
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) return NextResponse.redirect(new URL("/login?error=provision", req.url));
    user = data.user;
  }

  // 3) Mint a session (magic-link token → verifyOtp sets cookies)
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link.properties?.hashed_token) return NextResponse.redirect(new URL("/login?error=session", req.url));

  const cookieStore = await cookies();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cs) => cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  });
  const { error: otpErr } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (otpErr) return NextResponse.redirect(new URL("/login?error=session", req.url));

  return NextResponse.redirect(new URL("/", req.url));
}
```

## How to test / what the outcomes mean
After deploy + the portal enables SSO, clicking the portal card lands here with `?token=…`:
- lands logged in on our app → success
- redirect to `/login?error=sso` → token verify failed (check PORTAL_ISSUER exact match / SSO_AUDIENCE / PORTAL_JWKS_URL)
- `/login?error=provision` → SUPABASE_SERVICE_ROLE_KEY wrong/missing
- `/login?error=session` → our app isn't using @supabase/ssr cookie sessions (adapt step 1)
- 404 → route path wrong / not deployed
