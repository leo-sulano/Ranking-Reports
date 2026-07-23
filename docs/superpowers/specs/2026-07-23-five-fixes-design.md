# Five Fixes — Design

**Date:** 2026-07-23
**Status:** Approved by owner (chat), pending spec review

Five owner-requested changes, shipped as four sequential PRs based on `main`
(per the standard one-branch-per-change flow). Supabase SQL steps run in the
SQL editor at merge time; the auth env flag flips only after the final PR is
live in production.

---

## 1. Rename brand `FortunePLay` → `FortunePlay`

**Code (PR 1):**

- `src/lib/brands.ts`: the brand entry's `name`, plus the `'FortunePLay'` keys
  in `BRAND_LOGO_COLORS` and `BRAND_FAVICONS`.
- Docs that spell it `FortunePLay`: `CLAUDE.md`, `docs/DOCUMENTATION.md`.
  (Historical docs — `DONE_TASKS.md`, `docs/task-history.md`, old specs/plans —
  stay as written; they describe past work.)

**Data (Supabase SQL editor, run at merge time):**

```sql
update public.ftd_records set brand = 'FortunePlay' where brand = 'FortunePLay';
update public.brand_stags  set brand = 'FortunePlay' where brand = 'FortunePLay';
```

Rationale: `RankingRecord` does not store brand names (derived from domain via
`DOMAIN_TO_BRAND`), but `ftd_records` and `brand_stags` key rows by brand name.
Without the SQL update, FortunePlay's FTD history would silently disappear.

**Risk:** if a `'FortunePlay'` row somehow already exists for the same key, the
update conflicts on the unique constraint — check with a `select` first; merge
rows manually if so (not expected).

## 2. Remove the "Data" badge on brand cards

Remove the `hasData` pill (`<span>…Data</span>`) from the brand-grid cards in
`src/pages/BPSites.tsx` and `src/pages/LPSites.tsx`, along with each card's
now-unused `hasData` computation. No other consumer exists.

## 3. Light/dark theming for the spreadsheet-style tables

**Problem:** the spreadsheet-look surfaces — BP/LP ranking matrices
(`Home.tsx` / `BPSites.tsx` / `LPSites.tsx`), `FtdMatrixTable`, the
`Countries` tables, `PosBadge`, `EditableCell` — hardcode a light palette
(`#FFFFFF`, `#F8FAFC`, `#B0B7BD`, green totals set, pos/neg tints, …), so they
stay glaring white in dark mode.

**Chosen approach — extend Color System v1 with `--matrix-*` tokens:**

- Add a token block to `src/index.css` alongside the existing Color System v1
  variables, with values per theme:
  - `--matrix-bg`, `--matrix-border`, `--matrix-sticky-bg`,
    `--matrix-subhead-bg`, `--matrix-stags-bg`, `--matrix-year-row-bg`,
    `--matrix-ink`, `--matrix-muted`,
    `--matrix-totals-header-bg`, `--matrix-totals-subhead-bg`,
    `--matrix-totals-cell-bg`, and pos/neg tint tokens.
  - The final token list is fixed during implementation by inventorying every
    hardcoded hex in the components above; each distinct role becomes one
    token (no per-component one-offs — that's what makes the tables uniform).
- **Light values = the exact hex used today.** Light mode must be visually
  unchanged — it intentionally matches the client's Google Sheet. The
  "harmonized matrix-pastel" set (color-system spec section 07) is explicitly
  NOT adopted here; that remains a separate future conversation.
- **Dark values = navy-anchored solid equivalents** consistent with Color
  System v1's dark surfaces.
- Components swap hardcoded hex → `var(--matrix-…)`.

**Constraints:**

- Sticky cells overlay scrolled content, so every token used on a sticky cell
  must be a **solid** color in both themes (no alpha), matching the existing
  comment in `FtdMatrixTable`.
- The brand-tint overlay trick (solid white base + alpha gradient) must get a
  dark-safe equivalent: same pattern, but the base comes from
  `--matrix-sticky-bg` and tint alphas are re-checked for contrast on dark.
- This supersedes the earlier "matrices intentionally stay light in dark mode"
  decision (owner request, 2026-07-23).

**Verification:** `npm run build` + Playwright screenshots of each table in
both themes against `npm run dev`; light mode diffed against current
production look.

## 4. Sign-in gate — approved users only

**Decision (owner):** seeing any data requires being signed in AND approved.
A self-registered (pending) account sees an "awaiting approval" screen, not
data. Anon loses read access at the database level, so data stops being
reachable even via the raw Supabase REST API.

**Frontend (PR 4):**

- `src/components/AuthGate.tsx`: extend the existing gate. When
  `VITE_REQUIRE_AUTH=true`:
  - no session → `<Login />` (exists);
  - session but `user_access.status !== 'approved'` → new "awaiting admin
    approval" screen showing the signed-in email and a Sign out button;
  - approved → app.
  - The approval check reuses `getUserAccess` (`src/lib/userAccess.ts`);
    loading states mirror the existing "Checking session…" treatment.
- Env: `VITE_REQUIRE_AUTH=true` in Vercel Production (and local `.env` for
  dev). Flipped ONLY after PR 4 is deployed.

**Database (new `supabase/auth-approved-lockdown.sql`, run at flip time):**

- A `security definer` helper, e.g.
  `public.is_approved() returns boolean` — checks
  `user_access.status = 'approved'` for `auth.uid()`. Security definer avoids
  RLS recursion when other tables' policies read `user_access`.
- For all five data tables (`snapshots`, `ranking_records`, `ftd_records`,
  `ftd_totals`, `brand_stags`): drop the anon-read and auth-write policies
  installed by `auth-write-lockdown.sql` / `schema.sql`, and create
  select/insert/update/delete policies `to authenticated using
  (public.is_approved())`. This also tightens WRITES to approved-only at the
  DB level (previously enforced only app-side).
- Idempotent (`drop policy if exists` + `create or replace function`), like
  the existing lockdown files. Header comment documents the flip checklist
  and rollback (re-run `auth-write-lockdown.sql`).
- The prepared `auth-lockdown.sql` (any-authenticated) is superseded; its
  header gets a pointer to the new file.

**Compatibility notes:**

- Portal SSO users are auto-approved at provisioning
  (`api/portal-callback.ts` upserts `status: 'approved'`) — they pass the
  gate.
- Google/email self-sign-ups land pending → approval screen → admin approves
  at `/admin/users`.
- `user_access` policies themselves are untouched (users can already read
  their own row; admins manage rows).

**Flip sequence (production):**

1. Merge PR 4 (auto-deploys).
2. Run `auth-approved-lockdown.sql` in the Supabase SQL editor.
3. Set `VITE_REQUIRE_AUTH=true` in Vercel and redeploy.
4. Verify: signed out → login wall; pending account → approval screen; anon
   REST call with the anon key → empty/denied; approved account → full app.

(Ordering note: between steps 2 and 3 the deployed UI still tries anon reads
and will show empty tables to anon visitors — acceptable for the minutes the
flip takes, and strictly safer than the reverse order.)

## 5. Show who is logged in

- `src/components/Topbar.tsx`: when a session exists, show the signed-in
  email (`session.user.email`) beside the Sign out button, in the same muted
  mono style; hidden on narrow mobile widths (`hidden sm:inline` or similar)
  to avoid crowding.
- The awaiting-approval screen (item 4) also states the signed-in email.
- Ships in PR 4 (same surfaces as the gate work).

---

## PR breakdown

| PR | Branch | Contents |
|----|--------|----------|
| 1 | `fix/fortuneplay-name` | Item 1 (code + docs); SQL run at merge |
| 2 | `chore/remove-data-badge` | Item 2 |
| 3 | `feat/matrix-theming` | Item 3 |
| 4 | `feat/auth-gate-approved` | Items 4 + 5; SQL + env flip after deploy |

PRs 2 and 3 touch the same files (BPSites/LPSites) — merge sequentially,
never stacked (base every branch on `main`).

## Out of scope (deferred, from previous session)

- Verifying auth-gated surfaces' colors on production (do after PR 4 flips).
- Harmonized matrix-pastel set (client conversation first).
- Nested-`<button>` fix on brand cards (separate change; item 2 does not
  restructure the cards).
