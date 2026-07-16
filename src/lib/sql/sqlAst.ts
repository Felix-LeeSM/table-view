/**
 * SQL parser frontend facade — barrel.
 *
 * Consumers import from `./sqlAst` (or `@lib/sql/sqlAst`); this barrel
 * keeps that surface stable while the implementation is split by concern:
 *
 * - `sqlAstTypes.ts` — shared value / expression / SELECT AST types.
 * - `sqlAstStatementTypes.ts` — DDL / DML / misc statement wrappers +
 *   the `SqlParseResult` union.
 * - `sqlAstParser.ts` — WASM bridge + `parseSql` / `parseSqlPreloaded` /
 *   `preloadSqlWasm` runtime entry points.
 *
 * The TS types mirror the Rust `serde::Serialize` output one-for-one —
 * see `src-tauri/sql-parser-core/src/ast.rs`.
 */

export * from "./sqlAstTypes";
export * from "./sqlAstStatementTypes";
export * from "./sqlAstParser";
