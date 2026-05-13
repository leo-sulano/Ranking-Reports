/**
 * ============================================================================
 * Parser.gs — Dynamic dashboard structure detection
 * ============================================================================
 *
 * Returns for one sheet:
 *   {
 *     dateSections: [{
 *       dateLabel: string,
 *       date: Date|null,
 *       startRow: number, endRow: number,
 *       blockHeaderRow: number, countryHeaderRow: number,
 *       blocks: [{
 *         domain: string|null,
 *         type: 'main'|'bp',
 *         startCol: number, endCol: number,
 *         countryMap: { [code:string]: number }
 *       }],
 *       keywordRows: Map<normalizedKeyword, rowIndex(1-based)>
 *     }]
 *   }
 *
 * Detection rules:
 *   - A date section starts at a row whose column-A cell is a Date OR a string
 *     containing a parseable date OR starts with "DATE".
 *   - Inside a section, scan HEADER_SCAN_DEPTH rows below the marker for:
 *       (a) block header row → contains MAIN/BP labels OR a CONFIG domain
 *       (b) country header row → row with ≥2 ALLOWED_COUNTRY_CODES tokens
 *   - Block boundaries: from each non-empty header cell to col-1 of the next
 *     non-empty header cell (or the last column with any value).
 *   - Country columns: only cells whose text is in ALLOWED_COUNTRY_CODES.
 *     Protected tokens (GSV/SV/AFF/URL) are deliberately excluded.
 *   - Keyword rows: rows below countryHeaderRow until the section ends. The
 *     keyword key is column A, trimmed + lowercased.
 *
 * Caching: structures are memoized per sheet on ctx._parserCache.
 */

function parseSheetStructure(ctx, sheet, brand, config) {
  ctx._parserCache = ctx._parserCache || new Map();
  const cacheKey = sheet.getSheetId();
  if (ctx._parserCache.has(cacheKey)) return ctx._parserCache.get(cacheKey);

  const grid = sheet.getDataRange().getValues();
  const numRows = grid.length;
  const numCols = grid.length ? grid[0].length : 0;

  // 1. Detect date-section marker rows
  const sectionStarts = [];
  for (let r = 0; r < numRows; r++) {
    const a = grid[r][0];
    const detected = detectDateMarker(a);
    if (detected) sectionStarts.push({ row: r, ...detected });
  }
  if (sectionStarts.length === 0) {
    ctx._parserCache.set(cacheKey, { dateSections: [] });
    return { dateSections: [] };
  }

  for (let i = 0; i < sectionStarts.length; i++) {
    sectionStarts[i].endRow = (i + 1 < sectionStarts.length)
      ? sectionStarts[i + 1].row - 1
      : numRows - 1;
  }

  const brandDomains = (config.brandDomains.get(brand) || { main: [], bp: [] });
  const knownDomains = [...brandDomains.main, ...brandDomains.bp];

  const dateSections = sectionStarts.map(sec => {
    const headerScanEnd = Math.min(sec.row + HEADER_SCAN_DEPTH, sec.endRow);

    let bestBlockRow = -1, bestBlockScore = 0, bestBlockHits = [];
    for (let r = sec.row; r <= headerScanEnd; r++) {
      const hits = scanBlockHeaderRow(grid[r], knownDomains);
      if (hits.length > bestBlockScore) {
        bestBlockScore = hits.length;
        bestBlockRow = r;
        bestBlockHits = hits;
      }
    }

    let bestCountryRow = -1, bestCountryScore = 0;
    const countryScanStart = bestBlockRow >= 0 ? bestBlockRow + 1 : sec.row + 1;
    const countryScanEnd = Math.min(countryScanStart + HEADER_SCAN_DEPTH, sec.endRow);
    for (let r = countryScanStart; r <= countryScanEnd; r++) {
      const score = countCountryCells(grid[r]);
      if (score > bestCountryScore) { bestCountryScore = score; bestCountryRow = r; }
    }

    if (bestBlockRow < 0 || bestCountryRow < 0) {
      return {
        dateLabel: sec.label, date: sec.date,
        startRow: sec.row + 1, endRow: sec.endRow + 1,
        blockHeaderRow: -1, countryHeaderRow: -1,
        blocks: [], keywordRows: new Map(),
        _diagnostic: 'block/country header row not detected'
      };
    }

    const sortedHits = bestBlockHits.slice().sort((a, b) => a.col - b.col);
    const blocks = sortedHits.map((hit, i) => {
      const startCol = hit.col + 1;
      const nextHit = sortedHits[i + 1];
      const endCol = nextHit ? nextHit.col : numCols - 1;
      return {
        domain: hit.domain || null,
        type: hit.type,
        startCol,
        endCol: endCol + 1,
        countryMap: {}
      };
    });

    let mainIdx = 0, bpIdx = 0;
    for (const b of blocks) {
      if (b.domain) continue;
      const pool = b.type === 'main' ? brandDomains.main : brandDomains.bp;
      const idx = b.type === 'main' ? mainIdx++ : bpIdx++;
      b.domain = pool[idx] || null;
    }

    const countryRow = grid[bestCountryRow];
    for (const b of blocks) {
      const protectedSet = b.type === 'main' ? PROTECTED_COLUMNS_MAIN : PROTECTED_COLUMNS_BP;
      for (let c = b.startCol - 1; c <= b.endCol - 1; c++) {
        const token = String(countryRow[c] || '').trim().toUpperCase();
        if (!token) continue;
        if (protectedSet.has(token)) continue;
        if (!ALLOWED_COUNTRY_CODES.has(token)) continue;
        if (b.countryMap[token]) continue;
        b.countryMap[token] = c + 1;
      }
    }

    const keywordRows = new Map();
    for (let r = bestCountryRow + 1; r <= sec.endRow; r++) {
      const k = normalizeKeyword(grid[r][0]);
      if (!k) continue;
      if (keywordRows.has(k)) continue;
      keywordRows.set(k, r + 1);
    }

    return {
      dateLabel: sec.label,
      date: sec.date,
      startRow: sec.row + 1,
      endRow: sec.endRow + 1,
      blockHeaderRow: bestBlockRow + 1,
      countryHeaderRow: bestCountryRow + 1,
      blocks,
      keywordRows,
    };
  });

  const structure = { dateSections };
  ctx._parserCache.set(cacheKey, structure);
  return structure;
}

/**
 * Detect whether a column-A cell starts a date section.
 */
function detectDateMarker(cell) {
  if (cell instanceof Date) return { label: cell.toISOString().slice(0, 10), date: cell };
  const s = String(cell || '').trim();
  if (!s) return null;

  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { label: `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`, date: new Date(+iso[1], +iso[2] - 1, +iso[3]) };

  const slash = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) return { label: s, date: new Date(+slash[3], +slash[2] - 1, +slash[1]) };

  if (/^DATE\b/i.test(s)) return { label: s, date: null };

  return null;
}

/** Returns array of {col, type, domain?} for cells that look like block headers. */
function scanBlockHeaderRow(rowValues, knownDomains) {
  const hits = [];
  for (let c = 0; c < rowValues.length; c++) {
    const raw = String(rowValues[c] || '').trim();
    if (!raw) continue;
    const upper = raw.toUpperCase();

    const matchedDomain = knownDomains.find(d => upper.includes(d.toUpperCase()));
    if (matchedDomain) {
      let type = 'main';
      if (BLOCK_TYPE_TOKENS.bp.some(t => upper.includes(t))) type = 'bp';
      else if (BLOCK_TYPE_TOKENS.main.some(t => upper.includes(t))) type = 'main';
      hits.push({ col: c, type, domain: normalizeDomain(matchedDomain) });
      continue;
    }

    if (BLOCK_TYPE_TOKENS.main.some(t => upper === t || upper.startsWith(t))) {
      hits.push({ col: c, type: 'main', domain: null });
      continue;
    }
    if (BLOCK_TYPE_TOKENS.bp.some(t => upper === t || upper.startsWith(t))) {
      hits.push({ col: c, type: 'bp', domain: null });
      continue;
    }
  }
  return hits;
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
