/**
 * ============================================================================
 * Setup.gs — First-time setup helpers
 * ============================================================================
 * Creates CONFIG, RAW_IMPORT, ERROR_LOG sheets if they do not exist.
 * Does NOT touch existing brand dashboard sheets.
 */

function firstTimeSetup() {
  const ss = SpreadsheetApp.getActive();
  const created = [];

  if (!ss.getSheetByName(SHEETS.CONFIG)) {
    const s = ss.insertSheet(SHEETS.CONFIG);
    s.getRange(1, 1, 1, 4).setValues([['Domain', 'Brand', 'Type', 'SheetName']]).setFontWeight('bold');
    s.setFrozenRows(1);
    s.setColumnWidths(1, 4, 200);
    created.push(SHEETS.CONFIG);
  }
  if (!ss.getSheetByName(SHEETS.IMPORT)) {
    const s = ss.insertSheet(SHEETS.IMPORT);
    s.getRange(1, 1, 1, 7).setValues([['Domain','Keyword','Country','Position','Previous','Change','Last Check']])
                          .setFontWeight('bold');
    s.setFrozenRows(1);
    s.setColumnWidths(1, 7, 140);
    created.push(SHEETS.IMPORT);
  }
  if (!ss.getSheetByName(SHEETS.ERROR_LOG)) {
    const s = ss.insertSheet(SHEETS.ERROR_LOG);
    s.getRange(1, 1, 1, 4).setValues([['Timestamp','Level','Message','Context']]).setFontWeight('bold');
    s.setFrozenRows(1);
    s.setColumnWidths(1, 4, 220);
    created.push(SHEETS.ERROR_LOG);
  }

  SpreadsheetApp.getUi().alert('First-time setup',
    created.length ? `Created: ${created.join(', ')}` : 'All required sheets already exist.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
