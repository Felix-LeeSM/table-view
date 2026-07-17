// ── Export grid rows ───────────────────────────────────────────────────────

import { invoke } from "@tauri-apps/api/core";

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
 * UTF-8 text content 한 덩어리를 그대로 파일로 저장. migration DDL export
 * 처럼 "string 한 장 → 파일" 시나리오를 위한 minimal handler.
 * row-streaming / cancellation 미지원.
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
 * 통합 schema/database dump. DDL header + DML INSERT 본체를 한 .sql 파일로
 * streaming. INSERT 직렬화는 `options.dialect` 로 방언화 (#1641): `mysql`/
 * `mariadb` 는 backtick identifier + MySQL string escape, 그 외 (`postgresql`/
 * `sqlite`) 는 ANSI 더블쿼트. RDB 가 아닌 adapter 는 backend 가 `Unsupported`
 * 로 reject.
 *
 * `tables[].columnNames` 는 source order 로 호출자가 결정 — backend 의
 * `serde_json::Map` lookup 이 이 순서로 row 를 직렬화한다. `ddlHeader` 가
 * 빈 문자열이면 DDL 부분은 skip (DML-only mode).
 */
export type SchemaDumpInclude = "ddl" | "dml" | "both";

export interface SchemaDumpTable {
  schema: string;
  table: string;
  columnNames: string[];
}

export interface SchemaDumpOptions {
  include: SchemaDumpInclude;
  batchSize: number;
  /** #1641 — INSERT-writer dialect (matches the DDL dialect). */
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
