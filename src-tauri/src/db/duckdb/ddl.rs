//! DuckDB structured DDL — ADR 0051 Stage 2 (#1070, 2026-07-25).
//!
//! Scope: the schema-tree / Structure surfaces that ride the per-action
//! `ddl.*` capability — table create/drop/rename, column add/drop/type, and
//! index create/drop. Every op DuckDB exposes here is native `ALTER TABLE` /
//! `CREATE|DROP TABLE|INDEX`, so no rebuild-swap is needed for this set.
//!
//! Two DuckDB-specific deviations from the PostgreSQL builder
//! (`postgres/mutations/ddl.rs`, the Postgres-dialect template this mirrors):
//!   1. `ALTER TABLE` applies ONE alteration per statement (DuckDB rejects the
//!      comma-joined multi-change form Postgres accepts), so `alter_table`
//!      emits one statement per change/sub-op and runs them in a single
//!      `BEGIN..COMMIT` (rollback on any mid-batch failure).
//!   2. `CREATE INDEX` takes no `USING <method>` clause (DuckDB indexes are
//!      ART-only), so the index type is not emitted.
//!
//! Constraint DDL (`add_constraint` / `drop_constraint`) stays `Unsupported`
//! (Stage 2b): DuckDB's `ALTER TABLE` cannot add/drop constraints, so those
//! need the rebuild-swap path (owner decision #1070). The `ddl.alterConstraint`
//! capability keeps the Constraints-editor add/drop controls hidden until then.

use duckdb::Connection;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AlterTableRequest, ColumnChange, ColumnDefinition, CreateIndexRequest,
    CreateTablePlanRequest, CreateTableRequest, DropColumnRequest, DropIndexRequest,
    DropTableRequest, RenameTableRequest, SchemaChangeResult,
};

use crate::db::ddl_fragment::validate_ddl_fragment;

use super::connection::DuckdbAdapter;
use super::sql_text::quote_identifier;

const DUCKDB_IDENTIFIER_MAX_BYTES: usize = 255;

// --------------------------------------------------------------------------
// Inherent DDL entry points — the RdbAdapter trait impl (duckdb.rs) delegates
// here (inherent method resolution wins over the trait method of the same
// name, mirroring the PostgresAdapter shape).
// --------------------------------------------------------------------------

impl DuckdbAdapter {
    pub(super) async fn create_table(
        &self,
        req: &CreateTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let statements = build_create_table_statements(req)?;
        self.run_ddl_or_preview(req.preview_only, statements).await
    }

    pub(super) async fn drop_table(
        &self,
        req: &DropTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_drop_table_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![sql]).await
    }

    pub(super) async fn rename_table(
        &self,
        req: &RenameTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_rename_table_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![sql]).await
    }

    pub(super) async fn add_column(
        &self,
        req: &AddColumnRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let statements = build_add_column_statements(req)?;
        self.run_ddl_or_preview(req.preview_only, statements).await
    }

    pub(super) async fn drop_column(
        &self,
        req: &DropColumnRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_drop_column_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![sql]).await
    }

    pub(super) async fn alter_table(
        &self,
        req: &AlterTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let statements = build_alter_table_statements(req)?;
        self.run_ddl_or_preview(req.preview_only, statements).await
    }

    /// CreateTableDialog's single-IPC plan (table + indexes + constraints).
    ///
    /// Overridden instead of inheriting `RdbAdapter::create_table_plan`'s
    /// default body: that default chains `create_table` then one
    /// `add_constraint` per row, so on DuckDB (where `add_constraint` is
    /// `Unsupported` until Stage 2b) it would CREATE the table and only then
    /// fail — a half-applied plan behind an opaque error. Pre-block the whole
    /// plan instead, the same way SQLite does
    /// (`db/adapters/sqlite/ddl.rs::create_table_plan`). Indexes are native, so
    /// their chain is kept verbatim (atomic policy C: an index failure does not
    /// roll back the CREATE TABLE).
    pub(super) async fn create_table_plan(
        &self,
        req: &CreateTablePlanRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        if !req.constraints.is_empty() {
            return Err(AppError::Unsupported(
                "DuckDB cannot create table constraints yet (ADR 0051 Stage 2b): remove the \
                 FOREIGN KEY / CHECK / UNIQUE rows and create the table without them"
                    .into(),
            ));
        }

        let table = self
            .create_table(&CreateTableRequest {
                connection_id: req.connection_id.clone(),
                schema: req.schema.clone(),
                name: req.name.clone(),
                columns: req.columns.clone(),
                primary_key: req.primary_key.clone(),
                preview_only: req.preview_only,
                table_comment: req.table_comment.clone(),
                // Sprint 271c — the parent handler already probed
                // `expected_database`; child calls do not re-probe.
                expected_database: None,
            })
            .await?;

        let mut sql_parts = vec![table.sql];
        for idx in &req.indexes {
            let created = self
                .create_index(&CreateIndexRequest {
                    connection_id: req.connection_id.clone(),
                    schema: req.schema.clone(),
                    table: req.name.clone(),
                    index_name: idx.index_name.clone(),
                    columns: idx.columns.clone(),
                    index_type: idx.index_type.clone(),
                    is_unique: idx.is_unique,
                    preview_only: req.preview_only,
                    expected_database: None,
                })
                .await
                // Sprint 240 — surface the failing index name so the dialog's
                // preview pane shows which row blocked the chain.
                .map_err(|e| {
                    AppError::Database(format!("Index \"{}\" failed: {}", idx.index_name, e))
                })?;
            sql_parts.push(created.sql);
        }

        Ok(SchemaChangeResult {
            sql: sql_parts.join(";\n"),
        })
    }

    pub(super) async fn create_index(
        &self,
        req: &CreateIndexRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_create_index_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![sql]).await
    }

    pub(super) async fn drop_index(
        &self,
        req: &DropIndexRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_drop_index_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![sql]).await
    }

    /// Preview short-circuits to the joined SQL text; execute runs every
    /// statement inside one `BEGIN..COMMIT`. A read-only connection is rejected
    /// up front with a clear message (defense in depth — the command dispatch
    /// already gates via `safe_mode::enforce_read_only`, and the open connection
    /// itself is `AccessMode::ReadOnly`, but this keeps the adapter honest and
    /// unit-testable).
    async fn run_ddl_or_preview(
        &self,
        preview_only: bool,
        statements: Vec<String>,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = statements.join(";\n");
        if preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let settings = self.active_settings().await?;
        if settings.read_only {
            return Err(AppError::Unsupported(
                "Cannot run DDL on a read-only DuckDB connection".into(),
            ));
        }

        self.with_connection(move |conn| run_ddl_batch(conn, &statements))
            .await?;
        Ok(SchemaChangeResult { sql })
    }
}

fn run_ddl_batch(conn: &Connection, statements: &[String]) -> Result<(), AppError> {
    // `unchecked_transaction()` defaults to `DropBehavior::Rollback`, so any `?`
    // below drops `tx` and rolls back the statements already applied — a
    // multi-statement `alter_table` never leaves a half-applied table.
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::Database(e.to_string()))?;
    for stmt in statements {
        tx.execute(stmt, [])
            .map_err(|e| AppError::Database(format!("DuckDB DDL failed: {e}")))?;
    }
    tx.commit()
        .map_err(|e| AppError::Database(format!("DuckDB DDL commit failed: {e}")))?;
    Ok(())
}

// --------------------------------------------------------------------------
// SQL builders — pure, unit-testable, Postgres-dialect with the two DuckDB
// deviations documented at the top of this file.
// --------------------------------------------------------------------------

fn qualified_table(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_identifier(schema), quote_identifier(table))
}

fn build_drop_table_sql(req: &DropTableRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    let qualified = qualified_table(&req.schema, &req.table);
    Ok(if req.cascade {
        format!("DROP TABLE {qualified} CASCADE")
    } else {
        format!("DROP TABLE {qualified}")
    })
}

fn build_rename_table_sql(req: &RenameTableRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.new_name, "New table name")?;
    Ok(format!(
        "ALTER TABLE {} RENAME TO {}",
        qualified_table(&req.schema, &req.table),
        quote_identifier(req.new_name.trim())
    ))
}

fn build_add_column_statements(req: &AddColumnRequest) -> Result<Vec<String>, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.column.name, "Column name")?;
    validate_column_definition(&req.column)?;

    // DuckDB `ALTER TABLE ADD COLUMN` rejects inline CHECK (it is a constraint,
    // Parser: "Adding columns with constraints not yet supported"). A CHECK on a
    // new column therefore needs the Stage 2b rebuild-swap path.
    if req
        .check_expression
        .as_deref()
        .is_some_and(|e| !e.trim().is_empty())
    {
        return Err(AppError::Unsupported(
            "DuckDB cannot add a column with a CHECK constraint yet (Stage 2b)".into(),
        ));
    }

    let qualified = qualified_table(&req.schema, &req.table);
    Ok(add_column_ops(&req.column)
        .into_iter()
        .map(|op| format!("ALTER TABLE {qualified} {op}"))
        .collect())
}

/// The `ALTER TABLE …` alteration clauses that add one column DuckDB-safely.
/// DuckDB's `ADD COLUMN` rejects an inline `NOT NULL`, so a non-null column is
/// added nullable (with its `DEFAULT`, which backfills existing rows) and then
/// promoted with a separate `ALTER COLUMN … SET NOT NULL`.
fn add_column_ops(col: &ColumnDefinition) -> Vec<String> {
    let quoted = quote_identifier(&col.name);
    let mut add = format!("ADD COLUMN {} {}", quoted, col.data_type.trim());
    if let Some(default) = &col.default_value {
        let trimmed = default.trim();
        if !trimmed.is_empty() {
            add.push_str(&format!(" DEFAULT {trimmed}"));
        }
    }
    let mut ops = vec![add];
    if !col.nullable {
        ops.push(format!("ALTER COLUMN {quoted} SET NOT NULL"));
    }
    ops
}

fn build_drop_column_sql(req: &DropColumnRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.column_name, "Column name")?;
    let qualified = qualified_table(&req.schema, &req.table);
    let quoted_col = quote_identifier(&req.column_name);
    Ok(if req.cascade {
        format!("ALTER TABLE {qualified} DROP COLUMN {quoted_col} CASCADE")
    } else {
        format!("ALTER TABLE {qualified} DROP COLUMN {quoted_col}")
    })
}

fn build_create_table_statements(req: &CreateTableRequest) -> Result<Vec<String>, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.name, "Table name")?;

    if req.columns.is_empty() {
        return Err(AppError::Validation(
            "Table must have at least one column".into(),
        ));
    }
    for col in &req.columns {
        validate_identifier(&col.name, "Column name")?;
        validate_column_definition(col)?;
    }
    if let Some(pk_cols) = &req.primary_key {
        for pk in pk_cols {
            validate_identifier(pk, "Primary key column name")?;
            if !req.columns.iter().any(|c| c.name == *pk) {
                return Err(AppError::Validation(format!(
                    "Primary key column '{pk}' is not declared in the column list"
                )));
            }
        }
    }

    let qualified = qualified_table(&req.schema, &req.name);
    let mut col_defs: Vec<String> = req.columns.iter().map(build_column_definition).collect();
    if let Some(pk_cols) = &req.primary_key {
        if !pk_cols.is_empty() {
            let quoted: Vec<String> = pk_cols.iter().map(|c| quote_identifier(c)).collect();
            col_defs.push(format!("PRIMARY KEY ({})", quoted.join(", ")));
        }
    }

    let mut statements = vec![format!(
        "CREATE TABLE {} ({})",
        qualified,
        col_defs.join(", ")
    )];
    statements.extend(build_comment_statements(req, &qualified));
    Ok(statements)
}

fn build_alter_table_statements(req: &AlterTableRequest) -> Result<Vec<String>, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    if req.changes.is_empty() {
        return Err(AppError::Validation(
            "At least one column change is required".into(),
        ));
    }

    let qualified = qualified_table(&req.schema, &req.table);
    let mut statements = Vec::new();
    for change in &req.changes {
        for op in build_alter_ops(change)? {
            statements.push(format!("ALTER TABLE {qualified} {op}"));
        }
    }
    Ok(statements)
}

/// One DuckDB `ALTER TABLE` alteration clause per element (DuckDB rejects the
/// comma-joined form). `Modify` fans out into up to three ordered clauses.
fn build_alter_ops(change: &ColumnChange) -> Result<Vec<String>, AppError> {
    match change {
        ColumnChange::Add {
            name,
            data_type,
            nullable,
            default_value,
        } => {
            validate_identifier(name, "Column name")?;
            validate_ddl_fragment(data_type, "Data type")?;
            if let Some(default) = default_value {
                validate_ddl_fragment(default, "DEFAULT value")?;
            }
            // Reuse the DuckDB-safe add path (nullable add + SET NOT NULL) so an
            // ALTER-tab column-add matches the standalone add_column behaviour.
            Ok(add_column_ops(&ColumnDefinition {
                name: name.clone(),
                data_type: data_type.clone(),
                nullable: *nullable,
                default_value: default_value.clone(),
                comment: None,
                is_identity: false,
            }))
        }
        ColumnChange::Modify {
            name,
            new_data_type,
            new_nullable,
            new_default_value,
            using_expression,
            // #1735 — DuckDB does have native `COMMENT ON COLUMN` (this file
            // already emits it from `create_table`), but the ALTER leg is not
            // wired: the Structure column editor gates the comment cell on
            // `ddl.editColumnComment`, which stays false for DuckDB, so no
            // comment reaches this arm (same posture as MySQL / MSSQL).
            new_comment: _,
        } => {
            validate_identifier(name, "Column name")?;
            if new_data_type.is_none() && using_expression.is_some() {
                return Err(AppError::Validation(
                    "USING expression requires a new data type".into(),
                ));
            }
            let quoted = quote_identifier(name);
            let mut ops = Vec::new();
            if let Some(dt) = new_data_type {
                validate_ddl_fragment(dt, "Data type")?;
                match using_expression {
                    Some(expr) => {
                        validate_ddl_fragment(expr, "USING expression")?;
                        ops.push(format!("ALTER COLUMN {quoted} TYPE {dt} USING {expr}"));
                    }
                    None => ops.push(format!("ALTER COLUMN {quoted} TYPE {dt}")),
                }
            }
            if let Some(nullable) = new_nullable {
                if *nullable {
                    ops.push(format!("ALTER COLUMN {quoted} DROP NOT NULL"));
                } else {
                    ops.push(format!("ALTER COLUMN {quoted} SET NOT NULL"));
                }
            }
            if let Some(default) = new_default_value {
                validate_ddl_fragment(default, "DEFAULT value")?;
                ops.push(format!("ALTER COLUMN {quoted} SET DEFAULT {default}"));
            }
            if ops.is_empty() {
                return Err(AppError::Validation(
                    "Column modification requires at least one change".into(),
                ));
            }
            Ok(ops)
        }
        ColumnChange::Drop { name } => {
            validate_identifier(name, "Column name")?;
            Ok(vec![format!("DROP COLUMN {}", quote_identifier(name))])
        }
    }
}

fn build_create_index_sql(req: &CreateIndexRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.index_name, "Index name")?;
    if req.columns.is_empty() {
        return Err(AppError::Validation(
            "At least one column is required for an index".into(),
        ));
    }
    for col in &req.columns {
        validate_identifier(col, "Index column name")?;
    }
    let columns: Vec<String> = req.columns.iter().map(|c| quote_identifier(c)).collect();
    let unique = if req.is_unique { "UNIQUE " } else { "" };
    // DuckDB indexes are ART-only: no `USING <method>` clause (unlike Postgres).
    Ok(format!(
        "CREATE {}INDEX {} ON {} ({})",
        unique,
        quote_identifier(&req.index_name),
        qualified_table(&req.schema, &req.table),
        columns.join(", ")
    ))
}

fn build_drop_index_sql(req: &DropIndexRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.index_name, "Index name")?;
    let if_exists = if req.if_exists { "IF EXISTS " } else { "" };
    Ok(format!(
        "DROP INDEX {}{}.{}",
        if_exists,
        quote_identifier(&req.schema),
        quote_identifier(&req.index_name)
    ))
}

fn build_column_definition(col: &ColumnDefinition) -> String {
    // `is_identity` is not read here on purpose: `validate_column_definition`
    // (run by every caller before this point) rejects it outright, so an
    // identity column never reaches the emitter.
    let mut def = format!("{} {}", quote_identifier(&col.name), col.data_type.trim());
    if !col.nullable {
        def.push_str(" NOT NULL");
    }
    if let Some(default) = &col.default_value {
        let trimmed = default.trim();
        if !trimmed.is_empty() {
            def.push_str(&format!(" DEFAULT {trimmed}"));
        }
    }
    def
}

fn build_comment_statements(req: &CreateTableRequest, qualified: &str) -> Vec<String> {
    let mut stmts = Vec::new();
    if let Some(raw) = &req.table_comment {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            stmts.push(format!(
                "COMMENT ON TABLE {} IS '{}'",
                qualified,
                trimmed.replace('\'', "''")
            ));
        }
    }
    for col in &req.columns {
        if let Some(raw) = &col.comment {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                stmts.push(format!(
                    "COMMENT ON COLUMN {}.{} IS '{}'",
                    qualified,
                    quote_identifier(&col.name),
                    trimmed.replace('\'', "''")
                ));
            }
        }
    }
    stmts
}

/// Single guard for every column definition DuckDB emits — both
/// `build_create_table_statements` (per column) and
/// `build_add_column_statements` route through here, so a rejected shape can
/// never reach one builder while slipping past the other.
fn validate_column_definition(col: &ColumnDefinition) -> Result<(), AppError> {
    // DuckDB auto-increment is a `CREATE SEQUENCE` + `DEFAULT nextval(...)`
    // pair, which is out of the Stage 2 slice. Reject explicitly (SQLite does
    // the same) — silently dropping the flag would emit a plain column and
    // report success, so the user would believe they got auto-increment.
    if col.is_identity {
        return Err(AppError::Unsupported(
            "DuckDB structured DDL does not support identity columns yet (ADR 0051 Stage 2b): \
             DuckDB auto-increment needs a CREATE SEQUENCE + DEFAULT nextval(...) pair"
                .into(),
        ));
    }
    if col.data_type.trim().is_empty() {
        return Err(AppError::Validation(format!(
            "Column '{}' must have a non-empty data type",
            col.name
        )));
    }
    validate_ddl_fragment(&col.data_type, "Data type")?;
    if let Some(default) = &col.default_value {
        validate_ddl_fragment(default, "DEFAULT value")?;
    }
    Ok(())
}

fn validate_identifier(name: &str, label: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} must not be empty")));
    }
    if trimmed.len() > DUCKDB_IDENTIFIER_MAX_BYTES {
        return Err(AppError::Validation(format!(
            "{label} must not exceed {DUCKDB_IDENTIFIER_MAX_BYTES} bytes"
        )));
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return Err(AppError::Validation(format!("{label} must not be empty")));
    };
    if !first.is_ascii_alphabetic() && first != '_' {
        return Err(AppError::Validation(format!(
            "{label} must start with a letter or underscore"
        )));
    }
    for ch in chars {
        if !ch.is_ascii_alphanumeric() && ch != '_' {
            return Err(AppError::Validation(format!(
                "{label} must contain only alphanumeric characters and underscores"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    // Purpose: DuckDB Stage 2 structural DDL (ADR 0051, #1070) — SQL-builder
    // shape contracts plus round-trip execution (data preservation, rollback,
    // read-only rejection, preview) against a real DuckDB file (2026-07-25).
    use tempfile::TempDir;

    use super::*;
    use crate::db::{DbAdapter, RdbAdapter};
    use crate::models::{
        ColumnChange, ColumnDefinition, ConnectionConfig, ConstraintDefinition,
        CreateTablePlanConstraint, CreateTablePlanRequest, DatabaseType, DropColumnRequest,
    };

    // ---- builder shape contracts -----------------------------------------

    fn drop_req(cascade: bool) -> DropTableRequest {
        DropTableRequest {
            connection_id: "d".into(),
            schema: "main".into(),
            table: "users".into(),
            cascade,
            preview_only: true,
            expected_database: None,
        }
    }

    #[test]
    fn build_drop_table_quotes_and_honours_cascade() {
        assert_eq!(
            build_drop_table_sql(&drop_req(false)).unwrap(),
            "DROP TABLE \"main\".\"users\""
        );
        assert_eq!(
            build_drop_table_sql(&drop_req(true)).unwrap(),
            "DROP TABLE \"main\".\"users\" CASCADE"
        );
    }

    #[test]
    fn build_alter_table_emits_one_statement_per_change_and_sub_op() {
        let req = AlterTableRequest {
            connection_id: "d".into(),
            schema: "main".into(),
            table: "t".into(),
            changes: vec![
                ColumnChange::Add {
                    name: "note".into(),
                    data_type: "VARCHAR".into(),
                    nullable: true,
                    default_value: None,
                },
                ColumnChange::Modify {
                    name: "qty".into(),
                    new_data_type: Some("BIGINT".into()),
                    new_nullable: Some(false),
                    new_default_value: Some("0".into()),
                    using_expression: None,
                    new_comment: None,
                },
                ColumnChange::Drop { name: "old".into() },
            ],
            preview_only: true,
            expected_database: None,
        };
        let stmts = build_alter_table_statements(&req).unwrap();
        // Add (1) + Modify(type,notnull,default = 3) + Drop (1) = 5 statements,
        // never comma-joined (DuckDB single-op-per-statement).
        assert_eq!(stmts.len(), 5);
        assert_eq!(
            stmts[0],
            "ALTER TABLE \"main\".\"t\" ADD COLUMN \"note\" VARCHAR"
        );
        assert_eq!(
            stmts[1],
            "ALTER TABLE \"main\".\"t\" ALTER COLUMN \"qty\" TYPE BIGINT"
        );
        assert_eq!(
            stmts[2],
            "ALTER TABLE \"main\".\"t\" ALTER COLUMN \"qty\" SET NOT NULL"
        );
        assert_eq!(
            stmts[3],
            "ALTER TABLE \"main\".\"t\" ALTER COLUMN \"qty\" SET DEFAULT 0"
        );
        assert_eq!(stmts[4], "ALTER TABLE \"main\".\"t\" DROP COLUMN \"old\"");
    }

    #[test]
    fn build_create_index_omits_using_method_for_duckdb() {
        let req = CreateIndexRequest {
            connection_id: "d".into(),
            schema: "main".into(),
            table: "orders".into(),
            index_name: "idx_user".into(),
            columns: vec!["user_id".into()],
            index_type: "btree".into(),
            is_unique: true,
            preview_only: true,
            expected_database: None,
        };
        assert_eq!(
            build_create_index_sql(&req).unwrap(),
            "CREATE UNIQUE INDEX \"idx_user\" ON \"main\".\"orders\" (\"user_id\")"
        );
    }

    #[test]
    fn build_alter_rejects_using_without_type_and_ddl_injection() {
        let using_no_type = AlterTableRequest {
            connection_id: "d".into(),
            schema: "main".into(),
            table: "t".into(),
            changes: vec![ColumnChange::Modify {
                name: "c".into(),
                new_data_type: None,
                new_nullable: None,
                new_default_value: None,
                using_expression: Some("c::int".into()),
                new_comment: None,
            }],
            preview_only: true,
            expected_database: None,
        };
        assert!(matches!(
            build_alter_table_statements(&using_no_type),
            Err(AppError::Validation(_))
        ));

        let injection = AlterTableRequest {
            connection_id: "d".into(),
            schema: "main".into(),
            table: "t".into(),
            changes: vec![ColumnChange::Add {
                name: "c".into(),
                data_type: "INT; DROP TABLE audit".into(),
                nullable: true,
                default_value: None,
            }],
            preview_only: true,
            expected_database: None,
        };
        assert!(matches!(
            build_alter_table_statements(&injection),
            Err(AppError::Validation(_))
        ));
    }

    // ---- round-trip execution against real DuckDB ------------------------

    fn duckdb_config(path: &str, read_only: bool) -> ConnectionConfig {
        ConnectionConfig {
            id: "duckdb-ddl".to_string(),
            name: "DuckDB ddl".to_string(),
            db_type: DatabaseType::Duckdb,
            host: String::new(),
            port: 0,
            user: String::new(),
            password: String::new(),
            database: path.to_string(),
            read_only,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
            trust_server_certificate: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        }
    }

    fn seed(path: &std::path::Path) {
        let conn = duckdb::Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name VARCHAR, qty INTEGER);
             INSERT INTO items VALUES (1, 'a', 10), (2, 'b', 20);",
        )
        .unwrap();
    }

    async fn fixture(read_only: bool) -> (TempDir, DuckdbAdapter) {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("ddl.duckdb");
        seed(&db_path);
        let adapter = DuckdbAdapter::new();
        adapter
            .connect(&duckdb_config(db_path.to_str().unwrap(), read_only))
            .await
            .unwrap();
        (dir, adapter)
    }

    fn create_req(name: &str) -> CreateTableRequest {
        CreateTableRequest {
            connection_id: "d".into(),
            schema: "main".into(),
            name: name.into(),
            columns: vec![
                ColumnDefinition {
                    name: "id".into(),
                    data_type: "INTEGER".into(),
                    nullable: false,
                    default_value: None,
                    comment: None,
                    is_identity: false,
                },
                ColumnDefinition {
                    name: "label".into(),
                    data_type: "VARCHAR".into(),
                    nullable: true,
                    default_value: None,
                    comment: None,
                    is_identity: false,
                },
            ],
            primary_key: Some(vec!["id".into()]),
            preview_only: false,
            table_comment: None,
            expected_database: None,
        }
    }

    // Every round-trip below dispatches through `RdbAdapter::<method>(&adapter,
    // ..)` (UFCS) rather than the inherent method: the trait impl in
    // `db/duckdb.rs` is what the `ddl.*` commands actually call via `as_rdb()`,
    // so a method that regressed to `Err(duckdb_unsupported(..))` there has to
    // fail a test here.
    #[tokio::test]
    async fn create_then_drop_table_round_trips_1070() {
        let (_dir, adapter) = fixture(false).await;

        RdbAdapter::create_table(&adapter, &create_req("widgets"))
            .await
            .unwrap();
        let tables = RdbAdapter::list_tables(&adapter, "main").await.unwrap();
        assert!(tables.iter().any(|t| t.name == "widgets"));

        RdbAdapter::drop_table(
            &adapter,
            &DropTableRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "widgets".into(),
                cascade: false,
                preview_only: false,
                expected_database: None,
            },
        )
        .await
        .unwrap();
        let tables = RdbAdapter::list_tables(&adapter, "main").await.unwrap();
        assert!(!tables.iter().any(|t| t.name == "widgets"));
    }

    #[tokio::test]
    async fn rename_table_preserves_rows_1070() {
        let (_dir, adapter) = fixture(false).await;

        RdbAdapter::rename_table(
            &adapter,
            &RenameTableRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                new_name: "goods".into(),
                preview_only: false,
                expected_database: None,
            },
        )
        .await
        .unwrap();

        let page = adapter
            .query_table_data("main", "goods", 1, 100, Some("id ASC"), None, None, None)
            .await
            .unwrap();
        assert_eq!(page.total_count, 2);
        assert_eq!(page.rows[0][1], serde_json::json!("a"));
    }

    #[tokio::test]
    async fn add_and_drop_column_and_alter_type_round_trip_1070() {
        let (_dir, adapter) = fixture(false).await;

        // Add a NOT NULL column with a default. DuckDB rejects an inline NOT
        // NULL on ADD COLUMN, so the builder splits it into `ADD COLUMN ...
        // DEFAULT 0` + `ALTER COLUMN ... SET NOT NULL`; both halves are asserted
        // below (nullable flag + backfilled value), so deleting either statement
        // fails this test.
        RdbAdapter::add_column(
            &adapter,
            &AddColumnRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                column: ColumnDefinition {
                    name: "price".into(),
                    data_type: "INTEGER".into(),
                    nullable: false,
                    default_value: Some("0".into()),
                    comment: None,
                    is_identity: false,
                },
                check_expression: None,
                preview_only: false,
                expected_database: None,
            },
        )
        .await
        .unwrap();

        // Widen `qty` INTEGER -> BIGINT and promote it to NOT NULL via
        // ALTER COLUMN TYPE + SET NOT NULL (two DuckDB statements, one tx).
        RdbAdapter::alter_table(
            &adapter,
            &AlterTableRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                changes: vec![ColumnChange::Modify {
                    name: "qty".into(),
                    new_data_type: Some("BIGINT".into()),
                    new_nullable: Some(false),
                    new_default_value: None,
                    using_expression: None,
                    new_comment: None,
                }],
                preview_only: false,
                expected_database: None,
            },
        )
        .await
        .unwrap();

        let cols = adapter.get_columns("main", "items", None).await.unwrap();
        let price = cols.iter().find(|c| c.name == "price").unwrap();
        assert!(price.data_type.to_uppercase().contains("INT"));
        // The `SET NOT NULL` half of the split actually landed …
        assert!(!price.nullable, "ADD COLUMN must be promoted to NOT NULL");
        let qty = cols.iter().find(|c| c.name == "qty").unwrap();
        assert!(qty.data_type.to_uppercase().contains("BIGINT"));
        assert!(!qty.nullable, "ALTER COLUMN SET NOT NULL must land");

        // … and the DEFAULT backfilled the pre-existing rows (without it the
        // SET NOT NULL would have failed on the seeded rows).
        let page = adapter
            .query_table_data("main", "items", 1, 100, Some("id ASC"), None, None, None)
            .await
            .unwrap();
        let price_idx = page
            .columns
            .iter()
            .position(|c| c.name == "price")
            .expect("price column in page");
        assert_eq!(page.rows[0][price_idx], serde_json::json!(0));

        // Drop the `name` column; the other columns and rows survive.
        RdbAdapter::drop_column(
            &adapter,
            &DropColumnRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                column_name: "name".into(),
                cascade: false,
                preview_only: false,
                expected_database: None,
            },
        )
        .await
        .unwrap();
        let cols = adapter.get_columns("main", "items", None).await.unwrap();
        assert!(!cols.iter().any(|c| c.name == "name"));
        assert!(cols.iter().any(|c| c.name == "id"));
    }

    #[tokio::test]
    async fn create_and_drop_index_round_trip_1070() {
        let (_dir, adapter) = fixture(false).await;

        RdbAdapter::create_index(
            &adapter,
            &CreateIndexRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                index_name: "idx_items_name".into(),
                columns: vec!["name".into()],
                index_type: "btree".into(),
                is_unique: false,
                preview_only: false,
                expected_database: None,
            },
        )
        .await
        .unwrap();
        let indexes = RdbAdapter::get_table_indexes(&adapter, "main", "items", None)
            .await
            .unwrap();
        assert!(indexes.iter().any(|i| i.name == "idx_items_name"));

        RdbAdapter::drop_index(
            &adapter,
            &DropIndexRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                index_name: "idx_items_name".into(),
                table: "items".into(),
                if_exists: false,
                preview_only: false,
                expected_database: None,
            },
        )
        .await
        .unwrap();
        let indexes = RdbAdapter::get_table_indexes(&adapter, "main", "items", None)
            .await
            .unwrap();
        assert!(!indexes.iter().any(|i| i.name == "idx_items_name"));
    }

    #[tokio::test]
    async fn alter_table_rolls_back_on_mid_batch_failure_1070() {
        let (_dir, adapter) = fixture(false).await;

        // First op succeeds (add col), second targets a missing column so the
        // whole ALTER batch must roll back — the added column must NOT persist.
        let err = RdbAdapter::alter_table(
            &adapter,
            &AlterTableRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                changes: vec![
                    ColumnChange::Add {
                        name: "temp_col".into(),
                        data_type: "INTEGER".into(),
                        nullable: true,
                        default_value: None,
                    },
                    ColumnChange::Drop {
                        name: "does_not_exist".into(),
                    },
                ],
                preview_only: false,
                expected_database: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Database(_)), "got: {err:?}");

        let cols = adapter.get_columns("main", "items", None).await.unwrap();
        assert!(
            !cols.iter().any(|c| c.name == "temp_col"),
            "partial ALTER must roll back"
        );
    }

    #[tokio::test]
    async fn preview_only_emits_sql_without_touching_the_database_1070() {
        let (_dir, adapter) = fixture(false).await;

        let result = RdbAdapter::drop_table(
            &adapter,
            &DropTableRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                cascade: false,
                preview_only: true,
                expected_database: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(result.sql, "DROP TABLE \"main\".\"items\"");
        // Preview must not execute — the table is still there.
        let tables = RdbAdapter::list_tables(&adapter, "main").await.unwrap();
        assert!(tables.iter().any(|t| t.name == "items"));
    }

    #[tokio::test]
    async fn create_table_with_comments_executes_without_rolling_back_1070() {
        let (_dir, adapter) = fixture(false).await;

        // `COMMENT ON TABLE/COLUMN` runs inside the same transaction as the
        // CREATE TABLE, so a statement DuckDB rejected would roll the whole
        // table back. The Create Table dialog's Table comment / per-column
        // comment inputs make this user-reachable, so it needs real execution,
        // not just a string assertion — including the `''` escape path.
        let mut req = create_req("widgets");
        req.table_comment = Some("orders per widget".into());
        req.columns[1].comment = Some("display 'label'".into());
        RdbAdapter::create_table(&adapter, &req).await.unwrap();

        // Committed = every COMMENT ON statement was accepted.
        let tables = RdbAdapter::list_tables(&adapter, "main").await.unwrap();
        assert!(tables.iter().any(|t| t.name == "widgets"));
        let cols = adapter.get_columns("main", "widgets", None).await.unwrap();
        assert_eq!(cols.len(), 2);

        // Read-back of the stored comment is NOT asserted: `duckdb/queries.rs`
        // returns `comment: None` for every column (a pre-existing catalog-read
        // gap, unrelated to this write path). The emitted escape is locked on
        // the builder instead.
        let stmts = build_create_table_statements(&req).unwrap();
        assert_eq!(
            stmts[2],
            "COMMENT ON COLUMN \"main\".\"widgets\".\"label\" IS 'display ''label'''"
        );
    }

    // ---- Stage 2b boundary: constraints + identity are REJECTED, never
    // silently dropped and never half-applied ------------------------------

    fn plan_req(name: &str, constraints: Vec<CreateTablePlanConstraint>) -> CreateTablePlanRequest {
        let base = create_req(name);
        CreateTablePlanRequest {
            connection_id: base.connection_id,
            schema: base.schema,
            name: base.name,
            columns: base.columns,
            primary_key: base.primary_key,
            table_comment: None,
            indexes: Vec::new(),
            constraints,
            preview_only: false,
            expected_database: None,
        }
    }

    #[tokio::test]
    async fn create_table_plan_pre_blocks_constraints_without_creating_the_table_1070() {
        let (_dir, adapter) = fixture(false).await;

        // The `RdbAdapter::create_table_plan` DEFAULT body chains
        // `create_table` then `add_constraint` — on DuckDB that creates the
        // table and only then fails, so a CreateTableDialog FK/CHECK/UNIQUE row
        // is a click-then-error with a half-applied plan. DuckDB must pre-block
        // like SQLite (`db/adapters/sqlite/ddl.rs`).
        let err = RdbAdapter::create_table_plan(
            &adapter,
            &plan_req(
                "widgets",
                vec![CreateTablePlanConstraint {
                    constraint_name: "chk_widgets_id".into(),
                    definition: ConstraintDefinition::Check {
                        expression: "id > 0".into(),
                    },
                }],
            ),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Unsupported(_)), "got: {err:?}");

        let tables = RdbAdapter::list_tables(&adapter, "main").await.unwrap();
        assert!(
            !tables.iter().any(|t| t.name == "widgets"),
            "a rejected plan must not leave a half-applied table"
        );
    }

    #[tokio::test]
    async fn create_table_plan_without_constraints_still_chains_indexes_1070() {
        let (_dir, adapter) = fixture(false).await;

        RdbAdapter::create_table_plan(
            &adapter,
            &CreateTablePlanRequest {
                indexes: vec![crate::models::CreateTablePlanIndex {
                    index_name: "idx_widgets_label".into(),
                    columns: vec!["label".into()],
                    index_type: "btree".into(),
                    is_unique: false,
                }],
                ..plan_req("widgets", Vec::new())
            },
        )
        .await
        .unwrap();

        let indexes = RdbAdapter::get_table_indexes(&adapter, "main", "widgets", None)
            .await
            .unwrap();
        assert!(indexes.iter().any(|i| i.name == "idx_widgets_label"));
    }

    #[test]
    fn create_table_rejects_identity_columns_instead_of_dropping_them_1070() {
        // Silently ignoring `is_identity` creates a plain column with no
        // auto-increment and reports success. PG emits IDENTITY, SQLite rejects
        // — DuckDB must reject too until the sequence path lands.
        let mut req = create_req("widgets");
        req.columns[0].is_identity = true;
        assert!(matches!(
            build_create_table_statements(&req),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn add_column_rejects_identity_columns_instead_of_dropping_them_1070() {
        let req = AddColumnRequest {
            connection_id: "d".into(),
            schema: "main".into(),
            table: "items".into(),
            column: ColumnDefinition {
                name: "seq_id".into(),
                data_type: "INTEGER".into(),
                nullable: false,
                default_value: None,
                comment: None,
                is_identity: true,
            },
            check_expression: None,
            preview_only: true,
            expected_database: None,
        };
        assert!(matches!(
            build_add_column_statements(&req),
            Err(AppError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn ddl_rejected_on_read_only_connection_1070() {
        let (_dir, adapter) = fixture(true).await;

        let err = RdbAdapter::drop_table(
            &adapter,
            &DropTableRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                cascade: false,
                preview_only: false,
                expected_database: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Unsupported(_)), "got: {err:?}");
    }

    // ---- Stage 2b boundary lock ------------------------------------------

    #[tokio::test]
    async fn constraint_ddl_stays_unsupported_until_stage_2b_1070() {
        let (_dir, adapter) = fixture(false).await;

        // Locks the other half of the `ddl.alterConstraint` capability claim:
        // if either method ever starts returning Ok, the capability must flip
        // with it (otherwise the Constraints editor stays hidden for a path
        // that now works).
        let add = RdbAdapter::add_constraint(
            &adapter,
            &crate::models::AddConstraintRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                constraint_name: "chk_items_qty".into(),
                definition: ConstraintDefinition::Check {
                    expression: "qty > 0".into(),
                },
                preview_only: true,
                expected_database: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(add, AppError::Unsupported(_)), "got: {add:?}");

        let drop = RdbAdapter::drop_constraint(
            &adapter,
            &crate::models::DropConstraintRequest {
                connection_id: "d".into(),
                schema: "main".into(),
                table: "items".into(),
                constraint_name: "chk_items_qty".into(),
                preview_only: true,
                expected_database: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(drop, AppError::Unsupported(_)), "got: {drop:?}");
    }

    // ---- identifier validation -------------------------------------------

    #[test]
    fn validate_identifier_rejects_every_invalid_shape_1070() {
        // Peer parity: the other five `validate_identifier` copies
        // (postgres/mutations.rs, mysql/mutations.rs, adapters/sqlite/ddl.rs)
        // each lock their reject matrix. The DuckDB copy differs only in
        // `DUCKDB_IDENTIFIER_MAX_BYTES`, which is asserted at the boundary.
        for bad in ["", "   ", "1abc", "a-b", "a b", "a\"b", "tbl;DROP"] {
            assert!(
                matches!(
                    validate_identifier(bad, "Table name"),
                    Err(AppError::Validation(_))
                ),
                "expected rejection for {bad:?}"
            );
        }

        // 255 bytes is the documented cap: accepted at the boundary, rejected
        // one byte past it.
        let at_cap = "a".repeat(DUCKDB_IDENTIFIER_MAX_BYTES);
        assert!(validate_identifier(&at_cap, "Table name").is_ok());
        let over_cap = "a".repeat(DUCKDB_IDENTIFIER_MAX_BYTES + 1);
        assert!(matches!(
            validate_identifier(&over_cap, "Table name"),
            Err(AppError::Validation(_))
        ));

        // Accepted shapes (leading underscore, digits/underscores in the body).
        assert!(validate_identifier("_my_table1", "Table name").is_ok());
    }
}
