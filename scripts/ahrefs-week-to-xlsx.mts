// Read-only: prints one week of the client's Ahrefs Rank Tracker exactly as the
// sync would see it, and can write it as an import-ready xlsx for Import Data
// (BP Sites). Never touches Supabase, and only calls the free endpoints
// api/_lib/ahrefs.ts calls.
//
// Usage: npx tsx scripts/ahrefs-week-to-xlsx.mts <as-of YYYY-MM-DD> [out.xlsx]
//
// The key comes from AHREFS_API_KEY in the environment, else from ./.env. It is
// never printed. Output files hold client data, so they may only be written
// under docs/references/, which is gitignored.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { ahrefsConfig, fetchBpProjects } from '../api/_lib/ahrefs.js'
import { DOMAIN_TO_BRAND } from '../api/_lib/brands.js'
import { countOlderChecks, normalizeAhrefs } from '../api/_lib/sitesNormalize.js'
import { parseXlsx } from '../src/lib/parser'

const HEADER = ['Domain', 'Keyword', 'Country', 'Position', 'Previous', 'Change', 'Last Check']

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function loadKey(): string | undefined {
  const fromEnv = process.env.AHREFS_API_KEY?.trim()
  if (fromEnv) return fromEnv
  if (!existsSync('.env')) return undefined
  const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('AHREFS_API_KEY='))
  return line?.slice('AHREFS_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '') || undefined
}

const [asOf, out] = process.argv.slice(2)
if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  fail('Usage: npx tsx scripts/ahrefs-week-to-xlsx.mts <as-of YYYY-MM-DD> [out.xlsx]')
}

// Refuse a bad output path before spending any requests.
let outAbs: string | null = null
if (out) {
  const refs = resolve('docs/references')
  outAbs = resolve(out)
  const rel = relative(refs, outAbs)
  if (!outAbs.toLowerCase().endsWith('.xlsx') || rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    fail('Write the file under docs/references/ as .xlsx — that folder is gitignored, so client data never reaches the repo')
  }
}

const config = ahrefsConfig({ AHREFS_API_KEY: loadKey() })
if (!config) fail('AHREFS_API_KEY is not set (env or .env)')

let projects
try {
  projects = await fetchBpProjects(config, { asOf })
} catch (err) {
  // AhrefsError messages are worded for an operator and never carry the key.
  fail((err as Error).message)
}

let result
try {
  result = normalizeAhrefs(projects)
} catch (err) {
  fail((err as Error).message)
}
const { records, unknownDomains, rawDate } = result

const ranked = records.filter((r) => r.position !== 'NR').length
const brands = new Set(records.map((r) => DOMAIN_TO_BRAND[r.domain]))
const countries = [...new Set(records.map((r) => r.country))].sort()
console.log(`projects: ${projects.length}`)
console.log(`records: ${records.length} (ranked ${ranked}, NR ${records.length - ranked})`)
console.log(`weekly date: ${rawDate || '(none)'} (${countOlderChecks(records, rawDate)} kept an earlier check)`)
console.log(`brands: ${brands.size} · countries: ${countries.join(', ')}`)
console.log(`skipped domains: ${unknownDomains.length ? unknownDomains.map((u) => `${u.domain} (${u.count})`).join(', ') : 'none'}`)

if (outAbs) {
  const rows = [HEADER, ...records.map((r) => [r.domain, r.keyword, r.country, r.position, r.previous, r.change, r.date])]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'BP Sites')
  mkdirSync(dirname(outAbs), { recursive: true })
  writeFileSync(outAbs, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer)

  // Read it back with the app's own parser: the upload must land on the same
  // date and keep every record, or it would replace the wrong snapshot.
  const back = readFileSync(outAbs)
  const parsed = parseXlsx(back.buffer.slice(back.byteOffset, back.byteOffset + back.byteLength) as ArrayBuffer, 'bp-sites')
  const snap = parsed.snapshots[0]
  console.log(`parser check: rawDate ${snap?.rawDate ?? '(none)'}, ${snap?.records.length ?? 0} records`)
  if (parsed.snapshots.length !== 1 || snap.rawDate !== rawDate || snap.records.length !== records.length) {
    fail(`parser check failed: expected one snapshot dated ${rawDate} with ${records.length} records`)
  }
  console.log(`wrote ${relative(process.cwd(), outAbs)}`)
}
