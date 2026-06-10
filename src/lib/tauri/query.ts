import { invoke } from "@tauri-apps/api/core";
import {
  createTabularResultEnvelope,
  requireCompatibleQueryResult,
  type QueryResult,
  type TabularResultEnvelope,
} from "@/types/query";
import type { FilterCondition, TableData } from "@/types/schema";
import { normalizeQueryResult } from "@lib/wireCamelCase";

import { wrapNumericCells } from "./numericWrap";

// Sprint 271b — `expectedDatabase` is an opt-in db-mismatch guard. When
// provided the backend verifies the adapter's active db matches before
// dispatch; mismatch surfaces as a typed `AppError::DbMismatch` envelope
// whose `message` preserves `"Database mismatch: expected 'X', backend
// pool has 'Y'"`. DataGrid row-fetches forward the workspace `(connId, db)`
// so a swapped pool can no longer paint stale rows from the wrong database
// between user click and dispatch. Omitting the argument preserves the
// pre-271 fast-path.
export async function queryTableData(
  connectionId: string,
  table: string,
  schema: string,
  page?: number,
  pageSize?: number,
  orderBy?: string,
  filters?: FilterCondition[],
  rawWhere?: string,
  expectedDatabase?: string,
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
    expectedDatabase: expectedDatabase ?? null,
  });
  return wrapNumericCells(result);
}

// Query execution
//
// Sprint 266 — `expectedDatabase` is an opt-in db-mismatch guard. When
// provided the backend verifies the adapter's active db matches before
// dispatch; mismatch surfaces as a typed `AppError::DbMismatch` envelope
// whose `message` preserves `"Database mismatch: expected 'X', backend
// pool has 'Y'"`. Omitting it preserves the pre-Sprint-266 fast-path.
export async function executeQuery(
  connectionId: string,
  sql: string,
  queryId: string,
  expectedDatabase?: string,
): Promise<QueryResult> {
  return requireCompatibleQueryResult(
    await executeQueryEnvelope(connectionId, sql, queryId, expectedDatabase),
  );
}

export async function executeQueryEnvelope(
  connectionId: string,
  sql: string,
  queryId: string,
  expectedDatabase?: string,
): Promise<TabularResultEnvelope> {
  const result = await invoke<unknown>("execute_query", {
    connectionId,
    sql,
    queryId,
    expectedDatabase: expectedDatabase ?? null,
  });
  return createTabularResultEnvelope(normalizeTabularQueryResult(result));
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
  expectedDatabase?: string,
): Promise<QueryResult[]> {
  const envelopes = await executeQueryBatchEnvelopes(
    connectionId,
    statements,
    queryId,
    expectedDatabase,
  );
  return envelopes.map(requireCompatibleQueryResult);
}

export async function executeQueryBatchEnvelopes(
  connectionId: string,
  statements: string[],
  queryId: string,
  expectedDatabase?: string,
): Promise<TabularResultEnvelope[]> {
  const results = await invoke<unknown[]>("execute_query_batch", {
    connectionId,
    statements,
    queryId,
    expectedDatabase: expectedDatabase ?? null,
  });
  return results.map((result) =>
    createTabularResultEnvelope(normalizeTabularQueryResult(result)),
  );
}

// Sprint 247 (ADR 0022 Phase 3) — dry-run a batch of SQL statements
// inside a transaction that is unconditionally rolled back. Returns
// per-statement statistics (`totalCount` / `executionTimeMs`) for the
// destructive-statement confirm dialog's preview pane. The eventual
// commit goes through `executeQueryBatch`, NOT this wrapper — dry-run
// is observation only. Failure shape mirrors `executeQueryBatch`
// (`"statement K of N failed: ..."`) so preview and commit produce
// identical error copy. Adapters without dry-run support (MySQL/SQLite
// today) reject with `Unsupported`; Mongo connections never reach this
// wrapper because the hook routes paradigm="document" to a disclaimer
// state without invoking IPC.
//
// Sprint 271b — `expectedDatabase` is the same opt-in mismatch guard as
// `executeQuery` / `executeQueryBatch`. The dry-run preview MUST run
// against the same db the eventual commit will hit; threading the
// workspace `(connId, db)` lets the backend reject a swapped pool
// before the preview rolls back against the wrong database. Omitting
// it preserves the pre-271 fast-path.
export async function executeQueryDryRun(
  connectionId: string,
  statements: string[],
  queryId: string,
  expectedDatabase?: string,
): Promise<QueryResult[]> {
  const envelopes = await executeQueryDryRunEnvelopes(
    connectionId,
    statements,
    queryId,
    expectedDatabase,
  );
  return envelopes.map(requireCompatibleQueryResult);
}

export async function executeQueryDryRunEnvelopes(
  connectionId: string,
  statements: string[],
  queryId: string,
  expectedDatabase?: string,
): Promise<TabularResultEnvelope[]> {
  const results = await invoke<unknown[]>("execute_query_dry_run", {
    connectionId,
    statements,
    queryId,
    expectedDatabase: expectedDatabase ?? null,
  });
  return results.map((result) =>
    createTabularResultEnvelope(normalizeTabularQueryResult(result)),
  );
}

function normalizeTabularQueryResult(result: unknown): QueryResult {
  return wrapNumericCells(normalizeQueryResult(result));
}
