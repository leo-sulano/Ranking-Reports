/**
 * ============================================================================
 * Config.gs — CONFIG sheet loader
 * ============================================================================
 *
 * Returns:
 *   {
 *     byDomain:      Map<domain, {brand, type, sheetName}>
 *     brandToSheet:  Map<brand, sheetName>
 *     brandDomains:  Map<brand, { main: domain[], bp: domain[] }>
 *   }
 */

function loadConfig(ctx) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.CONFIG);
  if (!sheet) {
    log(ctx, 'FATAL', `CONFIG sheet "${SHEETS.CONFIG}" not found. Run "First-time setup".`);
    return null;
  }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    log(ctx, 'FATAL', 'CONFIG sheet has no data rows.');
    return null;
  }

  const header = values[0].map(c => String(c).trim().toLowerCase());
  const idxDomain    = header.indexOf('domain');
  const idxBrand     = header.indexOf('brand');
  const idxType      = header.indexOf('type');
  const idxSheetName = header.indexOf('sheetname');

  if (idxDomain < 0 || idxBrand < 0 || idxType < 0) {
    log(ctx, 'FATAL', 'CONFIG header must include Domain, Brand, Type.');
    return null;
  }

  const byDomain = new Map();
  const brandToSheet = new Map();
  const brandDomains = new Map();

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const domain = normalizeDomain(row[idxDomain]);
    const brand  = String(row[idxBrand] || '').trim();
    const type   = String(row[idxType]  || '').trim().toLowerCase();
    const sheetName = idxSheetName >= 0 ? String(row[idxSheetName] || '').trim() : '';

    if (!domain || !brand || !type) continue;
    if (type !== 'main' && type !== 'bp') {
      log(ctx, 'WARN', `CONFIG row ${r + 1}: invalid type "${type}" — must be main or bp`);
      continue;
    }
    if (byDomain.has(domain)) {
      log(ctx, 'WARN', `CONFIG row ${r + 1}: duplicate domain "${domain}" — using last seen`);
    }

    byDomain.set(domain, { brand, type, sheetName: sheetName || brand, domain });
    brandToSheet.set(brand, sheetName || brand);

    if (!brandDomains.has(brand)) brandDomains.set(brand, { main: [], bp: [] });
    brandDomains.get(brand)[type].push(domain);
  }

  return { byDomain, brandToSheet, brandDomains };
}

/** Strip protocol/www/trailing slash; lowercase. */
function normalizeDomain(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.replace(/\/.*$/, '');
  return s;
}

/** Menu command — readability report for the CONFIG sheet. */
function validateConfig() {
  const ctx = createContext();
  const cfg = loadConfig(ctx);
  if (!cfg) { flushLog(ctx); return; }

  const ss = SpreadsheetApp.getActive();
  const lines = [];
  for (const [brand, info] of cfg.brandDomains.entries()) {
    const sheetName = cfg.brandToSheet.get(brand);
    const present = !!ss.getSheetByName(sheetName);
    lines.push(`${brand}  →  sheet "${sheetName}" ${present ? 'OK' : 'MISSING'} | main=${info.main.length} bp=${info.bp.length}`);
  }
  SpreadsheetApp.getUi().alert('CONFIG validation', lines.join('\n') || 'No brands found.', SpreadsheetApp.getUi().ButtonSet.OK);
  flushLog(ctx);
}
