//! SQLite structured DDL that the engine performs natively (#1804).
//!
//! The bundled SQLite is 3.46 (`libsqlite3-sys 0.30.1`), so `DROP TABLE`,
//! `ALTER TABLE … RENAME TO` / `RENAME COLUMN` (3.25+), `ADD COLUMN`,
//! `DROP COLUMN` (3.35+) and `CREATE`/`DROP INDEX` all run as single
//! statements. Only those are opened here.
//!
//! Everything that SQLite can express solely by rebuilding the table — a
//! column's type, nullability or default, and adding or dropping a constraint —
//! stays `Unsupported`. The 12-step rebuild (create shadow, copy, swap,
//! recreate indexes/triggers/views) is a data-loss path and needs its own ADR,
//! so `alter_table` rejects a `Modify` change and `add_constraint` /
//! `drop_constraint` stay rejected in `mod.rs`.
//!
//! Two dialect facts drive the deviations from the peer builders
//! (`duckdb/ddl.rs`, `postgres/mutations/ddl.rs`):
//!   1. SQLite has no `CASCADE` on `DROP TABLE` or `DROP COLUMN`. A requested
//!      cascade is rejected rather than dropped silently — honouring the word
//!      "cascade" by ignoring it would misreport what ran.
//!   2. SQLite indexes are B-tree only and take no `USING <method>` clause, so
//!      a requested method that is not the default is rejected (same posture as
//!      DuckDB's ART-only builder).

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AlterTableRequest, ColumnChange, ColumnDefinition, CreateIndexRequest,
    DropColumnRequest, DropIndexRequest, DropTableRequest, RenameTableRequest, SchemaChangeResult,
};

use super::connection::{quote_identifier, validate_namespace, SqliteAdapter};
use super::ddl::{
    build_column_definition, validate_identifier, validate_sqlite_object_name, SqliteDdlStatement,
};

/// Index methods this builder can honour. SQLite has one index structure
/// (B-tree) and no `USING` clause; `btree` is what the Structure index dialog
/// sends by default and an empty value means "no method requested".
const SQLITE_INDEX_TYPES: &[&str] = &["btree"];

impl SqliteAdapter {
    pub async fn drop_table(&self, req: &DropTableRequest) -> Result<SchemaChangeResult, AppError> {
        let sql = build_drop_table_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![SqliteDdlStatement::plain(sql)])
            .await
    }

    pub async fn rename_table(
        &self,
        req: &RenameTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_rename_table_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![SqliteDdlStatement::plain(sql)])
            .await
    }

    pub async fn add_column(&self, req: &AddColumnRequest) -> Result<SchemaChangeResult, AppError> {
        let statement = build_add_column_statement(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![statement])
            .await
    }

    pub async fn drop_column(
        &self,
        req: &DropColumnRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let statement = build_drop_column_statement(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![statement])
            .await
    }

    pub async fn alter_table(
        &self,
        req: &AlterTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let statements = build_alter_table_statements(req)?;
        self.run_ddl_or_preview(req.preview_only, statements).await
    }

    pub async fn create_index(
        &self,
        req: &CreateIndexRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_create_index_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![SqliteDdlStatement::plain(sql)])
            .await
    }

    pub async fn drop_index(&self, req: &DropIndexRequest) -> Result<SchemaChangeResult, AppError> {
        let sql = build_drop_index_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![SqliteDdlStatement::plain(sql)])
            .await
    }
}

fn build_drop_table_sql(req: &DropTableRequest) -> Result<String, AppError> {
    validate_namespace(&req.schema)?;
    validate_target_table(&req.table)?;
    reject_cascade(req.cascade, "DROP TABLE")?;
    Ok(format!("DROP TABLE {}", quote_identifier(req.table.trim())))
}

fn build_rename_table_sql(req: &RenameTableRequest) -> Result<String, AppError> {
    validate_namespace(&req.schema)?;
    validate_target_table(&req.table)?;
    validate_identifier(&req.new_name, "New table name")?;
    validate_sqlite_object_name(&req.new_name, "New table name")?;
    Ok(format!(
        "ALTER TABLE {} RENAME TO {}",
        quote_identifier(req.table.trim()),
        quote_identifier(req.new_name.trim())
    ))
}

fn build_add_column_statement(req: &AddColumnRequest) -> Result<SqliteDdlStatement, AppError> {
    validate_namespace(&req.schema)?;
    validate_target_table(&req.table)?;
    // A CHECK is a constraint, and `ddl.alterConstraint` stays false for SQLite
    // for the same reason the create-table path rejects inline constraints:
    // the table cannot later drop or edit one without a rebuild. Rejecting it
    // here keeps the two paths telling the user the same thing.
    if req
        .check_expression
        .as_deref()
        .is_some_and(|expression| !expression.trim().is_empty())
    {
        return Err(AppError::Unsupported(
            "SQLite cannot add a column with a CHECK constraint: dropping or editing that \
             constraint later would need a full table rebuild, which this app does not do."
                .into(),
        ));
    }
    let definition = build_column_definition(&req.column)?;
    Ok(SqliteDdlStatement::for_column(
        format!(
            "ALTER TABLE {} ADD COLUMN {definition}",
            quote_identifier(req.table.trim())
        ),
        req.column.name.trim(),
    ))
}

fn build_drop_column_statement(req: &DropColumnRequest) -> Result<SqliteDdlStatement, AppError> {
    validate_namespace(&req.schema)?;
    validate_target_table(&req.table)?;
    validate_identifier(&req.column_name, "Column name")?;
    reject_cascade(req.cascade, "DROP COLUMN")?;
    Ok(SqliteDdlStatement::for_column(
        format!(
            "ALTER TABLE {} DROP COLUMN {}",
            quote_identifier(req.table.trim()),
            quote_identifier(req.column_name.trim())
        ),
        req.column_name.trim(),
    ))
}

fn build_alter_table_statements(
    req: &AlterTableRequest,
) -> Result<Vec<SqliteDdlStatement>, AppError> {
    validate_namespace(&req.schema)?;
    validate_target_table(&req.table)?;
    if req.changes.is_empty() {
        return Err(AppError::Validation(
            "At least one column change is required".into(),
        ));
    }

    let table = quote_identifier(req.table.trim());
    let mut statements = Vec::with_capacity(req.changes.len());
    for change in &req.changes {
        statements.push(build_alter_statement(&table, change)?);
    }
    Ok(statements)
}

/// SQLite applies one alteration per `ALTER TABLE`, so each change becomes its
/// own statement; the batch runner wraps them in a single transaction.
fn build_alter_statement(
    table: &str,
    change: &ColumnChange,
) -> Result<SqliteDdlStatement, AppError> {
    match change {
        ColumnChange::Add {
            name,
            data_type,
            nullable,
            default_value,
        } => {
            let definition = build_column_definition(&ColumnDefinition {
                name: name.clone(),
                data_type: data_type.clone(),
                nullable: *nullable,
                default_value: default_value.clone(),
                comment: None,
                is_identity: false,
            })?;
            Ok(SqliteDdlStatement::for_column(
                format!("ALTER TABLE {table} ADD COLUMN {definition}"),
                name.trim(),
            ))
        }
        ColumnChange::Drop { name } => {
            validate_identifier(name, "Column name")?;
            Ok(SqliteDdlStatement::for_column(
                format!(
                    "ALTER TABLE {table} DROP COLUMN {}",
                    quote_identifier(name.trim())
                ),
                name.trim(),
            ))
        }
        // The rebuild boundary. SQLite has no `ALTER COLUMN`: changing a type,
        // a NOT NULL or a DEFAULT means creating a shadow table, copying every
        // row, swapping the names and recreating the dependent indexes,
        // triggers and views. That is a data-loss path and is out of scope
        // (#1804), so it is refused here rather than half-applied.
        ColumnChange::Modify { name, .. } => Err(AppError::Unsupported(format!(
            "SQLite cannot change column \"{}\" in place: its type, NOT NULL and DEFAULT are \
             fixed when the table is created, and altering them needs a full table rebuild, \
             which this app does not do. Recreate the table with the new definition instead.",
            name.trim()
        ))),
    }
}

fn build_create_index_sql(req: &CreateIndexRequest) -> Result<String, AppError> {
    validate_namespace(&req.schema)?;
    validate_target_table(&req.table)?;
    validate_identifier(&req.index_name, "Index name")?;
    validate_sqlite_object_name(&req.index_name, "Index name")?;
    if req.columns.is_empty() {
        return Err(AppError::Validation(
            "At least one column is required for an index".into(),
        ));
    }
    for column in &req.columns {
        validate_identifier(column, "Index column name")?;
    }
    reject_unsupported_index_type(&req.index_type)?;

    let columns = req
        .columns
        .iter()
        .map(|column| quote_identifier(column.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(format!(
        "CREATE {}INDEX {} ON {} ({columns})",
        if req.is_unique { "UNIQUE " } else { "" },
        quote_identifier(req.index_name.trim()),
        quote_identifier(req.table.trim())
    ))
}

fn build_drop_index_sql(req: &DropIndexRequest) -> Result<String, AppError> {
    validate_namespace(&req.schema)?;
    validate_identifier(&req.index_name, "Index name")?;
    // Blocks `sqlite_autoindex_*`, the implicit indexes SQLite creates for
    // PRIMARY KEY / UNIQUE. `DROP INDEX` refuses them anyway, but the reserved
    // prefix says why. `req.table` is unused on purpose: SQLite's `DROP INDEX`
    // takes no `ON <table>` clause (MySQL's does — see `DropIndexRequest`).
    validate_sqlite_object_name(&req.index_name, "Index name")?;
    Ok(format!(
        "DROP INDEX {}{}",
        if req.if_exists { "IF EXISTS " } else { "" },
        quote_identifier(req.index_name.trim())
    ))
}

/// An existing table this statement targets. The reserved-prefix check keeps
/// the internal `sqlite_*` objects (`sqlite_sequence`, `sqlite_stat1`, …) out
/// of reach — dropping or renaming one corrupts the file's bookkeeping.
fn validate_target_table(table: &str) -> Result<(), AppError> {
    validate_identifier(table, "Table name")?;
    validate_sqlite_object_name(table, "Table name")
}

fn reject_cascade(cascade: bool, statement: &str) -> Result<(), AppError> {
    if cascade {
        return Err(AppError::Unsupported(format!(
            "SQLite has no CASCADE on {statement}: dependent views and triggers are never \
             dropped for you. Remove them first, then retry without cascade."
        )));
    }
    Ok(())
}

fn reject_unsupported_index_type(index_type: &str) -> Result<(), AppError> {
    let normalized = index_type.trim().to_ascii_lowercase();
    if normalized.is_empty() || SQLITE_INDEX_TYPES.contains(&normalized.as_str()) {
        return Ok(());
    }
    Err(AppError::Validation(format!(
        "SQLite indexes are B-tree only and take no index method, so index type must be one of: \
         {} (got {index_type})",
        SQLITE_INDEX_TYPES.join(", ")
    )))
}

#[cfg(test)]
#[path = "ddl_native_tests.rs"]
mod ddl_native_tests;
