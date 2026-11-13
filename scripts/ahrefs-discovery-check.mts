// Read-only live check of the "other ranking keywords" Ahrefs client that
// spends 0 API units: it queries ahrefs.com — one of Ahrefs' free Site Explorer
// test targets — with the real discovery key. It prints the key's limit and
// cycle, the mapped rows and what Ahrefs charged, then exits 1 unless the key's
// usage is unchanged afterwards and the excluded keyword is absent. It never
// prints the key and never touches Supabase.
//
// The key comes from AHREFS_DISCOVERY_API_KEY in the environment, else ./.env.
//
//   npx tsx scripts/ahrefs-discovery-check.mts
import { existsSync, readFileSync } from 'node:fs'
import { discoveryConfig, fetchKeyLimits, fetchOrganicKeywords, sharesSyncKey } from '../api/_lib/ahrefsDiscovery.js'
import { cycleStart, excludeKeywordsWhere, mapOrganicKeywords } from '../api/_lib/keywordDiscovery.js'

/** Ahrefs charges no units for Site Explorer requests whose target is its own domain. */
const FREE_TARGET = 'ahrefs.com'
const EXCLUDED = 'ahrefs'

function fromDotEnv(name: string): string | undefined {
  if (!existsSync('.env')) return undefined
  const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') || undefined
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const env = {
  AHREFS_DISCOVERY_API_KEY: process.env.AHREFS_DISCOVERY_API_KEY?.trim() || fromDotEnv('AHREFS_DISCOVERY_API_KEY'),
  AHREFS_API_KEY:           process.env.AHREFS_API_KEY?.trim() || fromDotEnv('AHREFS_API_KEY'),
}
const config = discoveryConfig(env)
if (!config) fail('AHREFS_DISCOVERY_API_KEY is not set (env or .env)')
if (sharesSyncKey(env)) fail('AHREFS_DISCOVERY_API_KEY is the same key as AHREFS_API_KEY — refusing to run')

try {
  const before = await fetchKeyLimits(config)
  const cycle = cycleStart(before.resetDate)
  console.log(`key limit ${before.limit ?? 'NONE (unlimited)'} | used ${before.usage} | resets ${before.resetDate} | cycle started ${cycle}`)

  const res = await fetchOrganicKeywords(config, {
    domain: FREE_TARGET, country: 'AU', date: new Date().toISOString().slice(0, 10),
    excludeWhere: excludeKeywordsWhere([EXCLUDED]),
  })
  const rows = mapOrganicKeywords(res.body, { cycle, brand: 'TEST', domain: FREE_TARGET, country: 'AU' })
  const kinds: Record<string, number> = {}
  for (const r of rows) kinds[r.positionKind ?? 'null'] = (kinds[r.positionKind ?? 'null'] ?? 0) + 1
  console.log(`${FREE_TARGET} AU: ${res.rowCount} rows returned, ${rows.length} mapped, unitsActual ${res.unitsActual}`)
  console.log(`position kinds: ${JSON.stringify(kinds)}`)
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.keyword} | pos ${r.position} (${r.positionKind}) | vol ${r.volume ?? '—'} | ${r.url}`)
  }

  const after = await fetchKeyLimits(config)
  const excludedPresent = rows.some((r) => r.keyword === EXCLUDED)
  const usageNote = after.usage === before.usage ? 'unchanged' : `CHANGED by ${after.usage - before.usage}`
  console.log(`usage after: ${after.usage} (${usageNote}); "${EXCLUDED}" ${excludedPresent ? 'PRESENT' : 'absent'}`)
  if (after.usage !== before.usage) fail('The check spent units — it must only ever query a free test target.')
  if (excludedPresent) fail(`The where clause did not exclude "${EXCLUDED}".`)
  if (res.unitsActual !== 0) fail(`Ahrefs reported ${res.unitsActual} actual units for a free target.`)
  console.log('OK')
} catch (err) {
  // DiscoveryError messages never carry the key or the URL.
  fail((err as Error).message)
}
