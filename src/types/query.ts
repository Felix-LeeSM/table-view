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
export type QueryType =
  | "select"
  | { dml: { rows_affected: number } }
  | "ddl";

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
 * Lifecycle state of a query tab's SQL execution.
 */
export type QueryState =
  | { status: "idle" }
  | { status: "running"; queryId: string }
  | { status: "completed"; result: QueryResult }
  | { status: "error"; error: string };
