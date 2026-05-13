/**
 * ============================================================================
 * Logger.gs — Append-only ERROR_LOG buffered logger
 * ============================================================================
 *
 *   log(ctx, level, message, contextString?)
 *   flushLog(ctx)  — single setValues() append at end of run
 */

function createContext() {
  return {
    _logBuffer: [],
    _parserCache: new Map(),
    _runId: Utilities.getUuid().slice(0, 8),
    _startedAt: new Date(),
  };
}

function log(ctx, level, message, contextStr) {
  const ts = new Date();
  ctx._logBuffer.push([ts, level, message, contextStr || '']);
  console.log(`[${ctx._runId}] ${level} ${message}${contextStr ? ' | ' + contextStr : ''}`);
}

function flushLog(ctx) {
  if (!ctx._logBuffer.length) return;
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SHEETS.ERROR_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.ERROR_LOG);
    sheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Level', 'Message', 'Context']])
         .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, ctx._logBuffer.length, 4).setValues(ctx._logBuffer);
  ctx._logBuffer.length = 0;
}
