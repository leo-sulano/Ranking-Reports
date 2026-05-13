import { parsePosition, parseChange } from '../lib/parser'
import type { RankingRecord } from '../types'

interface Props {
  record: RankingRecord
}

/**
 * Renders a ranking position in the canonical dashboard format:
 *   improved  →  "1 ↑ (2)"   in green
 *   dropped   →  "7 ↓ (3)"   in red
 *   no change →  "5"          in current text color (black on white, light on dark)
 *   not ranked → "Not in top 100"  dimmed
 *   no data   →  "–"            dimmed
 *
 * Uses `currentColor` for the no-change case so the badge inherits the
 * surrounding table's text color — looks correct on both white and dark
 * backgrounds.
 */
export function PosBadge({ record }: Props) {
  const pos = parsePosition(record.position)
  const chg = parseChange(record.change)

  if (pos === null) {
    return <span className="text-[11px] opacity-30">–</span>
  }

  if (pos === 'NR') {
    return <span className="text-[11px] opacity-60 whitespace-nowrap">Not in top 100</span>
  }

  const isUp   = chg !== null && chg > 0
  const isDown = chg !== null && chg < 0
  const color  = isUp   ? '#16A34A'    // green-600
               : isDown ? '#DC2626'    // red-600
               : undefined             // inherit (black on white, light on dark)

  const tip = [
    record.previous ? `Prev: ${record.previous}` : '',
    record.date     ? `Date: ${record.date}`     : '',
  ].filter(Boolean).join(' · ')

  return (
    <span
      className="text-[11px] font-semibold whitespace-nowrap"
      style={color ? { color } : undefined}
      title={tip || undefined}
    >
      {pos}
      {isUp   && <> {'↑'} ({Math.abs(chg!)})</>}
      {isDown && <> {'↓'} ({Math.abs(chg!)})</>}
    </span>
  )
}
