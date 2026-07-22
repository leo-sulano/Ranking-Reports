# SSO Portal Callback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Vercel serverless function that lets a user arrive from an external SSO "portal" already signed into this dashboard — verifying the portal's signed token, provisioning/approving the Supabase user, and redirecting into a live session.

**Architecture:** A thin Vercel Node serverless function (`api/auth/portal-callback.ts`) wired to a small set of pure, unit-tested helpers (`api/_lib/ssoPortal.ts`) that verify the portal's JWT. The function then uses a Supabase service-role client to JIT-provision/approve the user via `admin.generateLink`, and redirects the browser straight to Supabase's own `action_link` — which the existing client-side Supabase instance (`detectSessionInUrl: true`) picks up automatically, exactly like the app's existing password-reset flow. No cookies, no `@supabase/ssr`, no framework change.

**Tech Stack:** Vite + React SPA (existing), Vercel serverless functions (Node runtime, new), `jose` (new dependency, JWT/JWKS verification), `@supabase/supabase-js` (existing dependency, used here via its admin API), `@vercel/node` + `@types/node` (new devDependencies, types only), Vitest (existing test runner).

## Global Constraints

- Fail closed: any missing env var, bad signature, wrong issuer/audience, expired token, or unexpected error redirects to `/?error=sso` — never a raw 500, never a partially-provisioned user, never treated as "no constraint."
- The service-role key must only ever be read from `process.env` inside `api/` code — never given a `VITE_` prefix, never imported into anything under `src/` that the client bundle could pull in.
- SSO users are auto-approved (`user_access.status = 'approved'`) with no admin step — this is an explicit, already-approved design decision, not an oversight.
- Env var names (exact): `PORTAL_JWKS_URL`, `PORTAL_ISSUER`, `SSO_AUDIENCE`, `SUPABASE_SERVICE_ROLE_KEY`. Reuse the existing `VITE_SUPABASE_URL` for the Supabase project URL (server-side `process.env` access isn't restricted by the `VITE_` prefix — that prefix only controls Vite's client-bundle inlining).
- Callback path is `/api/auth/portal-callback` (not `/auth/portal-callback` — this app uses Vercel's `api/` filesystem convention, not Next.js App Router).

---

### Task 1: Portal JWT verification helpers (unit-tested)

**Files:**
- Create: `api/_lib/ssoPortal.ts`
- Create: `api/_lib/ssoPortal.test.ts`
- Modify: `vitest.config.ts` (include glob so tests under `api/` run)
- Modify: `package.json` (add `jose` dependency)

**Interfaces:**
- Produces: `requireEnv(env: Record<string, string | undefined>, name: string): string` — returns `env[name]`, throws `Error(\`${name} is required for SSO\`)` if unset/empty.
- Produces: `verifyPortalAssertion(token: string, jwks: import('jose').JWTVerifyGetKey, opts: { issuer: string; audience: string }): Promise<{ email: string }>` — verifies signature/issuer/audience/expiry via `jose.jwtVerify`, throws if any check fails or the `email` claim is missing/blank, otherwise resolves `{ email }`.

- [ ] **Step 1: Install `jose`**

```bash
npm install jose
```

- [ ] **Step 2: Widen the Vitest include glob to cover `api/`**

Modify `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Write the failing tests**

Create `api/_lib/ssoPortal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWK } from 'jose'
import { requireEnv, verifyPortalAssertion } from './ssoPortal'

const ISSUER = 'https://portal.example.com'
const AUDIENCE = 'test-audience-id'
const KID = 'test-key'

async function buildTestJwks() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = (await exportJWK(publicKey)) as JWK
  jwk.kid = KID
  jwk.alg = 'RS256'
  const jwks = createLocalJWKSet({ keys: [jwk] })
  return { jwks, privateKey }
}

async function sign(
  privateKey: Parameters<SignJWT['sign']>[0],
  payload: Record<string, unknown>,
  overrides: { issuer?: string; audience?: string; expiresIn?: string | number } = {}
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setExpirationTime(overrides.expiresIn ?? '5m')
    .sign(privateKey)
}

describe('requireEnv', () => {
  it('returns the value when set', () => {
    expect(requireEnv({ FOO: 'bar' }, 'FOO')).toBe('bar')
  })

  it('throws when unset', () => {
    expect(() => requireEnv({}, 'FOO')).toThrow('FOO is required for SSO')
  })

  it('throws when empty string', () => {
    expect(() => requireEnv({ FOO: '' }, 'FOO')).toThrow('FOO is required for SSO')
  })
})

describe('verifyPortalAssertion', () => {
  it('resolves the email claim for a valid token', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, { email: 'user@example.com' })

    const result = await verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })

    expect(result).toEqual({ email: 'user@example.com' })
  })

  it('rejects a token with the wrong issuer', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, { email: 'user@example.com' }, { issuer: 'https://not-the-portal.example.com' })

    await expect(verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow()
  })

  it('rejects a token with the wrong audience', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, { email: 'user@example.com' }, { audience: 'some-other-dashboard' })

    await expect(verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, { email: 'user@example.com' }, { expiresIn: Math.floor(Date.now() / 1000) - 10 })

    await expect(verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow()
  })

  it('rejects a token with no email claim', async () => {
    const { jwks, privateKey } = await buildTestJwks()
    const token = await sign(privateKey, {})

    await expect(verifyPortalAssertion(token, jwks, { issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow(
      'Portal token has no email claim'
    )
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- ssoPortal`
Expected: FAIL — `api/_lib/ssoPortal.ts` does not exist yet (`Cannot find module './ssoPortal'`).

- [ ] **Step 5: Write the implementation**

Create `api/_lib/ssoPortal.ts`:

```ts
import { jwtVerify, type JWTVerifyGetKey } from 'jose'

/** Reads `name` from `env`, throwing if unset/empty rather than silently treating it as "no constraint." */
export function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required for SSO`)
  return value
}

export interface PortalAssertion {
  email: string
}

/**
 * Verifies a portal-signed JWT against `jwks`, enforcing issuer, audience,
 * and expiry (via jose's own checks). Throws on any failure. Resolves the
 * asserted email on success.
 */
export async function verifyPortalAssertion(
  token: string,
  jwks: JWTVerifyGetKey,
  opts: { issuer: string; audience: string }
): Promise<PortalAssertion> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: opts.issuer,
    audience: opts.audience,
  })
  const email = typeof payload.email === 'string' ? payload.email : ''
  if (!email) throw new Error('Portal token has no email claim')
  return { email }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- ssoPortal`
Expected: PASS — all 8 tests green.

- [ ] **Step 7: Commit**

```bash
git add api/_lib/ssoPortal.ts api/_lib/ssoPortal.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: add portal JWT verification helpers for SSO callback"
```

---

### Task 2: Vercel route, type-checking wiring, and env docs

**Files:**
- Create: `api/auth/portal-callback.ts`
- Create: `tsconfig.api.json`
- Modify: `tsconfig.json` (add reference to `tsconfig.api.json`)
- Modify: `.env.example` (document the new env vars)
- Modify: `.gitignore` (ignore `.vercel/` created by local `vercel dev`/`vercel link`)
- Modify: `package.json` (add `@vercel/node`, `@types/node` devDependencies)

**Interfaces:**
- Consumes (from Task 1): `requireEnv(env, name): string`, `verifyPortalAssertion(token, jwks, opts): Promise<{ email: string }>`.

- [ ] **Step 1: Install the Vercel Node types**

```bash
npm install -D @vercel/node @types/node
```

- [ ] **Step 2: Add a tsconfig for `api/`, mirroring the existing app/node split**

Create `tsconfig.api.json`:

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.api.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "types": ["node"]
  },
  "include": ["api"]
}
```

Modify `tsconfig.json` to add the third reference:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.api.json" }
  ]
}
```

- [ ] **Step 3: Run the type-checker to confirm the new project builds (with no source yet)**

Run: `npx tsc -b`
Expected: succeeds (no errors) — `api/_lib/ssoPortal.ts` from Task 1 is valid standalone TS with no Node-specific APIs, so it type-checks under the new project too.

- [ ] **Step 4: Write the route**

Create `api/auth/portal-callback.ts`:

```ts
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
```

- [ ] **Step 5: Run the full type-check**

Run: `npx tsc -b`
Expected: succeeds with no errors across all three projects (app, node, api).

- [ ] **Step 6: Document the new env vars**

Modify `.env.example`, appending:

```
# SSO portal callback (api/auth/portal-callback.ts). Server-only — set these
# in Vercel (Production), never with a VITE_ prefix.
# PORTAL_JWKS_URL=https://dashboard-portal-tawny.vercel.app/api/sso/jwks
# PORTAL_ISSUER=https://dashboard-portal-tawny.vercel.app
# SSO_AUDIENCE=3b3a26b1-c89d-4d2f-ba2e-d88f743f062d
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

- [ ] **Step 7: Ignore the local Vercel CLI link directory**

Modify `.gitignore`, adding under "Environment & local config":

```
.vercel/
```

- [ ] **Step 8: Manual smoke test of the fail-closed paths (no real secrets needed)**

Run: `npx vercel dev` (first run will prompt to link/create a local Vercel project — accept the defaults; this only affects local `.vercel/` state, already gitignored).

In a second terminal, with `PORTAL_JWKS_URL`/`PORTAL_ISSUER`/`SSO_AUDIENCE`/`SUPABASE_SERVICE_ROLE_KEY` deliberately left unset locally:

```bash
curl -i "http://localhost:3000/api/auth/portal-callback"
```
Expected: `HTTP/1.1 302 Found` with `Location: http://localhost:3000/?error=sso` (missing `token` short-circuits before env vars are even read).

```bash
curl -i "http://localhost:3000/api/auth/portal-callback?token=not-a-real-jwt"
```
Expected: `HTTP/1.1 302 Found` with `Location: http://localhost:3000/?error=sso` (env vars unset → `requireEnv` throws → caught → redirect; confirms fail-closed behavior end-to-end at the routing layer, without needing the real portal or Supabase secrets).

- [ ] **Step 9: Commit**

```bash
git add api/auth/portal-callback.ts tsconfig.api.json tsconfig.json .env.example .gitignore package.json package-lock.json
git commit -m "feat: add SSO portal callback route"
```

---

## After this plan: manual setup (already documented, not repeated here)

Deploying real SSO — setting the production env vars in Vercel, confirming the Supabase Redirect URLs allow-list, giving the portal owner the callback URL, and testing end-to-end with real signed tokens — is the "Setup work" section of `docs/superpowers/specs/2026-07-22-sso-portal-callback-design.md`. That's manual, outside-the-codebase work for after this plan's two tasks are merged, not a coding task.
