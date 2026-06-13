//! SQLite structured DDL first slice.
//!
//! Scope: table creation only for writable user files. Raw SQL DDL, ALTER
//! rebuilds, indexes, drops, renames, constraints, nested JSON edit, and
//! extension semantics stay unsupported.

use crate::error::AppError;
use crate::models::{
    ColumnDefinition, CreateTablePlanRequest, CreateTableRequest, SchemaChangeResult,
};

use super::connection::{quote_identifier, validate_namespace, SqliteAdapter};

const SQLITE_IDENTIFIER_MAX_BYTES: usize = 128;

impl SqliteAdapter {
    pub async fn create_table(
        &self,
        req: &CreateTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_create_table_sql(req)?;
        if req.preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let (pool, read_only) = self.active_pool_with_mode().await?;
        if read_only {
            return Err(AppError::Unsupported(
                "Cannot execute SQLite structured table creation on a read-only SQLite connection."
                    .into(),
            ));
        }

        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
        if let Err(error) = sqlx::query(&sql).execute(&mut *tx).await {
            let _ = tx.rollback().await;
            return Err(AppError::Database(format!(
                "SQLite create table failed: {}",
                error
            )));
        }
        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("SQLite create table commit failed: {e}")))?;

        Ok(SchemaChangeResult { sql })
    }

    pub async fn create_table_plan(
        &self,
        req: &CreateTablePlanRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        if !req.indexes.is_empty() {
            return Err(AppError::Unsupported(
                "SQLite structured DDL first slice does not support index creation".into(),
            ));
        }
        if !req.constraints.is_empty() {
            return Err(AppError::Unsupported(
                "SQLite structured DDL first slice does not support standalone constraints".into(),
            ));
        }

        let table_req = CreateTableRequest {
            connection_id: req.connection_id.clone(),
            schema: req.schema.clone(),
            name: req.name.clone(),
            columns: req.columns.clone(),
            primary_key: req.primary_key.clone(),
            preview_only: req.preview_only,
            table_comment: req.table_comment.clone(),
            expected_database: None,
        };
        self.create_table(&table_req).await
    }
}

fn build_create_table_sql(req: &CreateTableRequest) -> Result<String, AppError> {
    validate_namespace(&req.schema)?;
    validate_identifier(&req.name, "Table name")?;
    reject_non_empty_comment(req.table_comment.as_deref(), "Table comments")?;

    if req.columns.is_empty() {
        return Err(AppError::Validation(
            "Table must have at least one column".into(),
        ));
    }

    let mut definitions = Vec::with_capacity(req.columns.len() + 1);
    for column in &req.columns {
        definitions.push(build_column_definition(column)?);
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
                .map(|column| quote_identifier(column))
                .collect::<Vec<_>>()
                .join(", ");
            definitions.push(format!("PRIMARY KEY ({columns})"));
        }
    }

    Ok(format!(
        "CREATE TABLE {} ({})",
        quote_identifier(req.name.trim()),
        definitions.join(", ")
    ))
}

fn build_column_definition(column: &ColumnDefinition) -> Result<String, AppError> {
    validate_identifier(&column.name, "Column name")?;
    reject_non_empty_comment(column.comment.as_deref(), "Column comments")?;
    if column.is_identity {
        return Err(AppError::Unsupported(
            "SQLite structured table creation does not support identity columns".into(),
        ));
    }

    let data_type = column.data_type.trim();
    if data_type.is_empty() {
        return Err(AppError::Validation(format!(
            "Column '{}' must have a non-empty data type",
            column.name
        )));
    }
    validate_sql_fragment(data_type, "Column data type")?;

    let mut definition = format!("{} {}", quote_identifier(column.name.trim()), data_type);
    if !column.nullable {
        definition.push_str(" NOT NULL");
    }
    if let Some(default) = &column.default_value {
        let default = default.trim();
        if !default.is_empty() {
            validate_sql_fragment(default, "Column default value")?;
            definition.push_str(&format!(" DEFAULT {default}"));
        }
    }
    Ok(definition)
}

fn validate_sql_fragment(value: &str, label: &str) -> Result<(), AppError> {
    if value.contains('\0')
        || value.contains(';')
        || value.contains("--")
        || value.contains("/*")
        || value.contains("*/")
    {
        return Err(AppError::Validation(format!(
            "{label} must not contain statement terminators or SQL comments"
        )));
    }
    Ok(())
}

fn validate_identifier(name: &str, label: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} must not be empty")));
    }
    if trimmed.len() > SQLITE_IDENTIFIER_MAX_BYTES {
        return Err(AppError::Validation(format!(
            "{label} must not exceed {SQLITE_IDENTIFIER_MAX_BYTES} bytes"
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

fn reject_non_empty_comment(value: Option<&str>, label: &str) -> Result<(), AppError> {
    if value.is_some_and(|comment| !comment.trim().is_empty()) {
        return Err(AppError::Unsupported(format!(
            "{label} are not supported in SQLite structured table creation"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ColumnDefinition;

    fn column(name: &str, data_type: &str, nullable: bool) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: data_type.to_string(),
            nullable,
            default_value: None,
            comment: None,
            is_identity: false,
        }
    }

    fn request() -> CreateTableRequest {
        CreateTableRequest {
            connection_id: "sqlite".to_string(),
            schema: "main".to_string(),
            name: "people".to_string(),
            columns: vec![column("id", "INTEGER", false), column("name", "TEXT", true)],
            primary_key: Some(vec!["id".to_string()]),
            preview_only: true,
            table_comment: None,
            expected_database: None,
        }
    }

    #[test]
    fn build_create_table_sql_quotes_identifiers_and_primary_key() {
        let sql = build_create_table_sql(&request()).unwrap();

        assert_eq!(
            sql,
            "CREATE TABLE \"people\" (\"id\" INTEGER NOT NULL, \"name\" TEXT, PRIMARY KEY (\"id\"))"
        );
    }

    #[test]
    fn build_create_table_sql_rejects_non_main_namespace() {
        let mut req = request();
        req.schema = "temp".to_string();

        let result = build_create_table_sql(&req);

        assert!(matches!(result, Err(AppError::Validation(message)) if message.contains("main")));
    }

    #[test]
    fn build_create_table_sql_rejects_identity_columns() {
        let mut req = request();
        req.columns[0].is_identity = true;

        let result = build_create_table_sql(&req);

        assert!(
            matches!(result, Err(AppError::Unsupported(message)) if message.contains("identity"))
        );
    }

    #[test]
    fn build_create_table_sql_rejects_statement_escape_fragments() {
        let mut req = request();
        req.columns[0].data_type = "INTEGER; DROP TABLE users".to_string();

        let result = build_create_table_sql(&req);

        assert!(
            matches!(result, Err(AppError::Validation(message)) if message.contains("statement terminators"))
        );
    }
}
