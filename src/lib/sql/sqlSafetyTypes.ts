/**
 * `Severity` is the 3-tier union adopted in ADR 0023 grill Q2-(a) —
 * `"info" | "warn" | "danger"`.
 *
 * - `"info"`: read-only / metadata-introspection. SELECT, WITH …SELECT
 *   (no DML CTE), EXPLAIN, SHOW, DESCRIBE, DESC. Always `allow` in the
 *   SafeMode matrix.
 * - `"warn"`: bounded write surface. UPDATE WHERE, DELETE WHERE, ALTER
 *   additive (no DROP COLUMN/CONSTRAINT). SafeMode matrix result is
 *   `allow` (the raw editor's SqlPreviewDialog handles it at the
 *   QueryTab level). Escalates to STOP on a dry-run of 100+ rows via the
 *   `escalateWarnIfLargeImpact` helper.
 * - `"danger"` (STOP, preserved): DROP, TRUNCATE, WHERE-less DELETE/UPDATE,
 *   ALTER DROP COLUMN/CONSTRAINT, GRANT, REVOKE. `confirm` in the
 *   SafeMode matrix (production, or non-prod + strict).
 *
 * Multi-statement priority: DANGER > WARN > INFO (worst tier wins).
 *
 * Classification runs on the AST (`parseSqlPreloaded`) for the statement
 * variants the grammar covers and falls back to the regex matcher for the
 * rest; the `switch` in `statementAnalysisFromAst`
 * (`src/lib/sql/sqlSafetyClassifier.ts`) is the covered list. Both paths
 * return the same `analyzeStatement` shape (`kind` / `severity` /
 * `reasons`), so a caller cannot tell them apart, and an environment
 * without a preloaded AST (tests, cold start) stays on the regex path.
 *
 * Only narrow WHERE expressions (column-op-literal + AND/OR/NOT/IS NULL)
 * reach the AST; anything wider (IN-list / function call / subquery /
 * cross-table) comes back as `unsupported-expression` and falls back.
 *
 * DML kinds share the `dml-*` prefix and INSERT is an additive write with
 * `info`. A successful SELECT parse yields `kind: "select"` /
 * `severity: "info"` / `reasons: []`. A narrow PostgreSQL MERGE is a
 * bounded write surface: `kind: "dml-merge"` / `severity: "warn"`.
 * PostgreSQL `DO $$ ... $$` stays parser-unsupported, but Safe Mode
 * classifies a top-level DO block as opaque procedural execution:
 * `kind: "routine-call"` / `severity: "warn"`.
 */
export type Severity = "info" | "warn" | "danger";

export type StatementKind =
  | "select"
  // `info` also classifies read-only / metadata lookups (EXPLAIN /
  // SHOW / DESCRIBE / DESC). Same INFO tier as `select`, and the
  // identifier helper (`isInfoStatement`) treats them together as true.
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
  // DDL additive classifications.
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
  // Misc grammar classifications.
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
  // (non-empty filter) is `warn`; `mongo-drop` / `mongo-out`
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
