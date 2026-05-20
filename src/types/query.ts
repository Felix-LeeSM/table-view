import type { ColumnCategory } from "@/lib/columnCategory";
import type { BulkWriteResult, DocumentId } from "@/types/documentMutate";

/**
 * Column metadata returned by a query execution.
 * Matches the Rust `QueryColumn` struct from `src-tauri/src/models/query.rs`.
 *
 * Sprint 238 — `category` 는 백엔드가 dialect 별 `dataType` 매핑 (`PG`,
 * `Mongo`) 으로 채워 보낸다. DataGrid 의 default 폭 + text-align 에만 사용.
 * Structure / Records 뷰는 raw `dataType` 을 그대로 노출 — `category` 로
 * 치환 금지 (예: uuid 컬럼은 "uuid" 로 보여야 한다).
 */
export interface QueryColumn {
  name: string;
  dataType: string;
  category: ColumnCategory;
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
 *
 * Sprint 311 (Phase 28 Slice A5) — added `resultKind` to discriminate
 * between the default grid render (`"grid"` / undefined), the scalar
 * panel (`"scalar"` for `countDocuments` / `estimatedDocumentCount`),
 * and the list panel (`"list"` for `distinct`). A6 will introduce
 * `"writeSummary"` for mutation results. Optional so every existing
 * RDB call site stays compatible without changes.
 */
export interface QueryResult {
  columns: QueryColumn[];
  rows: unknown[][];
  totalCount: number;
  executionTimeMs: number;
  queryType: QueryType;
  /**
   * Sprint 312 (Phase 28 Slice A6, 2026-05-14) — `"writeSummary"` joins
   * the discriminator union. The 7 Mongo write methods (`insertOne` /
   * `insertMany` / `updateOne` / `updateMany` / `deleteOne` /
   * `deleteMany` / `bulkWrite`) populate `writeSummary` and set this
   * field so `QueryResultGrid` routes to `WriteSummaryPanel` instead of
   * the default DataGrid render.
   */
  resultKind?: "grid" | "scalar" | "list" | "writeSummary";
  /**
   * Sprint 312 — populated when `resultKind === "writeSummary"`. Carries
   * the per-method counters the panel renders; left undefined for every
   * non-write result.
   */
  writeSummary?: WriteSummaryData;
}

/**
 * Sprint 312 (Phase 28 Slice A6, 2026-05-14) — discriminated union of
 * write-method summaries surfaced by `WriteSummaryPanel`. Each variant
 * holds the counter fields the user must see:
 *
 * - `"insert"`:  `insertedIds[]` (one id per inserted document) — drives
 *                the "Inserted N document(s)" headline + chevron list.
 * - `"update"`:  `matchedCount` / `modifiedCount` — drives "Modified N
 *                document(s) (matched M)".
 * - `"delete"`:  `deletedCount` — drives "Deleted N document(s)".
 * - `"bulkWrite"`: the full `BulkWriteResult` shape so the panel can
 *                render one row per non-zero counter + upserted ids.
 */
export type WriteSummaryData =
  | { kind: "insert"; insertedIds: DocumentId[] }
  | { kind: "update"; matchedCount: number; modifiedCount: number }
  | { kind: "delete"; deletedCount: number }
  | { kind: "bulkWrite"; result: BulkWriteResult };

/**
 * Result of a single statement inside a multi-statement execution.
 *
 * When the user runs a script with `>= 2` statements we keep a
 * per-statement breakdown so the result panel can show one tab per
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
 * `completed.statements` is OPTIONAL: single-statement executions leave it
 * `undefined` and the existing `result` field carries the only result.
 * Multi-statement executions populate `statements` with one entry per
 * statement (success or error); `result` then mirrors the LAST SUCCESSFUL
 * statement's result so single-result fallbacks (history, grid collapse)
 * keep working unchanged.
 *
 * If a multi-statement run fails for *every* statement, the state collapses
 * to `{ status: "error" }` instead — same as single-statement failure.
 *
 * Sprint 248 (ADR 0022 Phase 4) — `isDryRun` is set by the explicit
 * "Dry Run" button / `Cmd+Shift+Enter` shortcut so the result grid can
 * surface a "rolled back" banner. Defaults to `false` / undefined for the
 * regular `executeQuery` / `executeQueryBatch` paths.
 */
export type QueryState =
  | { status: "idle" }
  | { status: "running"; queryId: string }
  | {
      status: "completed";
      result: QueryResult;
      statements?: QueryStatementResult[];
      isDryRun?: boolean;
    }
  | { status: "error"; error: string };
