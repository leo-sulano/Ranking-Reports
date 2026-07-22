import type { Brand } from '../types'

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
      'lucky7casino.de',
      'lucky7seven.net',
      'lucky7seven.org',
      'lucky7seven.de',
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
      'roostercasino.de',
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
      'spinsupcasinos.de',
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
      'spinjo.de',
      'spinjocasino.net',
    ],
  },
  {
    name: 'FortunePLay',
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
      'fortuneplaycasino.de',
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

export function brandToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export const BRAND_BY_SLUG: Record<string, Brand> = Object.fromEntries(
  BRANDS.map((b) => [brandToSlug(b.name), b]),
)

// domain (lowercase) → brand name. BP/MAIN domains only.
export const DOMAIN_TO_BRAND: Record<string, string> = {}
BRANDS.forEach((b) => b.domains.forEach((d) => { DOMAIN_TO_BRAND[d.toLowerCase()] = b.name }))

// Landing-page domain → brand name. Kept separate from DOMAIN_TO_BRAND so the
// BP and LP namespaces don't bleed across category-tagged uploads.
export const LP_DOMAIN_TO_BRAND: Record<string, string> = {}
BRANDS.forEach((b) => b.lpDomains.forEach((d) => { LP_DOMAIN_TO_BRAND[d.toLowerCase()] = b.name }))

// Logo-accurate brand colors — sampled from each brand's actual favicon
// (public/Brand-Favicon/), distinct from Brand.color (the generic value used
// for Home stats/badges app-wide). Used wherever a brand needs to visually
// match its real identity: BP/LP Sites' brand grid cards, FTDs' brand column
// headers.
export const BRAND_LOGO_COLORS: Record<string, string> = {
  'Lucky 7even': '#7C3AED',
  'RoosterBet':  '#DC2626',
  'LuckyVibe':   '#2563EB',
  'SpinsUp':     '#EC4899',
  'Spinjo':      '#22D3EE',
  'FortunePLay': '#CA8A04',
  'RocketSpin':  '#0EA5E9',
  'PlayMojo':    '#64748B',
  'Rollero':     '#B8860B',
}

// Favicon image path for each brand, served from public/Brand-Favicon/.
// Rendered in place of the abbreviation badge on BP/LP Sites' brand grid cards.
export const BRAND_FAVICONS: Record<string, string> = {
  'Lucky 7even': '/Brand-Favicon/lucky7even.webp',
  'RoosterBet':  '/Brand-Favicon/roosterbet.webp',
  'LuckyVibe':   '/Brand-Favicon/luckyvibe.webp',
  'SpinsUp':     '/Brand-Favicon/spinsup.webp',
  'Spinjo':      '/Brand-Favicon/spinjo.webp',
  'FortunePLay': '/Brand-Favicon/fortuneplay.webp',
  'RocketSpin':  '/Brand-Favicon/rocketspin.webp',
  'PlayMojo':    '/Brand-Favicon/playmojo.webp',
  'Rollero':     '/Brand-Favicon/rollero.webp',
}

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
