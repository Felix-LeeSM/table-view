import type { ColumnCategory } from "@/lib/columnCategory";

export interface SchemaInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  row_count: number | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  fk_reference: string | null;
  comment: string | null;
  /**
   * CHECK constraint expressions referencing this column. Each entry is
   * the canonical `pg_get_constraintdef()` form (e.g. `"CHECK ((age >= 0))"`).
   * A constraint over multiple columns appears in each column's vector.
   * Backend-optional (#[serde(default)] keeps payloads from older callers
   * / non-PG adapters compatible) — read with `?? []` on the consumer side.
   */
  check_clauses?: string[];
  /**
   * Sprint 238 AC-238-02 — display category for the DataGrid (drives
   * default width + text-align). Independent of `data_type`, which is
   * preserved verbatim for structure / records views. Backend-optional
   * (`#[serde(default)]` → `unknown`) so older payloads / fixtures
   * continue parsing.
   */
  category?: ColumnCategory;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  index_type: string;
  is_unique: boolean;
  is_primary: boolean;
}

export interface ConstraintInfo {
  name: string;
  constraint_type: string;
  columns: string[];
  reference_table: string | null;
  reference_columns: string[] | null;
}

export interface TableData {
  columns: ColumnInfo[];
  rows: unknown[][];
  total_count: number;
  page: number;
  page_size: number;
  executed_query: string;
}

export type FilterOperator =
  | "Eq"
  | "Neq"
  | "Gt"
  | "Lt"
  | "Gte"
  | "Lte"
  | "Like"
  | "IsNull"
  | "IsNotNull";

export type FilterMode = "structured" | "raw";

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value: string | null;
  id: string;
}

/**
 * Validate a raw SQL WHERE clause for dangerous patterns.
 * Returns an error message string if validation fails, or null if the input is safe.
 */
export interface SortInfo {
  column: string;
  direction: "ASC" | "DESC";
}

export function validateRawSql(sql: string): string | null {
  const trimmed = sql.trim();
  if (!trimmed) return null;
  if (trimmed.includes(";")) {
    return "Raw WHERE clause must not contain semicolons";
  }
  const upper = trimmed.toUpperCase();
  const dangerous = [
    "DROP",
    "DELETE",
    "INSERT",
    "UPDATE",
    "ALTER",
    "CREATE",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
  ];
  for (const kw of dangerous) {
    if (upper.startsWith(kw)) {
      return `Raw WHERE clause must not start with ${kw}`;
    }
  }
  return null;
}

// ── Schema change types ────────────────────────────────────────────────

export type ColumnChange =
  | {
      type: "add";
      name: string;
      data_type: string;
      nullable: boolean;
      default_value: string | null;
    }
  | {
      type: "modify";
      name: string;
      new_data_type: string | null;
      new_nullable: boolean | null;
      new_default_value: string | null;
    }
  | {
      type: "drop";
      name: string;
    };

export interface AlterTableRequest {
  connection_id: string;
  schema: string;
  table: string;
  changes: ColumnChange[];
  preview_only?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. When set, the backend probes
   * the adapter's `current_database()` under the `active_connections`
   * lock and rejects with `AppError::DbMismatch` before invoking the
   * trait method. Omitting the field is byte-equivalent to pre-Sprint-271.
   */
  expected_database?: string;
}

/**
 * Sprint 235 — request payload for `tauri.renameTableRequest`. Mirrors
 * the Rust `RenameTableRequest` struct (camelCase wire form via serde
 * rename). `previewOnly` defaults to `false` server-side; the modal sends
 * `true` for the Show DDL fetch and `false` for the commit.
 */
export interface RenameTableRequest {
  connectionId: string;
  schema: string;
  table: string;
  newName: string;
  previewOnly?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expectedDatabase?: string;
}

/**
 * Sprint 235 — request payload for `tauri.dropTableRequest`. Mirrors
 * the Rust `DropTableRequest` struct. `cascade` defaults to `false`
 * (PG implicit RESTRICT; SQL omits the `RESTRICT` keyword for byte-
 * equivalence). `previewOnly` matches `RenameTableRequest`.
 */
export interface DropTableRequest {
  connectionId: string;
  schema: string;
  table: string;
  cascade?: boolean;
  previewOnly?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expectedDatabase?: string;
}

/**
 * Sprint 236 — request payload for `tauri.addColumnRequest`. Mirrors
 * the Rust `AddColumnRequest` struct (camelCase wire form via serde
 * rename). `column` reuses the Sprint 226 `ColumnDefinition` shape so
 * the existing `CreateTableDialog` field types are reusable in the new
 * `AddColumnDialog`. `checkExpression` is request-level (NOT inside
 * `ColumnDefinition`) so the Sprint 226 `CreateTableRequest` payload
 * stays diff = 0; when present and the trimmed expression is non-empty
 * the backend appends `CHECK (<expr>)` after `DEFAULT` (free-text
 * passthrough — no escaping, no syntax check). `previewOnly` toggles
 * between SQL emission and `BEGIN/COMMIT` execution.
 */
export interface AddColumnRequest {
  connectionId: string;
  schema: string;
  table: string;
  column: ColumnDefinition;
  checkExpression?: string | null;
  previewOnly?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expectedDatabase?: string;
}

/**
 * Sprint 236 — request payload for `tauri.dropColumnRequest`. Mirrors
 * the Rust `DropColumnRequest` struct. `cascade` defaults to `false`
 * (PG implicit RESTRICT; SQL omits the `RESTRICT` keyword for byte-
 * equivalence with the implicit form, matching Sprint 235
 * `DropTableRequest` convention). `previewOnly` matches
 * `AddColumnRequest`.
 */
export interface DropColumnRequest {
  connectionId: string;
  schema: string;
  table: string;
  columnName: string;
  cascade?: boolean;
  previewOnly?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expectedDatabase?: string;
}

export interface CreateIndexRequest {
  connection_id: string;
  schema: string;
  table: string;
  index_name: string;
  columns: string[];
  index_type: string;
  is_unique?: boolean;
  preview_only?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expected_database?: string;
}

export interface DropIndexRequest {
  connection_id: string;
  schema: string;
  index_name: string;
  if_exists?: boolean;
  preview_only?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expected_database?: string;
}

export type ConstraintDefinition =
  | {
      type: "primary_key";
      columns: string[];
    }
  | {
      type: "foreign_key";
      columns: string[];
      reference_table: string;
      reference_columns: string[];
      /**
       * Sprint 229 — referential action when the referenced row is
       * deleted. Whitelist (PG canonical, uppercase): NO ACTION |
       * RESTRICT | CASCADE | SET NULL | SET DEFAULT. Optional — when
       * omitted (or null) the backend's `#[serde(default)]` resolves
       * to `None` and the SQL emitter omits the clause (PG defaults
       * to NO ACTION).
       */
      on_delete?: string | null;
      /**
       * Sprint 229 — referential action when the referenced row is
       * updated. Same whitelist + default-omit semantics as
       * `on_delete`.
       */
      on_update?: string | null;
    }
  | {
      type: "unique";
      columns: string[];
    }
  | {
      type: "check";
      expression: string;
    };

export interface AddConstraintRequest {
  connection_id: string;
  schema: string;
  table: string;
  constraint_name: string;
  definition: ConstraintDefinition;
  preview_only?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expected_database?: string;
}

export interface DropConstraintRequest {
  connection_id: string;
  schema: string;
  table: string;
  constraint_name: string;
  preview_only?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expected_database?: string;
}

export interface SchemaChangeResult {
  sql: string;
}

// ── Create Table types (Sprint 226) ────────────────────────────────────

export interface ColumnDefinition {
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string | null;
  /**
   * Sprint 227 — optional column comment. When `undefined` (or empty
   * after trim) the backend emits no `COMMENT ON COLUMN`. When set,
   * single quotes are doubled (`O'Brien` → `'O''Brien'`) inside the
   * SQL literal and the statement is appended to the CREATE TABLE
   * batch in column-declaration order.
   */
  comment?: string;
  /**
   * Sprint 242 — when `true`, the column is emitted as an
   * auto-incrementing identity column (`GENERATED BY DEFAULT AS
   * IDENTITY` on PG). The backend forces NOT NULL and silently drops
   * any caller-supplied `default_value` to keep the SQL valid. Caller
   * is responsible for picking an integer-family `data_type`
   * (`smallint` / `integer` / `bigint`); the database engine itself
   * rejects non-integer types with a clear error. Defaults to `false`
   * (omitting the field is byte-equivalent to pre-Sprint-242 callers).
   */
  is_identity?: boolean;
}

export interface CreateTableRequest {
  connection_id: string;
  schema: string;
  name: string;
  columns: ColumnDefinition[];
  primary_key?: string[] | null;
  preview_only?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expected_database?: string;
}

/**
 * Sprint 240 — child index entry inside a `CreateTablePlanRequest`.
 * Mirrors the Rust `CreateTablePlanIndex` struct (camelCase wire
 * form). The parent-level `connectionId` / `schema` / `name` /
 * `previewOnly` are inherited; this entry only carries the per-index
 * fields the backend's `create_index` adapter method needs.
 */
export interface CreateTablePlanIndex {
  indexName: string;
  columns: string[];
  indexType: string;
  isUnique?: boolean;
}

/**
 * Sprint 240 — child constraint entry inside a `CreateTablePlanRequest`.
 * Mirrors the Rust `CreateTablePlanConstraint` struct.
 */
export interface CreateTablePlanConstraint {
  constraintName: string;
  definition: ConstraintDefinition;
}

/**
 * Sprint 240 — unified `CREATE TABLE + indexes + constraints` payload.
 *
 * The `CreateTableDialog` previously fanned out N+1 IPC calls during
 * each preview refresh (1 `create_table` + N `create_index` + M
 * `add_constraint`). Sprint 240 collapses this into a single
 * server-side IPC: the backend builds the full SQL plan once and the
 * frontend renders it in one preview pane.
 *
 * Atomic policy = C (partial-atomic) on commit — parent CREATE TABLE
 * runs in its own transaction (with COMMENTs); each child runs in its
 * own transaction. Preview mode joins child SQL with `;\n`.
 */
export interface CreateTablePlanRequest {
  connectionId: string;
  schema: string;
  name: string;
  columns: ColumnDefinition[];
  primaryKey?: string[] | null;
  tableComment?: string | null;
  indexes?: CreateTablePlanIndex[];
  constraints?: CreateTablePlanConstraint[];
  previewOnly?: boolean;
  /**
   * Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
   */
  expectedDatabase?: string;
}

export interface ViewInfo {
  name: string;
  schema: string;
  definition: string | null;
}

export interface FunctionInfo {
  name: string;
  schema: string;
  arguments: string | null;
  returnType: string | null;
  language: string | null;
  source: string | null;
  kind: string; // "function" | "procedure" | "aggregate" | "window"
}

/**
 * Sprint 230 — single Postgres type entry returned by
 * `tauri.listPostgresTypes(connectionId)`. The wire shape matches the
 * Rust `PostgresTypeInfo` struct (snake_case `type_kind` mirrors serde
 * default naming).
 *
 * `type_kind` is the `pg_type.typtype` whitelist:
 *   `"base"`     — built-in scalar / extension types (`varchar`,
 *                  `geometry`, …)
 *   `"domain"`   — `CREATE DOMAIN`
 *   `"enum"`     — `CREATE TYPE … AS ENUM`
 *   `"range"`    — `CREATE TYPE … AS RANGE`
 *   `"composite"` — `CREATE TYPE … AS (…)` (auto row types backing
 *                  every CREATE TABLE are excluded by the SQL filter)
 *
 * Sprint 230 surfaces the field but does not consume it for coloring
 * (deferred to Sprint 231 polish).
 */
export interface PostgresTypeInfo {
  schema: string;
  name: string;
  type_kind: "base" | "domain" | "enum" | "range" | "composite";
}
