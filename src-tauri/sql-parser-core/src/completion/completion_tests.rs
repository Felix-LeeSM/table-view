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
            schemas: vec![
                SqlCompletionCatalogSchema {
                    name: "public".to_string(),
                },
                SqlCompletionCatalogSchema {
                    name: "analytics".to_string(),
                },
            ],
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
            extensions: vec![],
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

fn empty_vocabulary_request(dialect: &str, shell: &str, text: &str) -> SqlCompletionRequest {
    let mut req = request(text, text.len(), text.len());
    req.dialect = dialect.to_string();
    req.shell = shell.to_string();
    req.vocabulary.keywords.clear();
    req.vocabulary.functions.clear();
    req
}

fn mysql_catalog_request(text: &str) -> SqlCompletionRequest {
    let mut req = empty_vocabulary_request("mysql", "mysql-client", text);
    req.catalog.schemas = vec![
        SqlCompletionCatalogSchema {
            name: "app".to_string(),
        },
        SqlCompletionCatalogSchema {
            name: "audit".to_string(),
        },
    ];
    req.catalog.objects = vec![
        SqlCompletionCatalogObject {
            kind: "table".to_string(),
            schema: "app".to_string(),
            name: "UserAccounts".to_string(),
            qualified_name: "app.UserAccounts".to_string(),
        },
        SqlCompletionCatalogObject {
            kind: "view".to_string(),
            schema: "app".to_string(),
            name: "UserSummary".to_string(),
            qualified_name: "app.UserSummary".to_string(),
        },
        SqlCompletionCatalogObject {
            kind: "table".to_string(),
            schema: "audit".to_string(),
            name: "AuditLog".to_string(),
            qualified_name: "audit.AuditLog".to_string(),
        },
    ];
    req.catalog.columns = vec![
        column("app", "UserAccounts", "id"),
        column("app", "UserAccounts", "EmailAddress"),
        column("audit", "AuditLog", "id"),
    ];
    req.catalog.functions = vec![SqlCompletionCatalogFunction {
        schema: "app".to_string(),
        name: "normalize_email".to_string(),
        qualified_name: "app.normalize_email".to_string(),
        arguments: Some("varchar".to_string()),
        return_type: Some("varchar".to_string()),
    }];
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

fn extension(name: &str) -> SqlCompletionCatalogExtension {
    SqlCompletionCatalogExtension {
        schema: "public".to_string(),
        name: name.to_string(),
        version: "1.0".to_string(),
    }
}

fn labels(result: &SqlCompletionCoreResult) -> Vec<String> {
    result.items.iter().map(|item| item.label.clone()).collect()
}

fn assert_builtin_completion_contains(dialect: &str, shell: &str, text: &str, label: &str) {
    let result = complete_sql(empty_vocabulary_request(dialect, shell, text));
    let result_labels = labels(&result);

    assert!(
        result_labels.contains(&label.to_string()),
        "{dialect}/{shell} completion for {text:?} did not contain {label:?}; got {result_labels:?}"
    );
}

fn assert_builtin_completion_excludes(dialect: &str, shell: &str, text: &str, label: &str) {
    let result = complete_sql(empty_vocabulary_request(dialect, shell, text));
    let result_labels = labels(&result);

    assert!(
        !result_labels.contains(&label.to_string()),
        "{dialect}/{shell} completion for {text:?} unexpectedly contained {label:?}; got {result_labels:?}"
    );
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
fn rust_builtin_vocabulary_does_not_depend_on_ts_request_lists() {
    let result = complete_sql(empty_vocabulary_request("postgresql", "psql", "VAC"));
    assert!(labels(&result).contains(&"VACUUM".to_string()));

    let result = complete_sql(empty_vocabulary_request("postgresql", "psql", "\\wa"));
    assert!(labels(&result).contains(&"\\watch".to_string()));

    let result = complete_sql(empty_vocabulary_request("mysql", "mysql-client", "JSON_TA"));
    assert!(labels(&result).contains(&"JSON_TABLE".to_string()));

    let result = complete_sql(empty_vocabulary_request("mysql", "mysql-client", "\\C"));
    assert!(labels(&result).contains(&"\\C".to_string()));
}

#[test]
fn postgresql_psql_reference_vocabulary_smoke() {
    assert_builtin_completion_contains("postgresql", "psql", "ON", "ON CONFLICT");
    assert_builtin_completion_contains("postgresql", "psql", "JSONB_BUILD_O", "JSONB_BUILD_OBJECT");
    assert_builtin_completion_contains(
        "postgresql",
        "psql",
        "PG_TERMINATE",
        "PG_TERMINATE_BACKEND",
    );
    assert_builtin_completion_contains("postgresql", "psql", "\\bi", "\\bind");
    assert_builtin_completion_contains("postgresql", "psql", "\\par", "\\parse");
    assert_builtin_completion_contains("postgresql", "psql", "\\wa", "\\watch");
}

#[test]
fn ac_488_pgcrypto_pack_is_not_suggested_without_installed_extension_inventory() {
    let result = complete_sql(empty_vocabulary_request("postgresql", "psql", "GEN_RANDOM"));

    assert!(!labels(&result).contains(&"GEN_RANDOM_UUID".to_string()));
}

#[test]
fn ac_488_detected_pgcrypto_extension_enables_curated_function_pack() {
    let mut req = empty_vocabulary_request("postgresql", "psql", "GEN_RANDOM");
    req.catalog.extensions = vec![extension("pgcrypto")];

    let result = complete_sql(req);

    assert!(labels(&result).contains(&"GEN_RANDOM_UUID".to_string()));
    let item = result
        .items
        .iter()
        .find(|item| item.label == "GEN_RANDOM_UUID")
        .expect("pgcrypto function candidate");
    assert_eq!(item.kind, "function");
    assert_eq!(
        item.detail.as_deref(),
        Some("PostgreSQL extension pgcrypto function")
    );
}

#[test]
fn ac_488_extension_packs_are_keyed_by_detected_extension_name() {
    let mut uuid_req = empty_vocabulary_request("postgresql", "psql", "UUID_GENERATE");
    uuid_req.catalog.extensions = vec![extension("uuid-ossp")];
    let uuid_result = complete_sql(uuid_req);
    assert!(labels(&uuid_result).contains(&"UUID_GENERATE_V4".to_string()));

    let mut unknown_req = empty_vocabulary_request("postgresql", "psql", "GEN_RANDOM");
    unknown_req.catalog.extensions = vec![extension("unknown_extension")];
    let unknown_result = complete_sql(unknown_req);
    assert!(!labels(&unknown_result).contains(&"GEN_RANDOM_UUID".to_string()));
}

#[test]
fn ac_488_operator_pack_candidates_replace_typed_operator_prefixes() {
    let mut vector_req = empty_vocabulary_request("postgresql", "psql", "SELECT embedding <");
    vector_req.catalog.extensions = vec![extension("pgvector")];
    let vector_result = complete_sql(vector_req);
    assert!(labels(&vector_result).contains(&"<->".to_string()));
    assert_eq!(
        vector_result.replace_range.from,
        CompletionCursorOffsets {
            utf16: 17,
            utf8: 17
        }
    );
    assert_eq!(
        vector_result.replace_range.to,
        CompletionCursorOffsets {
            utf16: 18,
            utf8: 18
        }
    );

    let mut trigram_req = empty_vocabulary_request("postgresql", "psql", "SELECT title %");
    trigram_req.catalog.extensions = vec![extension("pg_trgm")];
    let trigram_result = complete_sql(trigram_req);
    assert!(labels(&trigram_result).contains(&"%".to_string()));
    assert_eq!(
        trigram_result.replace_range.from,
        CompletionCursorOffsets {
            utf16: 13,
            utf8: 13
        }
    );
    assert_eq!(
        trigram_result.replace_range.to,
        CompletionCursorOffsets {
            utf16: 14,
            utf8: 14
        }
    );
}

#[test]
fn mysql_family_reference_vocabulary_smoke() {
    assert_builtin_completion_contains("mysql", "mysql-client", "ON", "ON DUPLICATE KEY UPDATE");
    assert_builtin_completion_contains("mysql", "mysql-client", "JSON_TA", "JSON_TABLE");
    assert_builtin_completion_contains("mysql", "mysql-client", "JSON_VAL", "JSON_VALUE");
    assert_builtin_completion_contains("mysql", "mysql-client", "REGEXP_LI", "REGEXP_LIKE");
    assert_builtin_completion_contains("mysql", "mysql-client", "UUID_TO", "UUID_TO_BIN");
    assert_builtin_completion_contains("mysql", "mysql-client", "BIN_TO", "BIN_TO_UUID");
    assert_builtin_completion_contains("mysql", "mysql-client", "query_a", "query_attributes");
    assert_builtin_completion_contains("mysql", "mysql-client", "delim", "delimiter");
    assert_builtin_completion_contains("mysql", "mysql-client", "sour", "source");
}

#[test]
fn ac_446_mysql_catalog_context_suggests_schema_qualified_tables_and_routines() {
    let result = complete_sql(mysql_catalog_request("USE ap"));
    assert!(result.items.iter().any(|item| {
        item.label == "app" && item.kind == "schema" && item.apply.as_deref() == Some("app")
    }));

    let result = complete_sql(mysql_catalog_request("SELECT * FROM app.User"));
    assert!(result.items.iter().any(|item| {
        item.label == "UserAccounts"
            && item.kind == "table"
            && item.detail.as_deref() == Some("app")
    }));

    let result = complete_sql(mysql_catalog_request("SELECT app.norm"));
    assert!(result.items.iter().any(|item| {
        item.label == "normalize_email"
            && item.kind == "function"
            && item.detail.as_deref() == Some("app.normalize_email -> varchar")
    }));
}

#[test]
fn ac_446_mysql_backtick_context_uses_catalog_replace_ranges_and_quoting() {
    let table_result = complete_sql(mysql_catalog_request("SELECT * FROM `User"));
    let table_item = table_result
        .items
        .iter()
        .find(|item| item.label == "UserAccounts")
        .expect("MySQL table candidate from backtick prefix");
    assert_eq!(table_item.apply.as_deref(), Some("`UserAccounts`"));
    assert_eq!(
        table_result.replace_range.from,
        CompletionCursorOffsets {
            utf16: 14,
            utf8: 14
        }
    );

    let column_result = complete_sql(mysql_catalog_request("SELECT `UserAccounts`.`i"));
    let id_items: Vec<_> = column_result
        .items
        .iter()
        .filter(|item| item.label == "id")
        .collect();
    assert_eq!(id_items.len(), 1);
    assert_eq!(id_items[0].detail.as_deref(), Some("app.UserAccounts"));
    assert_eq!(id_items[0].apply.as_deref(), Some("`id`"));
}

#[test]
fn mariadb_returning_keyword_is_dialect_specific() {
    assert_builtin_completion_contains("mariadb", "mysql-client", "RET", "RETURNING");
    assert_builtin_completion_excludes("mysql", "mysql-client", "RET", "RETURNING");
}

#[test]
fn sqlite_reference_vocabulary_smoke() {
    assert_builtin_completion_contains("sqlite", "sqlite-cli", "WITHO", "WITHOUT ROWID");
    assert_builtin_completion_contains("sqlite", "sqlite-cli", "JSON_EX", "JSON_EXTRACT");
    assert_builtin_completion_contains("sqlite", "sqlite-cli", "STRF", "STRFTIME");
    assert_builtin_completion_contains("sqlite", "sqlite-cli", ".rec", ".recover");
    assert_builtin_completion_contains("sqlite", "sqlite-cli", ".exp", ".expert");
    assert_builtin_completion_contains("sqlite", "sqlite-cli", ".sch", ".schema");
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
