// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as keywords from '../gsc-keywords.js'
import * as status from '../gsc-status.js'
import * as callback from '../gsc-callback.js'
import * as disconnect from '../gsc-disconnect.js'

// Vercel reads `config` from the endpoint's own source text. A re-exported constant
// (`export const config = GSC_CONFIG`) is not seen and the function gets the 10-15 s default,
// so each Google-calling endpoint must declare the literal, as api/sites.ts does.
const mods = { 'gsc-keywords': keywords, 'gsc-status': status, 'gsc-callback': callback, 'gsc-disconnect': disconnect }

describe('I-4b: Google-calling endpoints declare maxDuration 60', () => {
  for (const [name, mod] of Object.entries(mods)) {
    it(`${name} exports config.maxDuration 60 as a literal in its source`, () => {
      expect(mod.config.maxDuration).toBe(60)
      const src = readFileSync(fileURLToPath(new URL(`../${name}.ts`, import.meta.url)), 'utf8')
      expect(src).toMatch(/export const config = \{ maxDuration: 60 \}/)
    })
  }
})
