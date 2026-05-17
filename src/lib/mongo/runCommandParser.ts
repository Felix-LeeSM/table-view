// Sprint 381 (2026-05-17): naive statement-kind classifier for the
// MongoDB query tab.
//
// 작성 이유: Phase 28 mongosh AST parser (sprint-380) 는 collection
// command (`db.coll.method(...)`) 의 method whitelist 에 묶여 있어
// `db.runCommand({...})` / `db.adminCommand({...})` 같은 admin command
// 를 받아주지 않는다. 본 sprint 의 db-contract α 가 chip 미선택 상태에서
// admin command 의 Run 을 enabled 해야 하므로, AST 가 아닌 *naive regex*
// 로 statement kind 만 판별한다. 정확도 trade-off:
//   - 코멘트 / 다중 expression / 부분 매칭에 대한 안전망은 없음
//     (sprint-382 의 AST 가 본 classifier 를 promote).
//   - 정규식 1개, side-effect 0.

/**
 * Statement kind for the MongoDB query tab Run gate.
 *
 * - `admin-command` — `db.runCommand({...})` 또는 `db.adminCommand({...})`.
 *   chip 미선택 OK. backend 는 `database = null` 일 때 admin DB context.
 * - `collection-command` — `db.<coll>.<method>(...)`. chip 필수
 *   (sprint-309 의 Phase 28 method whitelist 와 동일 시맨틱).
 * - `unknown` — 빈 입력 / 공백만 / 매칭 실패. Toolbar 가 일반적 "empty
 *   sql" 경로로 처리 (Run disabled).
 */
export type MongoStatementKind =
  | "admin-command"
  | "collection-command"
  | "unknown";

/**
 * `db.runCommand({...})` / `db.adminCommand({...})` 매칭 정규식.
 *
 * Anchored at the start (after leading whitespace) so that
 * `someExpr; db.runCommand(...)` 같은 multi-statement 는 *admin* 로
 * 인식되지 않는다 (Phase 28 의 mongosh AST 가 multi-statement 자체를
 * 거부하므로 추가 가드 불필요).
 */
const ADMIN_COMMAND_RE = /^\s*db\.(runCommand|adminCommand)\s*\(/;

/**
 * `db.<coll>.<method>(...)` 매칭 정규식. naive — 첫 dot 뒤 identifier
 * 가 컬렉션, 두번째 dot 뒤가 메소드. `runCommand` / `adminCommand` 는
 * 명시적으로 제외해 admin command path 와 충돌하지 않게 한다.
 */
const COLLECTION_COMMAND_RE =
  /^\s*db\.([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

export function classifyMongoStatement(sql: string): MongoStatementKind {
  if (!sql || !sql.trim()) return "unknown";
  if (ADMIN_COMMAND_RE.test(sql)) return "admin-command";
  if (COLLECTION_COMMAND_RE.test(sql)) return "collection-command";
  return "unknown";
}

/**
 * Extract the BSON-shaped command body from a `db.runCommand({...})` /
 * `db.adminCommand({...})` expression and return it as a plain
 * `Record<string, unknown>` (JSON-compatible). Returns `null` when the
 * expression doesn't match the pattern or the inner argument fails to
 * parse as JSON.
 *
 * 작성 이유: naive — `JSON.parse` 만 사용하므로 BSON literal
 * (`ObjectId("...")`, `ISODate(...)`) 은 거부된다. admin command 본문은
 * 대부분 `{ key: 1 }` / `{ key: "value" }` 처럼 평범한 JSON 으로 충분.
 * BSON literal 지원은 sprint-382 의 AST 가 처리.
 */
export function extractAdminCommandBody(
  sql: string,
): Record<string, unknown> | null {
  const match = sql.match(
    /^\s*db\.(runCommand|adminCommand)\s*\(([\s\S]*)\)\s*;?\s*$/,
  );
  if (!match) return null;
  const inner = match[2]?.trim();
  if (!inner) return null;
  // Strip an optional trailing comma (mongosh tolerates `db.runCommand({...},)`)
  // before parsing.
  const cleaned = inner.replace(/,\s*$/, "");
  try {
    // mongosh allows unquoted keys (`{ ping: 1 }`). Quote them via a
    // narrow shim before `JSON.parse` — admin command bodies are
    // dictionary-shaped so a single-pass `\b<ident>:` rewrite is safe
    // enough for the common case. Strings inside the body still
    // round-trip through `JSON.parse` validation.
    const quoted = cleaned.replace(
      /([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g,
      '$1"$2":',
    );
    const parsed = JSON.parse(quoted);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
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
