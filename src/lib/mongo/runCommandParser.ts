// Sprint 382 (2026-05-17) — AST-backed statement classifier.
//
// 작성 이유: sprint-381 의 정규식 기반 분류를 typed AST
// (`./mongoshAst/index`) 위에서 통합한다. 호출부 (`useQueryExecution.ts`,
// `Toolbar.tsx`) 가 의존하는 export signature 는 변하지 않는다.
//
// 본 모듈은 statement classifier 책임만 갖고, expression parser 는
// `@features/query` public API 뒤에 둔다.

import { parseMongoshStatement } from "./mongoshAst/index";

/**
 * Statement kind for the MongoDB query tab Run gate.
 *
 * - `admin-command` — `db.runCommand({...})` 또는 `db.adminCommand({...})`.
 *   chip 미선택 OK. backend 는 `database = null` 일 때 admin DB context.
 * - `collection-command` — `db.<coll>.<method>(...)`. chip 필수
 *   (sprint-309 의 Phase 28 method whitelist 와 동일 시맨틱).
 * - `unknown` — 빈 입력 / 공백만 / 파싱 실패 / 다중 statement / BSON
 *   literal 등. Toolbar 는 일반적 "empty sql" 경로로 처리 (Run disabled).
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
 * Sprint 382 (2026-05-17) — backed by the AST.
 * Sprint 383 — BSON literals (`ObjectId` / `ISODate` / `NumberLong` /
 * `Decimal128` / `UUID`) accepted as extended-JSON placeholders inside
 * the body; sprint-384 — backend converts those placeholders to real BSON
 * variants via `bson::Bson::try_from(serde_json::Value)` before dispatching
 * to the driver.
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
