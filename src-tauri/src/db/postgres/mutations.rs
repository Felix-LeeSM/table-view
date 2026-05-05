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
    CreateIndexRequest, DropConstraintRequest, DropIndexRequest, SchemaChangeResult,
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
    let first = chars.next().expect("checked non-empty");
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

        let qualified = format!(
            "\"{}\".\"{}\"",
            schema.replace('"', "\"\""),
            table.replace('"', "\"\"")
        );
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

        let qualified_old = format!(
            "\"{}\".\"{}\"",
            schema.replace('"', "\"\""),
            table.replace('"', "\"\"")
        );
        let quoted_new = format!("\"{}\"", trimmed.replace('"', "\"\""));
        let sql = format!("ALTER TABLE {} RENAME TO {}", qualified_old, quoted_new);
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Renamed table {}.{} to {}", schema, table, trimmed);
        Ok(())
    }

    // ── Schema change operations ──────────────────────────────────────

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
                format!(
                    "FOREIGN KEY ({}) REFERENCES {} ({})",
                    cols.join(", "),
                    quote_identifier(reference_table),
                    ref_cols.join(", ")
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
        AddConstraintRequest, AlterTableRequest, ColumnChange, ConstraintDefinition,
        CreateIndexRequest, DropConstraintRequest, DropIndexRequest,
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
}
