import { invoke } from "@tauri-apps/api/core";
import type { QueryResult } from "@/types/query";
import type { FilterCondition, TableData } from "@/types/schema";

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
  return invoke<TableData>("query_table_data", {
    connectionId,
    table,
    schema,
    page: page ?? null,
    pageSize: pageSize ?? null,
    orderBy: orderBy ?? null,
    filters: filters ?? null,
    rawWhere: rawWhere ?? null,
  });
}

// Query execution
export async function executeQuery(
  connectionId: string,
  sql: string,
  queryId: string,
): Promise<QueryResult> {
  return invoke<QueryResult>("execute_query", {
    connectionId,
    sql,
    queryId,
  });
}

export async function cancelQuery(queryId: string): Promise<string> {
  return invoke<string>("cancel_query", { queryId });
}

// Sprint 183 — execute a list of SQL statements inside a single transaction
// (BEGIN/COMMIT/ROLLBACK). All-or-nothing: a failure on statement K rolls
// back statements 1..K-1 and surfaces the original error with
// "statement K of N failed: ..." in the message body.
export async function executeQueryBatch(
  connectionId: string,
  statements: string[],
  queryId: string,
): Promise<QueryResult[]> {
  return invoke<QueryResult[]>("execute_query_batch", {
    connectionId,
    statements,
    queryId,
  });
}
