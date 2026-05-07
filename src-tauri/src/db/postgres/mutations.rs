//! PostgreSQL DDL mutations — drop / rename / alter table, index lifecycle,
//! constraint lifecycle.
//!
//! Sprint 202 split from `db/postgres.rs`. Identifier validation/quoting
//! helpers (`validate_identifier`, `quote_identifier`, `qualified_table`)
//! live here since DDL is the only path that builds raw SQL by string
//! interpolation — every other sub-file uses parameterised queries.

use tracing::info;

use crate::error::AppError;
use crate::models::{
    AddConstraintRequest, AlterTableRequest, ColumnChange, ConstraintDefinition,
    CreateIndexRequest, CreateTableRequest, DropConstraintRequest, DropIndexRequest,
    SchemaChangeResult,
};

use super::PostgresAdapter;

/// Validate a SQL identifier (table name, column name, index name, constraint name)
/// to prevent SQL injection. Only allows `[a-zA-Z_][a-zA-Z0-9_]*`.
fn validate_identifier(name: &str, label: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{} must not be empty", label)));
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        // Unreachable: `is_empty()` above guarantees a leading char.
        // Surface Validation rather than panic on invariant break.
        return Err(AppError::Validation(format!("{} must not be empty", label)));
    };
    if !first.is_ascii_alphabetic() && first != '_' {
        return Err(AppError::Validation(format!(
            "{} must start with a letter or underscore",
            label
        )));
    }
    for ch in chars {
        if !ch.is_ascii_alphanumeric() && ch != '_' {
            return Err(AppError::Validation(format!(
                "{} must contain only alphanumeric characters and underscores",
                label
            )));
        }
    }
    Ok(())
}

/// Quote a SQL identifier with double quotes, escaping internal double quotes.
pub(super) fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Build a qualified table reference: `"schema"."table"`.
pub(super) fn qualified_table(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_identifier(schema), quote_identifier(table))
}

/// Sprint 229 — closed whitelist of PG canonical referential actions
/// for FK ON DELETE / ON UPDATE clauses (case-sensitive uppercase).
const REFERENTIAL_ACTIONS: &[&str] = &[
    "NO ACTION",
    "RESTRICT",
    "CASCADE",
    "SET NULL",
    "SET DEFAULT",
];

/// Format a referential action clause (`" ON DELETE CASCADE"` etc.)
/// when the action is `Some`. Validates against the closed whitelist
/// `{NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT}` —
/// case-sensitive uppercase, PG canonical form. Returns the empty
/// string when `None` so the calling SQL emitter can append
/// unconditionally without trailing whitespace when both clauses are
/// omitted (Sprint 226+227+228 byte-equivalence).
fn format_referential_action_clause(
    action: Option<&str>,
    keyword: &str,
) -> Result<String, AppError> {
    match action {
        None => Ok(String::new()),
        Some(value) => {
            if !REFERENTIAL_ACTIONS.contains(&value) {
                return Err(AppError::Validation(format!(
                    "Invalid {} action: {}",
                    keyword, value
                )));
            }
            Ok(format!(" {} {}", keyword, value))
        }
    }
}

impl PostgresAdapter {
    /// Drop a table permanently. Uses parameterized schema validation but
    /// table-safe quoting since table names cannot be bound as parameters.
    pub async fn drop_table(&self, table: &str, schema: &str) -> Result<(), AppError> {
        let pool = self.active_pool().await?;

        // Verify the table exists first
        let exists: Vec<(String,)> = sqlx::query_as(
            "SELECT table_name FROM information_schema.tables \
             WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

        if exists.is_empty() {
            return Err(AppError::NotFound(format!(
                "Table {}.{} not found",
                schema, table
            )));
        }

        let qualified = qualified_table(schema, table);
        let sql = format!("DROP TABLE {}", qualified);
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Dropped table {}.{}", schema, table);
        Ok(())
    }

    /// Rename a table. Validates the new name is a valid identifier.
    pub async fn rename_table(
        &self,
        table: &str,
        schema: &str,
        new_name: &str,
    ) -> Result<(), AppError> {
        // Validate new name: non-empty, alphanumeric + underscores only
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation(
                "New table name must not be empty".into(),
            ));
        }
        if !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err(AppError::Validation(
                "New table name must contain only alphanumeric characters and underscores".into(),
            ));
        }
        if trimmed.chars().next().is_none_or(|c| c.is_ascii_digit()) {
            return Err(AppError::Validation(
                "New table name must not start with a digit".into(),
            ));
        }

        let pool = self.active_pool().await?;

        let qualified_old = qualified_table(schema, table);
        let quoted_new = quote_identifier(trimmed);
        let sql = format!("ALTER TABLE {} RENAME TO {}", qualified_old, quoted_new);
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Renamed table {}.{} to {}", schema, table, trimmed);
        Ok(())
    }

    // ── Schema change operations ──────────────────────────────────────

    /// CREATE TABLE — Sprint 226.
    ///
    /// Identifier validation reuses the same `validate_identifier` helper
    /// that `alter_table` / `rename_table` (via `validate_identifier`)
    /// already enforce: whitespace-trimmed, non-empty, leading
    /// letter/underscore, alphanumeric + underscore body. SQL emission
    /// follows the PG ANSI form
    ///
    ///   `CREATE TABLE "<schema>"."<name>" ("<col1>" <type1> [NOT NULL]
    ///   [DEFAULT …], …, PRIMARY KEY ("<pkcol>", …))`
    ///
    /// `preview_only=true` returns the built SQL without touching the
    /// database. `preview_only=false` runs the statement inside a
    /// `BEGIN/COMMIT` transaction so a failure rolls back rather than
    /// leaving a half-created object.
    pub async fn create_table(
        &self,
        req: &CreateTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.name, "Table name")?;

        if req.columns.is_empty() {
            return Err(AppError::Validation(
                "Table must have at least one column".into(),
            ));
        }

        for col in &req.columns {
            validate_identifier(&col.name, "Column name")?;
            if col.data_type.trim().is_empty() {
                return Err(AppError::Validation(format!(
                    "Column '{}' must have a non-empty data type",
                    col.name
                )));
            }
        }

        // PK columns must be drawn from the declared column list.
        // Defending here mirrors the frontend pre-validation so a stale
        // PK reference (e.g. user removed a column row after marking it
        // PK) still gets rejected even if the modal were bypassed.
        if let Some(pk_cols) = &req.primary_key {
            for pk in pk_cols {
                validate_identifier(pk, "Primary key column name")?;
                if !req.columns.iter().any(|c| c.name == *pk) {
                    return Err(AppError::Validation(format!(
                        "Primary key column '{}' is not declared in the column list",
                        pk
                    )));
                }
            }
        }

        let qualified = qualified_table(&req.schema, &req.name);

        let mut col_defs: Vec<String> = Vec::with_capacity(req.columns.len() + 1);
        for col in &req.columns {
            let mut def = format!("{} {}", quote_identifier(&col.name), col.data_type.trim());
            if !col.nullable {
                def.push_str(" NOT NULL");
            }
            if let Some(default) = &col.default_value {
                let trimmed = default.trim();
                if !trimmed.is_empty() {
                    def.push_str(&format!(" DEFAULT {}", trimmed));
                }
            }
            col_defs.push(def);
        }

        if let Some(pk_cols) = &req.primary_key {
            if !pk_cols.is_empty() {
                let quoted: Vec<String> = pk_cols.iter().map(|c| quote_identifier(c)).collect();
                col_defs.push(format!("PRIMARY KEY ({})", quoted.join(", ")));
            }
        }

        let create_sql = format!("CREATE TABLE {} ({})", qualified, col_defs.join(", "));

        // Sprint 227 — emit `COMMENT ON COLUMN` per column whose
        // post-trim comment is non-empty. Single-quote escape doubles
        // any internal `'` (`O'Brien` → `'O''Brien'`). Empty /
        // whitespace-only comments emit no statement (column-comment
        // SQL is *additive* — 0-comment forms must remain
        // byte-equivalent to the Sprint 226 fixture).
        //
        // Atomic policy = C: the comment statements are appended to the
        // CREATE TABLE statement in column-declaration order and
        // executed inside the same transaction, so a CREATE TABLE
        // failure rolls back the comments and a comment failure rolls
        // back the table. The full multi-statement payload returned
        // from `preview_only` mirrors the executed batch byte-for-byte.
        let mut comment_stmts: Vec<String> = Vec::new();
        // Sprint 234 — table-level COMMENT ON TABLE statement, emitted
        // FIRST so the chain order is `table comment → column comments`
        // (Sprint 226-233 caller invariant: `table_comment = None` keeps
        // the SQL byte-equivalent because no statement is appended).
        // Single-quote escape mirrors the per-column comment rule below.
        if let Some(raw) = &req.table_comment {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                let escaped = trimmed.replace('\'', "''");
                comment_stmts.push(format!("COMMENT ON TABLE {} IS '{}'", qualified, escaped));
            }
        }
        for col in &req.columns {
            if let Some(raw) = &col.comment {
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let escaped = trimmed.replace('\'', "''");
                comment_stmts.push(format!(
                    "COMMENT ON COLUMN {}.{} IS '{}'",
                    qualified,
                    quote_identifier(&col.name),
                    escaped
                ));
            }
        }

        let sql = if comment_stmts.is_empty() {
            create_sql.clone()
        } else {
            // Each statement separated by `; ` (one space after the
            // semicolon mirrors the multi-statement convention used by
            // `alter_table`'s comma-joined parts) and a trailing `;`
            // after the final comment so the executed batch is a
            // syntactically clean script. The CREATE TABLE itself
            // remains unterminated when no comments exist (Sprint 226
            // byte-equivalence requires no trailing `;`).
            let mut s = create_sql.clone();
            for stmt in &comment_stmts {
                s.push_str("; ");
                s.push_str(stmt);
            }
            s.push(';');
            s
        };

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        // Wrap the execute in BEGIN/COMMIT so a failure (e.g. table
        // already exists, type-check rejection, comment on missing
        // column) leaves no partial state behind. CREATE TABLE itself
        // is implicitly transactional in PG, but the explicit
        // transaction is required for the additional `COMMENT ON
        // COLUMN` statements emitted in Sprint 227 — they must roll
        // back together with the CREATE TABLE if any leg fails.
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Err(e) = sqlx::query(&create_sql).execute(&mut *tx).await {
            // Best-effort rollback. The original DB error is the
            // user-facing failure; rollback errors are discarded so
            // the message stays clean.
            let _ = tx.rollback().await;
            return Err(AppError::Database(e.to_string()));
        }

        for stmt in &comment_stmts {
            if let Err(e) = sqlx::query(stmt).execute(&mut *tx).await {
                let _ = tx.rollback().await;
                return Err(AppError::Database(e.to_string()));
            }
        }

        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("commit failed: {}", e)))?;

        info!("Created table {}.{}", req.schema, req.name);
        Ok(SchemaChangeResult { sql })
    }

    /// ALTER TABLE: add, modify, or drop columns in batch.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn alter_table(
        &self,
        req: &AlterTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;

        if req.changes.is_empty() {
            return Err(AppError::Validation(
                "At least one column change is required".into(),
            ));
        }

        // Validate all column names in changes
        for change in &req.changes {
            match change {
                ColumnChange::Add { name, .. } => validate_identifier(name, "Column name")?,
                ColumnChange::Modify { name, .. } => validate_identifier(name, "Column name")?,
                ColumnChange::Drop { name } => validate_identifier(name, "Column name")?,
            }
        }

        let qualified = qualified_table(&req.schema, &req.table);

        let mut parts: Vec<String> = Vec::new();

        for change in &req.changes {
            match change {
                ColumnChange::Add {
                    name,
                    data_type,
                    nullable,
                    default_value,
                } => {
                    let mut sql = format!("ADD COLUMN {} {}", quote_identifier(name), data_type);
                    if !nullable {
                        sql.push_str(" NOT NULL");
                    }
                    if let Some(default) = default_value {
                        sql.push_str(&format!(" DEFAULT {}", default));
                    }
                    parts.push(sql);
                }
                ColumnChange::Modify {
                    name,
                    new_data_type,
                    new_nullable,
                    new_default_value,
                } => {
                    let quoted_name = quote_identifier(name);
                    if let Some(dt) = new_data_type {
                        parts.push(format!("ALTER COLUMN {} TYPE {}", quoted_name, dt));
                    }
                    if let Some(nullable) = new_nullable {
                        if *nullable {
                            parts.push(format!("ALTER COLUMN {} DROP NOT NULL", quoted_name));
                        } else {
                            parts.push(format!("ALTER COLUMN {} SET NOT NULL", quoted_name));
                        }
                    }
                    if let Some(default) = new_default_value {
                        parts.push(format!(
                            "ALTER COLUMN {} SET DEFAULT {}",
                            quoted_name, default
                        ));
                    }
                }
                ColumnChange::Drop { name } => {
                    parts.push(format!("DROP COLUMN {}", quote_identifier(name)));
                }
            }
        }

        let sql = format!("ALTER TABLE {} {}", qualified, parts.join(", "));

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Altered table {}.{}", req.schema, req.table);
        Ok(SchemaChangeResult { sql })
    }

    /// Create an index on a table.
    /// Supports index types: btree, hash, gist, gin, brin.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn create_index(
        &self,
        req: &CreateIndexRequest,
    ) -> Result<SchemaChangeResult, AppError> {
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

        // Validate index type
        let valid_index_types = ["btree", "hash", "gist", "gin", "brin"];
        let index_type_lower = req.index_type.to_lowercase();
        if !valid_index_types.contains(&index_type_lower.as_str()) {
            return Err(AppError::Validation(format!(
                "Index type must be one of: {}",
                valid_index_types.join(", ")
            )));
        }

        let qualified = qualified_table(&req.schema, &req.table);
        let columns: Vec<String> = req.columns.iter().map(|c| quote_identifier(c)).collect();

        let unique = if req.is_unique { "UNIQUE " } else { "" };
        let sql = format!(
            "CREATE {}INDEX {} ON {} USING {} ({})",
            unique,
            quote_identifier(&req.index_name),
            qualified,
            index_type_lower,
            columns.join(", ")
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!(
            "Created index {} on {}.{}",
            req.index_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Drop an index.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn drop_index(&self, req: &DropIndexRequest) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.index_name, "Index name")?;

        let if_exists = if req.if_exists { "IF EXISTS " } else { "" };
        let sql = format!(
            "DROP INDEX {}.{}{}",
            quote_identifier(&req.schema),
            if_exists,
            quote_identifier(&req.index_name)
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Dropped index {}.{}", req.schema, req.index_name);
        Ok(SchemaChangeResult { sql })
    }

    /// Add a constraint to a table.
    /// Supports: PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn add_constraint(
        &self,
        req: &AddConstraintRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.constraint_name, "Constraint name")?;

        let qualified = qualified_table(&req.schema, &req.table);
        let constraint_name = quote_identifier(&req.constraint_name);

        let constraint_sql = match &req.definition {
            ConstraintDefinition::PrimaryKey { columns } => {
                if columns.is_empty() {
                    return Err(AppError::Validation(
                        "Primary key requires at least one column".into(),
                    ));
                }
                for col in columns {
                    validate_identifier(col, "Primary key column name")?;
                }
                let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
                format!("PRIMARY KEY ({})", cols.join(", "))
            }
            ConstraintDefinition::ForeignKey {
                columns,
                reference_table,
                reference_columns,
                on_delete,
                on_update,
            } => {
                if columns.is_empty() {
                    return Err(AppError::Validation(
                        "Foreign key requires at least one column".into(),
                    ));
                }
                for col in columns {
                    validate_identifier(col, "Foreign key column name")?;
                }
                validate_identifier(reference_table, "Foreign key reference table name")?;
                for col in reference_columns {
                    validate_identifier(col, "Foreign key reference column name")?;
                }
                let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
                let ref_cols: Vec<String> = reference_columns
                    .iter()
                    .map(|c| quote_identifier(c))
                    .collect();
                // Sprint 229 — append optional ON DELETE / ON UPDATE
                // clauses when the field is `Some(action)` AND the
                // action matches the closed PG-canonical whitelist
                // `{NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT}`
                // (case-sensitive uppercase). Anything else →
                // `AppError::Validation`. When `None`, the clause is
                // omitted (Sprint 226+227+228 byte-equivalence — the
                // pre-existing `add_constraint_preview_foreign_key`
                // fixture's emitted SQL stays unchanged because both
                // fields default to `None`).
                let on_delete_clause =
                    format_referential_action_clause(on_delete.as_deref(), "ON DELETE")?;
                let on_update_clause =
                    format_referential_action_clause(on_update.as_deref(), "ON UPDATE")?;
                format!(
                    "FOREIGN KEY ({}) REFERENCES {} ({}){}{}",
                    cols.join(", "),
                    quote_identifier(reference_table),
                    ref_cols.join(", "),
                    on_delete_clause,
                    on_update_clause,
                )
            }
            ConstraintDefinition::Unique { columns } => {
                if columns.is_empty() {
                    return Err(AppError::Validation(
                        "Unique constraint requires at least one column".into(),
                    ));
                }
                for col in columns {
                    validate_identifier(col, "Unique constraint column name")?;
                }
                let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
                format!("UNIQUE ({})", cols.join(", "))
            }
            ConstraintDefinition::Check { expression } => {
                if expression.trim().is_empty() {
                    return Err(AppError::Validation(
                        "Check constraint expression must not be empty".into(),
                    ));
                }
                format!("CHECK ({})", expression)
            }
        };

        let sql = format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {}",
            qualified, constraint_name, constraint_sql
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!(
            "Added constraint {} on {}.{}",
            req.constraint_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }

    /// Drop a constraint from a table.
    /// If `preview_only` is true, returns the generated SQL without executing.
    pub async fn drop_constraint(
        &self,
        req: &DropConstraintRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.constraint_name, "Constraint name")?;

        let qualified = qualified_table(&req.schema, &req.table);
        let sql = format!(
            "ALTER TABLE {} DROP CONSTRAINT {}",
            qualified,
            quote_identifier(&req.constraint_name)
        );

        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let pool = self.active_pool().await?;

        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!(
            "Dropped constraint {} from {}.{}",
            req.constraint_name, req.schema, req.table
        );
        Ok(SchemaChangeResult { sql })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::postgres::PostgresAdapter;
    use crate::models::{
        AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition,
        ConstraintDefinition, CreateIndexRequest, CreateTableRequest, DropConstraintRequest,
        DropIndexRequest,
    };

    #[tokio::test]
    async fn drop_table_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.drop_table("users", "public").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_without_connection_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "people").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Not connected"),
            "Expected 'Not connected' error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_empty_name_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not be empty"),
            "Expected empty name validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_whitespace_only_name_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "   ").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not be empty"),
            "Expected empty name validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_invalid_characters_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "bad-name!").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("alphanumeric"),
            "Expected alphanumeric validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_starts_with_digit_fails() {
        let adapter = PostgresAdapter::new();
        let result = adapter.rename_table("users", "public", "123bad").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("must not start with a digit"),
            "Expected digit-start validation error, got: {err_msg}"
        );
    }

    #[tokio::test]
    async fn rename_table_valid_name_passes_validation() {
        let adapter = PostgresAdapter::new();
        // This will fail at the connection stage, not validation
        let result = adapter.rename_table("users", "public", "people").await;
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        // Should fail with connection error, not validation
        assert!(
            err_msg.contains("Not connected"),
            "Expected connection error for valid name, got: {err_msg}"
        );
    }

    // ── validate_identifier tests ─────────────────────────────────────

    #[test]
    fn validate_identifier_valid_names() {
        assert!(validate_identifier("users", "test").is_ok());
        assert!(validate_identifier("_private", "test").is_ok());
        assert!(validate_identifier("table_1", "test").is_ok());
        assert!(validate_identifier("CamelCase", "test").is_ok());
    }

    #[test]
    fn validate_identifier_empty_fails() {
        let result = validate_identifier("", "Table name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[test]
    fn validate_identifier_whitespace_only_fails() {
        let result = validate_identifier("   ", "Column name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[test]
    fn validate_identifier_starts_with_digit_fails() {
        let result = validate_identifier("1table", "Table name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must start with a letter or underscore"));
    }

    #[test]
    fn validate_identifier_special_chars_fails() {
        let result = validate_identifier("bad-name", "Table name");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must contain only alphanumeric characters and underscores"));
    }

    #[test]
    fn validate_identifier_with_space_fails() {
        let result = validate_identifier("bad name", "Table name");
        assert!(result.is_err());
    }

    // ── quote_identifier tests ────────────────────────────────────────

    #[test]
    fn quote_identifier_simple() {
        assert_eq!(quote_identifier("users"), "\"users\"");
    }

    #[test]
    fn quote_identifier_with_embedded_quote() {
        assert_eq!(quote_identifier("my\"table"), "\"my\"\"table\"");
    }

    // ── qualified_table tests ─────────────────────────────────────────

    #[test]
    fn qualified_table_format() {
        assert_eq!(qualified_table("public", "users"), "\"public\".\"users\"");
    }

    // ── alter_table tests ─────────────────────────────────────────────

    #[tokio::test]
    async fn alter_table_preview_only_returns_sql() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "email".to_string(),
                data_type: "varchar(255)".to_string(),
                nullable: false,
                default_value: None,
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" varchar(255) NOT NULL"
        );
    }

    #[tokio::test]
    async fn alter_table_preview_add_with_default() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "created_at".to_string(),
                data_type: "timestamp".to_string(),
                nullable: true,
                default_value: Some("now()".to_string()),
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ADD COLUMN \"created_at\" timestamp DEFAULT now()"
        );
    }

    #[tokio::test]
    async fn alter_table_preview_modify_column() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Modify {
                name: "age".to_string(),
                new_data_type: Some("bigint".to_string()),
                new_nullable: Some(false),
                new_default_value: Some("0".to_string()),
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ALTER COLUMN \"age\" TYPE bigint, ALTER COLUMN \"age\" SET NOT NULL, ALTER COLUMN \"age\" SET DEFAULT 0"
        );
    }

    #[tokio::test]
    async fn alter_table_preview_drop_column() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Drop {
                name: "legacy".to_string(),
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" DROP COLUMN \"legacy\""
        );
    }

    #[tokio::test]
    async fn alter_table_preview_batch_changes() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![
                ColumnChange::Add {
                    name: "email".to_string(),
                    data_type: "text".to_string(),
                    nullable: true,
                    default_value: None,
                },
                ColumnChange::Drop {
                    name: "old_col".to_string(),
                },
            ],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_ok());
        let schema_result = result.unwrap();
        assert_eq!(
            schema_result.sql,
            "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" text, DROP COLUMN \"old_col\""
        );
    }

    #[tokio::test]
    async fn alter_table_empty_changes_fails() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("At least one column change"));
    }

    #[tokio::test]
    async fn alter_table_invalid_table_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "bad table!".to_string(),
            changes: vec![ColumnChange::Add {
                name: "email".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn alter_table_invalid_column_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "bad column!".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
            }],
            preview_only: true,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn alter_table_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = AlterTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            changes: vec![ColumnChange::Add {
                name: "email".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
            }],
            preview_only: false,
        };
        let result = adapter.alter_table(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── create_index tests ────────────────────────────────────────────

    #[tokio::test]
    async fn create_index_preview_btree() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_users_email".to_string(),
            columns: vec!["email".to_string()],
            index_type: "btree".to_string(),
            is_unique: true,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE UNIQUE INDEX \"idx_users_email\" ON \"public\".\"users\" USING btree (\"email\")"
        );
    }

    #[tokio::test]
    async fn create_index_preview_hash_non_unique() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_users_data".to_string(),
            columns: vec!["data".to_string()],
            index_type: "hash".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_users_data\" ON \"public\".\"users\" USING hash (\"data\")"
        );
    }

    #[tokio::test]
    async fn create_index_preview_multi_column() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            index_name: "idx_orders_composite".to_string(),
            columns: vec!["user_id".to_string(), "created_at".to_string()],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_orders_composite\" ON \"public\".\"orders\" USING btree (\"user_id\", \"created_at\")"
        );
    }

    /// Sprint 228 — explicit byte-string fixture for `gin`. The
    /// pre-existing `create_index_all_types_accepted` loop only asserts
    /// `is_ok()` for each type; this case locks the actual SQL output
    /// so a future refactor (e.g. lowercase normalisation, identifier
    /// quoting tweak) can't silently regress the gin path the
    /// CreateTableDialog Indexes-tab editor exposes to users.
    #[tokio::test]
    async fn create_index_preview_gin_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "documents".to_string(),
            index_name: "idx_docs_search".to_string(),
            columns: vec!["search_tsv".to_string()],
            index_type: "gin".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_docs_search\" ON \"public\".\"documents\" USING gin (\"search_tsv\")"
        );
    }

    /// Sprint 228 — explicit byte-string fixture for `gist`. Companion
    /// to `create_index_preview_gin_byte_equivalent` — together they
    /// cover the two UI-exposed types (gin/gist) that previously only
    /// existed inside the all-types-acceptance loop.
    #[tokio::test]
    async fn create_index_preview_gist_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "regions".to_string(),
            index_name: "idx_regions_geom".to_string(),
            columns: vec!["geom".to_string()],
            index_type: "gist".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "CREATE INDEX \"idx_regions_geom\" ON \"public\".\"regions\" USING gist (\"geom\")"
        );
    }

    #[tokio::test]
    async fn create_index_all_types_accepted() {
        let adapter = PostgresAdapter::new();
        for itype in &["btree", "hash", "gist", "gin", "brin"] {
            let req = CreateIndexRequest {
                connection_id: "conn1".to_string(),
                schema: "public".to_string(),
                table: "users".to_string(),
                index_name: "idx_test".to_string(),
                columns: vec!["col1".to_string()],
                index_type: itype.to_string(),
                is_unique: false,
                preview_only: true,
            };
            assert!(
                adapter.create_index(&req).await.is_ok(),
                "Failed for type {}",
                itype
            );
        }
    }

    #[tokio::test]
    async fn create_index_invalid_type_fails() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_test".to_string(),
            columns: vec!["col1".to_string()],
            index_type: "invalid_type".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Index type must be one of"));
    }

    #[tokio::test]
    async fn create_index_empty_columns_fails() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_test".to_string(),
            columns: vec![],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("At least one column"));
    }

    #[tokio::test]
    async fn create_index_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "bad name!".to_string(),
            columns: vec!["col1".to_string()],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: true,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn create_index_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_test".to_string(),
            columns: vec!["col1".to_string()],
            index_type: "btree".to_string(),
            is_unique: false,
            preview_only: false,
        };
        let result = adapter.create_index(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── drop_index tests ──────────────────────────────────────────────

    #[tokio::test]
    async fn drop_index_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_users_email".to_string(),
            if_exists: false,
            preview_only: true,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "DROP INDEX \"public\".\"idx_users_email\""
        );
    }

    #[tokio::test]
    async fn drop_index_preview_if_exists() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_users_email".to_string(),
            if_exists: true,
            preview_only: true,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "DROP INDEX \"public\".IF EXISTS \"idx_users_email\""
        );
    }

    #[tokio::test]
    async fn drop_index_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "bad;name".to_string(),
            if_exists: false,
            preview_only: true,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn drop_index_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_test".to_string(),
            if_exists: false,
            preview_only: false,
        };
        let result = adapter.drop_index(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── add_constraint tests ──────────────────────────────────────────

    #[tokio::test]
    async fn add_constraint_preview_primary_key() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "pk_users".to_string(),
            definition: ConstraintDefinition::PrimaryKey {
                columns: vec!["id".to_string()],
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"pk_users\" PRIMARY KEY (\"id\")"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_foreign_key() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_orders_user".to_string(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".to_string()],
                reference_table: "users".to_string(),
                reference_columns: vec!["id".to_string()],
                // Sprint 229 — Rust syntax requires complete field
                // listings even when `#[serde(default)]` is set; the
                // 2-line `None` initializer keeps the emitted SQL
                // (asserted below) byte-equivalent to Sprint 228.
                on_delete: None,
                on_update: None,
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"fk_orders_user\" FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\")"
        );
    }

    // ── Sprint 229 — ON DELETE / ON UPDATE referential actions ─────────

    #[tokio::test]
    async fn add_constraint_preview_foreign_key_on_delete_cascade() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_orders_user".to_string(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".to_string()],
                reference_table: "users".to_string(),
                reference_columns: vec!["id".to_string()],
                on_delete: Some("CASCADE".to_string()),
                on_update: None,
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"fk_orders_user\" FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\") ON DELETE CASCADE"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_foreign_key_on_update_set_null_with_on_delete_restrict() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_orders_user".to_string(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".to_string()],
                reference_table: "users".to_string(),
                reference_columns: vec!["id".to_string()],
                on_delete: Some("RESTRICT".to_string()),
                on_update: Some("SET NULL".to_string()),
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        // Both clauses present, ON DELETE first then ON UPDATE
        // (declaration order is locked: emitter renders ON DELETE then
        // ON UPDATE so the byte-string is deterministic across calls).
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"fk_orders_user\" FOREIGN KEY (\"user_id\") REFERENCES \"users\" (\"id\") ON DELETE RESTRICT ON UPDATE SET NULL"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_foreign_key_invalid_on_delete_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_orders_user".to_string(),
            definition: ConstraintDefinition::ForeignKey {
                columns: vec!["user_id".to_string()],
                reference_table: "users".to_string(),
                reference_columns: vec!["id".to_string()],
                on_delete: Some("INVALID".to_string()),
                on_update: None,
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid ON DELETE action"));
    }

    #[tokio::test]
    async fn add_constraint_preview_unique() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_users_email".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"uq_users_email\" UNIQUE (\"email\")"
        );
    }

    #[tokio::test]
    async fn add_constraint_preview_check() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "chk_users_age".to_string(),
            definition: ConstraintDefinition::Check {
                expression: "age >= 0".to_string(),
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" ADD CONSTRAINT \"chk_users_age\" CHECK (age >= 0)"
        );
    }

    #[tokio::test]
    async fn add_constraint_empty_pk_columns_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "pk_test".to_string(),
            definition: ConstraintDefinition::PrimaryKey { columns: vec![] },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("at least one column"));
    }

    #[tokio::test]
    async fn add_constraint_empty_check_expression_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "chk_test".to_string(),
            definition: ConstraintDefinition::Check {
                expression: "  ".to_string(),
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("must not be empty"));
    }

    #[tokio::test]
    async fn add_constraint_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "bad;name".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: true,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn add_constraint_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = AddConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_test".to_string(),
            definition: ConstraintDefinition::Unique {
                columns: vec!["email".to_string()],
            },
            preview_only: false,
        };
        let result = adapter.add_constraint(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── drop_constraint tests ─────────────────────────────────────────

    #[tokio::test]
    async fn drop_constraint_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_users_email".to_string(),
            preview_only: true,
        };
        let result = adapter.drop_constraint(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            "ALTER TABLE \"public\".\"users\" DROP CONSTRAINT \"uq_users_email\""
        );
    }

    #[tokio::test]
    async fn drop_constraint_invalid_name_fails() {
        let adapter = PostgresAdapter::new();
        let req = DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "bad;name".to_string(),
            preview_only: true,
        };
        let result = adapter.drop_constraint(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn drop_constraint_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            constraint_name: "uq_test".to_string(),
            preview_only: false,
        };
        let result = adapter.drop_constraint(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    // ── create_table tests (Sprint 226) ───────────────────────────────

    fn col(name: &str, ty: &str, nullable: bool, default: Option<&str>) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: ty.to_string(),
            nullable,
            default_value: default.map(|s| s.to_string()),
            comment: None,
        }
    }

    /// Sprint 227 — `col` variant with a comment string. Mirrors `col`
    /// (no `comment` argument) but appends a non-empty `comment` for the
    /// `COMMENT ON COLUMN` emission tests.
    fn col_with_comment(
        name: &str,
        ty: &str,
        nullable: bool,
        default: Option<&str>,
        comment: &str,
    ) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: ty.to_string(),
            nullable,
            default_value: default.map(|s| s.to_string()),
            comment: Some(comment.to_string()),
        }
    }

    #[tokio::test]
    async fn create_table_preview_one_column_no_pk() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer)"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_three_column_composite_pk_byte_equivalent() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "memberships".to_string(),
            columns: vec![
                col("user_id", "integer", false, None),
                col("group_id", "integer", false, None),
                col("joined_at", "timestamp", true, Some("now()")),
            ],
            primary_key: Some(vec!["user_id".to_string(), "group_id".to_string()]),
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        // Byte-equivalent canonical fixture (RFC-style determinism per
        // spec Verification Hint #2). Any whitespace / quoting drift
        // breaks this test.
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."memberships" ("user_id" integer NOT NULL, "group_id" integer NOT NULL, "joined_at" timestamp DEFAULT now(), PRIMARY KEY ("user_id", "group_id"))"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_not_null_with_default() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "audit_log".to_string(),
            columns: vec![
                col("id", "bigserial", false, None),
                col("created_at", "timestamp", false, Some("now()")),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."audit_log" ("id" bigserial NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), PRIMARY KEY ("id"))"#
        );
    }

    #[tokio::test]
    async fn create_table_empty_columns_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "noop".to_string(),
            columns: vec![],
            primary_key: None,
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("Table must have at least one column"),
            "Expected empty-columns error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_pk_references_undeclared_column_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "stale_pk".to_string(),
            columns: vec![col("id", "integer", false, None)],
            primary_key: Some(vec!["nonexistent".to_string()]),
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("not declared"),
            "Expected PK-undeclared error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_table_name_with_embedded_space_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "foo bar".to_string(),
            columns: vec![col("id", "integer", false, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        // Validator surfaces "alphanumeric characters and underscores"
        // when an internal whitespace breaks the body charset rule.
        assert!(
            err.contains("alphanumeric") || err.contains("must start"),
            "Expected identifier-validation error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_column_name_with_embedded_quote_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "tbl".to_string(),
            columns: vec![col("bad\"col", "text", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn create_table_empty_table_name_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "   ".to_string(),
            columns: vec![col("id", "integer", false, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("must not be empty"),
            "Expected empty-name error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_empty_data_type_rejected() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "tbl".to_string(),
            columns: vec![col("id", "   ", false, None)],
            primary_key: None,
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("non-empty data type"),
            "Expected empty-type error, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_table_without_connection_fails_non_preview() {
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "users".to_string(),
            columns: vec![col("id", "integer", false, None)],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: false,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Not connected"));
    }

    #[tokio::test]
    async fn create_table_preview_no_pk_field_omits_clause() {
        // primary_key Some([]) should still omit the PRIMARY KEY clause —
        // empty pk vector behaves the same as None.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: Some(vec![]),
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer)"#
        );
    }

    // ── create_table tests (Sprint 227) ───────────────────────────────

    #[tokio::test]
    async fn create_table_preview_zero_comment_byte_equivalent_to_sprint_226() {
        // Sprint 227 additive regression proof — when no column carries
        // a `comment`, the emitted SQL must remain byte-equivalent to
        // the Sprint 226 composite-PK fixture. This test mirrors
        // `create_table_preview_three_column_composite_pk_byte_equivalent`
        // exactly but exercises the Sprint 227 codepath (which now
        // walks the column list looking for comments). If the codepath
        // accidentally appends a trailing `;` or stray space, this
        // test breaks before the Sprint 226 fixture even runs.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "memberships".to_string(),
            columns: vec![
                col("user_id", "integer", false, None),
                col("group_id", "integer", false, None),
                col("joined_at", "timestamp", true, Some("now()")),
            ],
            primary_key: Some(vec!["user_id".to_string(), "group_id".to_string()]),
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."memberships" ("user_id" integer NOT NULL, "group_id" integer NOT NULL, "joined_at" timestamp DEFAULT now(), PRIMARY KEY ("user_id", "group_id"))"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_two_columns_one_comment_byte_equivalent() {
        // Sprint 227 — single-column comment emission. The emitted SQL
        // is `CREATE TABLE …; COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<text>';`
        // joined with `"; "` and terminated with a trailing `;`. The
        // uncommented column emits no `COMMENT ON` statement.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![
                col_with_comment("id", "integer", false, None, "primary key"),
                col("name", "text", true, None),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer NOT NULL, "name" text, PRIMARY KEY ("id")); COMMENT ON COLUMN "public"."events"."id" IS 'primary key';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_single_quote_escape_byte_equivalent() {
        // Sprint 227 — `O'Brien`-style single-quote escape proof. The
        // SQL literal must double the single quote to `''` so PG
        // accepts it as a literal character (not the literal
        // terminator). This case also covers a 3-column form with two
        // commented columns to lock the column-declaration ordering of
        // emitted COMMENT ON statements.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "people".to_string(),
            columns: vec![
                col_with_comment("id", "integer", false, None, "row id"),
                col_with_comment("surname", "text", true, None, "O'Brien-safe"),
                col("nickname", "text", true, None),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."people" ("id" integer NOT NULL, "surname" text, "nickname" text, PRIMARY KEY ("id")); COMMENT ON COLUMN "public"."people"."id" IS 'row id'; COMMENT ON COLUMN "public"."people"."surname" IS 'O''Brien-safe';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_whitespace_comment_emits_no_statement() {
        // Sprint 227 — whitespace-only / empty comment string emits no
        // `COMMENT ON COLUMN` statement (post-trim check). The SQL must
        // remain byte-equivalent to the no-comment form.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![col_with_comment("id", "integer", true, None, "   ")],
            primary_key: None,
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer)"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_comment_with_semicolon_does_not_split() {
        // Sprint 227 — comment string containing `;` is emitted verbatim
        // inside the literal. The `;` is NOT a statement boundary; PG's
        // simple-query protocol parses single-quoted literals as a
        // contiguous token. The frontend `useDdlPreviewExecution` hook's
        // naive `;`-split is acceptable here because Safe Mode's
        // `analyzeStatement` only flags DDL keywords (CREATE / DROP /
        // ALTER / TRUNCATE) at the *start* of each split fragment —
        // comment-internal semicolons surface as additional safe-tier
        // fragments that are no-op'd by the backend's batch executor.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "tbl".to_string(),
            columns: vec![col_with_comment("id", "integer", true, None, "a;b;c")],
            primary_key: None,
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."tbl" ("id" integer); COMMENT ON COLUMN "public"."tbl"."id" IS 'a;b;c';"#
        );
    }

    // ── create_table tests (Sprint 234 — table_comment) ────────────────

    #[tokio::test]
    async fn create_table_preview_table_comment_byte_equivalent() {
        // Sprint 234 — table-level COMMENT ON TABLE statement appended
        // FIRST in the comment chain. With a single column and no
        // per-column comment the emitted SQL is the canonical
        // CREATE TABLE … followed by `; COMMENT ON TABLE …;` and the
        // trailing semicolon (Sprint 227 multi-statement convention).
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "users".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: Some("user accounts".to_string()),
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."users" ("id" integer); COMMENT ON TABLE "public"."users" IS 'user accounts';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_table_and_column_comments_byte_equivalent() {
        // Sprint 234 — when both a table comment and a per-column comment
        // are supplied, the table-level COMMENT ON TABLE statement comes
        // FIRST, then per-column COMMENT ON COLUMN in declared order.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![
                col_with_comment("id", "integer", false, None, "primary key"),
                col("name", "text", true, None),
            ],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: Some("event log".to_string()),
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer NOT NULL, "name" text, PRIMARY KEY ("id")); COMMENT ON TABLE "public"."events" IS 'event log'; COMMENT ON COLUMN "public"."events"."id" IS 'primary key';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_table_comment_single_quote() {
        // Sprint 234 — single-quote escape doubles internally to `''` so
        // PG accepts the literal verbatim. Same rule as the per-column
        // comment escape from Sprint 227.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "people".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: Some("O'Brien's table".to_string()),
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."people" ("id" integer); COMMENT ON TABLE "public"."people" IS 'O''Brien''s table';"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_zero_table_comment_byte_equivalent_to_sprint_226() {
        // Sprint 234 additive regression proof — when `table_comment` is
        // None (Sprint 226-233 caller default), the emitted SQL must
        // remain byte-equivalent to the Sprint 226 composite-PK fixture.
        // Mirrors `create_table_preview_three_column_composite_pk_
        // byte_equivalent` exactly but exercises the Sprint 234 codepath.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "memberships".to_string(),
            columns: vec![
                col("user_id", "integer", false, None),
                col("group_id", "integer", false, None),
                col("joined_at", "timestamp", true, Some("now()")),
            ],
            primary_key: Some(vec!["user_id".to_string(), "group_id".to_string()]),
            preview_only: true,
            table_comment: None,
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."memberships" ("user_id" integer NOT NULL, "group_id" integer NOT NULL, "joined_at" timestamp DEFAULT now(), PRIMARY KEY ("user_id", "group_id"))"#
        );
    }

    #[tokio::test]
    async fn create_table_preview_whitespace_table_comment_emits_no_statement() {
        // Sprint 234 — whitespace-only `table_comment` emits NO COMMENT
        // ON TABLE statement (post-trim guard). SQL stays byte-equivalent
        // to the no-comment form.
        let adapter = PostgresAdapter::new();
        let req = CreateTableRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            name: "events".to_string(),
            columns: vec![col("id", "integer", true, None)],
            primary_key: None,
            preview_only: true,
            table_comment: Some("   ".to_string()),
        };
        let result = adapter.create_table(&req).await;
        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().sql,
            r#"CREATE TABLE "public"."events" ("id" integer)"#
        );
    }
}
