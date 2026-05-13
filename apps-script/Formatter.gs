/**
 * ============================================================================
 * Formatter.gs — Ranking display rules
 * ============================================================================
 *
 *   improved   →  "1 ↑ (2)"
 *   dropped    →  "7 ↓ (3)"
 *   no change  →  "5"
 *   not ranked →  "Not in top 100"
 *
 * Convention used here for "change": positive = improved (moved UP the SERP).
 *   - Positive change → ↑ arrow
 *   - Negative change → ↓ arrow
 *   - Zero            → bare number
 */

function formatRanking(position, change) {
  if (position == null || position === '' || Number(position) <= 0 || Number(position) > 100) {
    return 'Not in top 100';
  }
  const p = Number(position);
  const c = Number(change || 0);
  if (c > 0) return `${p} ↑ (${c})`;
  if (c < 0) return `${p} ↓ (${Math.abs(c)})`;
  return String(p);
}
