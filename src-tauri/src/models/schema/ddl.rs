use serde::{Deserialize, Serialize};

/// Types of column changes supported by ALTER TABLE.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ColumnChange {
    Add {
        name: String,
        data_type: String,
        nullable: bool,
        default_value: Option<String>,
    },
    Modify {
        name: String,
        new_data_type: Option<String>,
        new_nullable: Option<bool>,
        new_default_value: Option<String>,
        /// Sprint 237 — optional USING cast expression for
        /// `ALTER COLUMN … TYPE … USING …`. Only emitted when both
        /// `new_data_type` and `using_expression` are `Some(...)`. Free-
        /// text passthrough (PG surfaces parse errors verbatim).
        /// `#[serde(default)]` keeps pre-Sprint-237 callers byte-equivalent
        /// — payloads that omit the field deserialize to `None` and the
        /// emitted SQL is unchanged.
        #[serde(default)]
        using_expression: Option<String>,
    },
    Drop {
        name: String,
    },
}

/// Request payload for ALTER TABLE operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterTableRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub changes: Vec<ColumnChange>,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c (2026-05-13) — opt-in DbMismatch guard. When set, the
    /// DDL handler probes `adapter.current_database()` under the
    /// `active_connections` lock and rejects with `AppError::DbMismatch`
    /// before invoking the trait method. Omitting the field
    /// (`#[serde(default)]` → `None`) is byte-equivalent to pre-Sprint-271.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Request payload for creating an index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIndexRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub index_name: String,
    pub columns: Vec<String>,
    pub index_type: String,
    #[serde(default)]
    pub is_unique: bool,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Request payload for dropping an index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropIndexRequest {
    pub connection_id: String,
    pub schema: String,
    pub index_name: String,
    /// Sprint 285 (Phase 17 MySQL Slice E) — MySQL 의 `DROP INDEX` 는
    /// `ON <table>` 절을 강제한다 (PG 는 schema + index_name 만으로 충분).
    /// PG 호출자는 `#[serde(default)]` 덕에 필드를 생략 가능하며 emitter
    /// 가 무시한다. MySQL 어댑터는 빈 문자열 시 `AppError::Validation`.
    #[serde(default)]
    pub table: String,
    #[serde(default)]
    pub if_exists: bool,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Types of constraints supported by ADD CONSTRAINT.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConstraintDefinition {
    PrimaryKey {
        columns: Vec<String>,
    },
    ForeignKey {
        columns: Vec<String>,
        reference_table: String,
        reference_columns: Vec<String>,
        /// Sprint 229 — referential action on DELETE of the referenced
        /// row. Whitelist (case-sensitive, PG canonical uppercase):
        /// `"NO ACTION"` | `"RESTRICT"` | `"CASCADE"` | `"SET NULL"` |
        /// `"SET DEFAULT"`. `#[serde(default)]` keeps Sprint 226+227+228
        /// callers byte-equivalent — those payloads omit the field, it
        /// deserializes to `None`, and the SQL emitter skips the
        /// `ON DELETE …` clause entirely (PG default = NO ACTION).
        #[serde(default)]
        on_delete: Option<String>,
        /// Sprint 229 — referential action on UPDATE of the referenced
        /// row. Same whitelist + default-omit semantics as `on_delete`.
        #[serde(default)]
        on_update: Option<String>,
    },
    Unique {
        columns: Vec<String>,
    },
    Check {
        expression: String,
    },
}

/// Request payload for adding a constraint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddConstraintRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub constraint_name: String,
    pub definition: ConstraintDefinition,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Request payload for dropping a constraint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropConstraintRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub constraint_name: String,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Single column definition for `CREATE TABLE` (Sprint 226).
///
/// A new struct rather than reusing `ColumnChange::Add` because Create
/// does not need the `Modify` / `Drop` enum variants and a flat shape
/// keeps the request payload simpler for the `CreateTableDialog`. If
/// `ColumnChange::Add` later diverges (e.g. ALTER-specific defaults),
/// the two stay decoupled.
///
/// Sprint 227 adds optional `comment` (`#[serde(default)]` for
/// back-compat with Sprint 226 callers that omit the field — those
/// payloads deserialize to `None`). When `Some(...)` and the trimmed
/// value is non-empty, the PG `create_table` impl emits a
/// `COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<escaped>';`
/// statement inside the same transaction (atomic policy = C,
/// partial-atomic).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    /// Sprint 242 — when `true`, the column is emitted as an
    /// auto-incrementing identity column. PG emits
    /// `GENERATED BY DEFAULT AS IDENTITY` (SQL-standard, PG 10+); the
    /// `BY DEFAULT` variant lets seed/migration scripts override the
    /// value via INSERT, which `GENERATED ALWAYS` would block. Setting
    /// `is_identity = true` overrides any caller-supplied
    /// `default_value` (the IDENTITY sequence is the default) and
    /// forces NOT NULL even if `nullable = true` was passed — the SQL
    /// standard requires identity columns to be NOT NULL anyway. The
    /// caller's `data_type` is used verbatim; PG accepts `smallint`,
    /// `integer`, `bigint`, and any domain over those — invalid types
    /// are rejected by the database engine itself with a clear error.
    /// Other adapters may map this to their dialect equivalent
    /// (`AUTO_INCREMENT` / `AUTOINCREMENT` / `IDENTITY(1,1)`); MongoDB
    /// ignores the flag.
    #[serde(default)]
    pub is_identity: bool,
}

/// Request payload for `RENAME TABLE` (Sprint 235).
///
/// Mirrors the Sprint 226 `CreateTableRequest` shape: `connection_id`,
/// `schema`, `table` identify the target; `new_name` is the rename
/// destination; `preview_only` (default `false`) toggles between SQL
/// emission and BEGIN/COMMIT execution. `#[serde(rename_all = "camelCase")]`
/// keeps the wire payload aligned with the rest of the
/// `*Request` family that the frontend's `@lib/tauri` wrappers send.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTableRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub new_name: String,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Request payload for `DROP TABLE` (Sprint 235).
///
/// `cascade` is opt-in (default `false` → PG's implicit RESTRICT, byte-
/// equivalent emission omits the `RESTRICT` keyword). `preview_only`
/// (default `false`) is the same preview/execute switch the rest of the
/// Phase 24-26 DDL family already uses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropTableRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    #[serde(default)]
    pub cascade: bool,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Request payload for `ADD COLUMN` (Sprint 236).
///
/// Mirrors the Sprint 235 `RenameTableRequest` / `DropTableRequest` shape
/// (camelCase wire form) so the new `AddColumnDialog` can drive a
/// preview/execute lifecycle through `useDdlPreviewExecution`. The
/// `column` field reuses the Sprint 226 `ColumnDefinition` struct
/// verbatim (`name`, `data_type`, `nullable`, `default_value`,
/// optional `comment`) so the Sprint 226 frontend types stay byte-
/// equivalent. `check_expression` is request-level (NOT inside
/// `ColumnDefinition`) so the `CreateTableRequest` payload shape stays
/// diff = 0; when `Some(...)` and the trimmed expression is non-empty,
/// the SQL emitter appends `CHECK (<expr>)` after `DEFAULT` (free-text
/// passthrough — no escaping, no syntax check, mirrors Sprint 229
/// CHECK constraint contract).
///
/// `preview_only` (default `false`) toggles between SQL emission and
/// `BEGIN/COMMIT` execution. `comment` on `ColumnDefinition` is
/// silently ignored by `add_column` this sprint — Sprint 237 polish
/// adds the `COMMENT ON COLUMN` chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddColumnRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub column: ColumnDefinition,
    #[serde(default)]
    pub check_expression: Option<String>,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Request payload for `DROP COLUMN` (Sprint 236).
///
/// `cascade` opt-in (default `false` → PG's implicit RESTRICT, byte-
/// equivalent emission omits the `RESTRICT` keyword — mirrors Sprint
/// 235 `DropTableRequest` convention). No pre-existence check on the
/// backend (let PG surface `column "X" does not exist` verbatim).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropColumnRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub column_name: String,
    #[serde(default)]
    pub cascade: bool,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Request payload for `CREATE TABLE` (Sprint 226).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTableRequest {
    pub connection_id: String,
    pub schema: String,
    pub name: String,
    pub columns: Vec<ColumnDefinition>,
    #[serde(default)]
    pub primary_key: Option<Vec<String>>,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 234 — table-level COMMENT ON TABLE statement, emitted
    /// inside the same `create_table` transaction as the per-column
    /// `COMMENT ON COLUMN` statements (atomic policy = C). When `None`
    /// or `Some(empty-after-trim)`, no statement is emitted (Sprint
    /// 226-233 callers stay byte-equivalent).
    #[serde(default)]
    pub table_comment: Option<String>,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}

/// Result returned by schema change operations.
/// When preview_only is true, `sql` contains the generated SQL.
/// When preview_only is false, `sql` contains the executed SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaChangeResult {
    pub sql: String,
}

/// Sprint 240 — single child index entry inside a `CreateTablePlanRequest`.
///
/// Mirrors `CreateIndexRequest` minus the `connection_id` / `schema` /
/// `table` / `preview_only` fields (those are inherited from the parent
/// plan request — one round-trip per CREATE TABLE workflow). The
/// adapter layer fans this out into a `CreateIndexRequest` per entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTablePlanIndex {
    pub index_name: String,
    pub columns: Vec<String>,
    pub index_type: String,
    #[serde(default)]
    pub is_unique: bool,
}

/// Sprint 240 — single child constraint entry inside a
/// `CreateTablePlanRequest`. Mirrors `AddConstraintRequest` minus the
/// connection / schema / table / preview-flag fields. The adapter layer
/// fans this out into an `AddConstraintRequest` per entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTablePlanConstraint {
    pub constraint_name: String,
    pub definition: ConstraintDefinition,
}

/// Sprint 240 — unified `CREATE TABLE + indexes + constraints` request.
///
/// Architecture intent (per user feedback in Sprint 240): the SQL
/// preview the user sees should come from the same server-side emitter
/// that ultimately executes. Pre-Sprint-240 the `CreateTableDialog`
/// fanned out N+1 round-trips during preview (1 `create_table` +
/// N `create_index` + M `add_constraint`); Sprint 240 collapses this
/// to a single `create_table_plan` IPC.
///
/// Atomic policy = C (partial-atomic) — the parent CREATE TABLE
/// statement runs inside its own transaction (with COMMENTs); each
/// child index / constraint runs in its own transaction. This matches
/// the per-call behaviour the dialog had before, just over one round
/// trip instead of N+1.
///
/// `preview_only` (default `false`) toggles between SQL emission and
/// execution. In preview mode the adapter joins each child's emitted
/// SQL with `;\n` so the frontend can render the full plan in one
/// pane. `#[serde(rename_all = "camelCase")]` keeps the wire form
/// aligned with the rest of the Sprint 235+ `*Request` family.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTablePlanRequest {
    pub connection_id: String,
    pub schema: String,
    pub name: String,
    pub columns: Vec<ColumnDefinition>,
    #[serde(default)]
    pub primary_key: Option<Vec<String>>,
    #[serde(default)]
    pub table_comment: Option<String>,
    #[serde(default)]
    pub indexes: Vec<CreateTablePlanIndex>,
    #[serde(default)]
    pub constraints: Vec<CreateTablePlanConstraint>,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 271c — opt-in DbMismatch guard. See `AlterTableRequest`.
    #[serde(default)]
    pub expected_database: Option<String>,
}
