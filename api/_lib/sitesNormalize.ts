// SHIPS IN THE BROWSER BUNDLE — src/lib/sitesNormalize.ts re-exports from here,
// so being under api/ does not make this server code. No secrets, no
// process.env, no node: imports. (Server-only neighbours, where those are fine:
// ranks.ts, snapshotStore.ts, requestAuth.ts, ssoPortal.ts.)
//
// One implementation for both ingest paths. See its doc comment: carry-forward
// keys on a byte-compared country, so a second, subtly different normalizer
// here would break GSV/SV/AFF inheritance between synced and uploaded
// snapshots. Project 0 returns codes COUNTRY_LABELS already maps to
// themselves, and an unrecognised value is uppercased and kept rather than
// dropped — it surfaces in the summary's Countries count.
import { DOMAIN_TO_BRAND, normalizeCountry } from './brands.js'

/**
 * One row as the Ranks API actually returns it. Types are deliberately loose:
 * the upstream is PHP and has been observed returning ints where the vendor doc
 * promises null, so every field is coerced rather than trusted.
 */
export interface ApiRow {
  domain:            string
  keyword:           string
  country:           string | null
  language?:         string | null
  position:          number | string | null
  previous_position: number | string | null
  change:            number | string | null
  url_found:         string | null
  checked_at:        string | null
  project_id?:       number
}

/**
 * Structurally identical to the app's RankingRecord. Declared here because
 * api/_lib must not import from src/. src/lib/sitesNormalize.ts carries a
 * compile-time guard that fails the build if the two shapes ever diverge.
 */
export interface SyncRecord {
  domain:              string
  keyword:             string
  country:             string
  position:            string
  previous:            string
  change:              string
  date:                string
  searchVolume?:       string
  affiliateUrl?:       string
  globalSearchVolume?: string
}

/** Structurally identical to the app's UnknownDomain, for the same reason. */
export interface SkippedDomain {
  domain: string
  count:  number
}

export interface NormalizeResult {
  records:        SyncRecord[]
  /** Rows dropped because the domain is not in BRANDS, counted per domain, busiest first. */
  unknownDomains: SkippedDomain[]
  /** Newest checked_at date among the KEPT rows; '' when none. */
  rawDate:        string
}

/** Lowercase, trim, drop a leading `www.` — the upstream mixes all three forms. */
export function canonicalDomain(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase().replace(/^www\./, '')
}

/**
 * The API signals "not ranking" with 0 far more often than with null — 403 of
 * 1,109 Rooster rows are 0, while the vendor doc mentions only null. Treat
 * both, plus anything non-positive or unparseable, as NR.
 */
export function positionToString(p: number | string | null | undefined): string {
  if (p === null || p === undefined || p === '') return 'NR'
  const n = Number(p)
  if (!Number.isFinite(n) || n <= 0) return 'NR'
  return String(n)
}

/** Signed movement string. Positive means the rank improved. */
export function changeToString(c: number | string | null | undefined): string {
  if (c === null || c === undefined || c === '') return ''
  const n = Number(c)
  if (!Number.isFinite(n)) return ''
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : String(n)
}

/** Date portion of a checked_at value. Accepts 'YYYY-MM-DD HH:MM:SS' and ISO. */
export function checkedAtDate(s: string | null | undefined): string {
  if (!s) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

/**
 * Normalise a timestamp into a directly-comparable form: ISO 'T' becomes a
 * space and a trailing 'Z' is dropped. Without this a raw string compare would
 * rank any ISO row above any space-separated row on the same date ('T' is 0x54,
 * ' ' is 0x20) regardless of actual clock time.
 */
function comparableTimestamp(s: string | null | undefined): string {
  return (s ?? '').replace('T', ' ').replace(/Z$/, '')
}

/**
 * Keep only the newest row per (domain, keyword, country).
 *
 * A no-op against project 0 today — every key appears exactly once. It stays as
 * a guard: BIF-Dashboard observed up to 6 rows per key on project 18, because
 * `action=results` is a check log rather than current state. A row with an
 * empty timestamp sorts lowest, which is what we want.
 */
export function reduceLatest(rows: ApiRow[]): ApiRow[] {
  const best = new Map<string, ApiRow>()
  for (const r of rows) {
    const key = [
      canonicalDomain(r.domain),
      (r.keyword ?? '').trim().toLowerCase(),
      normalizeCountry(r.country),
    ].join('|')
    const prev = best.get(key)
    if (!prev || comparableTimestamp(r.checked_at) > comparableTimestamp(prev.checked_at)) {
      best.set(key, r)
    }
  }
  return [...best.values()]
}

export function normalizeRows(rows: ApiRow[]): NormalizeResult {
  const skippedCounts = new Map<string, number>()
  const kept: ApiRow[] = []

  // DOMAIN_TO_BRAND is the only filter — NOT project_id. The 56 project-18 rows
  // on shared Rooster domains use the same keyword vocabulary as project 0 and
  // fill (domain, keyword, country) keys project 0 did not check that week.
  for (const r of reduceLatest(rows)) {
    const domain = canonicalDomain(r.domain)
    if (!DOMAIN_TO_BRAND[domain]) {
      skippedCounts.set(domain, (skippedCounts.get(domain) ?? 0) + 1)
      continue
    }
    kept.push(r)
  }

  // Date the snapshot from the retained rows only: a foreign domain's later
  // checked_at must never date a batch that does not contain it.
  let rawDate = ''
  for (const r of kept) {
    const d = checkedAtDate(r.checked_at)
    if (d > rawDate) rawDate = d
  }

  const records: SyncRecord[] = kept.map((r) => ({
    domain:   canonicalDomain(r.domain),
    keyword:  (r.keyword ?? '').trim(),
    country:  normalizeCountry(r.country),
    position: positionToString(r.position),
    previous: positionToString(r.previous_position),
    change:   changeToString(r.change),
    // An undated row stays undated. Falling back to the batch date would stamp
    // a never-crawled row as freshly checked and destroy the only signal
    // separating "the vendor never looked" from "looked and found nothing".
    date:     checkedAtDate(r.checked_at),
    // Not supplied by the API. applyCarryForward inherits them from the
    // previous snapshot, which is exactly what it was built for.
    searchVolume:       '',
    affiliateUrl:       '',
    globalSearchVolume: '',
  }))

  const unknownDomains: SkippedDomain[] = [...skippedCounts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))

  return { records, unknownDomains, rawDate }
}
