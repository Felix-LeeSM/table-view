/**
 * Sprint 254 (2026-05-09) — `Severity` union 3-tier split.
 * `"safe" | "danger"` (2-tier, Sprint 185-198) → `"info" | "warn" |
 * "danger"`. ADR 0023 grill Q2-(a) "3-tier severity 채택" 의 정식 도입.
 *
 * - `"info"`: read-only / metadata-introspection. SELECT, WITH …SELECT
 *   (no DML CTE), EXPLAIN, SHOW, DESCRIBE, DESC. SafeMode 매트릭스에서
 *   *항상* `allow`.
 * - `"warn"`: bounded write 표면. INSERT, UPDATE WHERE, DELETE WHERE,
 *   CREATE, ALTER additive (no DROP COLUMN/CONSTRAINT). SafeMode 매트릭스
 *   결과는 `allow` (raw editor 의 SqlPreviewDialog 가 QueryTab-level 에서
 *   처리 — Sprint 255). dry-run 100+ row 시 STOP 으로 escalate (Sprint 254
 *   의 `escalateWarnIfLargeImpact` helper).
 * - `"danger"` (STOP, 보존): DROP, TRUNCATE, WHERE-less DELETE/UPDATE,
 *   ALTER DROP COLUMN/CONSTRAINT, GRANT, REVOKE. SafeMode 매트릭스에서
 *   `confirm` (production 또는 non-prod + strict).
 *
 * 다중 statement 우선순위: DANGER > WARN > INFO (worst tier 결정).
 *
 * Sprint 391 (2026-05-17) — DDL destructive classifier callsite 가 정규식
 * 에서 AST 기반(`parseSqlPreloaded`) 으로 *부분* 교체. `analyzeStatement`
 * 의 반환 shape (`kind` / `severity` / `reasons`) 는 변경 없음 — 호출자
 * 영향 0. AST 가 preload 되지 않은 환경(테스트, cold-start)에서는 정규식
 * fallback 으로 회귀-안전.
 *
 * Sprint 392 (2026-05-18) — DML write triad (INSERT / UPDATE / DELETE) 도
 * AST 기반으로 migrate. WHERE 의 narrow expression (column-op-literal +
 * AND/OR/NOT/IS NULL) 만 AST 로 parse 되고 그 이상 (IN-list / 함수 호출 /
 * subquery / cross-table) 은 `unsupported-expression` 으로 fallback. 반환
 * shape 는 여전히 동일 — 호출자 영향 0. 남은 정규식 (SELECT widening /
 * CREATE / GRANT / REVOKE / WITH / EXPLAIN / SHOW / DESCRIBE) 은 sprint-
 * 393~395 가 단계적으로 교체.
 */
export type Severity = "info" | "warn" | "danger";

export type StatementKind =
  | "select"
  // Sprint 255 — `info` 는 SELECT 외 read-only / metadata 조회 (EXPLAIN /
  // SHOW / DESCRIBE / DESC) 의 분류. `select` 와 같은 INFO tier 지만 식별
  // helper (`isInfoStatement`) 에서 함께 true 로 처리된다.
  | "info"
  | "insert"
  | "update"
  | "delete"
  | "ddl-drop"
  | "ddl-truncate"
  | "ddl-alter-drop"
  | "ddl-other"
  // Mongo variants share this union so `useSafeModeGate` is
  // paradigm-agnostic. `*-all` (empty filter) is danger; `*-many`
  // (non-empty filter) is `warn` (Sprint 254); `mongo-drop` / `mongo-out`
  // / `mongo-merge` are unconditionally `danger`.
  | "mongo-out"
  | "mongo-merge"
  | "mongo-other"
  | "mongo-drop"
  | "mongo-delete-all"
  | "mongo-delete-many"
  | "mongo-update-all"
  | "mongo-update-many"
  | "other";

export interface StatementAnalysis {
  kind: StatementKind;
  severity: Severity;
  reasons: string[];
}

import { parseSqlPreloaded, type SqlParseResult } from "./sqlAst";

const LINE_COMMENT_RE = /--[^\n\r]*/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const WHITESPACE_RE = /\s+/g;
const WORD_BOUNDARY_WHERE_RE = /\bWHERE\b/i;

/**
 * Sprint 391 — DDL destructive classifier callsite migration.
 * Sprint 392 — DML write triad migration (INSERT / UPDATE / DELETE).
 *
 * Convert a parsed AST node (sprint-391 / 392 grammar slice) into the
 * `StatementAnalysis` shape used by the rest of the codebase. Returns
 * `null` for AST variants outside the supported scope so the caller
 * falls through to the legacy regex matcher.
 *
 * Why a dedicated mapper instead of inlining at the callsite: the AST
 * → analysis projection is a *contract* — `kind` / `severity` / `reasons`
 * shape must stay identical to the prior regex output (sqlSafety tests
 * pin this). Isolating the mapper makes the contract auditable and gives
 * sprint-393/394 a single point to extend without re-touching
 * `analyzeStatement` for every new variant.
 *
 * Sprint-392 invariants (D1/D2/D3):
 * - INSERT — kind:'insert', severity:'warn' (existing Sprint 254 tier;
 *   ON CONFLICT DO UPDATE classifies the same — caller treats UPSERT
 *   as a write surface, not a destructive one).
 * - UPDATE — kind:'update'; `where_clause === null` → severity:'danger'
 *   + reason "UPDATE without WHERE clause"; otherwise severity:'warn'.
 * - DELETE — kind:'delete'; `where_clause === null` → severity:'danger'
 *   + reason "DELETE without WHERE clause"; otherwise severity:'warn'.
 *
 * The DML reason strings *match* the pre-sprint-392 regex output bit-for-
 * bit so the existing sqlSafety test suite stays green (no regression).
 */
function statementAnalysisFromAst(
  ast: SqlParseResult,
): StatementAnalysis | null {
  switch (ast.kind) {
    case "drop": {
      // Reason string format matches the prior regex output —
      // `DROP TABLE` / `DROP INDEX` / `DROP VIEW` / … The AST object_type
      // is kebab-case ("table", "database", …); upper-casing recreates
      // the regex group capture.
      const objectKeyword = ast.object_type.toUpperCase();
      return {
        kind: "ddl-drop",
        severity: "danger",
        reasons: [`DROP ${objectKeyword}`],
      };
    }
    case "truncate": {
      return {
        kind: "ddl-truncate",
        severity: "danger",
        reasons: ["TRUNCATE"],
      };
    }
    case "alter-table": {
      // Only DropColumn / DropConstraint flow to `ddl-alter-drop`;
      // DropIndex (MySQL-style) is also a structure-removing surface
      // so we map it to the same kind — its blast radius (index drop)
      // matches a top-level `DROP INDEX`.
      switch (ast.action.kind) {
        case "drop-column":
          return {
            kind: "ddl-alter-drop",
            severity: "danger",
            reasons: ["ALTER TABLE DROP COLUMN"],
          };
        case "drop-constraint":
          return {
            kind: "ddl-alter-drop",
            severity: "danger",
            reasons: ["ALTER TABLE DROP CONSTRAINT"],
          };
        case "drop-index":
          return {
            kind: "ddl-alter-drop",
            severity: "danger",
            reasons: ["ALTER TABLE DROP INDEX"],
          };
      }
      return null;
    }
    // Sprint-392 — DML write triad.
    case "insert":
      return { kind: "insert", severity: "warn", reasons: [] };
    case "update":
      if (ast.where_clause === null) {
        return {
          kind: "update",
          severity: "danger",
          reasons: ["UPDATE without WHERE clause"],
        };
      }
      return { kind: "update", severity: "warn", reasons: [] };
    case "delete":
      if (ast.where_clause === null) {
        return {
          kind: "delete",
          severity: "danger",
          reasons: ["DELETE without WHERE clause"],
        };
      }
      return { kind: "delete", severity: "warn", reasons: [] };
    // SELECT / error variants are not currently mapped here — `select`
    // flows through the existing INFO path; `error` (lex / syntax /
    // unsupported-expression / unsupported-statement) lets the caller
    // fall through to the regex matcher for safety classification.
    case "select":
    case "error":
      return null;
  }
}

function stripComments(sql: string): string {
  return sql.replace(BLOCK_COMMENT_RE, " ").replace(LINE_COMMENT_RE, " ");
}

function normalize(sql: string): string {
  return stripComments(sql).replace(WHITESPACE_RE, " ").trim();
}

function hasOuterWhere(stripped: string): boolean {
  return WORD_BOUNDARY_WHERE_RE.test(stripped);
}

/**
 * Sprint 254 — DML CTE 식별. `WITH x AS (UPDATE …) SELECT *` 같은 statement
 * 는 `WITH` 로 시작하지만 CTE 본문에 write op (UPDATE / DELETE / INSERT) 를
 * 포함한다. 이 경우 wrapped statement 의 severity 와 동일하게 결정해야
 * 하며, 단순 `WITH` → INFO 분기로는 잘못 분류된다.
 *
 * Heuristic: `WITH … AS (` 직후의 첫 keyword 를 본다. UPDATE/DELETE/INSERT
 * 면 그 statement body 를 `analyzeStatement` 로 재귀 분석해 severity 를
 * 결정한다. 단순 `SELECT` CTE 는 INFO 보존.
 */
function analyzeDmlCte(upper: string): StatementAnalysis | null {
  // Match: WITH [RECURSIVE]? <ident> AS ( <innerKeyword>
  // 여러 CTE 가 있을 경우 가장 first 의 CTE body 만 검사한다 (worst tier
  // 결정은 caller 의 multi-statement 루프 책임 — single statement 단위에서는
  // first-CTE 가 wrapped statement 의 dominant write op).
  const match = upper.match(
    /^WITH\s+(?:RECURSIVE\s+)?[A-Z_][A-Z0-9_]*\s*(?:\([^)]*\)\s*)?AS\s*\(\s*(UPDATE|DELETE|INSERT)\b/,
  );
  if (!match) return null;
  const innerOp = match[1];
  // Recursively analyse the inner DML body. We approximate by stripping
  // the WITH-AS prefix and feeding the inner op + operand to
  // `analyzeStatement` so the WHERE-or-not invariant is preserved.
  const innerStartIdx = upper.indexOf(`(${innerOp}`);
  if (innerStartIdx === -1) return null;
  const innerBody = extractBalanced(upper, innerStartIdx);
  if (innerBody == null) return null;
  // `innerBody` includes surrounding parens; strip them.
  const inner = innerBody.slice(1, -1).trim();
  // Re-analyse the inner statement; preserve outer kind so callers /
  // tests that key on `kind === "select"` for pure WITH-SELECT still pass
  // — but the inner *severity* is what flows through.
  const innerAnalysis = analyzeStatement(inner);
  // The wrapped form's kind stays as the inner DML op so downstream
  // dispatch (e.g. dry-run) treats it as a write surface, not a SELECT.
  return innerAnalysis;
}

/**
 * Helper — given a string and the index of an opening paren, return the
 * substring from `idx` through the matching closing paren (inclusive).
 * Returns null if no balanced match exists.
 */
function extractBalanced(s: string, idx: number): string | null {
  if (s[idx] !== "(") return null;
  let depth = 0;
  for (let i = idx; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return s.slice(idx, i + 1);
    }
  }
  return null;
}

export function analyzeStatement(sql: string): StatementAnalysis {
  const normalized = normalize(sql);
  if (normalized.length === 0) {
    // Sprint 254 — empty / unrecognised input defaults to INFO so the
    // SafeMode matrix never escalates a benign no-op buffer. WARN is
    // reserved for *known* write surfaces.
    return { kind: "other", severity: "info", reasons: [] };
  }

  const upper = normalized.toUpperCase();

  // Sprint 391 — DDL destructive (DROP / TRUNCATE / ALTER … DROP) is
  // classified through the AST first.
  // Sprint 392 — extended to the DML write triad (INSERT / UPDATE /
  // DELETE). The WASM module may not be loaded (cold-start, jsdom unit
  // tests) in which case `parseSqlPreloaded` returns `null` and we fall
  // back to the legacy regex matchers below. The regex fallback is
  // *bit-identical* to the prior behavior so existing sqlSafety tests
  // remain green either way.
  if (/^(DROP|TRUNCATE|ALTER|INSERT|UPDATE|DELETE)\b/.test(upper)) {
    const ast = parseSqlPreloaded(normalized);
    if (ast !== null) {
      const fromAst = statementAnalysisFromAst(ast);
      if (fromAst !== null) return fromAst;
      // AST parsed but the variant is not one we map (e.g. SELECT
      // mis-detected by the regex, or `error` from
      // unsupported-expression / unsupported-statement). Fall through
      // to the legacy regex path so the existing classification stays
      // in effect — graceful degrade.
    }
  }

  if (/^DELETE\s+FROM\b/.test(upper)) {
    if (!hasOuterWhere(upper)) {
      return {
        kind: "delete",
        severity: "danger",
        reasons: ["DELETE without WHERE clause"],
      };
    }
    // Sprint 254 — bounded DELETE WHERE = WARN tier (was "safe").
    return { kind: "delete", severity: "warn", reasons: [] };
  }

  if (/^UPDATE\s+\S/.test(upper)) {
    if (!hasOuterWhere(upper)) {
      return {
        kind: "update",
        severity: "danger",
        reasons: ["UPDATE without WHERE clause"],
      };
    }
    // Sprint 254 — bounded UPDATE WHERE = WARN tier.
    return { kind: "update", severity: "warn", reasons: [] };
  }

  if (/^DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|TRIGGER)\b/.test(upper)) {
    const match = upper.match(
      /^DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|TRIGGER)\b/,
    );
    const reason = match ? `DROP ${match[1]}` : "DROP";
    return { kind: "ddl-drop", severity: "danger", reasons: [reason] };
  }

  if (/^TRUNCATE\b/.test(upper)) {
    return { kind: "ddl-truncate", severity: "danger", reasons: ["TRUNCATE"] };
  }

  // `ALTER TABLE … DROP COLUMN/CONSTRAINT` is destructive enough
  // (column + data loss / FK invalidation) that the structure-surface
  // gate must flag it for the production warn / strict tier.
  if (/^ALTER\s+TABLE\b/.test(upper)) {
    const dropMatch = upper.match(/\bDROP\s+(COLUMN|CONSTRAINT)\b/);
    if (dropMatch) {
      return {
        kind: "ddl-alter-drop",
        severity: "danger",
        reasons: [`ALTER TABLE DROP ${dropMatch[1]}`],
      };
    }
  }

  // Sprint 254 — GRANT / REVOKE are privilege mutations; classify as
  // STOP (`danger`) since they cannot be safely auto-applied. Master
  // spec §Sprint 254 + ADR 0023 grill Q2-(a).
  if (/^GRANT\b/.test(upper)) {
    return { kind: "ddl-other", severity: "danger", reasons: ["GRANT"] };
  }
  if (/^REVOKE\b/.test(upper)) {
    return { kind: "ddl-other", severity: "danger", reasons: ["REVOKE"] };
  }

  if (
    /^DROP\b/.test(upper) ||
    /^ALTER\b/.test(upper) ||
    /^CREATE\b/.test(upper)
  ) {
    // Sprint 254 — additive ALTER / CREATE / non-DROP-keyword DROP
    // (defensive — DROP TABLE/DATABASE/SCHEMA/INDEX/VIEW already handled
    // above) classify as WARN (write surface).
    return { kind: "ddl-other", severity: "warn", reasons: [] };
  }

  if (/^INSERT\s+INTO\b/.test(upper)) {
    // Sprint 254 — INSERT = WARN tier.
    return { kind: "insert", severity: "warn", reasons: [] };
  }

  if (/^SELECT\b/.test(upper)) {
    // Sprint 254 — SELECT = INFO tier (read).
    return { kind: "select", severity: "info", reasons: [] };
  }

  if (/^WITH\b/.test(upper)) {
    // Sprint 254 — DML CTE 식별. `WITH x AS (UPDATE …) SELECT *` 같은 form
    // 은 wrapped DML 의 severity 를 따른다. 순수 WITH-SELECT 만 INFO.
    const dml = analyzeDmlCte(upper);
    if (dml) return dml;
    return { kind: "select", severity: "info", reasons: [] };
  }

  // Sprint 255 — read-only / metadata introspection 의 INFO tier. EXPLAIN /
  // SHOW / DESCRIBE / DESC.
  // Sprint 254 — severity 가 명시적으로 "info" 로 정렬됨.
  if (/^(EXPLAIN|SHOW|DESCRIBE|DESC)\b/.test(upper)) {
    return { kind: "info", severity: "info", reasons: [] };
  }

  // Sprint 254 — unrecognised input defaults to INFO (defensive — never
  // surface WARN/STOP for unknown statements).
  return { kind: "other", severity: "info", reasons: [] };
}

export function isDangerous(analysis: StatementAnalysis): boolean {
  return analysis.severity === "danger";
}

/**
 * INFO tier 식별 휴리스틱. raw editor 의 WARN dialog mount 분기에서
 * 호출되어 read-only / metadata-introspection statement 만 dialog skip →
 * 직접 IPC 발동.
 *
 * Sprint 254 — `severity === "info"` 직접 비교로 단순화. 기존 두-가지 kind
 * 매칭 (`select` / `info`) 의미 보존: 둘 다 severity:"info".
 *
 * `severity: "warn"` (INSERT / UPDATE WHERE / CREATE …) 와 `"danger"` (STOP)
 * 는 INFO 가 아니므로 false.
 */
export function isInfoStatement(analysis: StatementAnalysis): boolean {
  return analysis.severity === "info";
}
