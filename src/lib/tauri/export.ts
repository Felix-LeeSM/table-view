// ── Export grid rows ───────────────────────────────────────────────────────

import { invoke } from "@tauri-apps/api/core";
import type { ColumnCategory } from "@/lib/columnCategory";
import { toIpcSafeRows } from "@/lib/jsonCell";
import type { DdlDialect } from "@/lib/sql/ddlGenerator";

export type ExportFormat = "csv" | "tsv" | "sql" | "json";

export type ExportContext =
  | { kind: "table"; schema: string; name: string }
  | { kind: "collection"; name: string }
  | {
      kind: "query";
      source_table: { schema: string; name: string } | null;
    };

export interface ExportSummary {
  rows_written: number;
  bytes_written: number;
}

/**
 * Issue #1443 — rows at or below this count go through the single-shot
 * `export_grid_rows` command (one IPC payload). Above it, the export streams
 * through begin/chunk/finish sessions so only one chunk (this many rows) ever
 * crosses the IPC boundary at a time — the whole result never gets serialized
 * into a single ~500MB string that freezes the webview main thread.
 */
export const EXPORT_IPC_CHUNK_ROWS = 25_000;

/**
 * Stream the supplied rows to `targetPath` in the requested `format`. All
 * encoding decisions (CSV escape / SQL identifier quoting / Mongo Extended
 * JSON shape) live in the Rust handler so output is deterministic across
 * platforms. Pass `exportId` to register a cooperative cancel token in the
 * query-token registry.
 *
 * Above `EXPORT_IPC_CHUNK_ROWS` the call fans out into a chunked backend
 * session (#1443); the output is byte-identical to the single-shot path. A
 * mid-stream failure (including a #1269 Stop-button cancel) aborts the
 * session so the temp file is cleaned up and any pre-existing target is left
 * untouched.
 *
 * #1448 F15 — `onProgress` reports the cumulative rows written after each
 * chunk of the streamed (>`EXPORT_IPC_CHUNK_ROWS`) path, so a large export can
 * surface a live count. The single-shot path completes in one IPC call and
 * reports no interim progress (nothing to show for an instant write).
 */
export async function exportGridRows(
  format: ExportFormat,
  targetPath: string,
  headers: string[],
  rows: unknown[][],
  context: ExportContext,
  exportId: string | null = null,
  onProgress?: (rowsWritten: number) => void,
): Promise<ExportSummary> {
  if (rows.length > EXPORT_IPC_CHUNK_ROWS) {
    return exportGridRowsChunked(
      format,
      targetPath,
      headers,
      rows,
      context,
      exportId,
      onProgress,
    );
  }
  return invoke<ExportSummary>("export_grid_rows", {
    format,
    targetPath,
    headers,
    // BigInt / Decimal cells (ADR 0026 promotion) would make Tauri's native
    // JSON.stringify throw; send them back as wire strings (issue #1082).
    rows: toIpcSafeRows(rows),
    context,
    exportId,
  });
}

async function exportGridRowsChunked(
  format: ExportFormat,
  targetPath: string,
  headers: string[],
  rows: unknown[][],
  context: ExportContext,
  exportId: string | null,
  onProgress?: (rowsWritten: number) => void,
): Promise<ExportSummary> {
  const sessionId = await invoke<string>("export_grid_begin", {
    format,
    targetPath,
    headers,
    context,
    exportId,
  });
  try {
    for (let i = 0; i < rows.length; i += EXPORT_IPC_CHUNK_ROWS) {
      await invoke("export_grid_chunk", {
        sessionId,
        // Per-chunk IPC-safe conversion — BigInt / Decimal cells anywhere in
        // the result must not reach Tauri's native JSON.stringify (#1082).
        rows: toIpcSafeRows(rows.slice(i, i + EXPORT_IPC_CHUNK_ROWS)),
      });
      // #1448 F15 — cumulative rows persisted so far (clamped to the total for
      // the final short chunk).
      onProgress?.(Math.min(i + EXPORT_IPC_CHUNK_ROWS, rows.length));
    }
    return await invoke<ExportSummary>("export_grid_finish", { sessionId });
  } catch (err) {
    // Best-effort teardown: drop the temp file + cancel token backend-side.
    // The original error (I/O or #1269 cancel) is what the caller must see.
    try {
      await invoke("export_grid_abort", { sessionId });
    } catch {
      /* abort is fire-and-forget; surface the real failure below */
    }
    throw err;
  }
}

/**
 * Saves one blob of UTF-8 text content to a file as-is. Minimal handler
 * for "one string → one file" scenarios such as migration DDL export.
 * No row-streaming / cancellation support.
 */
export async function writeTextFileExport(
  targetPath: string,
  content: string,
): Promise<ExportSummary> {
  return invoke<ExportSummary>("write_text_file_export", {
    targetPath,
    content,
  });
}

/**
 * Unified schema/database dump. Streams a DDL header + DML INSERT body
 * into one .sql file. INSERT serialization is dialect-specific via
 * `options.dialect` (#1641/#1642/#1674): `mysql`/`mariadb` use backtick
 * identifiers + MySQL string escape, `mssql` uses `[bracket]` identifiers
 * + T-SQL escape (bool → 1/0), `oracle` uses ANSI double-quoted
 * identifiers + Oracle value escape (bool → 1/0, binary →
 * `hextoraw('…')`), and the rest (`postgresql`/`sqlite`) use ANSI double
 * quotes. Non-RDB adapters are rejected by the backend with `Unsupported`.
 *
 * `tables[].columnNames` is decided by the caller in source order — the
 * backend's `serde_json::Map` lookup serializes rows in that order. When
 * `ddlHeader` is an empty string the DDL part is skipped (DML-only mode).
 */
export type SchemaDumpInclude = "ddl" | "dml" | "both";

export interface SchemaDumpTable {
  schema: string;
  table: string;
  columnNames: string[];
  /**
   * #1677 — per-column display category, in the same order as `columnNames`
   * (both derive from one `t.columns` array). The backend branches a `binary`
   * column to an unquoted binary literal (`X'…'` / `0x…`) instead of a quoted
   * hex string that restores as text bytes, silently corrupting varbinary/BLOB.
   */
  columnCategories: ColumnCategory[];
}

export interface SchemaDumpOptions {
  include: SchemaDumpInclude;
  batchSize: number;
  /** #1641/#1642 — INSERT-writer dialect (matches the DDL dialect). */
  dialect: DdlDialect;
}

export async function exportSchemaDump(
  connectionId: string,
  targetPath: string,
  ddlHeader: string,
  ddlFooter: string,
  tables: SchemaDumpTable[],
  options: SchemaDumpOptions,
  exportId: string | null = null,
): Promise<ExportSummary> {
  return invoke<ExportSummary>("export_schema_dump", {
    connectionId,
    targetPath,
    ddlHeader,
    ddlFooter,
    tables,
    options,
    exportId,
  });
}
