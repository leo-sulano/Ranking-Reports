/**
 * ============================================================================
 * Importer.gs — RAW_IMPORT loader + row normalization
 * ============================================================================
 *
 * Returns Array<{
 *   domain:string, keyword:string, country:string,
 *   position:number|null, previous:number|null, change:number,
 *   lastCheck:Date|null, lastCheckRaw:string
 * }>
 */

function loadImportData(ctx) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.IMPORT);
  if (!sheet) {
    log(ctx, 'FATAL', `RAW_IMPORT sheet "${SHEETS.IMPORT}" not found. Run "First-time setup".`);
    return [];
  }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values[0].map(c => String(c).trim().toLowerCase());
  const idx = {
    domain:    header.indexOf('domain'),
    keyword:   header.indexOf('keyword'),
    country:   header.indexOf('country'),
    position:  header.indexOf('position'),
    previous:  header.indexOf('previous'),
    change:    header.indexOf('change'),
    lastCheck: header.indexOf('last check'),
  };

  const missing = Object.entries(idx).filter(([, v]) => v < 0).map(([k]) => k);
  if (missing.length) {
    log(ctx, 'FATAL', `RAW_IMPORT missing columns: ${missing.join(', ')}`);
    return [];
  }

  const out = [];
  const seen = new Set();
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const domain  = normalizeDomain(row[idx.domain]);
    const keyword = String(row[idx.keyword] || '').trim();
    const country = String(row[idx.country] || '').trim().toUpperCase();
    if (!domain || !keyword || !country) continue;

    const position = parseNumber(row[idx.position]);
    const previous = parseNumber(row[idx.previous]);
    let change = parseNumber(row[idx.change]);
    if (change == null && position != null && previous != null) change = previous - position;
    if (change == null) change = 0;

    const { date: lastCheck, raw: lastCheckRaw } = parseDateValue(row[idx.lastCheck]);

    const dedupeKey = `${domain}|${keyword.toLowerCase()}|${country}|${lastCheckRaw}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({ domain, keyword, country, position, previous, change, lastCheck, lastCheckRaw });
  }
  return out;
}

function parseNumber(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDateValue(v) {
  if (v instanceof Date) return { date: v, raw: Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') };
  const raw = String(v || '').trim();
  if (!raw) return { date: null, raw: '' };
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { date: new Date(+m[1], +m[2] - 1, +m[3]), raw };
  const d = new Date(raw);
  return { date: isNaN(d.getTime()) ? null : d, raw };
}
