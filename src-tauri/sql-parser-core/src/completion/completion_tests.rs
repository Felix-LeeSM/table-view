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
        vocabulary: SqlCompletionVocabulary {
            keywords: vec![
                "SELECT".to_string(),
                "FROM".to_string(),
                "WHERE".to_string(),
            ],
            functions: vec!["COUNT".to_string(), "DATE_TRUNC".to_string()],
        },
        catalog: SqlCompletionCatalogSnapshot {
            revision: "rev-1".to_string(),
            objects: vec![
                SqlCompletionCatalogObject {
                    kind: "table".to_string(),
                    schema: "public".to_string(),
                    name: "users".to_string(),
                    qualified_name: "public.users".to_string(),
                },
                SqlCompletionCatalogObject {
                    kind: "view".to_string(),
                    schema: "analytics".to_string(),
                    name: "active_users".to_string(),
                    qualified_name: "analytics.active_users".to_string(),
                },
            ],
            columns: vec![
                column("public", "users", "id"),
                column("public", "users", "email"),
                column("public", "users", "created_at"),
                column("analytics", "active_users", "last_seen_at"),
            ],
            functions: vec![SqlCompletionCatalogFunction {
                schema: "public".to_string(),
                name: "slugify".to_string(),
                qualified_name: "public.slugify".to_string(),
                arguments: Some("text".to_string()),
                return_type: Some("text".to_string()),
            }],
        },
    }
}

fn request_for_dialect(dialect: &str, shell: &str, text: &str) -> SqlCompletionRequest {
    let mut req = request(text, text.len(), text.len());
    req.dialect = dialect.to_string();
    req.shell = shell.to_string();
    req.vocabulary.keywords.extend(
        [
            "SHOW",
            "DESCRIBE",
            "USE",
            "ON DUPLICATE KEY UPDATE",
            "PRAGMA",
            "WITHOUT ROWID",
        ]
        .into_iter()
        .map(str::to_string),
    );
    req.vocabulary
        .functions
        .extend(["JSON_EXTRACT", "STRFTIME"].into_iter().map(str::to_string));
    req
}

fn column(schema: &str, table: &str, name: &str) -> SqlCompletionCatalogColumn {
    SqlCompletionCatalogColumn {
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
fn returns_keyword_table_column_and_function_candidates() {
    let result = complete_sql(request("SEL", 3, 3));
    assert!(labels(&result).contains(&"SELECT".to_string()));

    let result = complete_sql(request("SELECT * FROM us", 16, 16));
    assert!(labels(&result).contains(&"users".to_string()));

    let result = complete_sql(request("SELECT em", 9, 9));
    assert!(labels(&result).contains(&"email".to_string()));

    let result = complete_sql(request("SELECT DA", 9, 9));
    assert!(labels(&result).contains(&"DATE_TRUNC".to_string()));
}

#[test]
fn resolves_alias_qualified_columns() {
    let result = complete_sql(request("SELECT u.em FROM users u", 11, 11));

    assert!(labels(&result).contains(&"email".to_string()));
    assert!(!labels(&result).contains(&"last_seen_at".to_string()));
    assert_eq!(
        result.replace_range.from,
        CompletionCursorOffsets { utf16: 9, utf8: 9 }
    );
}

#[test]
fn preserves_utf16_and_utf8_replace_offsets() {
    let text = "SELECT 한😀 em";
    let cursor = text.len();
    let result = complete_sql(request(
        text,
        text.chars().map(char::len_utf16).sum(),
        cursor,
    ));

    assert_eq!(result.replace_range.from.utf16, 11);
    assert_eq!(result.replace_range.from.utf8, 15);
    assert_eq!(result.replace_range.to.utf16, 13);
    assert_eq!(result.replace_range.to.utf8, 17);
}

#[test]
fn mysql_family_returns_keywords_functions_and_shell_commands() {
    let result = complete_sql(request_for_dialect("mysql", "mysql-client", "SH"));
    assert!(labels(&result).contains(&"SHOW".to_string()));

    let result = complete_sql(request_for_dialect("mariadb", "mysql-client", "JSON_EX"));
    assert!(labels(&result).contains(&"JSON_EXTRACT".to_string()));

    let result = complete_sql(request_for_dialect("mysql", "mysql-client", "\\G"));
    assert!(labels(&result).contains(&"\\G".to_string()));
    assert_eq!(
        result.replace_range.from,
        CompletionCursorOffsets { utf16: 0, utf8: 0 }
    );
}

#[test]
fn sqlite_returns_keywords_and_dot_shell_commands() {
    let result = complete_sql(request_for_dialect("sqlite", "sqlite-cli", "PRA"));
    assert!(labels(&result).contains(&"PRAGMA".to_string()));

    let result = complete_sql(request_for_dialect("sqlite", "sqlite-cli", ".s"));
    assert!(labels(&result).contains(&".schema".to_string()));
    assert_eq!(
        result.replace_range.from,
        CompletionCursorOffsets { utf16: 0, utf8: 0 }
    );
}

#[test]
fn unsupported_dialect_returns_empty_result_with_metadata() {
    let mut req = request("SELECT ", 7, 7);
    req.dialect = "mssql".to_string();

    let result = complete_sql(req);

    assert!(result.items.is_empty());
    assert_eq!(result.metadata.engine, "wasm");
    assert_eq!(result.metadata.dialect, "mssql");
}
