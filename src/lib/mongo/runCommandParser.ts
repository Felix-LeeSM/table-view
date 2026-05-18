// Sprint 382 (2026-05-17) — AST-backed statement classifier.
//
// 작성 이유: sprint-381 의 정규식 기반 (`ADMIN_COMMAND_RE`,
// `COLLECTION_COMMAND_RE`, JSON-quoter 한 패스) 분류를 typed AST
// (`./mongoshAst.ts`) 위에서 통합한다. 호출부 (`useQueryExecution.ts`,
// `Toolbar.tsx`) 가 의존하는 export signature 는 변하지 않으며, AST 로
// promote 한 덕에 (1) 라인 코멘트가 statement 어디에 있든 strip 되고,
// (2) nested object body 가 안전하게 추출되며, (3) `;` 로 구분된 두 번째
// statement 가 명시적으로 거부된다.
//
// `analyzeMongoRunCommand` (mongoSafety.ts) 와 `parseMongoshExpression`
// (mongoshParser.ts, Phase 28 method-whitelist parser) 는 본 sprint 가
// 만지지 않는다 — 본 모듈은 statement classifier 의 책임만 promote.

import { parseMongoshStatement } from "./mongoshAst";

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
 * Sprint 382 (2026-05-17) — backed by the AST. BSON literals
 * (`ObjectId("...")`, `ISODate(...)`) inside the body are still rejected;
 * full BSON literal support is deferred to sprint-383.
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
