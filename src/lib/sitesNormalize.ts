import type { RankingRecord } from '../types'
import type { UnknownDomain } from './parser'
import type { SyncRecord, SkippedDomain } from '../../api/_lib/sitesNormalize.js'

// The normalizer moved to api/_lib so the cron can use it. This file stays the
// frontend's import site.
export type { ApiRow, NormalizeResult } from '../../api/_lib/sitesNormalize.js'
export {
  normalizeRows, canonicalDomain, positionToString, changeToString,
  checkedAtDate, reduceLatest,
} from '../../api/_lib/sitesNormalize.js'

/**
 * api/_lib declares its own record types because it cannot import from src/.
 * These assertions fail the build if the two ever drift — which matters because
 * applyCarryForward keys on a byte-compared country field, so a shape change on
 * one side and not the other would silently break GSV/SV/AFF inheritance.
 * Assignability is checked in BOTH directions on purpose: one direction alone
 * would let a field be added to either side unnoticed.
 */
type Assert<T extends true> = T
type Mutually<A, B> = A extends B ? (B extends A ? true : false) : false
export type _RecordShapesMatch  = Assert<Mutually<SyncRecord, RankingRecord>>
export type _SkippedShapesMatch = Assert<Mutually<SkippedDomain, UnknownDomain>>
