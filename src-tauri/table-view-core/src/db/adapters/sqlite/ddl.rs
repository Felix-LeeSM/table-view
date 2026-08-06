//! SQLite structured table creation, and the batch runner every structured DDL
//! entry point shares.
//!
//! Scope: writable user files only. Raw SQL DDL, rebuild-only alterations,
//! constraint DDL, nested JSON edit and extension semantics stay unsupported.
//! The natively supported drops, renames, column changes and indexes live in
//! [`super::ddl_native`] and run through [`SqliteAdapter::run_ddl_or_preview`]
//! below, so the read-only rejection and the restriction-message mapping have
//! one home rather than one per entry point.

use crate::error::AppError;
use crate::models::{
    ColumnDefinition, CreateIndexRequest, CreateTablePlanRequest, CreateTableRequest,
    SchemaChangeResult,
};

use super::connection::{
    begin_write_transaction, quote_identifier, validate_namespace, SqliteAdapter,
};
use super::ddl_errors::ddl_failure;
use super::ddl_native::build_create_index_sql;

const SQLITE_IDENTIFIER_MAX_BYTES: usize = 128;
const SQLITE_DATA_TYPE_UNSUPPORTED_TOKENS: &[&str] = &[
    "CONSTRAINT",
    "PRIMARY",
    "KEY",
    "UNIQUE",
    "CHECK",
    "REFERENCES",
    "FOREIGN",
    "DEFAULT",
    "COLLATE",
    "GENERATED",
    "ALWAYS",
    "AS",
    "NOT",
    "NULL",
    "AUTOINCREMENT",
    "ON",
    "CONFLICT",
    "DEFERRABLE",
    "INITIALLY",
    "DEFERRED",
    "IMMEDIATE",
    "MATCH",
    "INDEX",
];
const SQLITE_DEFAULT_UNSUPPORTED_TOKENS: &[&str] = &[
    "CONSTRAINT",
    "PRIMARY",
    "KEY",
    "UNIQUE",
    "CHECK",
    "REFERENCES",
    "FOREIGN",
    "COLLATE",
    "GENERATED",
    "ALWAYS",
    "AS",
    "NOT",
    "NULL",
    "AUTOINCREMENT",
    "ON",
    "CONFLICT",
    "DEFERRABLE",
    "INITIALLY",
    "DEFERRED",
    "IMMEDIATE",
    "MATCH",
    "INDEX",
];

/// One statement of a DDL batch, plus the column it targets when it is a
/// single-column `ALTER TABLE`. SQLite's `ADD COLUMN` restriction errors never
/// name the column, so the runner carries it in from the request to build the
/// message (`ddl_errors`).
#[derive(Debug)]
pub(super) struct SqliteDdlStatement {
    pub(super) sql: String,
    pub(super) column: Option<String>,
}

impl SqliteDdlStatement {
    pub(super) fn plain(sql: String) -> Self {
        Self { sql, column: None }
    }

    pub(super) fn for_column(sql: String, column: &str) -> Self {
        Self {
            sql,
            column: Some(column.to_string()),
        }
    }
}

impl SqliteAdapter {
    /// Preview short-circuits to the joined SQL text. Execute runs every
    /// statement inside one transaction, so a multi-change `alter_table` never
    /// leaves the table half-altered — SQLite applies one alteration per
    /// `ALTER TABLE`, which makes a rollback boundary mandatory rather than
    /// decorative.
    ///
    /// The read-only rejection sits here, once, for every DDL entry point.
    /// It is defense in depth — command dispatch already gates on Safe Mode
    /// and the pool itself opens read-only — but it keeps the adapter honest
    /// and unit-testable on its own.
    pub(super) async fn run_ddl_or_preview(
        &self,
        preview_only: bool,
        statements: Vec<SqliteDdlStatement>,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = statements
            .iter()
            .map(|statement| statement.sql.as_str())
            .collect::<Vec<_>>()
            .join(";\n");
        if preview_only {
            return Ok(SchemaChangeResult { sql });
        }

        let (pool, read_only) = self.active_pool_with_mode().await?;
        if read_only {
            return Err(AppError::Unsupported(
                "Cannot execute structured DDL on a read-only SQLite connection.".into(),
            ));
        }

        let mut tx = begin_write_transaction(&pool).await?;
        // SQLite parses `ALTER TABLE` against the schema its *connection* has
        // cached, and the pool hands out up to `SQLITE_POOL_MAX_CONNECTIONS`
        // of them. A connection that has not read the file since another one
        // ran DDL still holds the old copy, so dropping a column added moments
        // earlier fails with `no such column`. Opening the transaction is not
        // what fixes that: the reload needs a statement that actually runs and
        // finds the schema cookie changed, and no begin style carries such a
        // check. So this read stays load-bearing — measured, deleting it fails
        // `a_column_added_in_this_session_can_be_dropped_again` with either
        // `BEGIN` or `BEGIN IMMEDIATE`.
        sqlx::query("SELECT count(*) FROM sqlite_schema")
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Database(format!("SQLite schema refresh failed: {e}")))?;
        for statement in &statements {
            if let Err(error) = sqlx::query(&statement.sql).execute(&mut *tx).await {
                let _ = tx.rollback().await;
                return Err(ddl_failure(statement.column.as_deref(), &error.to_string()));
            }
        }
        tx.commit()
            .await
            .map_err(|e| AppError::Database(format!("SQLite DDL commit failed: {e}")))?;

        Ok(SchemaChangeResult { sql })
    }

    pub async fn create_table(
        &self,
        req: &CreateTableRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        let sql = build_create_table_sql(req)?;
        self.run_ddl_or_preview(req.preview_only, vec![SqliteDdlStatement::plain(sql)])
            .await
    }

    pub async fn create_table_plan(
        &self,
        req: &CreateTablePlanRequest,
    ) -> Result<SchemaChangeResult, AppError> {
        // Pre-block the whole plan rather than creating the table and only then
        // failing on the constraint leg: SQLite can only attach a constraint at
        // CREATE TABLE time, so a plan carrying standalone constraint rows can
        // never complete and a half-applied plan behind an opaque error is
        // worse than an upfront refusal.
        if !req.constraints.is_empty() {
            return Err(AppError::Unsupported(
                "SQLite can only declare constraints when the table is created, so standalone \
                 constraint rows cannot be applied: remove the FOREIGN KEY / CHECK / UNIQUE rows \
                 and create the table without them."
                    .into(),
            ));
        }

        // Indexes are native (#1804), so the plan carries them instead of being
        // refused for having any. Every statement is built before any of them
        // runs, and they all run in the one transaction `run_ddl_or_preview`
        // opens: a rejected plan touches nothing, and an index that fails at
        // execution (a name that collides with an existing object, say — which
        // no preview can predict) takes the CREATE TABLE back with it. Chaining
        // separate transactions here would have replaced the pre-#1804
        // all-or-nothing refusal with a table that outlives its failed plan.
        let mut statements = vec![SqliteDdlStatement::plain(build_create_table_sql(
            &CreateTableRequest {
                connection_id: req.connection_id.clone(),
                schema: req.schema.clone(),
                name: req.name.clone(),
                columns: req.columns.clone(),
                primary_key: req.primary_key.clone(),
                preview_only: req.preview_only,
                table_comment: req.table_comment.clone(),
                expected_database: None,
            },
        )?)];
        for index in &req.indexes {
            let sql = build_create_index_sql(&CreateIndexRequest {
                connection_id: req.connection_id.clone(),
                schema: req.schema.clone(),
                table: req.name.clone(),
                index_name: index.index_name.clone(),
                columns: index.columns.clone(),
                index_type: index.index_type.clone(),
                is_unique: index.is_unique,
                preview_only: req.preview_only,
                expected_database: None,
            })
            // Name the failing row so the dialog can point at it — the builder
            // errors describe the fault, not which index carried it.
            .map_err(|e| match e {
                AppError::Validation(message) => {
                    AppError::Validation(format!("Index \"{}\": {message}", index.index_name))
                }
                other => other,
            })?;
            statements.push(SqliteDdlStatement::plain(sql));
        }

        self.run_ddl_or_preview(req.preview_only, statements).await
    }
}

fn build_create_table_sql(req: &CreateTableRequest) -> Result<String, AppError> {
    validate_namespace(&req.schema)?;
    validate_identifier(&req.name, "Table name")?;
    validate_sqlite_object_name(&req.name, "Table name")?;
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

pub(super) fn build_column_definition(column: &ColumnDefinition) -> Result<String, AppError> {
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
    validate_sqlite_data_type(data_type)?;

    let mut definition = format!("{} {}", quote_identifier(column.name.trim()), data_type);
    if !column.nullable {
        definition.push_str(" NOT NULL");
    }
    if let Some(default) = &column.default_value {
        let default = default.trim();
        if !default.is_empty() {
            validate_sqlite_default_value(default)?;
            definition.push_str(&format!(" DEFAULT {default}"));
        }
    }
    Ok(definition)
}

fn validate_sqlite_data_type(value: &str) -> Result<(), AppError> {
    validate_sql_fragment(value, "Column data type")?;
    validate_sqlite_data_type_shape(value)?;
    reject_unsupported_sql_tokens(
        value,
        "Column data type",
        SQLITE_DATA_TYPE_UNSUPPORTED_TOKENS,
    )
}

fn validate_sqlite_data_type_shape(value: &str) -> Result<(), AppError> {
    let trimmed = value.trim();
    let (base, params) = match trimmed.find('(') {
        Some(open_idx) => {
            if !trimmed.ends_with(')')
                || trimmed[open_idx + 1..trimmed.len() - 1].contains(['(', ')'])
            {
                return Err(AppError::Validation(
                    "Column data type must be a type name with optional numeric parameters".into(),
                ));
            }
            (
                trimmed[..open_idx].trim(),
                Some(trimmed[open_idx + 1..trimmed.len() - 1].trim()),
            )
        }
        None => (trimmed, None),
    };

    if base.is_empty() {
        return Err(AppError::Validation(
            "Column data type must include a type name".into(),
        ));
    }
    for word in base.split_whitespace() {
        validate_type_word(word)?;
    }

    if let Some(params) = params {
        let parts = params.split(',').collect::<Vec<_>>();
        if parts.is_empty() || parts.len() > 2 {
            return Err(AppError::Validation(
                "Column data type parameters must be one or two numeric values".into(),
            ));
        }
        for part in parts {
            let trimmed = part.trim();
            if trimmed.is_empty() || !trimmed.chars().all(|ch| ch.is_ascii_digit()) {
                return Err(AppError::Validation(
                    "Column data type parameters must be numeric".into(),
                ));
            }
        }
    }

    Ok(())
}

fn validate_type_word(word: &str) -> Result<(), AppError> {
    let mut chars = word.chars();
    let Some(first) = chars.next() else {
        return Err(AppError::Validation(
            "Column data type must include a type name".into(),
        ));
    };
    if !first.is_ascii_alphabetic() {
        return Err(AppError::Validation(
            "Column data type words must start with a letter".into(),
        ));
    }
    if chars.any(|ch| !ch.is_ascii_alphanumeric() && ch != '_') {
        return Err(AppError::Validation(
            "Column data type words must contain only alphanumeric characters and underscores"
                .into(),
        ));
    }
    Ok(())
}

fn validate_sqlite_default_value(value: &str) -> Result<(), AppError> {
    validate_sql_fragment(value, "Column default value")?;
    validate_default_fragment_shape(value)?;
    reject_unsupported_sql_tokens(
        value,
        "Column default value",
        SQLITE_DEFAULT_UNSUPPORTED_TOKENS,
    )
}

fn validate_default_fragment_shape(value: &str) -> Result<(), AppError> {
    let mut in_string = false;
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\'' {
            if in_string && chars.peek().is_some_and(|next| *next == '\'') {
                let _ = chars.next();
                continue;
            }
            in_string = !in_string;
            continue;
        }
        if !in_string && (ch == ',' || ch == '"') {
            return Err(AppError::Validation(
                "Column default value must not contain unquoted column separators or identifiers"
                    .into(),
            ));
        }
    }
    if in_string {
        return Err(AppError::Validation(
            "Column default value must not contain unterminated string literals".into(),
        ));
    }
    Ok(())
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

fn reject_unsupported_sql_tokens(
    value: &str,
    label: &str,
    unsupported_tokens: &[&str],
) -> Result<(), AppError> {
    let mut in_string = false;
    let mut token = String::new();
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\'' {
            if in_string && chars.peek().is_some_and(|next| *next == '\'') {
                let _ = chars.next();
                continue;
            }
            if let Some(unsupported) = unsupported_sql_token(&token, unsupported_tokens) {
                return unsupported_sql_token_error(label, unsupported);
            }
            token.clear();
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        if ch.is_ascii_alphanumeric() || ch == '_' {
            token.push(ch);
            continue;
        }
        if let Some(unsupported) = unsupported_sql_token(&token, unsupported_tokens) {
            return unsupported_sql_token_error(label, unsupported);
        }
        token.clear();
    }
    if let Some(unsupported) = unsupported_sql_token(&token, unsupported_tokens) {
        return unsupported_sql_token_error(label, unsupported);
    }
    Ok(())
}

fn unsupported_sql_token<'a>(token: &str, unsupported_tokens: &'a [&str]) -> Option<&'a str> {
    if token.is_empty() {
        return None;
    }
    unsupported_tokens
        .iter()
        .copied()
        .find(|candidate| token.eq_ignore_ascii_case(candidate))
}

fn unsupported_sql_token_error(label: &str, token: &str) -> Result<(), AppError> {
    Err(AppError::Unsupported(format!(
        "{label} must not contain inline SQLite constraint or index token {token}"
    )))
}

pub(super) fn validate_identifier(name: &str, label: &str) -> Result<(), AppError> {
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

pub(super) fn validate_sqlite_object_name(name: &str, label: &str) -> Result<(), AppError> {
    if name.trim().to_ascii_lowercase().starts_with("sqlite_") {
        return Err(AppError::Validation(format!(
            "{label} must not start with reserved SQLite prefix sqlite_"
        )));
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
    fn build_create_table_sql_rejects_internal_sqlite_object_prefix() {
        let mut req = request();
        req.name = "sqlite_structured".to_string();

        let result = build_create_table_sql(&req);

        assert!(
            matches!(result, Err(AppError::Validation(message)) if message.contains("sqlite_"))
        );
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

    #[test]
    fn build_create_table_sql_allows_common_sqlite_type_shapes() {
        let mut req = request();
        req.columns[0].data_type = "DOUBLE PRECISION".to_string();
        req.columns[1].data_type = "NUMERIC(10, 2)".to_string();

        let sql = build_create_table_sql(&req).unwrap();

        assert!(sql.contains("\"id\" DOUBLE PRECISION NOT NULL"));
        assert!(sql.contains("\"name\" NUMERIC(10, 2)"));
    }

    #[test]
    fn build_create_table_sql_rejects_inline_constraint_in_type() {
        let mut req = request();
        req.columns[0].data_type = "TEXT UNIQUE".to_string();

        let result = build_create_table_sql(&req);

        assert!(
            matches!(result, Err(AppError::Unsupported(message)) if message.contains("UNIQUE"))
        );
    }

    #[test]
    fn build_create_table_sql_rejects_inline_constraint_in_default() {
        let mut req = request();
        req.columns[0].default_value = Some("0 UNIQUE".to_string());

        let result = build_create_table_sql(&req);

        assert!(
            matches!(result, Err(AppError::Unsupported(message)) if message.contains("UNIQUE"))
        );
    }
}
