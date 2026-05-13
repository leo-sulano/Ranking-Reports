# Apps Script — SEO Ranking Dashboard Automation

Production-ready Google Apps Script that updates an existing horizontal-matrix
Google Sheets ranking dashboard from a `RAW_IMPORT` sheet. **Does not modify
the dashboard layout** — only writes into country ranking cells.

## Files

| File          | Role                                                                |
|---------------|---------------------------------------------------------------------|
| `Main.gs`     | Entry points (`processRankings`, `onOpen`), per-brand orchestration |
| `Config.gs`   | `CONFIG` sheet loader, domain normalization                         |
| `Importer.gs` | `RAW_IMPORT` loader, dedupe, number/date parsing                    |
| `Parser.gs`   | Dynamic structure detection (date sections, blocks, countries, kws) |
| `Updater.gs`  | Single-read / single-write batch writer                             |
| `Formatter.gs`| Ranking display rules (`↑`, `↓`, `Not in top 100`)                  |
| `Logger.gs`   | Append-only `ERROR_LOG` with buffered writes                        |
| `Setup.gs`    | First-time setup — creates CONFIG/RAW_IMPORT/ERROR_LOG if missing   |
| `Util.gs`     | `groupBy` helper                                                    |

## Required sheets

### `CONFIG`

| Domain                  | Brand        | Type | SheetName (optional) |
|-------------------------|--------------|------|----------------------|
| lucky7even.com          | LUCKY7       | main | LUCKY7               |
| lucky7evencasino.com    | LUCKY7       | bp   | LUCKY7               |

- `Domain` — bare host (normalized at load: lowercased, `https://`/`www.`/trailing-slash stripped).
- `Type` — `main` or `bp` (case-insensitive).
- `SheetName` — defaults to `Brand` if blank.

### `RAW_IMPORT`

| Domain | Keyword | Country | Position | Previous | Change | Last Check |

- `Position` empty or `> 100` → `Not in top 100`.
- `Change` is signed; if blank, derived as `Previous - Position`.
- `Last Check` matches the section's date in the dashboard.

### `ERROR_LOG` (auto-created)

`Timestamp | Level | Message | Context` — append-only, runs include INFO/WARN/ERROR/FATAL.

## Install

1. Open the dashboard spreadsheet.
2. `Extensions → Apps Script`.
3. Create the nine files above in the editor (same names) and paste contents.
4. Save. Reload the spreadsheet → **Rankings** menu appears.
5. `Rankings → First-time setup` → creates the helper sheets.
6. Fill `CONFIG`.
7. **Open a brand sheet** and run `Rankings → Diagnose layout (active sheet)`.
   This is read-only — it writes the detected date sections, blocks,
   countries, and keyword counts to `ERROR_LOG` so you can confirm the parser
   sees the dashboard the way you expect, **before any cells are touched**.
8. Paste a small batch into `RAW_IMPORT`.
9. `Rankings → Process RAW_IMPORT`.
10. Inspect `ERROR_LOG` for any `WARN` / `ERROR` rows.

## Triggers

| Trigger             | Function           | Schedule                  |
|---------------------|--------------------|---------------------------|
| Time-driven         | `processRankings`  | Daily 06:00–07:00         |
| Time-driven         | `clearErrorLog`    | Monthly, 1st @ 02:00      |
| Installable on-edit | `processRankings`  | Edit on `RAW_IMPORT!A2:G` |

## Detection rules (short version)

- **Date sections**: column-A cell is a Date, contains `yyyy-MM-dd`, or starts with `DATE`.
- **Website blocks**: row within `HEADER_SCAN_DEPTH` below the date marker with the most `MAIN SITE`/`BP SITE`/known-domain hits. Each hit starts a block; the block extends to the column before the next hit.
- **Domain ↔ block**: domain literal in the header cell wins; otherwise blocks are filled in CONFIG order (main first, then BP).
- **Country columns**: country header row is the one with the most `ALLOWED_COUNTRY_CODES` tokens. Protected tokens (`GSV`, `SV`, `AFF`, `URL`) are filtered out — those cells can never be written.
- **Keyword rows**: column A below the country header row until the next date section. Match is case- and whitespace-insensitive.

## Behaviour under missing data

| Situation                                | Action                                             |
|------------------------------------------|----------------------------------------------------|
| Domain not in CONFIG                     | `WARN`; row skipped.                               |
| CONFIG brand sheet missing               | `ERROR`; rows for that brand skipped.              |
| No date section in sheet                 | `ERROR`; brand skipped.                            |
| Keyword not present in section           | `WARN`; row skipped.                               |
| Country code not in block                | `WARN`; row skipped.                               |
| Country code is protected (GSV/SV/AFF)   | `WARN`; refused even if mapped.                    |
| Cell already has identical value         | Silently deduped (no write, no log line).          |
| Concurrent run                           | Second invocation aborts with a toast.             |

## Performance

- One `getValues()` + one `setValues()` per brand sheet per run.
- Parser cache (`ctx._parserCache`) so structure detection runs once per sheet.
- `LockService.getDocumentLock()` prevents concurrent-run races.
- For >10k import rows: split `RAW_IMPORT` and run in series (Apps Script consumer cap is 6 min, Workspace is 30 min).
