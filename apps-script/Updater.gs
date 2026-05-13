/**
 * ============================================================================
 * Updater.gs — SheetUpdater
 * ============================================================================
 *
 * Reads the full data range once, applies queued updates to an in-memory 2D
 * array, then writes the full range back in ONE setValues() call. This avoids
 * the per-cell write penalty and quota pressure of many small writes.
 */

function SheetUpdater(sheet) {
  this.sheet = sheet;
  this.range = sheet.getDataRange();
  this.values = this.range.getValues();
  this.numRows = this.values.length;
  this.numCols = this.values.length ? this.values[0].length : 0;
  this.dirty = false;
  this.touchedCells = 0;
}

SheetUpdater.prototype.read = function (row1, col1) {
  const r = row1 - 1, c = col1 - 1;
  if (r < 0 || r >= this.numRows || c < 0 || c >= this.numCols) return null;
  const v = this.values[r][c];
  return v == null ? '' : String(v);
};

SheetUpdater.prototype.set = function (row1, col1, value) {
  const r = row1 - 1, c = col1 - 1;
  if (r < 0 || r >= this.numRows || c < 0 || c >= this.numCols) return false;
  if (this.values[r][c] === value) return false;
  this.values[r][c] = value;
  this.dirty = true;
  this.touchedCells++;
  return true;
};

SheetUpdater.prototype.flush = function () {
  if (!this.dirty) return;
  this.range.setValues(this.values);
  this.dirty = false;
};
