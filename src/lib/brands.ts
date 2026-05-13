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
  },
]

export const BRAND_BY_NAME: Record<string, Brand> = Object.fromEntries(
  BRANDS.map((b) => [b.name, b]),
)

// domain (lowercase) → brand name
export const DOMAIN_TO_BRAND: Record<string, string> = {}
BRANDS.forEach((b) => b.domains.forEach((d) => { DOMAIN_TO_BRAND[d.toLowerCase()] = b.name }))

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
