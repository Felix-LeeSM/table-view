import { invoke } from "@tauri-apps/api/core";
import type { QueryResult } from "@/types/query";
import type { FilterCondition, TableData } from "@/types/schema";

import { wrapNumericCells } from "./numericWrap";

export async function queryTableData(
  connectionId: string,
  table: string,
  schema: string,
  page?: number,
  pageSize?: number,
  orderBy?: string,
  filters?: FilterCondition[],
  rawWhere?: string,
): Promise<TableData> {
  const result = await invoke<TableData>("query_table_data", {
    connectionId,
    table,
    schema,
    page: page ?? null,
    pageSize: pageSize ?? null,
    orderBy: orderBy ?? null,
    filters: filters ?? null,
    rawWhere: rawWhere ?? null,
  });
  return wrapNumericCells(result);
}

// Query execution
export async function executeQuery(
  connectionId: string,
  sql: string,
  queryId: string,
): Promise<QueryResult> {
  const result = await invoke<QueryResult>("execute_query", {
    connectionId,
    sql,
    queryId,
  });
  return wrapNumericCells(result);
}

export async function cancelQuery(queryId: string): Promise<string> {
  return invoke<string>("cancel_query", { queryId });
}

// Execute a list of SQL statements inside a single transaction
// (BEGIN/COMMIT/ROLLBACK). All-or-nothing: a failure on statement K rolls
// back statements 1..K-1 and surfaces the original error with
// "statement K of N failed: ..." in the message body.
export async function executeQueryBatch(
  connectionId: string,
  statements: string[],
  queryId: string,
): Promise<QueryResult[]> {
  const results = await invoke<QueryResult[]>("execute_query_batch", {
    connectionId,
    statements,
    queryId,
  });
  return results.map(wrapNumericCells);
}

// Sprint 247 (ADR 0022 Phase 3) — dry-run a batch of SQL statements
// inside a transaction that is unconditionally rolled back. Returns
// per-statement statistics (`total_count` / `execution_time_ms`) for the
// destructive-statement confirm dialog's preview pane. The eventual
// commit goes through `executeQueryBatch`, NOT this wrapper — dry-run
// is observation only. Failure shape mirrors `executeQueryBatch`
// (`"statement K of N failed: ..."`) so preview and commit produce
// identical error copy. Adapters without dry-run support (MySQL/SQLite
// today) reject with `Unsupported`; Mongo connections never reach this
// wrapper because the hook routes paradigm="document" to a disclaimer
// state without invoking IPC.
export async function executeQueryDryRun(
  connectionId: string,
  statements: string[],
  queryId: string,
): Promise<QueryResult[]> {
  const results = await invoke<QueryResult[]>("execute_query_dry_run", {
    connectionId,
    statements,
    queryId,
  });
  return results.map(wrapNumericCells);
}
