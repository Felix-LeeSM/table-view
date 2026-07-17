import { invoke } from "@tauri-apps/api/core";

/**
 * Stage 1 (issue #1077) — read a user-picked UTF-8 text file (a `.sql`
 * script) so the query editor can load it and run it through the existing
 * execute / Safe Mode pipeline. The backend caps size (16 MiB), rejects
 * app-internal paths, and rejects non-UTF-8 content. Symmetric inverse of
 * `writeTextFileExport`.
 */
export async function readTextFileImport(sourcePath: string): Promise<string> {
  return invoke<string>("read_text_file_import", { sourcePath });
}

/**
 * Stage 1 CSV import (issue #1639) — read-only parse/preview of a user-picked
 * CSV. The backend streams the file (no whole-file load, no 16 MiB cap) and
 * applies the same read guards as `readTextFileImport` (absolute path,
 * regular file, app-internal path rejected). Returns headers, the exact total
 * data-row count, and up to 100 preview rows for the mapping wizard. No DB
 * writes happen here — the commit path lands in #1640.
 */
export interface CsvPreviewOptions {
  /** Treat the first row as a header. Defaults to `true` backend-side. */
  hasHeader?: boolean;
  /** Single-char field delimiter. Defaults to `,` backend-side. */
  delimiter?: string;
}

export interface CsvPreview {
  headers: string[];
  row_count: number;
  preview_rows: string[][];
}

export async function previewCsvImport(
  sourcePath: string,
  options?: CsvPreviewOptions,
): Promise<CsvPreview> {
  return invoke<CsvPreview>("preview_csv_import", { sourcePath, options });
}

/**
 * Stage 2 CSV import commit (issue #1640) — build the batched INSERT
 * statements for the confirmed column mapping. Read-only itself (it parses the
 * CSV and returns SQL strings); the caller feeds the result to
 * `executeQueryBatch` in a single call so the whole import runs in one atomic
 * transaction (all-or-nothing rollback), reusing the Safe Mode / read-only
 * gates + history + cancel. PostgreSQL-only; other engines reject with
 * `Unsupported`.
 */
export interface CsvColumnMapping {
  /** Target table column name. */
  column: string;
  /** Zero-based index into each parsed CSV record for the mapped source. */
  sourceIndex: number;
}

export interface CsvImportOptions {
  /** Treat the first row as a header. Defaults to `true` backend-side. */
  hasHeader?: boolean;
  /** Single-char field delimiter. Defaults to `,` backend-side. */
  delimiter?: string;
  /**
   * Tri-state NULL policy (ADR 0009): map an empty CSV field to SQL `NULL`
   * (`true`, default) or to an empty string literal `''` (`false`).
   */
  emptyAsNull?: boolean;
}

export async function buildCsvImportStatements(
  connectionId: string,
  sourcePath: string,
  schema: string,
  table: string,
  mapping: CsvColumnMapping[],
  options?: CsvImportOptions,
): Promise<string[]> {
  return invoke<string[]>("build_csv_import_statements", {
    connectionId,
    sourcePath,
    schema,
    table,
    mapping,
    options,
  });
}
