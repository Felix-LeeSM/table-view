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

export type Dialect = NonNullable<StatementAnalysisOptions["dialect"]>;
