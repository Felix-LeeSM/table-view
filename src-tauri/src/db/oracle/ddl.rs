use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, CreateIndexRequest,
    CreateTableRequest, DropColumnRequest, DropConstraintRequest, DropIndexRequest,
    DropTableRequest, RenameTableRequest, SchemaChangeResult,
};

use super::common::{
    oracle_column_definition, oracle_constraint_definition, qualified_object, qualified_table,
    quote_ident, validate_identifier, ORACLE_INDEX_TYPES,
};
use super::OracleAdapter;

impl OracleAdapter {
    pub(super) async fn drop_table_impl(
        &self,
        req: &DropTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        let cascade = if req.cascade {
            " CASCADE CONSTRAINTS"
        } else {
            ""
        };
        let sql = format!(
            "DROP TABLE {}{cascade}",
            qualified_table(&req.schema, &req.table)
        );
        self.run_schema_sql(&sql, req.preview_only).await
    }

    pub(super) async fn rename_table_impl(
        &self,
        req: &RenameTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.new_name, "New table name")?;
        let sql = format!(
            "ALTER TABLE {} RENAME TO {}",
            qualified_table(&req.schema, &req.table),
            quote_ident(&req.new_name)
        );
        self.run_schema_sql(&sql, req.preview_only).await
    }

    pub(super) async fn alter_table_impl(
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
        let qualified = qualified_table(&req.schema, &req.table);
        let mut statements = Vec::new();
        for change in &req.changes {
            match change {
                ColumnChange::Add {
                    name,
                    data_type,
                    nullable,
                    default_value,
                } => {
                    validate_identifier(name, "Column name")?;
                    if data_type.trim().is_empty() {
                        return Err(AppError::Validation(format!(
                            "Column '{name}' must have a non-empty data type"
                        )));
                    }
                    let mut def = format!("{} {}", quote_ident(name), data_type.trim());
                    if let Some(default) = default_value {
                        if !default.trim().is_empty() {
                            def.push_str(&format!(" DEFAULT {}", default.trim()));
                        }
                    }
                    if !nullable {
                        def.push_str(" NOT NULL");
                    }
                    statements.push(format!("ALTER TABLE {qualified} ADD ({def})"));
                }
                ColumnChange::Modify {
                    name,
                    new_data_type,
                    new_nullable,
                    new_default_value,
                    using_expression,
                } => {
                    validate_identifier(name, "Column name")?;
                    if using_expression.is_some() {
                        return Err(AppError::Validation(
                        "Oracle MODIFY does not support USING in this emitter; use raw SQL for casts".into(),
                    ));
                    }
                    let mut parts = Vec::new();
                    if let Some(data_type) = new_data_type {
                        parts.push(data_type.trim().to_string());
                    }
                    if let Some(default) = new_default_value {
                        if !default.trim().is_empty() {
                            parts.push(format!("DEFAULT {}", default.trim()));
                        }
                    }
                    if let Some(nullable) = new_nullable {
                        parts.push(if *nullable {
                            "NULL".into()
                        } else {
                            "NOT NULL".into()
                        });
                    }
                    if parts.is_empty() {
                        return Err(AppError::Validation(format!(
                            "Oracle MODIFY for '{name}' requires at least one change"
                        )));
                    }
                    statements.push(format!(
                        "ALTER TABLE {qualified} MODIFY ({} {})",
                        quote_ident(name),
                        parts.join(" ")
                    ));
                }
                ColumnChange::Drop { name } => {
                    validate_identifier(name, "Column name")?;
                    statements.push(format!(
                        "ALTER TABLE {qualified} DROP COLUMN {}",
                        quote_ident(name)
                    ));
                }
            }
        }
        let sql = statements.join(";\n");
        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }
        let config = self.connected_config().await?;
        for statement in statements {
            Self::execute_statement(&config, &statement).await?;
        }
        Ok(SchemaChangeResult { sql })
    }

    pub(super) async fn add_column_impl(
        &self,
        req: &AddColumnRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        let mut def = oracle_column_definition(&req.column)?;
        if let Some(expr) = &req.check_expression {
            if !expr.trim().is_empty() {
                def.push_str(&format!(" CHECK ({})", expr.trim()));
            }
        }
        let sql = format!(
            "ALTER TABLE {} ADD ({})",
            qualified_table(&req.schema, &req.table),
            def
        );
        self.run_schema_sql(&sql, req.preview_only).await
    }

    pub(super) async fn drop_column_impl(
        &self,
        req: &DropColumnRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.column_name, "Column name")?;
        let sql = format!(
            "ALTER TABLE {} DROP COLUMN {}",
            qualified_table(&req.schema, &req.table),
            quote_ident(&req.column_name)
        );
        self.run_schema_sql(&sql, req.preview_only).await
    }

    pub(super) async fn create_table_impl(
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
        let mut parts = Vec::new();
        for column in &req.columns {
            parts.push(oracle_column_definition(column)?);
        }
        if let Some(pk) = &req.primary_key {
            if !pk.is_empty() {
                for col in pk {
                    validate_identifier(col, "Primary key column name")?;
                }
                parts.push(format!(
                    "PRIMARY KEY ({})",
                    pk.iter()
                        .map(|c| quote_ident(c))
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
        let sql = format!(
            "CREATE TABLE {} ({})",
            qualified_table(&req.schema, &req.name),
            parts.join(", ")
        );
        self.run_schema_sql(&sql, req.preview_only).await
    }

    pub(super) async fn create_index_impl(
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
        let index_type = req.index_type.trim().to_ascii_lowercase();
        if !ORACLE_INDEX_TYPES.contains(&index_type.as_str()) {
            return Err(AppError::Validation(format!(
                "Index type must be one of: {}",
                ORACLE_INDEX_TYPES.join(", ")
            )));
        }
        let unique = if req.is_unique { "UNIQUE " } else { "" };
        let bitmap = if index_type == "bitmap" {
            "BITMAP "
        } else {
            ""
        };
        let sql = format!(
            "CREATE {unique}{bitmap}INDEX {} ON {} ({})",
            qualified_object(&req.schema, &req.index_name),
            qualified_table(&req.schema, &req.table),
            req.columns
                .iter()
                .map(|c| quote_ident(c))
                .collect::<Vec<_>>()
                .join(", ")
        );
        self.run_schema_sql(&sql, req.preview_only).await
    }

    pub(super) async fn drop_index_impl(
        &self,
        req: &DropIndexRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.index_name, "Index name")?;
        let exists = if req.if_exists { "IF EXISTS " } else { "" };
        let sql = format!(
            "DROP INDEX {exists}{}",
            qualified_object(&req.schema, &req.index_name)
        );
        self.run_schema_sql(&sql, req.preview_only).await
    }

    pub(super) async fn add_constraint_impl(
        &self,
        req: &AddConstraintRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.constraint_name, "Constraint name")?;
        let definition = oracle_constraint_definition(&req.definition)?;
        let sql = format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {}",
            qualified_table(&req.schema, &req.table),
            quote_ident(&req.constraint_name),
            definition
        );
        self.run_schema_sql(&sql, req.preview_only).await
    }

    pub(super) async fn drop_constraint_impl(
        &self,
        req: &DropConstraintRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.constraint_name, "Constraint name")?;
        let sql = format!(
            "ALTER TABLE {} DROP CONSTRAINT {}",
            qualified_table(&req.schema, &req.table),
            quote_ident(&req.constraint_name)
        );
        self.run_schema_sql(&sql, req.preview_only).await
    }
}
