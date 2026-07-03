// ── Export grid rows ───────────────────────────────────────────────────────

import { invoke } from "@tauri-apps/api/core";

import { toIpcSafeRows } from "@/lib/jsonCell";

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
 * Stream the supplied rows to `targetPath` in the requested `format`. All
 * encoding decisions (CSV escape / SQL identifier quoting / Mongo Extended
 * JSON shape) live in the Rust handler so output is deterministic across
 * platforms. Pass `exportId` to register a cooperative cancel token in the
 * query-token registry.
 */
export async function exportGridRows(
  format: ExportFormat,
  targetPath: string,
  headers: string[],
  rows: unknown[][],
  context: ExportContext,
  exportId: string | null = null,
): Promise<ExportSummary> {
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
 * streaming. PG only — backend 가 MySQL/SQLite 를 만나면 `Unsupported` 로
 * reject.
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
