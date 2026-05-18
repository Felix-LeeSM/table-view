/**
 * Sprint 385 / 391 / 392 — SQL parser frontend facade.
 *
 * Bridges the WASM module emitted by `wasm-pack build --target web`
 * (`src/lib/sql/wasm/`) to the rest of the TS codebase. The WASM module
 * is **lazy-loaded** via dynamic `import()` so it lives in its own Vite
 * chunk and does NOT bloat the main entry bundle — that is a load-bearing
 * invariant of the sprint-385 contract.
 *
 * Grammar (sprint-385): `SELECT <columns> FROM <table> [WHERE <ident>
 * <op> <literal>]`. Sprint-391 adds DDL destructive — `DROP …`,
 * `TRUNCATE …`, `ALTER TABLE … DROP COLUMN/CONSTRAINT/INDEX`. Sprint-392
 * adds the DML write triad — `INSERT INTO <table> [(cols)] (VALUES /
 * DEFAULT VALUES / SELECT) [ON CONFLICT …] [RETURNING …]`,
 * `UPDATE <table> SET … [FROM] [WHERE] [RETURNING]`,
 * `DELETE FROM <table> [USING] [WHERE] [RETURNING]`. WHERE is the narrow
 * `column-op-literal + AND/OR/NOT/IS NULL` slice; richer expressions
 * surface as `error-kind:'unsupported-expression'` so callers can fall
 * back to regex heuristics. Anything else returns a `SqlParseError`
 * variant. Further widening (SELECT JOIN / IN-list / functions /
 * CREATE / GRANT) is sprint-393+.
 *
 * The TS types mirror the Rust `serde::Serialize` output one-for-one —
 * see `src-tauri/sql-parser-core/src/ast.rs`. The tagged-union shape
 * (`{ kind: "..." }`) lets callers narrow without exception flow.
 */

// ---- public types ----------------------------------------------------

export type SqlBinaryOp = "=" | "<>" | "!=" | "<" | ">" | "<=" | ">=";

export type SqlLiteral =
  | { kind: "integer"; value: number }
  | { kind: "string"; value: string };

export interface SqlWhereClause {
  column: string;
  op: SqlBinaryOp;
  literal: SqlLiteral;
}

export type SqlColumns = { kind: "star" } | { kind: "named"; names: string[] };

export interface SqlSelectStatement {
  kind: "select";
  columns: SqlColumns;
  table: string;
  where: SqlWhereClause | null;
}

export type SqlParseErrorKind =
  | "lex-error"
  | "unsupported-statement"
  | "syntax-error"
  | "empty-input"
  // Sprint-392 — verb-level structure was recognized but the inner
  // expression (WHERE / SET RHS) uses a construct outside the narrow
  // sprint-392 expression slice (subquery / IN-list / cross-table
  // comparison / arithmetic / function call). Callers may treat this as
  // "fall back to regex heuristic".
  | "unsupported-expression";

export interface SqlParseError {
  kind: "error";
  error_kind: SqlParseErrorKind;
  message: string;
  at: number | null;
}

// ---- sprint-391 DDL destructive types --------------------------------

/**
 * Object kinds the sprint-391 grammar recognises after `DROP`.
 * Trigger / function / procedure / role are deliberately out of scope —
 * sqlSafety's regex fallback continues to classify them.
 */
export type SqlDropObjectType =
  | "table"
  | "database"
  | "index"
  | "view"
  | "schema"
  | "sequence"
  | "type";

export type SqlCascadeBehavior = "cascade" | "restrict";

export interface SqlDropStatement {
  kind: "drop";
  object_type: SqlDropObjectType;
  name: string;
  if_exists: boolean;
  /** `null` when the user did not write CASCADE/RESTRICT. */
  cascade: SqlCascadeBehavior | null;
}

export interface SqlTruncateStatement {
  kind: "truncate";
  table: string;
  /**
   * `null` if unspecified, `true` if `RESTART IDENTITY`, `false` if
   * `CONTINUE IDENTITY` — matches the Rust `Option<bool>` shape.
   */
  restart_identity: boolean | null;
  cascade: SqlCascadeBehavior | null;
}

export type SqlAlterAction =
  | {
      kind: "drop-column";
      column: string;
      if_exists: boolean;
      cascade: SqlCascadeBehavior | null;
    }
  | {
      kind: "drop-constraint";
      constraint: string;
      cascade: SqlCascadeBehavior | null;
    }
  | { kind: "drop-index"; index: string };

export interface SqlAlterTableStatement {
  kind: "alter-table";
  table: string;
  action: SqlAlterAction;
}

// ---- sprint-392 DML write triad types --------------------------------

/**
 * Sprint-392 widened literal set — sprint-385's `SqlLiteral` covered only
 * `integer` / `string`; DML VALUES needs every JSON-shaped column type.
 * Re-using the existing `SqlLiteral` name would be a breaking change for
 * sprint-385 callsites (sqlAst.test, useSafeModeGate, etc.), so we name
 * the new union `SqlLiteralValue` and keep `SqlLiteral` untouched.
 */
export type SqlLiteralValue =
  | { kind: "integer"; value: number }
  | { kind: "float"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" };

export type SqlInsertValue =
  | { kind: "literal"; value: SqlLiteralValue }
  | { kind: "default" }
  | { kind: "placeholder"; name: string };

export type SqlCompareOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

export type SqlWhereExpr =
  | {
      kind: "comparison";
      column: string;
      op: SqlCompareOp;
      value: SqlInsertValue;
    }
  | { kind: "and"; left: SqlWhereExpr; right: SqlWhereExpr }
  | { kind: "or"; left: SqlWhereExpr; right: SqlWhereExpr }
  | { kind: "not"; inner: SqlWhereExpr }
  | { kind: "is-null"; column: string }
  | { kind: "is-not-null"; column: string };

export type SqlInsertSource =
  | { kind: "values"; rows: SqlInsertValue[][] }
  | { kind: "default-values" }
  | { kind: "select"; statement: SqlSelectStatement };

export interface SqlUpdateAssignment {
  column: string;
  value: SqlInsertValue;
}

export type SqlOnConflict =
  | { kind: "do-nothing" }
  | {
      kind: "do-update";
      set: SqlUpdateAssignment[];
      where_clause: SqlWhereExpr | null;
    };

export interface SqlInsertStatement {
  kind: "insert";
  table: string;
  columns: string[];
  source: SqlInsertSource;
  on_conflict: SqlOnConflict | null;
  returning: string[];
}

export interface SqlUpdateStatement {
  kind: "update";
  table: string;
  assignments: SqlUpdateAssignment[];
  from: string[];
  where_clause: SqlWhereExpr | null;
  returning: string[];
}

export interface SqlDeleteStatement {
  kind: "delete";
  table: string;
  using: string[];
  where_clause: SqlWhereExpr | null;
  returning: string[];
}

export type SqlParseResult =
  | SqlSelectStatement
  | SqlDropStatement
  | SqlTruncateStatement
  | SqlAlterTableStatement
  | SqlInsertStatement
  | SqlUpdateStatement
  | SqlDeleteStatement
  | SqlParseError;

// ---- WASM bridge -----------------------------------------------------

/**
 * The wasm-pack-generated module shape. `default` is the init function
 * (returns a promise that resolves when the WASM linear memory is ready);
 * `parse_sql` is our exported Rust function. We type these via `unknown`
 * + a narrow runtime guard rather than `any` — the d.ts emitted by
 * wasm-pack uses `any` for the return value, which we tighten to
 * `SqlParseResult` here.
 */
interface SqlWasmModule {
  default: (input?: unknown) => Promise<unknown>;
  parse_sql: (sql: string) => unknown;
}

// Module-level cached init promise — `parseSql` is called once per
// editor keystroke at the worst, so we memoize the WASM instantiation
// rather than re-fetching for each call.
let modulePromise: Promise<SqlWasmModule> | null = null;

// Sprint 391 — once the WASM module has finished initialising we mirror
// the module reference into a synchronous slot so sync callers
// (`parseSqlPreloaded`, used by `sqlSafety.analyzeStatement`) can route
// through the AST path without awaiting. `null` means the module has
// not yet been loaded — sync callers must fall back to their existing
// regex / heuristic path in that case.
let loadedModule: SqlWasmModule | null = null;

async function loadWasm(): Promise<SqlWasmModule> {
  if (modulePromise === null) {
    modulePromise = (async () => {
      // Dynamic import — Vite tree-splits this into its own chunk so the
      // ~45KB WASM glue does not land in the main entry bundle.
      const mod = (await import(
        // The relative path is intentional — the wasm-pack output dir
        // (`src/lib/sql/wasm/`) is a sibling of this file. Using `@/...`
        // alias would also work but the relative form makes the chunk
        // boundary obvious to anyone grepping for `wasm`.
        "./wasm/sql_parser_core.js"
      )) as unknown as SqlWasmModule;
      // `default` is the init function generated by wasm-pack `--target
      // web`. Calling it with no args lets the glue locate the sibling
      // `.wasm` via `new URL("...", import.meta.url)`.
      await mod.default();
      // Sprint 391 — once the module is ready, expose it via the sync
      // slot so `parseSqlPreloaded` can dispatch without awaiting.
      loadedModule = mod;
      return mod;
    })();
  }
  return modulePromise;
}

/**
 * Lazy-loaded SQL parser entry point. Resolves to either a successful
 * `SqlSelectStatement` or a `SqlParseError` — errors are NOT thrown so
 * callers can pattern-match on the `kind` discriminant without
 * try/catch ceremony.
 *
 * Caller responsibility: do NOT pass untrusted SQL to a backend executor
 * based on the AST alone. The parser only verifies syntax; semantic
 * checks (schema-aware completion, dialect validation, safety gating)
 * still belong to the existing pipelines (`sqlSafety`, `queryAnalyzer`,
 * …). Replacing those is sprint-386+.
 */
export async function parseSql(sql: string): Promise<SqlParseResult> {
  const mod = await loadWasm();
  const raw = mod.parse_sql(sql);
  if (!isSqlParseResult(raw)) {
    // The Rust crate's WASM bridge falls back to `JsValue::NULL` only
    // on an internal serde-bindgen serialization bug, which is not a
    // user-input failure mode. Surface it as a synthetic error so the
    // caller's narrowing stays exhaustive.
    return {
      kind: "error",
      error_kind: "lex-error",
      message: "internal: WASM bridge returned non-serializable result",
      at: null,
    };
  }
  return raw;
}

/**
 * Sprint 391 — synchronous AST entry point. Returns `null` if the WASM
 * module is not yet loaded; otherwise dispatches into the same Rust
 * `parse_sql` function as `parseSql`. Used by `sqlSafety.analyzeStatement`
 * to migrate the regex-based DDL destructive classifier to an AST-based
 * one without breaking the synchronous public API of `analyzeStatement`.
 *
 * Callers MUST treat a `null` return as "fall back to the prior regex /
 * heuristic path" — the function deliberately does NOT throw so the
 * classifier can stay drop-in regression-safe.
 */
export function parseSqlPreloaded(sql: string): SqlParseResult | null {
  if (loadedModule === null) return null;
  const raw = loadedModule.parse_sql(sql);
  if (!isSqlParseResult(raw)) return null;
  return raw;
}

/**
 * Sprint 391 — fire-and-forget preload. Resolves once the WASM module
 * is loaded. Used by integration tests to make `parseSqlPreloaded`
 * synchronously available. Production code does not need to call this
 * explicitly; the first `parseSql(...)` await primes the same cache.
 */
export async function preloadSqlWasm(): Promise<void> {
  await loadWasm();
}

// ---- runtime guards --------------------------------------------------

const SQL_PARSE_RESULT_KINDS = new Set<string>([
  "select",
  "drop",
  "truncate",
  "alter-table",
  // Sprint-392 — DML write triad.
  "insert",
  "update",
  "delete",
  "error",
]);

function isSqlParseResult(value: unknown): value is SqlParseResult {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && SQL_PARSE_RESULT_KINDS.has(kind);
}

/**
 * Test-only escape hatch — used by `sqlAst.test.ts` to force a fresh
 * `import()` between tests. Not part of the public surface and not
 * exported through `index.ts`-style barrels.
 *
 * The function is `export` so vitest can reach it; production callers
 * should never invoke it (there is no production use case for evicting
 * the WASM module after it has been loaded).
 */
export function __resetSqlWasmModuleForTests(): void {
  modulePromise = null;
  loadedModule = null;
}
