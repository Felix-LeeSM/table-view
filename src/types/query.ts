/**
 * Column metadata returned by a query execution.
 * Matches the Rust `QueryColumn` struct from `src-tauri/src/models/query.rs`.
 */
export interface QueryColumn {
  name: string;
  data_type: string;
}

/**
 * Discriminated type of the SQL query that was executed.
 * Mirrors the Rust `QueryType` enum serialization.
 *
 * - `"select"` — SELECT / read-only statements
 * - `{ dml: { rows_affected: number } }` — INSERT / UPDATE / DELETE
 * - `"ddl"` — CREATE / ALTER / DROP
 */
export type QueryType = "select" | { dml: { rows_affected: number } } | "ddl";

/**
 * Result of executing an arbitrary SQL query.
 * Matches the Rust `QueryResult` struct.
 */
export interface QueryResult {
  columns: QueryColumn[];
  rows: unknown[][];
  total_count: number;
  execution_time_ms: number;
  query_type: QueryType;
}

/**
 * Result of a single statement inside a multi-statement execution.
 *
 * Sprint 100 — when the user runs a script with `>= 2` statements we keep
 * a per-statement breakdown so the result panel can show one tab per
 * statement (verb / rows / ms / pass-fail). Single-statement runs do NOT
 * produce this array; consumers must check for `statements` presence
 * before branching.
 *
 * - `status: "success"` — `result` is set and `error` is undefined.
 * - `status: "error"` — `error` is set and `result` is undefined.
 *
 * `durationMs` is the wall-clock duration measured around the
 * `executeQuery` call for that single statement.
 */
export interface QueryStatementResult {
  sql: string;
  status: "success" | "error";
  result?: QueryResult;
  error?: string;
  durationMs: number;
}

/**
 * Lifecycle state of a query tab's SQL execution.
 *
 * `completed.statements` is OPTIONAL (Sprint 100): single-statement
 * executions leave it `undefined` and the existing `result` field carries
 * the only result. Multi-statement executions populate `statements` with
 * one entry per statement (success or error); `result` then mirrors the
 * LAST SUCCESSFUL statement's result so single-result fallbacks (history,
 * grid collapse) keep working unchanged.
 *
 * If a multi-statement run fails for *every* statement, the state collapses
 * to `{ status: "error" }` instead — same as single-statement failure.
 */
export type QueryState =
  | { status: "idle" }
  | { status: "running"; queryId: string }
  | {
      status: "completed";
      result: QueryResult;
      statements?: QueryStatementResult[];
    }
  | { status: "error"; error: string };
