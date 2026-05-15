import { parsePosition } from '../lib/parser'
import type { RankingRecord } from '../types'

interface Props {
  record: RankingRecord
}

/**
 * Renders the ranking position exactly as it appears in the source file:
 *   "3 ⇑ (6)"        in green       (BP matrix — parens hold previous pos)
 *   "12 ⇓ 10"        in red         (LP matrix — trailing number is prev pos)
 *   "5"              inherits color (no movement)
 *   "Not in top 100" dimmed
 *   "–"              dimmed         (no data)
 *
 * No tooltip, no delta computation — the cell mirrors the upload verbatim
 * so what you see in the dashboard is what the export contained.
 */
export function PosBadge({ record }: Props) {
  const pos = parsePosition(record.position)

  if (pos === null) {
    return <span className="text-[11px] opacity-30">–</span>
  }

  if (pos === 'NR') {
    return <span className="text-[10px] whitespace-nowrap">Not in top 100</span>
  }

  const change = record.change ?? ''
  const isUp   = /[⇑↑]/.test(change) || /^\s*\+?\d+\s*$/.test(change)        // legacy: "+3" / "3" → green
  const isDown = /[⇓↓]/.test(change) || /^\s*-\d+\s*$/.test(change)          // legacy: "-3" → red
  const color  = isUp   ? '#15803D'
               : isDown ? '#B91C1C'
               : undefined

  // For arrow-bearing change strings ("⇑ (6)", "⇓ 10"), render verbatim.
  // For legacy numeric strings, recreate the old "↑ (n)" notation so
  // existing Supabase rows stay readable without a re-upload.
  let suffix = ''
  if (change) {
    if (/[⇑⇓↑↓]/.test(change)) {
      suffix = ` ${change.trim()}`
    } else {
      const n = parseFloat(change)
      if (!isNaN(n) && n !== 0) {
        suffix = ` ${n > 0 ? '↑' : '↓'} (${Math.abs(n)})`
      }
    }
  }

  return (
    <span
      className="text-[11px] font-normal whitespace-nowrap"
      style={color ? { color } : undefined}
    >
      {pos}{suffix}
    </span>
  )
}
