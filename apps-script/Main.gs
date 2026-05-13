/**
 * ============================================================================
 * Main.gs — Entry points + orchestration
 * ============================================================================
 *
 * Public functions:
 *   onOpen()            → installs "Rankings" custom menu
 *   processRankings()   → main automation; processes RAW_IMPORT into dashboard
 *   validateConfig()    → sanity-checks CONFIG sheet
 *   clearErrorLog()     → wipes ERROR_LOG (keeps header row)
 *   firstTimeSetup()    → creates CONFIG/RAW_IMPORT/ERROR_LOG if missing
 *
 * Trigger recommendation:
 *   Time-driven trigger on processRankings() — daily at 06:00 (matches your
 *   typical SEO-tool export cadence). See README for full guidance.
 * ============================================================================
 */

/** Constants exposed to other files via global lexical scope. */
const SHEETS = Object.freeze({
  CONFIG: 'CONFIG',
  IMPORT: 'RAW_IMPORT',
  ERROR_LOG: 'ERROR_LOG',
});

/** Country codes the automation is allowed to write into. Extend as needed. */
const ALLOWED_COUNTRY_CODES = new Set([
  'AU','CA','DE','IT','NZ','UK','GB','US','IE','NL','BR','FR','ES',
  'SE','NO','FI','DK','AT','CH','PT','PL','CZ','JP','BE','LU'
]);

/** Columns that must NEVER be overwritten in a MAIN block. */
const PROTECTED_COLUMNS_MAIN = new Set(['GSV','SV','AFF','URL','LINK']);

/** Columns that must NEVER be overwritten in a BP block. */
const PROTECTED_COLUMNS_BP = new Set(['AFF','URL','LINK']);

/** Header tokens used to detect website-block boundaries in the dashboard. */
const BLOCK_TYPE_TOKENS = Object.freeze({
  main: ['MAIN SITE', 'MAIN WEBSITE', 'MAIN'],
  bp:   ['BP SITE', 'BP WEBSITE', 'BP'],
});

/** How many rows below a date-section marker to scan for block + country headers. */
const HEADER_SCAN_DEPTH = 8;

/** Spreadsheet-wide menu bootstrap. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Rankings')
    .addItem('Process RAW_IMPORT', 'processRankings')
    .addSeparator()
    .addItem('Diagnose layout (active sheet)', 'diagnoseLayout')
    .addItem('Validate CONFIG', 'validateConfig')
    .addItem('Clear ERROR_LOG', 'clearErrorLog')
    .addSeparator()
    .addItem('First-time setup', 'firstTimeSetup')
    .addToUi();
}

/**
 * Parse the currently active sheet and write the detected structure to
 * ERROR_LOG. NO dashboard cells are touched — this is read-only.
 *
 * Use this BEFORE the first real run to confirm the parser sees your sheet
 * the way you expect: date sections, block boundaries, country columns,
 * keyword rows.
 */
function diagnoseLayout() {
  const ctx = createContext();
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    const sheetName = sheet.getName();

    if (sheetName === SHEETS.CONFIG || sheetName === SHEETS.IMPORT || sheetName === SHEETS.ERROR_LOG) {
      SpreadsheetApp.getUi().alert(
        'Diagnose layout',
        `Open a brand sheet first — "${sheetName}" is a system sheet.`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    const config = loadConfig(ctx);
    if (!config) { flushLog(ctx); return; }

    // Resolve sheet → brand via CONFIG
    let brand = null;
    for (const [b, name] of config.brandToSheet.entries()) {
      if (name === sheetName) { brand = b; break; }
    }
    if (!brand) {
      log(ctx, 'WARN', `Sheet "${sheetName}" not in CONFIG — block→domain mapping will show "(unmapped)"`);
      brand = '__diagnose__';
      config.brandDomains.set(brand, { main: [], bp: [] });
    }

    log(ctx, 'INFO', `=== Diagnose: sheet="${sheetName}" brand="${brand}" ===`);
    const struct = parseSheetStructure(ctx, sheet, brand, config);

    log(ctx, 'INFO',
      `Layout anchors: domainRow=${struct.domainRow} countryHeaderRow=${struct.countryHeaderRow}`);

    log(ctx, 'INFO', `Detected ${struct.blocks.length} website block(s):`);
    struct.blocks.forEach((b, i) => {
      const countries = Object.entries(b.countryMap)
        .map(([k, v]) => `${k}=col${v}`)
        .join(', ');
      log(ctx, 'INFO',
        `  Block #${i + 1}: type=${b.type} domain=${b.domain} ` +
        `cols=${b.startCol}..${b.endCol} ` +
        `countries={${countries || 'none'}}`);
    });

    log(ctx, 'INFO', `Detected ${struct.dateSections.length} date section(s):`);
    struct.dateSections.forEach((s, i) => {
      const dateStr = s.date ? Utilities.formatDate(s.date, Session.getScriptTimeZone(), 'yyyy-MM-dd') : 'null';
      const sample = [...s.keywordRows.keys()].slice(0, 6);
      log(ctx, 'INFO',
        `  Section #${i + 1}: label="${s.dateLabel}" date=${dateStr} ` +
        `rows=${s.startRow}..${s.endRow} keywords=${s.keywordRows.size}`);
      if (sample.length) {
        log(ctx, 'INFO', `    Keywords (first 6): ${sample.join(' | ')}`);
      }
    });

    SpreadsheetApp.getActive().toast(
      `Diagnose written to ${SHEETS.ERROR_LOG}. ` +
      `${struct.blocks.length} block(s), ${struct.dateSections.length} section(s) on "${sheetName}".`,
      'Rankings', 6
    );
  } catch (err) {
    log(ctx, 'ERROR', `diagnoseLayout failed: ${err && err.message}`, err && err.stack);
  } finally {
    flushLog(ctx);
  }
}

/**
 * Main automation. Reads RAW_IMPORT, dispatches per brand sheet, batches writes.
 */
function processRankings() {
  const ctx = createContext();
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    SpreadsheetApp.getActive().toast('Another run is in progress — aborting.', 'Rankings', 5);
    return;
  }

  try {
    const config = loadConfig(ctx);
    if (!config) { flushLog(ctx); return; }

    const importRows = loadImportData(ctx);
    log(ctx, 'INFO', `Loaded ${importRows.length} import rows, ${config.byDomain.size} CONFIG domains.`);

    const rowsByBrand = groupBy(importRows, row => {
      const m = config.byDomain.get(row.domain);
      if (!m) {
        log(ctx, 'WARN', `No CONFIG mapping for domain "${row.domain}"`,
            `keyword=${row.keyword} country=${row.country}`);
        return null;
      }
      return m.brand;
    });

    let totalApplied = 0, totalSkipped = 0;
    for (const [brand, rows] of rowsByBrand.entries()) {
      if (!brand) { totalSkipped += rows.length; continue; }
      const result = processBrandSheet(ctx, brand, rows, config);
      totalApplied += result.applied;
      totalSkipped += result.skipped;
    }

    log(ctx, 'INFO', `Done. applied=${totalApplied} skipped=${totalSkipped}`);
    SpreadsheetApp.getActive().toast(
      `Rankings updated: ${totalApplied} written, ${totalSkipped} skipped. See ERROR_LOG for details.`,
      'Rankings', 6
    );
  } catch (err) {
    log(ctx, 'FATAL', `Unhandled: ${err && err.message}`, err && err.stack);
  } finally {
    flushLog(ctx);
    lock.releaseLock();
  }
}

/**
 * Process one brand sheet end-to-end.
 */
function processBrandSheet(ctx, brand, rows, config) {
  const sheetName = config.brandToSheet.get(brand) || brand;
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) {
    rows.forEach(r => log(ctx, 'ERROR', `Brand sheet "${sheetName}" not found`,
        `brand=${brand} domain=${r.domain} keyword=${r.keyword}`));
    return { applied: 0, skipped: rows.length };
  }

  const structure = parseSheetStructure(ctx, sheet, brand, config);
  if (!structure || structure.blocks.length === 0) {
    rows.forEach(r => log(ctx, 'ERROR', 'No website blocks detected on sheet',
        `brand=${brand} sheet=${sheetName}`));
    return { applied: 0, skipped: rows.length };
  }
  if (structure.dateSections.length === 0) {
    rows.forEach(r => log(ctx, 'ERROR', 'No date sections detected on sheet',
        `brand=${brand} sheet=${sheetName}`));
    return { applied: 0, skipped: rows.length };
  }

  const updater = new SheetUpdater(sheet);
  let applied = 0, skipped = 0;

  for (const row of rows) {
    const outcome = applyImportRow(ctx, row, brand, structure, updater, config);
    if (outcome.applied) applied++; else skipped++;
  }

  updater.flush();
  log(ctx, 'INFO', `[${brand}] sheet="${sheetName}" applied=${applied} skipped=${skipped}`);
  return { applied, skipped };
}

/**
 * Map a single import row through the parsed dashboard structure and queue
 * the corresponding cell update.
 */
function applyImportRow(ctx, row, brand, structure, updater, config) {
  const mapping = config.byDomain.get(row.domain);
  if (!mapping) return { applied: false };

  // Block is GLOBAL — defined once by the domain row at the top of the sheet.
  const block = structure.blocks.find(b => b.domain === row.domain);
  if (!block) {
    log(ctx, 'WARN', `No website block for domain "${row.domain}" on this sheet`,
        `brand=${brand} keyword=${row.keyword}`);
    return { applied: false };
  }

  // Country column comes from the block's countryMap (built from the global country header).
  const col = block.countryMap[row.country];
  if (!col) {
    log(ctx, 'WARN', `No country column "${row.country}" in block for ${row.domain}`,
        `brand=${brand} country=${row.country}`);
    return { applied: false };
  }

  const protectedSet = block.type === 'main' ? PROTECTED_COLUMNS_MAIN : PROTECTED_COLUMNS_BP;
  if (protectedSet.has(row.country.toUpperCase())) {
    log(ctx, 'WARN', `Refused to write protected column "${row.country}"`,
        `brand=${brand} domain=${row.domain}`);
    return { applied: false };
  }

  // Date section is per-import-date.
  const section = pickDateSection(structure.dateSections, row.lastCheck);
  if (!section) {
    log(ctx, 'WARN', `No date section matches "${row.lastCheckRaw}"`,
        `brand=${brand} domain=${row.domain}`);
    return { applied: false };
  }

  // Keyword row lives within the chosen date section (col B).
  const keywordKey = normalizeKeyword(row.keyword);
  const targetRow = section.keywordRows.get(keywordKey);
  if (!targetRow) {
    log(ctx, 'WARN', `Keyword "${row.keyword}" not found in section ${section.dateLabel}`,
        `brand=${brand} domain=${row.domain}`);
    return { applied: false };
  }

  const display = formatRanking(row.position, row.change);

  const existing = updater.read(targetRow, col);
  if (existing === display) return { applied: true, deduped: true };

  updater.set(targetRow, col, display);
  return { applied: true };
}

/** Wipe ERROR_LOG except header. */
function clearErrorLog() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.ERROR_LOG);
  if (!sheet) return;
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
  SpreadsheetApp.getActive().toast('ERROR_LOG cleared.', 'Rankings', 3);
}
