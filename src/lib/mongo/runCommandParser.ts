// 2026-05-17 — AST-backed statement classifier.
//
// Reason: reimplements the earlier regex-based classification on top of the
// typed AST (`./mongoshAst/index`). The export signatures that callers
// (`mongoQueryExecution.ts`, `Toolbar.tsx`) depend on do not change.
//
// This module owns only statement classification; the expression parser
// sits behind the `@features/query` public API.

import { parseMongoshStatement } from "./mongoshAst/index";

/**
 * Statement kind for the MongoDB query tab Run gate.
 *
 * - `admin-command` — `db.runCommand({...})` or `db.adminCommand({...})`.
 *   Allowed with no chip selected; the backend uses the admin DB context
 *   when `database = null`.
 * - `collection-command` — `db.<coll>.<method>(...)`. Requires a chip (same
 *   semantics as the Phase 28 method whitelist).
 * - `unknown` — empty / whitespace-only input, parse failure, multiple
 *   statements, BSON literal, etc. The Toolbar gates it like
 *   `collection-command` (a chip is required).
 */
export type MongoStatementKind =
  | "admin-command"
  | "collection-command"
  | "unknown";

export function classifyMongoStatement(sql: string): MongoStatementKind {
  if (!sql || !sql.trim()) return "unknown";
  const result = parseMongoshStatement(sql);
  if (result.kind === "admin-command") return "admin-command";
  if (result.kind === "collection-command") return "collection-command";
  return "unknown";
}

/**
 * Extract the BSON-shaped command body from a `db.runCommand({...})` /
 * `db.adminCommand({...})` expression and return it as a plain
 * `Record<string, unknown>` (JSON-compatible). Returns `null` when the
 * expression doesn't match the admin command shape or the body cannot be
 * parsed.
 *
 * 2026-05-17 — backed by the AST. BSON literals (`ObjectId` / `ISODate` /
 * `NumberLong` / `Decimal128` / `UUID`) are accepted as extended-JSON
 * placeholders inside the body; the backend converts those placeholders to
 * real BSON variants via `bson::Bson::try_from(serde_json::Value)` before
 * dispatching to the driver.
 */
export function extractAdminCommandBody(
  sql: string,
): Record<string, unknown> | null {
  if (!sql || !sql.trim()) return null;
  const result = parseMongoshStatement(sql);
  if (result.kind !== "admin-command") return null;
  return result.body;
}

/**
 * Whether `kind` corresponds to a statement that may execute without a
 * bound database. Used by the toolbar Run-button enable gate.
 */
export function statementAllowsMissingDatabase(
  kind: MongoStatementKind,
): boolean {
  return kind === "admin-command";
}
