use super::*;

fn request(text: &str, cursor_utf16: usize, cursor_utf8: usize) -> SqlCompletionRequest {
    SqlCompletionRequest {
        text: text.to_string(),
        cursor: CompletionCursorOffsets {
            utf16: cursor_utf16,
            utf8: cursor_utf8,
        },
        dialect: "postgresql".to_string(),
        shell: "psql".to_string(),
        server_version: None,
        vocabulary: SqlCompletionVocabulary {
            keywords: vec!["SELECT".to_string(), "FROM".to_string()],
            functions: vec!["COUNT".to_string()],
        },
        catalog: SqlCompletionCatalogSnapshot {
            revision: "rev-state".to_string(),
            databases: vec![],
            schemas: vec![SqlCompletionCatalogSchema {
                database: String::new(),
                name: "public".to_string(),
            }],
            objects: vec![SqlCompletionCatalogObject {
                kind: "table".to_string(),
                database: String::new(),
                schema: "public".to_string(),
                name: "users".to_string(),
                qualified_name: "public.users".to_string(),
            }],
            columns: vec![
                column("public", "users", "id"),
                column("public", "users", "email"),
                column("public", "users", "created_at"),
                column("analytics", "active_users", "last_seen_at"),
            ],
            functions: vec![SqlCompletionCatalogFunction {
                database: String::new(),
                schema: "public".to_string(),
                name: "slugify".to_string(),
                qualified_name: "public.slugify".to_string(),
                arguments: Some("text".to_string()),
                return_type: Some("text".to_string()),
            }],
            extensions: vec![],
        },
    }
}

fn column(schema: &str, table: &str, name: &str) -> SqlCompletionCatalogColumn {
    SqlCompletionCatalogColumn {
        database: String::new(),
        schema: schema.to_string(),
        table: table.to_string(),
        name: name.to_string(),
        qualified_table_name: format!("{schema}.{table}"),
    }
}

fn labels(result: &SqlCompletionCoreResult) -> Vec<String> {
    result.items.iter().map(|item| item.label.clone()).collect()
}

#[test]
fn explicit_completion_state_classifier_covers_initial_sql_states() {
    assert_eq!(
        complete_sql(request("", 0, 0)).metadata.completion_state,
        CompletionState::StatementStart
    );
    assert_eq!(
        complete_sql(request("SELECT ", 7, 7))
            .metadata
            .completion_state,
        CompletionState::SelectList
    );
    assert_eq!(
        complete_sql(request("SELECT * FROM ", 14, 14))
            .metadata
            .completion_state,
        CompletionState::RelationName
    );
    assert_eq!(
        complete_sql(request("USE ", 4, 4))
            .metadata
            .completion_state,
        CompletionState::DatabaseName
    );
    assert_eq!(
        complete_sql(request("SELECT u. FROM users u", 9, 9))
            .metadata
            .completion_state,
        CompletionState::ColumnRef
    );
    assert_eq!(
        complete_sql(request("SELECT COUNT", 12, 12))
            .metadata
            .completion_state,
        CompletionState::FunctionRef
    );
    assert_eq!(
        complete_sql(request("INSERT INTO users (", 19, 19))
            .metadata
            .completion_state,
        CompletionState::InsertColumns
    );
    assert_eq!(
        complete_sql(request("UPDATE users SET ", 17, 17))
            .metadata
            .completion_state,
        CompletionState::UpdateSetTarget
    );
    assert_eq!(
        complete_sql(request("SELECT * FROM users ORDER BY ", 29, 29))
            .metadata
            .completion_state,
        CompletionState::OrderByExpr
    );
    assert_eq!(
        complete_sql(request("\\wa", 3, 3))
            .metadata
            .completion_state,
        CompletionState::ShellMeta
    );

    let mut unsupported = request("SELECT ", 7, 7);
    unsupported.dialect = "ansi".to_string();
    assert_eq!(
        complete_sql(unsupported).metadata.completion_state,
        CompletionState::Unsupported
    );
}

#[test]
fn completion_state_core_resolves_cte_and_dml_column_targets() {
    let insert_result = complete_sql(request("INSERT INTO users (", 19, 19));
    assert!(insert_result.items.iter().any(|item| {
        item.label == "email"
            && item.kind == "column"
            && item.detail.as_deref() == Some("public.users")
    }));
    assert!(
        !labels(&insert_result).contains(&"last_seen_at".to_string()),
        "INSERT column target should stay scoped to users"
    );

    let update_result = complete_sql(request("UPDATE users SET ", 17, 17));
    assert!(update_result.items.iter().any(|item| {
        item.label == "created_at"
            && item.kind == "column"
            && item.detail.as_deref() == Some("public.users")
    }));
    assert!(
        !labels(&update_result).contains(&"last_seen_at".to_string()),
        "UPDATE SET target should stay scoped to users"
    );

    let cte_sql = "WITH recent AS (SELECT id, email FROM users) SELECT recent.";
    let cte_result = complete_sql(request(cte_sql, cte_sql.len(), cte_sql.len()));
    assert_eq!(
        cte_result.metadata.completion_state,
        CompletionState::ColumnRef
    );
    assert!(cte_result.items.iter().any(|item| {
        item.label == "email" && item.kind == "column" && item.detail.as_deref() == Some("recent")
    }));
}
