use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnChange, ColumnDefinition,
    ConstraintDefinition, CreateIndexRequest, CreateTableRequest, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, RenameTableRequest,
};

use super::{qualified_table, quote_identifier, validate_identifier};

const PG_INDEX_TYPES: &[&str] = &["btree", "hash", "gist", "gin", "brin"];
const REFERENTIAL_ACTIONS: &[&str] = &[
    "NO ACTION",
    "RESTRICT",
    "CASCADE",
    "SET NULL",
    "SET DEFAULT",
];

pub(super) struct CreateTablePlan {
    pub(super) create_sql: String,
    pub(super) comment_stmts: Vec<String>,
    pub(super) sql: String,
}

pub(super) fn build_drop_table_sql(req: &DropTableRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;

    let qualified = qualified_table(&req.schema, &req.table);
    let sql = if req.cascade {
        format!("DROP TABLE {} CASCADE", qualified)
    } else {
        format!("DROP TABLE {}", qualified)
    };
    Ok(sql)
}

pub(super) fn build_rename_table_sql(req: &RenameTableRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.new_name, "New table name")?;

    let qualified_old = qualified_table(&req.schema, &req.table);
    let quoted_new = quote_identifier(req.new_name.trim());
    Ok(format!(
        "ALTER TABLE {} RENAME TO {}",
        qualified_old, quoted_new
    ))
}

pub(super) fn build_add_column_sql(req: &AddColumnRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.column.name, "Column name")?;
    validate_column_data_type(&req.column)?;

    let qualified = qualified_table(&req.schema, &req.table);
    let mut col_def = build_column_definition(&req.column);
    if let Some(expr) = &req.check_expression {
        let trimmed = expr.trim();
        if !trimmed.is_empty() {
            col_def.push_str(&format!(" CHECK ({})", trimmed));
        }
    }

    Ok(format!("ALTER TABLE {} ADD COLUMN {}", qualified, col_def))
}

pub(super) fn build_drop_column_sql(req: &DropColumnRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.column_name, "Column name")?;

    let qualified = qualified_table(&req.schema, &req.table);
    let quoted_col = quote_identifier(&req.column_name);
    let sql = if req.cascade {
        format!(
            "ALTER TABLE {} DROP COLUMN {} CASCADE",
            qualified, quoted_col
        )
    } else {
        format!("ALTER TABLE {} DROP COLUMN {}", qualified, quoted_col)
    };
    Ok(sql)
}

pub(super) fn build_create_table_plan(
    req: &CreateTableRequest,
) -> Result<CreateTablePlan, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.name, "Table name")?;

    if req.columns.is_empty() {
        return Err(AppError::Validation(
            "Table must have at least one column".into(),
        ));
    }

    for col in &req.columns {
        validate_identifier(&col.name, "Column name")?;
        validate_column_data_type(col)?;
    }

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
    let mut col_defs: Vec<String> = req.columns.iter().map(build_column_definition).collect();

    if let Some(pk_cols) = &req.primary_key {
        if !pk_cols.is_empty() {
            let quoted: Vec<String> = pk_cols.iter().map(|c| quote_identifier(c)).collect();
            col_defs.push(format!("PRIMARY KEY ({})", quoted.join(", ")));
        }
    }

    let create_sql = format!("CREATE TABLE {} ({})", qualified, col_defs.join(", "));
    let comment_stmts = build_create_table_comment_statements(req, &qualified);
    let sql = join_create_table_plan_sql(&create_sql, &comment_stmts);

    Ok(CreateTablePlan {
        create_sql,
        comment_stmts,
        sql,
    })
}

pub(super) fn build_alter_table_sql(req: &AlterTableRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;

    if req.changes.is_empty() {
        return Err(AppError::Validation(
            "At least one column change is required".into(),
        ));
    }

    for change in &req.changes {
        match change {
            ColumnChange::Add { name, .. } => validate_identifier(name, "Column name")?,
            ColumnChange::Modify {
                name,
                new_data_type,
                using_expression,
                ..
            } => {
                validate_identifier(name, "Column name")?;
                if new_data_type.is_none() && using_expression.is_some() {
                    return Err(AppError::Validation(
                        "USING expression requires a new data type".into(),
                    ));
                }
            }
            ColumnChange::Drop { name } => validate_identifier(name, "Column name")?,
        }
    }

    let qualified = qualified_table(&req.schema, &req.table);
    let mut parts = Vec::new();
    for change in &req.changes {
        parts.extend(build_alter_table_parts(change));
    }

    Ok(format!("ALTER TABLE {} {}", qualified, parts.join(", ")))
}

pub(super) fn build_create_index_sql(req: &CreateIndexRequest) -> Result<String, AppError> {
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

    let index_type_lower = req.index_type.to_lowercase();
    if !PG_INDEX_TYPES.contains(&index_type_lower.as_str()) {
        return Err(AppError::Validation(format!(
            "Index type must be one of: {}",
            PG_INDEX_TYPES.join(", ")
        )));
    }

    let qualified = qualified_table(&req.schema, &req.table);
    let columns: Vec<String> = req.columns.iter().map(|c| quote_identifier(c)).collect();
    let unique = if req.is_unique { "UNIQUE " } else { "" };

    Ok(format!(
        "CREATE {}INDEX {} ON {} USING {} ({})",
        unique,
        quote_identifier(&req.index_name),
        qualified,
        index_type_lower,
        columns.join(", ")
    ))
}

pub(super) fn build_drop_index_sql(req: &DropIndexRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.index_name, "Index name")?;

    let if_exists = if req.if_exists { "IF EXISTS " } else { "" };
    Ok(format!(
        "DROP INDEX {}.{}{}",
        quote_identifier(&req.schema),
        if_exists,
        quote_identifier(&req.index_name)
    ))
}

pub(super) fn build_add_constraint_sql(req: &AddConstraintRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.constraint_name, "Constraint name")?;

    let qualified = qualified_table(&req.schema, &req.table);
    let constraint_name = quote_identifier(&req.constraint_name);
    let constraint_sql = build_constraint_definition_sql(&req.definition)?;

    Ok(format!(
        "ALTER TABLE {} ADD CONSTRAINT {} {}",
        qualified, constraint_name, constraint_sql
    ))
}

pub(super) fn build_drop_constraint_sql(req: &DropConstraintRequest) -> Result<String, AppError> {
    validate_identifier(&req.schema, "Schema name")?;
    validate_identifier(&req.table, "Table name")?;
    validate_identifier(&req.constraint_name, "Constraint name")?;

    let qualified = qualified_table(&req.schema, &req.table);
    Ok(format!(
        "ALTER TABLE {} DROP CONSTRAINT {}",
        qualified,
        quote_identifier(&req.constraint_name)
    ))
}

fn validate_column_data_type(col: &ColumnDefinition) -> Result<(), AppError> {
    if col.data_type.trim().is_empty() {
        return Err(AppError::Validation(format!(
            "Column '{}' must have a non-empty data type",
            col.name
        )));
    }
    Ok(())
}

fn build_column_definition(col: &ColumnDefinition) -> String {
    let mut def = format!("{} {}", quote_identifier(&col.name), col.data_type.trim());
    if col.is_identity {
        def.push_str(" GENERATED BY DEFAULT AS IDENTITY NOT NULL");
    } else {
        if !col.nullable {
            def.push_str(" NOT NULL");
        }
        if let Some(default) = &col.default_value {
            let trimmed = default.trim();
            if !trimmed.is_empty() {
                def.push_str(&format!(" DEFAULT {}", trimmed));
            }
        }
    }
    def
}

fn build_create_table_comment_statements(req: &CreateTableRequest, qualified: &str) -> Vec<String> {
    let mut comment_stmts = Vec::new();
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
    comment_stmts
}

fn join_create_table_plan_sql(create_sql: &str, comment_stmts: &[String]) -> String {
    if comment_stmts.is_empty() {
        return create_sql.to_string();
    }

    let mut sql = create_sql.to_string();
    for stmt in comment_stmts {
        sql.push_str("; ");
        sql.push_str(stmt);
    }
    sql.push(';');
    sql
}

fn build_alter_table_parts(change: &ColumnChange) -> Vec<String> {
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
            vec![sql]
        }
        ColumnChange::Modify {
            name,
            new_data_type,
            new_nullable,
            new_default_value,
            using_expression,
        } => {
            let quoted_name = quote_identifier(name);
            let mut parts = Vec::new();
            if let Some(dt) = new_data_type {
                match using_expression {
                    Some(expr) => parts.push(format!(
                        "ALTER COLUMN {} TYPE {} USING {}",
                        quoted_name, dt, expr
                    )),
                    None => parts.push(format!("ALTER COLUMN {} TYPE {}", quoted_name, dt)),
                }
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
            parts
        }
        ColumnChange::Drop { name } => vec![format!("DROP COLUMN {}", quote_identifier(name))],
    }
}

fn build_constraint_definition_sql(definition: &ConstraintDefinition) -> Result<String, AppError> {
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
            let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
            Ok(format!("PRIMARY KEY ({})", cols.join(", ")))
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
            let on_delete_clause =
                format_referential_action_clause(on_delete.as_deref(), "ON DELETE")?;
            let on_update_clause =
                format_referential_action_clause(on_update.as_deref(), "ON UPDATE")?;
            Ok(format!(
                "FOREIGN KEY ({}) REFERENCES {} ({}){}{}",
                cols.join(", "),
                quote_identifier(reference_table),
                ref_cols.join(", "),
                on_delete_clause,
                on_update_clause,
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
            let cols: Vec<String> = columns.iter().map(|c| quote_identifier(c)).collect();
            Ok(format!("UNIQUE ({})", cols.join(", ")))
        }
        ConstraintDefinition::Check { expression } => {
            if expression.trim().is_empty() {
                return Err(AppError::Validation(
                    "Check constraint expression must not be empty".into(),
                ));
            }
            Ok(format!("CHECK ({})", expression))
        }
    }
}

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
