/**
 * Sprint 254 (2026-05-09) — `Severity` union 3-tier split.
 * `"safe" | "danger"` (2-tier, Sprint 185-198) → `"info" | "warn" |
 * "danger"`. ADR 0023 grill Q2-(a) "3-tier severity 채택" 의 정식 도입.
 *
 * - `"info"`: read-only / metadata-introspection. SELECT, WITH …SELECT
 *   (no DML CTE), EXPLAIN, SHOW, DESCRIBE, DESC. SafeMode 매트릭스에서
 *   *항상* `allow`.
 * - `"warn"`: bounded write 표면. UPDATE WHERE, DELETE WHERE, ALTER
 *   additive (no DROP COLUMN/CONSTRAINT). SafeMode 매트릭스
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
 * subquery / cross-table) 은 `unsupported-expression` 으로 fallback. 남은
 * 정규식 (SELECT widening / CREATE / GRANT / REVOKE / WITH / EXPLAIN /
 * SHOW / DESCRIBE) 은 sprint-393~395 가 단계적으로 교체.
 *
 * Sprint 403 (2026-05-19) — Sprint 392 contract drift 정정. DML kind 는
 * `dml-*` prefix 로 통일하고 INSERT 는 additive write 로 `info` 처리한다.
 *
 * Sprint 393a (2026-05-18) — SELECT 의 widened grammar (FROM 다중 / JOIN
 * 변종 / WHERE expression 확장 / GROUP BY / HAVING / ORDER BY / LIMIT) 가
 * AST 기반으로 분기. severity 변경 없음 — successful SELECT parse 는
 * 여전히 `kind: "select"` / `severity: "info"` / `reasons: []`. 효과는
 * 단지 regex fallback 경로가 더 적게 실행된다는 점이다. CTE / window /
 * subquery / set ops 는 sprint-393b 까지 regex 경로로 남는다.
 *
 * Sprint 484 (2026-05-27) — narrow PostgreSQL MERGE parses as a bounded
 * write surface: `kind: "dml-merge"` / `severity: "warn"`.
 *
 * Sprint 485 (2026-05-27) — PostgreSQL `DO $$ ... $$` stays parser-
 * unsupported, but Safe Mode classifies top-level DO blocks as opaque
 * procedural execution: `kind: "routine-call"` / `severity: "warn"`.
 */
export type Severity = "info" | "warn" | "danger";

export type StatementKind =
  | "select"
  // Sprint 255 — `info` 는 SELECT 외 read-only / metadata 조회 (EXPLAIN /
  // SHOW / DESCRIBE / DESC) 의 분류. `select` 와 같은 INFO tier 지만 식별
  // helper (`isInfoStatement`) 에서 함께 true 로 처리된다.
  | "info"
  | "dml-insert"
  | "dml-update"
  | "dml-delete"
  | "dml-merge"
  // Issue #1115 — MySQL/MariaDB `REPLACE INTO` is a destructive upsert
  // (DELETE conflicting row, then INSERT). Always `danger`: it can silently
  // drop an existing row's data. Distinct kind so callers can surface it in
  // the confirm dialog copy.
  | "dml-replace"
  | "ddl-drop"
  | "ddl-truncate"
  | "ddl-alter-drop"
  // Sprint 394 — DDL additive classifications.
  // - `ddl-create` (info): CREATE TABLE / INDEX / VIEW — non-destructive
  //   construction. SafeMode treats as read-equivalent (no warn dialog).
  // - `ddl-alter-add` (warn): ALTER TABLE ADD COLUMN / ADD CONSTRAINT —
  //   schema-extending write surface.
  // - `ddl-alter-rename` (warn): ALTER TABLE RENAME TO / RENAME COLUMN —
  //   non-data-loss but breaks external queries hard-coding the old name.
  | "ddl-create"
  | "ddl-alter-add"
  | "ddl-alter-rename"
  | "ddl-other"
  // Sprint 395 — misc grammar classifications.
  // - `permission-change` (warn): GRANT / REVOKE.
  // - `config-read` (info): SHOW.
  // - `config-write` (info): SET.
  // - `data-movement` (warn): COPY (both FROM and TO).
  // - `metadata` (info): COMMENT.
  // EXPLAIN does NOT introduce its own kind — it inherits the inner
  // statement's classification per D1.
  | "permission-change"
  | "config-read"
  | "config-write"
  | "data-movement"
  | "metadata"
  | "routine-call"
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
  // Issue #1117 — explicitly-registered benign utility/session statements
  // (transaction control, maintenance, benign PRAGMA reads). Distinct from
  // `other` so "classified as safe" is auditable and distinguishable from
  // "unrecognised → fail-open info". severity is always `info`. This roster is
  // the precondition for any future revisit of the fail-open fallback policy.
  | "known-safe"
  | "other";

export interface StatementAnalysis {
  kind: StatementKind;
  severity: Severity;
  reasons: string[];
}

export interface StatementAnalysisOptions {
  dialect?: "postgresql" | "mysql" | "sqlite" | "mssql" | "oracle";
}

import { parseSqlPreloaded, type SqlParseResult } from "./sqlAst";
import { scanDollarQuoteEnd } from "./sqlTokenize";
import { splitSqlStatements } from "./sqlUtils";

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warn: 1,
  danger: 2,
};

/**
 * Issue #1118 — worst-severity selection for multi-statement input. Returns
 * the analysis with the highest severity tier (danger > warn > info); ties
 * keep the earliest statement so its `kind` / `reasons` surface unchanged.
 */
function worstAnalysis(analyses: StatementAnalysis[]): StatementAnalysis {
  return analyses.reduce((worst, cur) =>
    SEVERITY_RANK[cur.severity] > SEVERITY_RANK[worst.severity] ? cur : worst,
  );
}

// Issue #1117 — session integrity switches that disable FK / uniqueness /
// constraint / trigger enforcement. Only the *disabling* direction warns
// (re-enabling `=1` / `ON` stays benign config). Disabling one of these arms a
// later write to corrupt data silently, the same blast-radius class as a
// bounded write, so it shares the WARN tier (consistency: same risk = same
// warning). Covers MySQL (`FOREIGN_KEY_CHECKS`/`UNIQUE_CHECKS`), PostgreSQL
// (`session_replication_role = replica|local` disables FK/trigger firing), and
// SQLite (`PRAGMA foreign_keys = off`, `PRAGMA ignore_check_constraints = on`).
const INTEGRITY_SWITCH_OFF_RES: RegExp[] = [
  /^SET\s+(?:SESSION\s+|GLOBAL\s+|@@(?:SESSION\.|GLOBAL\.)?)?(?:FOREIGN_KEY_CHECKS|UNIQUE_CHECKS)\s*=\s*0\b/,
  /^SET\s+(?:SESSION\s+)?SESSION_REPLICATION_ROLE\s*(?:=|\bTO\b)\s*'?(?:REPLICA|LOCAL)\b/,
  /^PRAGMA\s+(?:\w+\.)?FOREIGN_KEYS\s*=\s*(?:OFF|0|FALSE|NO)\b/,
  /^PRAGMA\s+(?:\w+\.)?IGNORE_CHECK_CONSTRAINTS\s*=\s*(?:ON|1|TRUE|YES)\b/,
];

// Issue #1117 — known-safe utility/session verbs (transaction control,
// maintenance, benign PRAGMA reads). Registered explicitly so the classifier
// distinguishes "known benign" from "unrecognised, fail-open". Integrity
// PRAGMA (see above) is intercepted before this reaches, so any PRAGMA landing
// here is a benign read/config.
const KNOWN_SAFE_RE =
  /^(BEGIN|START\s+TRANSACTION|COMMIT|END\s+TRANSACTION|ROLLBACK|SAVEPOINT|RELEASE|VACUUM|ANALYZE|REINDEX|CHECKPOINT|PRAGMA)\b/;

const WHITESPACE_RE = /\s+/g;

type Dialect = NonNullable<StatementAnalysisOptions["dialect"]>;

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
 * Sprint-403 invariants:
 * - INSERT — kind:'dml-insert', severity:'info'.
 * - UPDATE — kind:'dml-update'; `where_clause === null` → severity:'danger'
 *   + reason "UPDATE without WHERE clause"; otherwise severity:'warn'.
 * - DELETE — kind:'dml-delete'; `where_clause === null` → severity:'danger'
 *   + reason "DELETE without WHERE clause"; otherwise severity:'warn'.
 *
 * The DML reason strings *match* the pre-sprint-392 regex output bit-for-
 * bit so the existing sqlSafety test suite stays green (no regression).
 */
function statementAnalysisFromAst(
  ast: SqlParseResult,
): StatementAnalysis | null {
  switch (ast.kind) {
    // Sprint-393b — `WITH (CTE wrap) <inner-statement>` inherits the inner
    // statement's classification per D1/D2. The recursive call uses the
    // same mapper to avoid duplicating the per-variant rules.
    //
    // Issue #1119 — the CTE bodies (`ctes[]`) are analyzed too, not just
    // `inner_statement`. The grammar currently restricts CTE bodies to
    // SELECT, but a future widening to PostgreSQL writable CTEs
    // (`WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d`) would
    // otherwise let a destructive body slip through the AST path as
    // `info` — the regex fallback (`analyzeDmlCte`) only runs when parsing
    // fails. Combine the inner statement and every CTE body at worst
    // severity; any part the mapper cannot classify returns `null` so the
    // caller falls through to the regex matcher on the raw SQL, the more
    // protective outcome.
    case "with": {
      const parts: SqlParseResult[] = [
        ast.inner_statement,
        ...ast.ctes.map((cte) => cte.body),
      ];
      const analyses: StatementAnalysis[] = [];
      for (const part of parts) {
        const analysis = statementAnalysisFromAst(part);
        if (analysis === null) return null;
        analyses.push(analysis);
      }
      return worstAnalysis(analyses);
    }
    // Sprint-395 — EXPLAIN wrap inherits the inner statement's
    // classification verbatim per D1. The outer EXPLAIN does not add a
    // reason or escalate severity. If the inner statement is itself
    // unclassifiable (returns null), fall through so the regex fallback
    // takes over on the original SQL string.
    case "explain": {
      const inner = ast.inner_statement;
      const innerAnalysis = statementAnalysisFromAst(inner);
      if (innerAnalysis === null) return null;
      return innerAnalysis;
    }
    // Sprint-395 — GRANT / REVOKE → permission-change / warn / pinned
    // reason. The reason strings are pinned per D5 — exact-string
    // verification in AC-395-X01 / X02.
    case "grant":
      return {
        kind: "permission-change",
        severity: "warn",
        reasons: ["GRANT — 권한 변경"],
      };
    case "revoke":
      return {
        kind: "permission-change",
        severity: "warn",
        reasons: ["REVOKE — 권한 변경"],
      };
    // Sprint-395 — SHOW → config-read / info / empty reasons. D4: the
    // classifier does not distinguish between target variants.
    case "show":
      return { kind: "config-read", severity: "info", reasons: [] };
    // Sprint-395 — SET → config-write / info / empty reasons. D3: SET's
    // severity is info, not warn (per-session config change, no row
    // impact).
    case "set-stmt":
      return { kind: "config-write", severity: "info", reasons: [] };
    // Sprint-395 — COPY → data-movement / warn / direction-specific
    // pinned reason. D2: direction does not escalate severity.
    case "copy":
      return {
        kind: "data-movement",
        severity: "warn",
        reasons:
          ast.direction === "from"
            ? ["COPY FROM — 대량 import"]
            : ["COPY TO — 대량 export"],
      };
    // Sprint-395 — COMMENT → metadata / info / empty reasons.
    case "comment":
      return { kind: "metadata", severity: "info", reasons: [] };
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
      //
      // Sprint-394 — additive actions (ADD COLUMN / ADD CONSTRAINT /
      // RENAME TO / RENAME COLUMN) map to `ddl-alter-add` /
      // `ddl-alter-rename` per the per-action table in the contract.
      // The reason strings are pinned per decision D2 — reviewers must
      // reject silent rewording.
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
        case "add-column":
          return {
            kind: "ddl-alter-add",
            severity: "warn",
            reasons: ["ALTER TABLE — ADD COLUMN (schema 변경)"],
          };
        case "add-constraint":
          return {
            kind: "ddl-alter-add",
            severity: "warn",
            reasons: ["ALTER TABLE — ADD CONSTRAINT (schema 변경)"],
          };
        case "rename-table":
          return {
            kind: "ddl-alter-rename",
            severity: "warn",
            reasons: ["ALTER TABLE — RENAME (이름 변경)"],
          };
        case "rename-column":
          return {
            kind: "ddl-alter-rename",
            severity: "warn",
            reasons: ["ALTER TABLE — RENAME COLUMN (이름 변경)"],
          };
      }
      return null;
    }
    // Sprint-394 — DDL additive top-levels. Per contract D1: all three
    // CREATE variants classify as `ddl-create` / info / empty reasons.
    // `OR REPLACE` does NOT escalate severity (`create-view.or_replace`
    // is intentionally ignored here).
    case "create-table":
    case "create-index":
    case "create-view":
      return { kind: "ddl-create", severity: "info", reasons: [] };
    // Sprint-392 — DML write triad.
    case "insert":
      return { kind: "dml-insert", severity: "info", reasons: [] };
    case "call":
      return {
        kind: "routine-call",
        severity: "warn",
        reasons: ["CALL — stored routine execution"],
      };
    case "update":
      if (ast.where_clause === null) {
        return {
          kind: "dml-update",
          severity: "danger",
          reasons: ["UPDATE without WHERE clause"],
        };
      }
      return { kind: "dml-update", severity: "warn", reasons: [] };
    case "delete":
      if (ast.where_clause === null) {
        return {
          kind: "dml-delete",
          severity: "danger",
          reasons: ["DELETE without WHERE clause"],
        };
      }
      return { kind: "dml-delete", severity: "warn", reasons: [] };
    case "merge": {
      // Issue #1116 — a MERGE is a bounded conditional write (warn), and
      // `dml-merge` participates in dry-run impact escalation (same gate as
      // DELETE/UPDATE WHERE). The current AST grammar models only
      // update/insert/do-nothing branch actions — it has no DELETE action, so
      // a `WHEN MATCHED THEN DELETE` merge fails to parse and reaches the
      // regex fallback instead. Guard against a future grammar widening that
      // adds a branch action outside the analyzable set: if any clause action
      // is unrecognized, return null so the raw-SQL regex matcher takes over —
      // the more protective path (mirrors the #1119 CTE composition style).
      const analyzableMergeActions = new Set([
        "update",
        "insert",
        "do-nothing",
      ]);
      if (
        !ast.clauses.every((clause) =>
          analyzableMergeActions.has(clause.action),
        )
      ) {
        return null;
      }
      return { kind: "dml-merge", severity: "warn", reasons: [] };
    }
    // Sprint-393a — successful widened SELECT parse always classifies as
    // read-only `info`. No JOIN / GROUP / ORDER / LIMIT shape escalates
    // severity — the AST simply confirms the statement is a valid SELECT
    // and the regex fallback is bypassed.
    case "select":
      return { kind: "select", severity: "info", reasons: [] };
    case "error":
      // `error` (lex / syntax / unsupported-expression / unsupported-
      // statement) lets the caller fall through to the regex matcher
      // for safety classification.
      return null;
  }
}

/**
 * Issue #1450 — literal/nesting-aware comment stripper. Replaces the old
 * two-regex (BLOCK_COMMENT_RE / LINE_COMMENT_RE) pass that had three
 * classifier-bypass holes:
 *   (a) a nested block comment stopped at the FIRST close marker (PostgreSQL
 *       nests, so a nested-open comment leaked the trailing DROP behind stray
 *       close-marker garbage, fail-open);
 *   (b) MySQL '#' line comments were never recognised ("#x\nDROP", fail-open);
 *   and it stripped line/block comment markers even inside string literals,
 *       which could false-positive-escalate a benign write.
 * One pass so string literals, quoted identifiers, and dollar-quotes are copied
 * verbatim (a comment marker inside them is NOT a comment). Block comments
 * depth-count to the matching close (PostgreSQL nesting; over-stripping a
 * non-nesting dialect's trailing close-marker only ever fails closed). '#' is a
 * comment only for MySQL/MariaDB (dialect === "mysql"); elsewhere it is an
 * operator (PostgreSQL XOR) or a temp-table prefix (MSSQL #t).
 */
function stripComments(sql: string, dialect?: Dialect): string {
  const hashComments = dialect === "mysql";
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = skipQuotedLiteral(sql, i, ch);
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "$") {
      const end = scanDollarQuoteEnd(sql, i);
      if (end !== null) {
        out += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    // Line comment: `--` (all dialects) or `#` (MySQL only) → one space.
    if ((ch === "-" && sql[i + 1] === "-") || (hashComments && ch === "#")) {
      i += ch === "#" ? 1 : 2;
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    // Block comment `/* … */`, PostgreSQL-style nesting via a depth counter.
    if (ch === "/" && sql[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function normalize(sql: string, dialect?: Dialect): string {
  return stripComments(sql, dialect).replace(WHITESPACE_RE, " ").trim();
}

function hasMssqlBatchSeparator(sql: string): boolean {
  return /^[ \t]*GO(?:\s+\d+)?[ \t]*;?[ \t]*$/im.test(stripComments(sql));
}

function isUnsupportedTsqlProceduralScript(upper: string): boolean {
  return (
    /^CREATE\s+(?:OR\s+ALTER\s+)?PROCEDURE\b/.test(upper) ||
    /^ALTER\s+PROCEDURE\b/.test(upper) ||
    /^DECLARE\b/.test(upper) ||
    /^BEGIN\s+(?!TRAN(?:SACTION)?\b|WORK\b)/.test(upper) ||
    /^BEGIN\s+TRY\b/.test(upper) ||
    /^WHILE\b/.test(upper)
  );
}

function isMssqlSafetyContext(options?: StatementAnalysisOptions): boolean {
  return options?.dialect === "mssql";
}

/**
 * Issue #1450 — word-boundary `WHERE` presence that skips string literals,
 * quoted identifiers, and dollar-quotes. The old `/\bWHERE\b/i` matched a
 * `WHERE` inside a string literal (`SET note = 'ask WHERE money'`), so an
 * unbounded UPDATE/DELETE was mis-read as bounded and degraded to `warn`.
 * `stripped` is upper-cased at every callsite, so the needle is upper only.
 */
function hasOuterWhere(stripped: string): boolean {
  let i = 0;
  const n = stripped.length;
  while (i < n) {
    const ch = stripped[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuotedLiteral(stripped, i, ch);
      continue;
    }
    if (ch === "$") {
      const end = scanDollarQuoteEnd(stripped, i);
      if (end !== null) {
        i = end;
        continue;
      }
    }
    if (
      stripped.startsWith("WHERE", i) &&
      !isWordChar(stripped[i - 1]) &&
      !isWordChar(stripped[i + 5])
    ) {
      return true;
    }
    i++;
  }
  return false;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
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
function analyzeDmlCte(
  upper: string,
  options?: StatementAnalysisOptions,
): StatementAnalysis | null {
  // Issue #1350 — scan EVERY `… AS ( … )` CTE body, not just the first. A
  // destructive body in the 2nd+ CTE (`WITH a AS (SELECT 1), b AS (DELETE
  // FROM t) SELECT …`) would otherwise read as a benign SELECT and run with
  // no confirm dialog. Each body is re-analysed and the worst severity wins,
  // so the wrapped statement inherits its most dangerous CTE. After each body
  // we resume scanning past its closing paren, so nested `AS (` subqueries
  // inside a body aren't rescanned and a `'DELETE …'` string literal never
  // registers as a body opener.
  const asRe = /\bAS\s*\(/g;
  const analyses: StatementAnalysis[] = [];
  let searchFrom = 0;
  for (;;) {
    asRe.lastIndex = searchFrom;
    const m = asRe.exec(upper);
    if (m === null) break;
    const openIdx = asRe.lastIndex - 1; // index of the `(`
    const body = extractBalanced(upper, openIdx);
    if (body == null) break;
    // `body` includes surrounding parens; strip them and re-analyse. The
    // inner *severity* flows through; `worstAnalysis` keeps the dominant
    // body's `kind` so downstream dispatch treats a write CTE as a write.
    analyses.push(analyzeStatement(body.slice(1, -1).trim(), options));
    searchFrom = openIdx + body.length;
  }
  if (analyses.length === 0) return null;
  return worstAnalysis(analyses);
}

/**
 * Helper — given a string and the index of an opening paren, return the
 * substring from `idx` through the matching closing paren (inclusive).
 * Returns null if no balanced match exists.
 *
 * Review #1374 — literal-aware: a `(` / `)` inside a string literal, quoted
 * identifier, or dollar-quote must NOT move the depth, or a payload like
 * `(SELECT '(')` skews the count and swallows the following CTE. Skip logic
 * mirrors `splitSqlStatements` (sqlUtils.ts) so the two agree.
 */
function extractBalanced(s: string, idx: number): string | null {
  if (s[idx] !== "(") return null;
  let depth = 0;
  let i = idx;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuotedLiteral(s, i, ch);
      continue;
    }
    if (ch === "$") {
      const end = scanDollarQuoteEnd(s, i);
      if (end !== null) {
        i = end;
        continue;
      }
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return s.slice(idx, i + 1);
    }
    i++;
  }
  return null;
}

/**
 * Skip a quoted literal opened at `start` (`q` ∈ `'` `"` `` ` ``), returning the
 * index just past the closing quote. `'` and `` ` `` treat a doubled quote as
 * an escape; `"` does not (mirrors `splitSqlStatements`). Unterminated → EOF.
 */
function skipQuotedLiteral(s: string, start: number, q: string): number {
  const escapesByDoubling = q === "'" || q === "`";
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === q) {
      if (escapesByDoubling && s[i + 1] === q) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Classify a SQL statement for Safe Mode.
 *
 * Contract: this is a **single-statement** classifier — it branches on the
 * leading keyword, so `"SELECT 1; DROP TABLE x"` would otherwise read as a
 * benign `SELECT`. Historically the safety invariant ("split a batch, analyze
 * each") lived only in caller convention (see `rdbQueryExecution` →
 * `splitSqlStatements`). Issue #1118 makes the classifier self-defending: if a
 * joined batch reaches here, it is split with the literal/comment-aware
 * `splitSqlStatements` and the worst-severity classification is returned, so a
 * trailing destructive statement can never pass as `info`. Callers that
 * already split (passing one statement) hit the fast path unchanged.
 */
export function analyzeStatement(
  sql: string,
  options?: StatementAnalysisOptions,
): StatementAnalysis {
  const normalized = normalize(sql, options?.dialect);
  if (normalized.length === 0) {
    // Sprint 254 — empty / unrecognised input defaults to INFO so the
    // SafeMode matrix never escalates a benign no-op buffer. WARN is
    // reserved for *known* write surfaces.
    return { kind: "other", severity: "info", reasons: [] };
  }

  const upper = normalized.toUpperCase();

  if (isMssqlSafetyContext(options) && hasMssqlBatchSeparator(sql)) {
    return {
      kind: "other",
      severity: "warn",
      reasons: ["GO — T-SQL batch separator unsupported"],
    };
  }

  if (
    isMssqlSafetyContext(options) &&
    isUnsupportedTsqlProceduralScript(upper)
  ) {
    return {
      kind: "routine-call",
      severity: "warn",
      reasons: ["T-SQL procedural scripting unsupported in Safe Mode"],
    };
  }

  // Issue #1118 — multi-statement defense. Placed after the MSSQL
  // batch-separator / procedural early-returns so single-blob T-SQL bodies
  // (BEGIN … END; with internal semicolons) stay intact. A genuinely joined
  // batch is split with the literal/comment-aware splitter and each statement
  // is re-analyzed; the worst severity wins. Single-statement input (length
  // <= 1) skips this and takes the fast path below unchanged.
  const parts = splitSqlStatements(sql);
  if (parts.length > 1) {
    return worstAnalysis(parts.map((part) => analyzeStatement(part, options)));
  }

  // Issue #1117 — session integrity switch OFF → warn. Placed *before* the
  // AST gate because `SET FOREIGN_KEY_CHECKS=0` otherwise parses as a
  // `set-stmt` node and returns `config-write`/info, masking the risk. Same
  // early placement covers the SQLite PRAGMA forms (which never reach the AST
  // gate since PRAGMA is not in its keyword alternation).
  if (INTEGRITY_SWITCH_OFF_RES.some((re) => re.test(upper))) {
    return {
      kind: "config-write",
      severity: "warn",
      reasons: ["세션 무결성 검사 비활성화 — 후속 파괴 작업 발판"],
    };
  }

  // Sprint 391 — DDL destructive (DROP / TRUNCATE / ALTER … DROP) is
  // classified through the AST first.
  // Sprint 392 — extended to the DML write triad (INSERT / UPDATE /
  // DELETE). The WASM module may not be loaded (cold-start, jsdom unit
  // tests) in which case `parseSqlPreloaded` returns `null` and we fall
  // back to the legacy regex matchers below. The regex fallback is
  // *bit-identical* to the prior behavior so existing sqlSafety tests
  // remain green either way.
  // Sprint 393a — SELECT widened grammar (FROM / JOIN / WHERE expression /
  // GROUP / HAVING / ORDER / LIMIT). The AST may succeed for inputs that
  // the regex path classifies anyway; for inputs the AST cannot parse
  // (CTE / subquery / set ops / aggregate — deferred to sprint-393b), the
  // `error` variant lets the regex SELECT branch below handle them.
  // Sprint 395 — extended to GRANT / REVOKE / EXPLAIN / SHOW / SET / COPY /
  // COMMENT. EXPLAIN inherits the inner statement's classification (D1);
  // CALL/DO are warn-tier because routine/procedural side effects are opaque
  // to the client parser. COPY / GRANT / REVOKE classify per the misc-grammar
  // table; SHOW / SET / COMMENT classify as info-tier metadata-like
  // reads/writes.
  if (
    /^(CREATE|DROP|TRUNCATE|ALTER|INSERT|REPLACE|CALL|DO|UPDATE|DELETE|MERGE|SELECT|WITH|GRANT|REVOKE|EXPLAIN|SHOW|SET|COPY|COMMENT|EXEC|EXECUTE|USE|BACKUP|RESTORE|DBCC|DENY|GO)\b/.test(
      upper,
    )
  ) {
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

  // Issue #1115 — MySQL/MariaDB `REPLACE [INTO] …` is a destructive upsert:
  // a conflicting row is DELETEd and re-INSERTed, so existing column data is
  // silently lost. `sql-parser-core` returns `unsupported-statement` for
  // REPLACE (it never reaches the AST mapper above), so this regex branch is
  // the sole classifier. The `^REPLACE\b` anchor covers every dialect variant
  // (VALUES / SET / SELECT, with or without the optional INTO) while leaving
  // `CREATE OR REPLACE …` and `SELECT REPLACE(col, …)` untouched — in both the
  // leading keyword is not REPLACE.
  if (/^REPLACE\b/.test(upper)) {
    return {
      kind: "dml-replace",
      severity: "danger",
      reasons: ["REPLACE — 기존 행 덮어쓰기 (충돌 행 DELETE 후 INSERT)"],
    };
  }

  if (/^DELETE\s+FROM\b/.test(upper)) {
    if (!hasOuterWhere(upper)) {
      return {
        kind: "dml-delete",
        severity: "danger",
        reasons: ["DELETE without WHERE clause"],
      };
    }
    // Sprint 254 — bounded DELETE WHERE = WARN tier (was "safe").
    // Issue #1117 — an always-true predicate (`WHERE 1=1`) still classifies as
    // WARN, not danger, by design: the static classifier only checks WHERE
    // *presence*, and full predicate evaluation is intentionally deferred to
    // the dynamic dry-run escalation (`escalateWarnIfLargeImpact`), which
    // promotes WARN→danger once the row-impact estimate crosses the threshold.
    return { kind: "dml-delete", severity: "warn", reasons: [] };
  }

  if (/^UPDATE\s+\S/.test(upper)) {
    if (!hasOuterWhere(upper)) {
      return {
        kind: "dml-update",
        severity: "danger",
        reasons: ["UPDATE without WHERE clause"],
      };
    }
    // Sprint 254 — bounded UPDATE WHERE = WARN tier.
    return { kind: "dml-update", severity: "warn", reasons: [] };
  }

  if (/^CALL\b/.test(upper)) {
    return {
      kind: "routine-call",
      severity: "warn",
      reasons: ["CALL — stored routine execution"],
    };
  }

  if (/^DO\b/.test(upper)) {
    return {
      kind: "routine-call",
      severity: "warn",
      reasons: ["DO — procedural block execution"],
    };
  }

  if (/^(EXEC|EXECUTE)\b/.test(upper)) {
    return {
      kind: "routine-call",
      severity: "warn",
      reasons: ["EXEC — stored routine execution"],
    };
  }

  // Issue #1117 — PREPARE defines a deferred/opaque statement for later
  // EXECUTE. EXECUTE is already warn (routine-call); the definition side was
  // fail-open info — asymmetric. The prepared body is opaque to the static
  // classifier and may be destructive, so mirror EXECUTE at warn.
  if (/^PREPARE\b/.test(upper)) {
    return {
      kind: "routine-call",
      severity: "warn",
      reasons: ["PREPARE — dynamic statement definition"],
    };
  }

  // Issue #1117 — ATTACH/DETACH mount/unmount an external DB file
  // (SQLite/DuckDB), widening the write surface. Same config-write kind as USE
  // (database-context change) at warn.
  if (/^ATTACH\b/.test(upper)) {
    return {
      kind: "config-write",
      severity: "warn",
      reasons: ["ATTACH — 외부 DB 파일 마운트"],
    };
  }
  if (/^DETACH\b/.test(upper)) {
    return {
      kind: "config-write",
      severity: "warn",
      reasons: ["DETACH — 외부 DB 파일 해제"],
    };
  }

  if (/^GO\b/.test(upper)) {
    return {
      kind: "other",
      severity: "warn",
      reasons: ["GO — T-SQL batch separator unsupported"],
    };
  }

  if (/^USE\b/.test(upper)) {
    return {
      kind: "config-write",
      severity: "warn",
      reasons: ["USE — database context switch unsupported"],
    };
  }

  if (/^DBCC\b/.test(upper)) {
    return {
      kind: "other",
      severity: "warn",
      reasons: ["DBCC — SQL Server admin command unsupported"],
    };
  }

  if (/^DENY\b/.test(upper)) {
    return {
      kind: "permission-change",
      severity: "warn",
      reasons: ["DENY — 권한 변경"],
    };
  }

  if (/^BACKUP\b/.test(upper)) {
    return {
      kind: "data-movement",
      severity: "warn",
      reasons: ["BACKUP — SQL Server backup unsupported"],
    };
  }

  if (/^RESTORE\b/.test(upper)) {
    return {
      kind: "data-movement",
      severity: "danger",
      reasons: ["RESTORE — SQL Server restore may overwrite database"],
    };
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
  //
  // Sprint-394 — additive ALTER TABLE actions (ADD COLUMN / ADD
  // CONSTRAINT / RENAME TO / RENAME COLUMN) classify with their own
  // kinds + pinned reasons (D2). The regex path mirrors the AST path
  // bit-for-bit so jsdom unit tests without a preloaded WASM module
  // still produce the same `StatementAnalysis` shape.
  if (/^ALTER\s+TABLE\b/.test(upper)) {
    const dropMatch = upper.match(/\bDROP\s+(COLUMN|CONSTRAINT)\b/);
    if (dropMatch) {
      return {
        kind: "ddl-alter-drop",
        severity: "danger",
        reasons: [`ALTER TABLE DROP ${dropMatch[1]}`],
      };
    }
    // RENAME COLUMN takes precedence over plain RENAME (the test below
    // would otherwise match `RENAME` first).
    if (/\bRENAME\s+COLUMN\b/.test(upper)) {
      return {
        kind: "ddl-alter-rename",
        severity: "warn",
        reasons: ["ALTER TABLE — RENAME COLUMN (이름 변경)"],
      };
    }
    if (/\bRENAME\s+TO\b/.test(upper)) {
      return {
        kind: "ddl-alter-rename",
        severity: "warn",
        reasons: ["ALTER TABLE — RENAME (이름 변경)"],
      };
    }
    if (/\bADD\s+COLUMN\b/.test(upper)) {
      return {
        kind: "ddl-alter-add",
        severity: "warn",
        reasons: ["ALTER TABLE — ADD COLUMN (schema 변경)"],
      };
    }
    if (/\bADD\s+CONSTRAINT\b/.test(upper)) {
      return {
        kind: "ddl-alter-add",
        severity: "warn",
        reasons: ["ALTER TABLE — ADD CONSTRAINT (schema 변경)"],
      };
    }
    // Anonymous ADD <constraint-keyword> — bare PRIMARY KEY / UNIQUE /
    // FOREIGN KEY / CHECK at the ADD position. All classify as
    // `ddl-alter-add` per contract; the reason string uses the ADD
    // CONSTRAINT phrasing because semantically they are the same.
    if (/\bADD\s+(PRIMARY|UNIQUE|FOREIGN|CHECK)\b/.test(upper)) {
      return {
        kind: "ddl-alter-add",
        severity: "warn",
        reasons: ["ALTER TABLE — ADD CONSTRAINT (schema 변경)"],
      };
    }
  }

  // Sprint 395 — GRANT / REVOKE classify as `permission-change` / warn
  // with pinned reasons per D5. Pre-sprint-395 the regex branch classified
  // these as `ddl-other` / danger (sprint 254 baseline); sprint-395 moves
  // them to warn-tier so SafeMode `confirm` happens at the QueryTab dialog
  // (not the STOP gate). Reason strings are pinned verbatim — reviewers
  // must reject silent rewording.
  if (/^GRANT\b/.test(upper)) {
    return {
      kind: "permission-change",
      severity: "warn",
      reasons: ["GRANT — 권한 변경"],
    };
  }
  if (/^REVOKE\b/.test(upper)) {
    return {
      kind: "permission-change",
      severity: "warn",
      reasons: ["REVOKE — 권한 변경"],
    };
  }

  // Sprint-394 — CREATE TABLE / INDEX / VIEW / MATERIALIZED VIEW classify
  // as `ddl-create` / info / empty reasons. CREATE FUNCTION / TRIGGER /
  // ROLE / EXTENSION also classify here (the AST parser rejects them as
  // SyntaxError; the regex fallback still produces `ddl-create` because
  // the verb-level semantics is the same — construction, non-destructive).
  if (/^CREATE\b/.test(upper)) {
    return { kind: "ddl-create", severity: "info", reasons: [] };
  }

  if (/^DROP\b/.test(upper) || /^ALTER\b/.test(upper)) {
    // Sprint 254 — non-DROP-keyword DROP / ALTER without a recognised
    // action keyword falls through here. Defensive — most ALTER TABLE /
    // DROP variants are handled by their dedicated branches above.
    return { kind: "ddl-other", severity: "warn", reasons: [] };
  }

  if (/^INSERT\s+INTO\b/.test(upper)) {
    return { kind: "dml-insert", severity: "info", reasons: [] };
  }

  if (/^MERGE\b/.test(upper)) {
    return {
      kind: "dml-merge",
      severity: "warn",
      reasons: ["MERGE — conditional write"],
    };
  }

  if (/^SELECT\b/.test(upper)) {
    // Sprint 254 — SELECT = INFO tier (read).
    return { kind: "select", severity: "info", reasons: [] };
  }

  if (/^WITH\b/.test(upper)) {
    // Sprint 254 — DML CTE 식별. `WITH x AS (UPDATE …) SELECT *` 같은 form
    // 은 wrapped DML 의 severity 를 따른다. 순수 WITH-SELECT 만 INFO.
    const dml = analyzeDmlCte(upper, options);
    if (dml) return dml;
    return { kind: "select", severity: "info", reasons: [] };
  }

  // Sprint 395 — COPY classifies as data-movement / warn (regex fallback
  // when AST is not preloaded). Direction-specific reason string is
  // pinned per D5.
  if (/^COPY\b/.test(upper)) {
    // Direction-sniff via regex — `\bFROM\b` between table and source.
    // Both FROM and TO classifications are warn-level (D2 — direction
    // does not escalate severity).
    if (/\bTO\b/.test(upper)) {
      return {
        kind: "data-movement",
        severity: "warn",
        reasons: ["COPY TO — 대량 export"],
      };
    }
    return {
      kind: "data-movement",
      severity: "warn",
      reasons: ["COPY FROM — 대량 import"],
    };
  }

  // Sprint 395 — COMMENT classifies as metadata / info / empty reasons.
  if (/^COMMENT\b/.test(upper)) {
    return { kind: "metadata", severity: "info", reasons: [] };
  }

  // Sprint 395 — SET classifies as config-write / info / empty reasons.
  // Match `^SET\b` early (before falling through to "other" defaults).
  if (/^SET\b/.test(upper)) {
    return { kind: "config-write", severity: "info", reasons: [] };
  }

  // Sprint 255 — read-only / metadata introspection 의 INFO tier. EXPLAIN /
  // SHOW / DESCRIBE / DESC.
  // Sprint 254 — severity 가 명시적으로 "info" 로 정렬됨.
  // Sprint 395 (D4) — SHOW (regex fallback) maps to `config-read`, distinct
  // from the EXPLAIN/DESCRIBE/DESC `info` kind. EXPLAIN remains in the
  // legacy `info` bucket via this regex branch because the regex path
  // cannot identify the inner statement to inherit from (D1's "inherit
  // inner" rule is AST-only).
  if (/^SHOW\b/.test(upper)) {
    return { kind: "config-read", severity: "info", reasons: [] };
  }

  if (/^(EXPLAIN|DESCRIBE|DESC)\b/.test(upper)) {
    return { kind: "info", severity: "info", reasons: [] };
  }

  // Issue #1117 — known-safe utility/session statements (transaction control,
  // maintenance, benign PRAGMA reads). Registered as `known-safe`/info so a
  // caller/reviewer can tell "known benign" apart from the fail-open `other`
  // bucket below. Integrity-disabling SET/PRAGMA already returned warn above,
  // so a PRAGMA reaching here is a benign read/config.
  if (KNOWN_SAFE_RE.test(upper)) {
    return { kind: "known-safe", severity: "info", reasons: [] };
  }

  // Fallback policy (2026-07-02 decision, Issue #1117): an unrecognised
  // statement defaults to `other`/info (allow) — a deliberate fail-*open*
  // trade-off. The known-list above is kept maximal to minimise the residual,
  // but any statement no branch recognises must never surface WARN/STOP on its
  // own. This is intentionally asymmetric with the Oracle path
  // (`oracleSafety.ts`), which fails *closed* (block) for anything outside its
  // bounded slice because PL/SQL opacity makes an unknown statement
  // unclassifiable. The final defense for RDB is the backend Safe Mode gate at
  // the Rust IPC chokepoint (#1112), not this classifier. See
  // `docs/product/known-limitations.md` (Security / admin surface).
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
 * `severity: "warn"` (UPDATE WHERE / CREATE …) 와 `"danger"` (STOP) 는
 * INFO 가 아니므로 false.
 */
export function isInfoStatement(analysis: StatementAnalysis): boolean {
  return analysis.severity === "info";
}
