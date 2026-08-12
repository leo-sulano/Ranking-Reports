/**
 * Brand configuration, shared by the browser and the serverless functions.
 *
 * This lives under api/ rather than src/ because api/ cannot import from src/
 * (tsconfig.api.json uses NodeNext, and Vercel's runtime needs explicit .js
 * specifiers), while src/ CAN import from here — bundler resolution maps the
 * .js specifier back to this .ts file. src/lib/brands.ts re-exports everything
 * below, so the frontend's import site is unchanged.
 *
 * Nothing here may import from src/, or the serverless build breaks.
 *
 * SHIPS IN THE BROWSER BUNDLE — being under api/ does not make this server
 * code. No secrets, no process.env, no node: imports. (Server-only neighbours,
 * where those are fine: ranks.ts, snapshotStore.ts, requestAuth.ts,
 * ssoPortal.ts.)
 */
export interface Brand {
  name: string
  abbr: string
  color: string
  mainDomain: string
  domains: string[]
  lpDomains: string[]
}

export const BRANDS: Brand[] = [
  {
    name: 'Lucky 7even',
    abbr: 'L7',
    color: '#F59E0B',
    mainDomain: 'lucky7even.com',
    domains: [
      'lucky7even.com',
      'lucky7evencasino.com',
      'lucky7evencasino.io',
      'lucky7evencasino.org',
      'lucky7seven.com',
    ],
    lpDomains: [
      'lucky7even.club',
      'lucky7evencasino.org',
      'lucky7seven.net',
      'lucky7seven.org',
    ],
  },
  {
    name: 'RoosterBet',
    abbr: 'RB',
    color: '#EF4444',
    mainDomain: 'rooster.bet',
    domains: [
      'rooster.bet',
      'roosters.bet',
      'roostersbet.com',
      'casinoroosters.com',
    ],
    lpDomains: [
      'roosterbet.club',
      'roosterbet.io',
      'roosterbet.info',
    ],
  },
  {
    name: 'LuckyVibe',
    abbr: 'LV',
    color: '#10B981',
    mainDomain: 'luckyvibe.com',
    domains: [
      'luckyvibe.com',
      'luckyvibe.io',
      'casinoluckyvibe.com',
      'luckyvibecasino.com',
    ],
    lpDomains: [
      'luckyvibe.net',
      'casino-luckyvibe.com',
      'casinos-luckyvibe.com',
      'casinosluckyvibe.com',
      'luckyvibe-casino.com',
      'luckyvibe.casino',
      'luckyvibe.club',
      'luckyvibescasino.com',
    ],
  },
  {
    name: 'SpinsUp',
    abbr: 'SU',
    color: '#8B5CF6',
    mainDomain: 'spinsup.com',
    domains: [
      'spinsup.com',
      'spinsup.io',
      'spinsupcasino.com',
      'casinospinsup.com',
    ],
    lpDomains: [
      'spinsupcasinos.com',
      'casino-spinsup.com',
      'spinsup-casino.com',
      'spinsup.casino',
      'spinsup.club',
      'spinsupcasino.net',
      'spinsupcasino.org',
    ],
  },
  {
    name: 'Spinjo',
    abbr: 'SJ',
    color: '#38BDF8',
    mainDomain: 'spinjo.com',
    domains: [
      'spinjo.com',
      'spinjo.io',
      'spinjocasino.com',
      'casinospinjo.com',
    ],
    lpDomains: [
      'spinjo.club',
      'spinjos.casino',
      'spinjo.it.com',
      'spinjo.info',
      'spinjocasino.net',
    ],
  },
  {
    name: 'FortunePlay',
    abbr: 'FP',
    color: '#EC4899',
    mainDomain: 'fortuneplay.com',
    domains: [
      'fortuneplay.com',
      'fortuneplay.casino',
      'fortuneplay.io',
      'fortuneplaycasino.net',
    ],
    lpDomains: [
      'fortuneplay.club',
      'fortuneplaylive.com',
      'fortuneplaycasino.org',
    ],
  },
  {
    name: 'RocketSpin',
    abbr: 'RS',
    color: '#F97316',
    mainDomain: 'rocketspin.com',
    domains: [
      'rocketspin.com',
      'rocketspin.io',
      'rocketspincasino.com',
      'casinorocketspin.com',
    ],
    lpDomains: [
      'casino-rocketspin.com',
      'casinosrocketspin.com',
      'rocketspin-casino.com',
      'rocketspin.casino',
      'rocketspin.club',
      'rocketspincasinos.com',
      'rocketspins.net',
      'rocketspinscasino.com',
    ],
  },
  {
    name: 'PlayMojo',
    abbr: 'PM',
    color: '#14B8A6',
    mainDomain: 'playmojo.com',
    domains: [
      'playmojo.com',
      'playmojo.io',
      'playmojocasino.com',
      'casinoplaymojo.com',
    ],
    lpDomains: [
      'casino-playmojo.com',
      'casinosplaymojo.com',
      'playmojo-casino.com',
      'playmojo.casino',
      'playmojo.club',
      'playmojo.net',
      'playmojo.org',
      'playmojocasinos.com',
      'playmojos.com',
    ],
  },
  {
    name: 'Rollero',
    abbr: 'RO',
    color: '#84CC16',
    mainDomain: 'rollero.com',
    domains: [
      'rollero.com',
      'rollero.io',
      'rollerocasino.com',
      'casinorollero.com',
    ],
    lpDomains: [
      'rollero.net',
      'rollerocasinos.com',
      'rolleros.casino',
      'rolleroscasino.com',
      'casino-rollero.com',
      'casinosrollero.com',
      'rollero-casino.com',
      'rollero.casino',
      'rollero.club',
    ],
  },
]

export const BRAND_BY_NAME: Record<string, Brand> = Object.fromEntries(
  BRANDS.map((b) => [b.name, b]),
)

// domain (lowercase) → brand name. BP/MAIN domains only.
export const DOMAIN_TO_BRAND: Record<string, string> = {}
BRANDS.forEach((b) => b.domains.forEach((d) => { DOMAIN_TO_BRAND[d.toLowerCase()] = b.name }))

// Landing-page domain → brand name. Kept separate from DOMAIN_TO_BRAND so the
// BP and LP namespaces don't bleed across category-tagged uploads.
export const LP_DOMAIN_TO_BRAND: Record<string, string> = {}
BRANDS.forEach((b) => b.lpDomains.forEach((d) => { LP_DOMAIN_TO_BRAND[d.toLowerCase()] = b.name }))

export const COUNTRY_LABELS: Record<string, string> = {
  Australia: 'AU',
  Canada: 'CA',
  Germany: 'DE',
  Italy: 'IT',
  'New Zealand': 'NZ',
  AU: 'AU',
  CA: 'CA',
  DE: 'DE',
  IT: 'IT',
  NZ: 'NZ',
}

/**
 * Coerce a country cell to a 2-letter code:
 *   "Australia"   → "AU"
 *   "australia"   → "AU"
 *   "AU"          → "AU"
 *   "au"          → "AU"
 *   "ZZ"          → "ZZ"   (unknown → uppercased pass-through so it still
 *                            matches itself in lookups)
 *
 * Shared with the API sync (`src/lib/sitesNormalize.ts`) and NOT to be
 * duplicated: `applyCarryForward` keys on `${domain}|${keyword}|${country}`
 * with the country NOT case-folded, so any divergence between the two ingest
 * paths silently breaks GSV/SV/AFF carry-forward between an uploaded and a
 * synced snapshot, and adds a phantom entry to the country filter.
 */
export function normalizeCountry(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''

  // Try the literal value (handles "Australia", "AU", etc.)
  const direct = COUNTRY_LABELS[s]
  if (direct) return direct

  // Try lowercased/normalized variants of full names
  const norm = s.toLowerCase().replace(/\s+/g, ' ')
  for (const [key, code] of Object.entries(COUNTRY_LABELS)) {
    if (key.toLowerCase() === norm) return code
  }

  // Already a 2-letter code in some other case? Uppercase it.
  if (s.length === 2) return s.toUpperCase()

  return s.toUpperCase()
}
