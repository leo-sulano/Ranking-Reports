/**
 * Snapshot date labelling, shared by the browser and the serverless functions.
 *
 * SHIPS IN THE BROWSER BUNDLE — src/lib/parser.ts re-exports from here, so this
 * file is compiled into the client. No secrets, no process.env, no node:
 * imports. (Server-only neighbours: ranks.ts, snapshotStore.ts, requestAuth.ts,
 * ssoPortal.ts.)
 *
 * Its own module rather than a corner of brands.ts because this is date
 * presentation, not brand configuration, and brands.ts is deliberately a
 * data-only file with no functions beyond normalizeCountry.
 *
 * Every write path calls this so the three of them agree: the xlsx import, the
 * Sync button (both via src/lib/parser.ts) and api/cron-sync.ts. What the
 * agreement actually buys is consistent activity_log summary text — the stored
 * snapshots.display_date is never rendered, because src/lib/storage.ts
 * re-formats it from raw_date on every read.
 */

/**
 * '2026-08-04' → 'Aug 4, 2026'. Empty input is 'Unknown Date'; anything
 * unparseable comes back unchanged rather than as 'Invalid Date'.
 */
export function formatDisplayDate(raw: string): string {
  if (!raw) return 'Unknown Date'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  // YYYY-MM-DD literals: build a local Date so toLocaleDateString doesn't
  // shift the displayed day across the UTC boundary (e.g. UTC- zones would
  // otherwise show the previous day for a "2026-05-13" ISO date).
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return d.toLocaleDateString('en-US', opts)
  }
  const d = new Date(raw)
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', opts)
  }
  return raw
}
