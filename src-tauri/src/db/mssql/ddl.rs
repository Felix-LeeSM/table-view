//! SQL Server structured DDL for the bounded table/index/constraint slice.
//!
//! Scope: table create/drop/rename/column alteration, index create/drop, and
//! constraint add/drop. Enterprise/admin surfaces such as users, roles,
//! backup/restore, jobs, SQLCMD, procedures, and trigger body authoring stay
//! unsupported.

use tracing::info;

use crate::db::ddl_fragment::validate_ddl_fragment;
use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition,
    ConstraintDefinition, CreateIndexRequest, CreateTableRequest, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, RenameTableRequest,
    SchemaChangeResult,
};

use super::MssqlAdapter;

const MSSQL_IDENTIFIER_MAX_BYTES: usize = 128;
const MSSQL_REFERENTIAL_ACTIONS: &[&str] = &["NO ACTION", "CASCADE", "SET NULL", "SET DEFAULT"];

pub(super) fn validate_identifier(name: &str, label: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{} must not be empty", label)));
    }
    if trimmed.len() > MSSQL_IDENTIFIER_MAX_BYTES {
        return Err(AppError::Validation(format!(
            "{} must not exceed {} bytes",
            label, MSSQL_IDENTIFIER_MAX_BYTES
        )));
    }

    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
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

pub(super) fn quote_ident(name: &str) -> String {
    format!("[{}]", name.replace(']', "]]"))
}

pub(super) fn qualified_table(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

impl MssqlAdapter {
    pub async fn drop_table(&self, req: &DropTableRequest) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        if req.cascade {
            return Err(AppError::Unsupported(
                "SQL Server structured DROP TABLE CASCADE is not supported".into(),
            ));
        }

        let sql = format!("DROP TABLE {}", qualified_table(&req.schema, &req.table));
        self.preview_or_execute(req.preview_only, vec![sql], "drop table")
            .await
    }

    pub async fn rename_table(
        &self,
        req: &RenameTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.new_name, "New table name")?;

        let sql = format!(
            "EXEC sp_rename N'{}.{}', N'{}'",
            req.schema.replace('\'', "''"),
            req.table.replace('\'', "''"),
            req.new_name.trim().replace('\'', "''")
        );
        self.preview_or_execute(req.preview_only, vec![sql], "rename table")
            .await
    }

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

        let qualified = qualified_table(&req.schema, &req.table);
        let mut statements = Vec::with_capacity(req.changes.len());
        for change in &req.changes {
            statements.push(build_alter_table_statement(&qualified, change)?);
        }

        self.preview_or_execute(req.preview_only, statements, "alter table")
            .await
    }

    pub async fn add_column(&self, req: &AddColumnRequest) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        let qualified = qualified_table(&req.schema, &req.table);
        let column = build_column_definition(&req.column)?;
        let mut statement = format!("ALTER TABLE {} ADD {}", qualified, column);
        if let Some(expr) = &req.check_expression {
            let trimmed = expr.trim();
            if !trimmed.is_empty() {
                validate_ddl_fragment(trimmed, "Check expression")?;
                statement.push_str(&format!(" CHECK ({})", trimmed));
            }
        }

        self.preview_or_execute(req.preview_only, vec![statement], "add column")
            .await
    }

    pub async fn drop_column(
        &self,
        req: &DropColumnRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.column_name, "Column name")?;
        if req.cascade {
            return Err(AppError::Unsupported(
                "SQL Server structured DROP COLUMN CASCADE is not supported".into(),
            ));
        }

        let sql = format!(
            "ALTER TABLE {} DROP COLUMN {}",
            qualified_table(&req.schema, &req.table),
            quote_ident(&req.column_name)
        );
        self.preview_or_execute(req.preview_only, vec![sql], "drop column")
            .await
    }

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
        reject_non_empty_comment(req.table_comment.as_deref(), "Table comments")?;

        let mut column_definitions = Vec::with_capacity(req.columns.len() + 1);
        for column in &req.columns {
            reject_non_empty_comment(column.comment.as_deref(), "Column comments")?;
            column_definitions.push(build_column_definition(column)?);
        }

        if let Some(pk_columns) = &req.primary_key {
            for column in pk_columns {
                validate_identifier(column, "Primary key column name")?;
                if !req.columns.iter().any(|defined| defined.name == *column) {
                    return Err(AppError::Validation(format!(
                        "Primary key column '{}' is not declared in the column list",
                        column
                    )));
                }
            }
            if !pk_columns.is_empty() {
                let columns = pk_columns
                    .iter()
                    .map(|column| quote_ident(column))
                    .collect::<Vec<_>>()
                    .join(", ");
                column_definitions.push(format!("PRIMARY KEY ({})", columns));
            }
        }

        let sql = format!(
            "CREATE TABLE {} ({})",
            qualified_table(&req.schema, &req.name),
            column_definitions.join(", ")
        );
        self.preview_or_execute(req.preview_only, vec![sql], "create table")
            .await
    }

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
        for column in &req.columns {
            validate_identifier(column, "Index column name")?;
        }

        let index_kind = format_index_kind(&req.index_type)?;
        let unique = if req.is_unique { "UNIQUE " } else { "" };
        let columns = req
            .columns
            .iter()
            .map(|column| quote_ident(column))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "CREATE {}{}INDEX {} ON {} ({})",
            unique,
            index_kind,
            quote_ident(&req.index_name),
            qualified_table(&req.schema, &req.table),
            columns
        );

        self.preview_or_execute(req.preview_only, vec![sql], "create index")
            .await
    }

    pub async fn drop_index(&self, req: &DropIndexRequest) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.index_name, "Index name")?;
        if req.table.trim().is_empty() {
            return Err(AppError::Validation(
                "SQL Server DROP INDEX requires a table — request.table must not be empty".into(),
            ));
        }
        validate_identifier(&req.table, "Table name")?;

        let if_exists = if req.if_exists { "IF EXISTS " } else { "" };
        let sql = format!(
            "DROP INDEX {}{} ON {}",
            if_exists,
            quote_ident(&req.index_name),
            qualified_table(&req.schema, &req.table)
        );
        self.preview_or_execute(req.preview_only, vec![sql], "drop index")
            .await
    }

    pub async fn add_constraint(
        &self,
        req: &AddConstraintRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        validate_identifier(&req.schema, "Schema name")?;
        validate_identifier(&req.table, "Table name")?;
        validate_identifier(&req.constraint_name, "Constraint name")?;

        let constraint = build_constraint_definition(&req.definition)?;
        let sql = format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {}",
            qualified_table(&req.schema, &req.table),
            quote_ident(&req.constraint_name),
            constraint
        );
        self.preview_or_execute(req.preview_only, vec![sql], "add constraint")
            .await
    }

    pub async fn drop_constraint(
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
        self.preview_or_execute(req.preview_only, vec![sql], "drop constraint")
            .await
    }

    async fn preview_or_execute(
        &self,
        preview_only: bool,
        statements: Vec<String>,
        operation: &'static str,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = statements.join("; ");
        if preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        self.execute_schema_change(&statements, operation).await?;
        info!("Executed SQL Server structured DDL: {}", operation);
        Ok(SchemaChangeResult { sql })
    }

    async fn execute_schema_change(
        &self,
        statements: &[String],
        operation: &'static str,
    ) -> Result<(), AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        run_statement(&mut client, "BEGIN TRANSACTION").await?;

        for (idx, statement) in statements.iter().enumerate() {
            if let Err(error) = run_statement(&mut client, statement).await {
                let _ = run_statement(&mut client, "ROLLBACK TRANSACTION").await;
                return Err(AppError::Database(format!(
                    "SQL Server {} statement {} of {} failed: {}",
                    operation,
                    idx + 1,
                    statements.len(),
                    error
                )));
            }
        }

        run_statement(&mut client, "COMMIT TRANSACTION").await
    }
}

fn build_alter_table_statement(qualified: &str, change: &ColumnChange) -> Result<String, AppError> {
    match change {
        ColumnChange::Add {
            name,
            data_type,
            nullable,
            default_value,
        } => {
            let column = ColumnDefinition {
                name: name.clone(),
                data_type: data_type.clone(),
                nullable: *nullable,
                default_value: default_value.clone(),
                comment: None,
                is_identity: false,
            };
            Ok(format!(
                "ALTER TABLE {} ADD {}",
                qualified,
                build_column_definition(&column)?
            ))
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
                return Err(AppError::Unsupported(
                    "SQL Server structured ALTER COLUMN USING expressions are not supported".into(),
                ));
            }
            if new_default_value.is_some() {
                return Err(AppError::Unsupported(
                    "SQL Server structured default-constraint changes are not supported".into(),
                ));
            }
            let Some(data_type) = new_data_type.as_deref().map(str::trim) else {
                return Err(AppError::Validation(format!(
                    "SQL Server ALTER COLUMN requires a data type for '{}'",
                    name
                )));
            };
            if data_type.is_empty() {
                return Err(AppError::Validation(format!(
                    "Column '{}' must have a non-empty data type",
                    name
                )));
            }
            validate_ddl_fragment(data_type, "Data type")?;
            let nullability = match new_nullable {
                Some(true) => " NULL",
                Some(false) => " NOT NULL",
                None => "",
            };
            Ok(format!(
                "ALTER TABLE {} ALTER COLUMN {} {}{}",
                qualified,
                quote_ident(name),
                data_type,
                nullability
            ))
        }
        ColumnChange::Drop { name } => {
            validate_identifier(name, "Column name")?;
            Ok(format!(
                "ALTER TABLE {} DROP COLUMN {}",
                qualified,
                quote_ident(name)
            ))
        }
    }
}

fn build_column_definition(column: &ColumnDefinition) -> Result<String, AppError> {
    validate_identifier(&column.name, "Column name")?;
    let data_type = column.data_type.trim();
    if data_type.is_empty() {
        return Err(AppError::Validation(format!(
            "Column '{}' must have a non-empty data type",
            column.name
        )));
    }
    validate_ddl_fragment(data_type, "Data type")?;
    if let Some(default) = &column.default_value {
        validate_ddl_fragment(default, "DEFAULT value")?;
    }

    let mut definition = format!("{} {}", quote_ident(&column.name), data_type);
    if column.is_identity {
        definition.push_str(" IDENTITY(1,1) NOT NULL");
        return Ok(definition);
    }

    if !column.nullable {
        definition.push_str(" NOT NULL");
    }
    if let Some(default) = &column.default_value {
        let trimmed = default.trim();
        if !trimmed.is_empty() {
            definition.push_str(&format!(" DEFAULT {}", trimmed));
        }
    }
    Ok(definition)
}

fn build_constraint_definition(definition: &ConstraintDefinition) -> Result<String, AppError> {
    match definition {
        ConstraintDefinition::PrimaryKey { columns } => {
            let columns = format_identifier_list(columns, "Primary key column name")?;
            Ok(format!("PRIMARY KEY ({})", columns))
        }
        ConstraintDefinition::ForeignKey {
            columns,
            reference_table,
            reference_columns,
            on_delete,
            on_update,
        } => {
            let columns = format_identifier_list(columns, "Foreign key column name")?;
            validate_identifier(reference_table, "Foreign key reference table name")?;
            let reference_columns =
                format_identifier_list(reference_columns, "Foreign key reference column name")?;
            let on_delete = format_referential_action_clause(on_delete.as_deref(), "ON DELETE")?;
            let on_update = format_referential_action_clause(on_update.as_deref(), "ON UPDATE")?;
            Ok(format!(
                "FOREIGN KEY ({}) REFERENCES {} ({}){}{}",
                columns,
                quote_ident(reference_table),
                reference_columns,
                on_delete,
                on_update
            ))
        }
        ConstraintDefinition::Unique { columns } => {
            let columns = format_identifier_list(columns, "Unique constraint column name")?;
            Ok(format!("UNIQUE ({})", columns))
        }
        ConstraintDefinition::Check { expression } => {
            let expression = expression.trim();
            if expression.is_empty() {
                return Err(AppError::Validation(
                    "Check constraint expression must not be empty".into(),
                ));
            }
            validate_ddl_fragment(expression, "Check expression")?;
            Ok(format!("CHECK ({})", expression))
        }
    }
}

fn format_identifier_list(columns: &[String], label: &str) -> Result<String, AppError> {
    if columns.is_empty() {
        return Err(AppError::Validation(format!(
            "{} requires at least one column",
            label.trim_end_matches(" column name")
        )));
    }
    for column in columns {
        validate_identifier(column, label)?;
    }
    Ok(columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<Vec<_>>()
        .join(", "))
}

fn format_referential_action_clause(
    action: Option<&str>,
    clause: &str,
) -> Result<String, AppError> {
    match action {
        None => Ok(String::new()),
        Some(action) if MSSQL_REFERENTIAL_ACTIONS.contains(&action) => {
            Ok(format!(" {} {}", clause, action))
        }
        Some(action) => Err(AppError::Validation(format!(
            "Invalid SQL Server referential action: {} (expected one of {})",
            action,
            MSSQL_REFERENTIAL_ACTIONS.join(", ")
        ))),
    }
}

fn format_index_kind(index_type: &str) -> Result<&'static str, AppError> {
    match index_type.trim().to_ascii_lowercase().as_str() {
        "" | "btree" | "nonclustered" => Ok(""),
        "clustered" => Ok("CLUSTERED "),
        other => Err(AppError::Validation(format!(
            "SQL Server index type must be one of: btree, nonclustered, clustered (got {})",
            other
        ))),
    }
}

fn reject_non_empty_comment(value: Option<&str>, label: &str) -> Result<(), AppError> {
    if value.is_some_and(|comment| !comment.trim().is_empty()) {
        return Err(AppError::Unsupported(format!(
            "{} are not supported in SQL Server structured DDL",
            label
        )));
    }
    Ok(())
}

async fn run_statement(
    client: &mut tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>,
    sql: &str,
) -> Result<(), AppError> {
    client
        .simple_query(sql)
        .await
        .map_err(|err| AppError::Database(err.to_string()))?
        .into_results()
        .await
        .map_err(|err| AppError::Database(err.to_string()))?;
    Ok(())
}
