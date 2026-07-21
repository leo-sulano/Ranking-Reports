import type { FtdRecord, FtdRecordPatch, FtdTotals, BrandStags } from '../types'
import { supabase } from './supabase'

export interface FtdData {
  records: FtdRecord[]
  totals:  FtdTotals[]
  stags:   BrandStags[]
}

export async function loadFtdData(): Promise<FtdData> {
  const [recordsRes, totalsRes, stagsRes] = await Promise.all([
    supabase.from('ftd_records').select('brand, year_month, reg, ftd, conversion_pct'),
    supabase.from('ftd_totals').select('year_month, conversion_pct'),
    supabase.from('brand_stags').select('brand, stags'),
  ])
  if (recordsRes.error) throw recordsRes.error
  if (totalsRes.error)  throw totalsRes.error
  if (stagsRes.error)   throw stagsRes.error

  const records: FtdRecord[] = (recordsRes.data ?? []).map((r) => ({
    brand:         r.brand as string,
    yearMonth:     r.year_month as string,
    reg:           r.reg as number,
    ftd:           r.ftd as number,
    conversionPct: r.conversion_pct as number | null,
  }))

  const totals: FtdTotals[] = (totalsRes.data ?? []).map((t) => ({
    yearMonth:     t.year_month as string,
    conversionPct: t.conversion_pct as number | null,
  }))

  const stags: BrandStags[] = (stagsRes.data ?? []).map((s) => ({
    brand: s.brand as string,
    stags: s.stags as string,
  }))

  return { records, totals, stags }
}

/**
 * Partial upsert on (brand, year_month) — only the columns present in
 * `patch` are written. On INSERT the omitted columns take their table
 * defaults (0 for reg/ftd); on UPDATE (conflict) only the passed columns
 * are overwritten, leaving the rest untouched. This is what lets a single
 * inline cell edit (e.g. just REG) coexist safely with the full-row
 * FtdEntryForm submit.
 */
export async function upsertFtdRecord(
  brand: string,
  yearMonth: string,
  patch: FtdRecordPatch,
): Promise<void> {
  const payload: Record<string, unknown> = { brand, year_month: yearMonth }
  if ('reg'           in patch) payload.reg            = patch.reg
  if ('ftd'           in patch) payload.ftd            = patch.ftd
  if ('conversionPct' in patch) payload.conversion_pct = patch.conversionPct
  const { error } = await supabase.from('ftd_records').upsert(payload, { onConflict: 'brand,year_month' })
  if (error) throw error
}

export async function upsertFtdTotals(yearMonth: string, conversionPct: number | null): Promise<void> {
  const { error } = await supabase
    .from('ftd_totals')
    .upsert({ year_month: yearMonth, conversion_pct: conversionPct }, { onConflict: 'year_month' })
  if (error) throw error
}

export async function upsertBrandStags(brand: string, stags: string): Promise<void> {
  const { error } = await supabase
    .from('brand_stags')
    .upsert({ brand, stags }, { onConflict: 'brand' })
  if (error) throw error
}
