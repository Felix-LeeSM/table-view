use crate::db::BoxFuture;
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition,
    ConstraintDefinition, CreateIndexRequest, CreateTableRequest, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, RenameTableRequest,
    SchemaChangeResult,
};

use super::support::{qualified_table, quote_ident, sql_string, validate_identifier};
use super::MssqlAdapter;

const REFERENTIAL_ACTIONS: &[&str] = &[
    "NO ACTION",
    "RESTRICT",
    "CASCADE",
    "SET NULL",
    "SET DEFAULT",
];
const MSSQL_INDEX_TYPES: &[&str] = &["btree", "hash", "columnstore"];

impl MssqlAdapter {
    pub(super) async fn run_schema_sql(
        &self,
        sql: &str,
        preview_only: bool,
    ) -> Result<SchemaChangeResult, AppError> {
        if !preview_only {
            let config = self.connected_config().await?;
            Self::execute_statement(&config, sql).await?;
        }
        Ok(SchemaChangeResult {
            sql: sql.to_string(),
        })
    }

    pub(super) fn drop_table_box<'a>(
        &'a self,
        req: &'a DropTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
            validate_identifier(&req.schema, "Schema name")?;
            validate_identifier(&req.table, "Table name")?;
            let sql = format!("DROP TABLE {}", qualified_table(&req.schema, &req.table));
            self.run_schema_sql(&sql, req.preview_only).await
        })
    }

    pub(super) fn rename_table_box<'a>(
        &'a self,
        req: &'a RenameTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
            validate_identifier(&req.schema, "Schema name")?;
            validate_identifier(&req.table, "Table name")?;
            validate_identifier(&req.new_name, "New table name")?;
            let sql = format!(
                "EXEC sp_rename {}, {}",
                sql_string(&format!("{}.{}", req.schema.trim(), req.table.trim())),
                sql_string(req.new_name.trim())
            );
            self.run_schema_sql(&sql, req.preview_only).await
        })
    }

    pub(super) fn alter_table_box<'a>(
        &'a self,
        req: &'a AlterTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
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
                        if !nullable {
                            def.push_str(" NOT NULL");
                        }
                        if let Some(default) = default_value {
                            if !default.trim().is_empty() {
                                def.push_str(&format!(" DEFAULT {}", default.trim()));
                            }
                        }
                        statements.push(format!("ALTER TABLE {qualified} ADD {def}"));
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
                                "SQL Server ALTER COLUMN does not support USING; use raw SQL for casts".into(),
                            ));
                        }
                        if let Some(data_type) = new_data_type {
                            let mut sql = format!(
                                "ALTER TABLE {qualified} ALTER COLUMN {} {}",
                                quote_ident(name),
                                data_type.trim()
                            );
                            if let Some(nullable) = new_nullable {
                                sql.push_str(if *nullable { " NULL" } else { " NOT NULL" });
                            }
                            statements.push(sql);
                        }
                        if let Some(default) = new_default_value {
                            if !default.trim().is_empty() {
                                statements.push(format!(
                                    "ALTER TABLE {qualified} ADD DEFAULT {} FOR {}",
                                    default.trim(),
                                    quote_ident(name)
                                ));
                            }
                        }
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
        })
    }

    pub(super) fn add_column_box<'a>(
        &'a self,
        req: &'a AddColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
            validate_identifier(&req.schema, "Schema name")?;
            validate_identifier(&req.table, "Table name")?;
            let def = mssql_column_definition(&req.column)?;
            let mut sql = format!(
                "ALTER TABLE {} ADD {}",
                qualified_table(&req.schema, &req.table),
                def
            );
            if let Some(expr) = &req.check_expression {
                if !expr.trim().is_empty() {
                    sql.push_str(&format!(" CHECK ({})", expr.trim()));
                }
            }
            self.run_schema_sql(&sql, req.preview_only).await
        })
    }

    pub(super) fn drop_column_box<'a>(
        &'a self,
        req: &'a DropColumnRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
            validate_identifier(&req.schema, "Schema name")?;
            validate_identifier(&req.table, "Table name")?;
            validate_identifier(&req.column_name, "Column name")?;
            let sql = format!(
                "ALTER TABLE {} DROP COLUMN {}",
                qualified_table(&req.schema, &req.table),
                quote_ident(&req.column_name)
            );
            self.run_schema_sql(&sql, req.preview_only).await
        })
    }

    pub(super) fn create_table_box<'a>(
        &'a self,
        req: &'a CreateTableRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
            validate_identifier(&req.schema, "Schema name")?;
            validate_identifier(&req.name, "Table name")?;
            if req.columns.is_empty() {
                return Err(AppError::Validation(
                    "Table must have at least one column".into(),
                ));
            }
            let mut parts = Vec::new();
            for column in &req.columns {
                parts.push(mssql_column_definition(column)?);
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
        })
    }

    pub(super) fn create_index_box<'a>(
        &'a self,
        req: &'a CreateIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
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
            if !MSSQL_INDEX_TYPES.contains(&index_type.as_str()) {
                return Err(AppError::Validation(format!(
                    "Index type must be one of: {}",
                    MSSQL_INDEX_TYPES.join(", ")
                )));
            }
            let unique = if req.is_unique { "UNIQUE " } else { "" };
            let type_clause = match index_type.as_str() {
                "hash" => "NONCLUSTERED HASH ",
                "columnstore" => "COLUMNSTORE ",
                _ => "NONCLUSTERED ",
            };
            let sql = format!(
                "CREATE {unique}{type_clause}INDEX {} ON {} ({})",
                quote_ident(&req.index_name),
                qualified_table(&req.schema, &req.table),
                req.columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            self.run_schema_sql(&sql, req.preview_only).await
        })
    }

    pub(super) fn drop_index_box<'a>(
        &'a self,
        req: &'a DropIndexRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
            validate_identifier(&req.schema, "Schema name")?;
            validate_identifier(&req.index_name, "Index name")?;
            if req.table.trim().is_empty() {
                return Err(AppError::Validation(
                    "SQL Server DROP INDEX requires a table".into(),
                ));
            }
            validate_identifier(&req.table, "Table name")?;
            let exists = if req.if_exists { "IF EXISTS " } else { "" };
            let sql = format!(
                "DROP INDEX {exists}{} ON {}",
                quote_ident(&req.index_name),
                qualified_table(&req.schema, &req.table)
            );
            self.run_schema_sql(&sql, req.preview_only).await
        })
    }

    pub(super) fn add_constraint_box<'a>(
        &'a self,
        req: &'a AddConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
            validate_identifier(&req.schema, "Schema name")?;
            validate_identifier(&req.table, "Table name")?;
            validate_identifier(&req.constraint_name, "Constraint name")?;
            let definition = mssql_constraint_definition(&req.definition)?;
            let sql = format!(
                "ALTER TABLE {} ADD CONSTRAINT {} {}",
                qualified_table(&req.schema, &req.table),
                quote_ident(&req.constraint_name),
                definition
            );
            self.run_schema_sql(&sql, req.preview_only).await
        })
    }

    pub(super) fn drop_constraint_box<'a>(
        &'a self,
        req: &'a DropConstraintRequest,
    ) -> BoxFuture<'a, Result<SchemaChangeResult, AppError>> {
        Box::pin(async move {
            validate_identifier(&req.schema, "Schema name")?;
            validate_identifier(&req.table, "Table name")?;
            validate_identifier(&req.constraint_name, "Constraint name")?;
            let sql = format!(
                "ALTER TABLE {} DROP CONSTRAINT {}",
                qualified_table(&req.schema, &req.table),
                quote_ident(&req.constraint_name)
            );
            self.run_schema_sql(&sql, req.preview_only).await
        })
    }
}

fn mssql_column_definition(column: &ColumnDefinition) -> Result<String, AppError> {
    validate_identifier(&column.name, "Column name")?;
    if column.data_type.trim().is_empty() {
        return Err(AppError::Validation(format!(
            "Column '{}' must have a non-empty data type",
            column.name
        )));
    }
    let mut def = format!("{} {}", quote_ident(&column.name), column.data_type.trim());
    if column.is_identity {
        def.push_str(" IDENTITY(1,1) NOT NULL");
    } else {
        if !column.nullable {
            def.push_str(" NOT NULL");
        }
        if let Some(default) = &column.default_value {
            if !default.trim().is_empty() {
                def.push_str(&format!(" DEFAULT {}", default.trim()));
            }
        }
    }
    Ok(def)
}

fn mssql_constraint_definition(definition: &ConstraintDefinition) -> Result<String, AppError> {
    match definition {
        ConstraintDefinition::PrimaryKey { columns } => {
            if columns.is_empty() {
                return Err(AppError::Validation(
                    "Primary key requires at least one column".into(),
                ));
            }
            for col in columns {
                validate_identifier(col, "Primary key column name")?;
            }
            Ok(format!(
                "PRIMARY KEY ({})",
                columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        }
        ConstraintDefinition::ForeignKey {
            columns,
            reference_table,
            reference_columns,
            on_delete,
            on_update,
        } => {
            if columns.is_empty() || reference_columns.is_empty() {
                return Err(AppError::Validation(
                    "Foreign key requires local and reference columns".into(),
                ));
            }
            for col in columns {
                validate_identifier(col, "Foreign key column name")?;
            }
            validate_identifier(reference_table, "Foreign key reference table name")?;
            for col in reference_columns {
                validate_identifier(col, "Foreign key reference column name")?;
            }
            Ok(format!(
                "FOREIGN KEY ({}) REFERENCES {} ({}){}{}",
                columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", "),
                quote_ident(reference_table),
                reference_columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", "),
                referential_action(on_delete.as_deref(), "ON DELETE")?,
                referential_action(on_update.as_deref(), "ON UPDATE")?
            ))
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
            Ok(format!(
                "UNIQUE ({})",
                columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        }
        ConstraintDefinition::Check { expression } => {
            if expression.trim().is_empty() {
                return Err(AppError::Validation(
                    "Check constraint expression must not be empty".into(),
                ));
            }
            Ok(format!("CHECK ({})", expression.trim()))
        }
    }
}

fn referential_action(action: Option<&str>, clause: &str) -> Result<String, AppError> {
    match action {
        None => Ok(String::new()),
        Some(action) if REFERENTIAL_ACTIONS.contains(&action) => Ok(format!(" {clause} {action}")),
        Some(action) => Err(AppError::Validation(format!(
            "Invalid referential action: {} (expected one of {})",
            action,
            REFERENTIAL_ACTIONS.join(", ")
        ))),
    }
}
