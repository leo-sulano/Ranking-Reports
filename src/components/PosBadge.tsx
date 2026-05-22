import { parsePosition } from '../lib/parser'
import type { RankingRecord } from '../types'

interface Props {
  record: RankingRecord
  // When supplied, cross-snapshot comparison is used instead of record.change.
  // undefined → no prev snapshot available; fall back to within-file change field.
  // null       → prev snapshot exists but this key wasn't in it; show no color.
  crossSnapPrevPos?: number | 'NR' | null
}

/**
 * Renders the ranking position with movement color/arrow.
 *
 * When crossSnapPrevPos is provided (BPSites passes the previous snapshot's
 * parsed position), color is driven by the delta between snapshots so that
 * a rank that stayed the same shows plain black regardless of what the
 * Excel's own change column says.
 *
 * Without crossSnapPrevPos (oldest snapshot, LP sites) the component falls
 * back to the within-file change field — "⇑ (6)" style for BP matrix,
 * plain numeric for legacy flat-format rows.
 */
export function PosBadge({ record, crossSnapPrevPos }: Props) {
  const pos = parsePosition(record.position)

  if (pos === null) {
    return <span className="text-[11px] opacity-30">–</span>
  }

  if (pos === 'NR') {
    return <span className="text-[10px] whitespace-nowrap">Not in top 100</span>
  }

  // ── Cross-snapshot path ───────────────────────────────────────────────────
  if (crossSnapPrevPos !== undefined) {
    let color: string | undefined
    let suffix = ''

    if (crossSnapPrevPos === 'NR') {
      // Was not ranking, now is — entered rankings
      color = '#15803D'
      suffix = ' ↑'
    } else if (typeof crossSnapPrevPos === 'number') {
      if (crossSnapPrevPos > pos) {
        // Rank number decreased = position improved
        color = '#15803D'
        suffix = ` ↑ (${crossSnapPrevPos})`
      } else if (crossSnapPrevPos < pos) {
        // Rank number increased = position dropped
        color = '#B91C1C'
        suffix = ` ↓ (${crossSnapPrevPos})`
      }
      // crossSnapPrevPos === pos → same position, no color/suffix
    }
    // crossSnapPrevPos === null → no previous data, no color

    return (
      <span
        className="text-[11px] font-normal whitespace-nowrap"
        style={color ? { color } : undefined}
      >
        {pos}{suffix}
      </span>
    )
  }

  // ── Within-file fallback (oldest snapshot / LP sites) ────────────────────
  const change = record.change ?? ''

  // BP-matrix cells use "⇑ (n)" where n is the previous position, not a delta.
  // If previous position === current position, there is no actual movement.
  const bpParensMatch = /^[⇑⇓↑↓]\s*\(\s*(\d+)\s*\)$/.exec(change.trim())
  const inFilePrevPos = bpParensMatch ? parseInt(bpParensMatch[1], 10) : null
  const noActualMovement = inFilePrevPos !== null && inFilePrevPos === pos

  const isUp   = !noActualMovement && (/[⇑↑]/.test(change) || /^\s*\+?\d+\s*$/.test(change))
  const isDown = !noActualMovement && (/[⇓↓]/.test(change) || /^\s*-\d+\s*$/.test(change))
  const color  = isUp   ? '#15803D'
               : isDown ? '#B91C1C'
               : undefined

  let suffix = ''
  if (change && !noActualMovement) {
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
