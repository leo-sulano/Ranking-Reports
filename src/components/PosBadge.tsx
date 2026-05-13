import { parsePosition, parseChange } from '../lib/parser'
import type { RankingRecord } from '../types'

interface Props {
  record: RankingRecord
}

function posTier(pos: number | 'NR' | null): string {
  if (pos === null) return 'null'
  if (pos === 'NR') return 'nr'
  if (pos <= 3) return 'gold'
  if (pos <= 10) return 'green'
  if (pos <= 20) return 'sky'
  return 'dim'
}

const TIER_COLORS: Record<string, string> = {
  gold:  '#F59E0B',
  green: '#10B981',
  sky:   '#38BDF8',
  dim:   '#94A3B8',
  nr:    '#64748B',
  null:  'transparent',
}

export function PosBadge({ record }: Props) {
  const pos = parsePosition(record.position)
  const chg = parseChange(record.change)
  const tier = posTier(pos)
  const color = TIER_COLORS[tier]

  const tip = [
    record.previous ? `Prev: ${record.previous}` : '',
    record.date ? `Date: ${record.date}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  if (pos === null) {
    return <span className="text-[#1C2B3A] font-mono text-[11px]">–</span>
  }

  return (
    <div className="inline-flex flex-col items-center gap-0.5 min-w-[52px]" title={tip}>
      {pos === 'NR' ? (
        <span className="text-[13px] font-mono font-medium text-[#64748B] my-1">NR</span>
      ) : (
        <span className="font-display text-[22px] leading-none" style={{ color }}>
          {pos}
        </span>
      )}

      {chg !== null && chg !== 0 && (
        <span
          className="text-[10px] font-mono flex items-center gap-0.5"
          style={{ color: chg > 0 ? '#10B981' : '#F43F5E' }}
        >
          {chg > 0 ? '▲' : '▼'}
          {Math.abs(chg)}
        </span>
      )}
      {chg === 0 && pos !== 'NR' && (
        <span className="text-[10px] font-mono text-[#64748B]">—</span>
      )}
      {(chg === null || chg === undefined) && pos !== 'NR' && record.previous === '' && (
        <span className="text-[10px] font-mono text-[#38BDF8]">NEW</span>
      )}
    </div>
  )
}
