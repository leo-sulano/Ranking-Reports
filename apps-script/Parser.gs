/**
 * ============================================================================
 * Parser.gs — Dynamic dashboard structure detection
 * ============================================================================
 *
 * Real dashboard layout (per brand sheet):
 *
 *   Row 1 (country header) :  | 0       | Country | GSV | AU | SV | AFF | CA | SV | AFF | ... | AU | CA | DE | IT | NZ | ...
 *   Row 2 (domain header)  :  |         | Domain  |     |        lucky7even.com (merged across MAIN cols)        | lucky7evencasino.com (BP) | lucky7evencasino.io (BP) | ...
 *   Row 3 (date band)      :  |         | 05/13/26 (merged)
 *   Row 4 (section recap)  :  |         | Country | AU | SV | AFF | CA | ...
 *   Rows 5–10 (keywords)   :  | 1..6    | <keyword text>
 *   Row 11 blank
 *   Row 12 (next date)     :  |         | 05/08/26
 *   …
 *
 * Key facts:
 *   • Blocks (domain → column range) are GLOBAL — defined ONCE by row 2.
 *   • Country header is GLOBAL — defined ONCE by row 1.
 *   • Per date section we only detect KEYWORD ROWS.
 *   • Keywords live in column B (column A is a 1–N row counter).
 *   • Date markers live in column B (merged across the row for visual span).
 *
 * The parser detects everything dynamically:
 *   1. Domain row    = the row (among first 20) with the most CONFIG-domain matches.
 *   2. Country row   = the row near the domain row with the most ALLOWED_COUNTRY_CODES.
 *   3. Blocks        = each non-empty CONFIG-domain cell in the domain row starts a block;
 *                      block ends at the column before the next domain hit.
 *   4. countryMap    = per block, scan the country header row inside the block range;
 *                      keep only ALLOWED_COUNTRY_CODES; skip PROTECTED_COLUMNS_*.
 *   5. Date sections = rows below the domain row whose col A OR col B is a date marker.
 *   6. Keyword rows  = inside each section, col B values, normalized, skipping 'country'/'domain'.
 *
 * Returns:
 *   {
 *     domainRow:        number  (1-based)
 *     countryHeaderRow: number  (1-based)
 *     blocks: [{
 *       domain:   string,
 *       type:     'main' | 'bp',
 *       startCol: number, endCol: number,    // 1-based, inclusive
 *       countryMap: { [code]: column1Based }
 *     }]
 *     dateSections: [{
 *       dateLabel:  string,
 *       date:       Date | null,
 *       startRow:   number, endRow: number,  // 1-based
 *       keywordRows: Map<normalizedKeyword, row1Based>
 *     }]
 *   }
 *
 * Caching: per sheet on ctx._parserCache.
 */

function parseSheetStructure(ctx, sheet, brand, config) {
  ctx._parserCache = ctx._parserCache || new Map();
  const cacheKey = sheet.getSheetId();
  if (ctx._parserCache.has(cacheKey)) return ctx._parserCache.get(cacheKey);

  const grid = sheet.getDataRange().getValues();
  const numRows = grid.length;
  const numCols = numRows ? grid[0].length : 0;

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Find the DOMAIN ROW (most CONFIG-domain matches in first 20 rows)
  // ──────────────────────────────────────────────────────────────────────────
  let domainRow = -1, domainHits = [];
  {
    let bestScore = 0;
    const scanLimit = Math.min(20, numRows);
    for (let r = 0; r < scanLimit; r++) {
      const hits = findDomainsInRow(grid[r], config.byDomain);
      if (hits.length > bestScore) {
        bestScore = hits.length;
        domainRow = r;
        domainHits = hits;
      }
    }
  }
  if (domainRow < 0 || domainHits.length === 0) {
    log(ctx, 'ERROR',
      'Could not find a domain header row. Make sure CONFIG domains appear ' +
      'literally in the top 20 rows of the brand sheet (typically row 2).');
    const empty = { blocks: [], dateSections: [], domainRow: -1, countryHeaderRow: -1 };
    ctx._parserCache.set(cacheKey, empty);
    return empty;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Find the COUNTRY HEADER ROW (most ALLOWED_COUNTRY_CODES near domain row)
  // ──────────────────────────────────────────────────────────────────────────
  let countryHeaderRow = -1;
  {
    let bestScore = 0;
    const lo = Math.max(0, domainRow - 5);
    const hi = Math.min(domainRow + 5, numRows - 1);
    for (let r = lo; r <= hi; r++) {
      if (r === domainRow) continue;
      const score = countCountryCells(grid[r]);
      if (score > bestScore) { bestScore = score; countryHeaderRow = r; }
    }
  }
  if (countryHeaderRow < 0) {
    log(ctx, 'ERROR',
      'Country header row not found near domain row. ' +
      'Expected a row with country codes (AU/CA/DE/…) within 5 rows of the domain row.');
    const empty = { blocks: [], dateSections: [], domainRow: domainRow + 1, countryHeaderRow: -1 };
    ctx._parserCache.set(cacheKey, empty);
    return empty;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Build BLOCKS from the domain row (left to right)
  // ──────────────────────────────────────────────────────────────────────────
  const sortedHits = domainHits.slice().sort((a, b) => a.col - b.col);
  const blocks = sortedHits.map((hit, i) => {
    const startCol = hit.col + 1;
    const next = sortedHits[i + 1];
    const endCol = next ? next.col : numCols - 1;
    return {
      domain: hit.domain,
      type: hit.type,
      startCol,
      endCol: endCol + 1,
      countryMap: {}
    };
  });

  // 3a. Per-block country map (scan only within each block's column range)
  const countryRowVals = grid[countryHeaderRow];
  for (const b of blocks) {
    const protectedSet = b.type === 'main' ? PROTECTED_COLUMNS_MAIN : PROTECTED_COLUMNS_BP;
    for (let c = b.startCol - 1; c <= b.endCol - 1 && c < numCols; c++) {
      const token = String(countryRowVals[c] || '').trim().toUpperCase();
      if (!token) continue;
      if (protectedSet.has(token)) continue;
      if (!ALLOWED_COUNTRY_CODES.has(token)) continue;
      if (b.countryMap[token]) continue;
      b.countryMap[token] = c + 1;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Find DATE SECTIONS below the domain row (scan col A then col B)
  // ──────────────────────────────────────────────────────────────────────────
  const sectionStarts = [];
  for (let r = domainRow + 1; r < numRows; r++) {
    const m = detectDateMarker(grid[r][0]) || detectDateMarker(grid[r][1]);
    if (m) sectionStarts.push({ row: r, label: m.label, date: m.date });
  }
  for (let i = 0; i < sectionStarts.length; i++) {
    sectionStarts[i].endRow = (i + 1 < sectionStarts.length)
      ? sectionStarts[i + 1].row - 1
      : numRows - 1;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Keyword rows per section (col B, skipping 'Country' / 'Domain' recaps)
  // ──────────────────────────────────────────────────────────────────────────
  const dateSections = sectionStarts.map(sec => {
    const keywordRows = new Map();
    for (let r = sec.row + 1; r <= sec.endRow; r++) {
      const keyword = normalizeKeyword(grid[r][1]);
      if (!keyword) continue;
      if (keyword === 'country' || keyword === 'domain') continue;
      if (keywordRows.has(keyword)) continue;
      keywordRows.set(keyword, r + 1);
    }
    return {
      dateLabel: sec.label,
      date: sec.date,
      startRow: sec.row + 1,
      endRow: sec.endRow + 1,
      keywordRows,
    };
  });

  const structure = {
    blocks,
    dateSections,
    domainRow: domainRow + 1,
    countryHeaderRow: countryHeaderRow + 1,
  };
  ctx._parserCache.set(cacheKey, structure);
  return structure;
}

/**
 * For a given row, return every cell that contains a CONFIG-registered domain.
 * Exact normalized match first, then substring fallback (handles cells like
 * "Main: lucky7even.com" or "lucky7even.com (main)").
 */
function findDomainsInRow(rowVals, byDomain) {
  const hits = [];
  for (let c = 0; c < rowVals.length; c++) {
    const raw = rowVals[c];
    if (raw === '' || raw == null) continue;
    const normalized = normalizeDomain(raw);
    if (!normalized) continue;

    let mapping = byDomain.get(normalized);
    if (!mapping) {
      for (const d of byDomain.keys()) {
        if (normalized.indexOf(d) >= 0) { mapping = byDomain.get(d); break; }
      }
    }
    if (!mapping) continue;
    hits.push({ col: c, domain: mapping.domain, type: mapping.type });
  }
  return hits;
}

/**
 * Detect whether a cell starts a date section.
 *
 * Accepted:
 *   - Date object
 *   - "yyyy-MM-dd" anywhere in the cell
 *   - "MM/DD/YY"  (e.g. "05/08/26" → 2026-05-08)
 *   - "MM/DD/YYYY"
 *   - any string starting with "DATE"
 *
 * Slash dates are interpreted as MM/DD/YY (US format). 2-digit years
 * expand to 2000+YY.
 */
function detectDateMarker(cell) {
  if (cell instanceof Date) return { label: cell.toISOString().slice(0, 10), date: cell };
  const s = String(cell || '').trim();
  if (!s) return null;

  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { label: `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`, date: new Date(+iso[1], +iso[2] - 1, +iso[3]) };

  const slash = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) {
    const month = +slash[1];
    const day   = +slash[2];
    let year    = +slash[3];
    if (year < 100) year += 2000;
    return { label: s, date: new Date(year, month - 1, day) };
  }

  if (/^DATE\b/i.test(s)) return { label: s, date: null };

  return null;
}

function countCountryCells(rowValues) {
  let n = 0;
  for (const v of rowValues) {
    const t = String(v || '').trim().toUpperCase();
    if (ALLOWED_COUNTRY_CODES.has(t)) n++;
  }
  return n;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function normalizeKeyword(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Choose which date section a given import row belongs to.
 *   1. exact same calendar day, or
 *   2. nearest date (any direction), or
 *   3. first section (top = newest, by dashboard convention).
 */
function pickDateSection(sections, importDate) {
  if (sections.length === 0) return null;
  if (!importDate) return sections[0];

  const sameDay = sections.find(s => s.date && sameDate(s.date, importDate));
  if (sameDay) return sameDay;

  let best = null, bestDiff = Infinity;
  for (const s of sections) {
    if (!s.date) continue;
    const diff = Math.abs(s.date.getTime() - importDate.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best || sections[0];
}

function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}
