// Brand data now lives in api/_lib/brands.ts so the serverless functions can
// import it too — api/ cannot import from src/, but src/ can import from api/.
// This file stays the frontend's import site, so no consumer changed.
export type { Brand } from '../../api/_lib/brands.js'
export {
  BRANDS, BRAND_BY_NAME, DOMAIN_TO_BRAND, LP_DOMAIN_TO_BRAND, COUNTRY_LABELS,
  normalizeCountry,
} from '../../api/_lib/brands.js'

import { BRANDS } from '../../api/_lib/brands.js'

export function brandToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export const BRAND_BY_SLUG: Record<string, import('../../api/_lib/brands.js').Brand> =
  Object.fromEntries(BRANDS.map((b) => [brandToSlug(b.name), b]))

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
  'FortunePlay': '#CA8A04',
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
  'FortunePlay': '/Brand-Favicon/fortuneplay.webp',
  'RocketSpin':  '/Brand-Favicon/rocketspin.webp',
  'PlayMojo':    '/Brand-Favicon/playmojo.webp',
  'Rollero':     '/Brand-Favicon/rollero.webp',
}
