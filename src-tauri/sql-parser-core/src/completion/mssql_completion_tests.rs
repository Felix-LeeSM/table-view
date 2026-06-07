use super::*;

fn request(text: &str) -> SqlCompletionRequest {
    SqlCompletionRequest {
        text: text.to_string(),
        cursor: CompletionCursorOffsets {
            utf16: text.len(),
            utf8: text.len(),
        },
        dialect: "mssql".to_string(),
        shell: "none".to_string(),
        server_version: None,
        vocabulary: SqlCompletionVocabulary {
            keywords: vec![],
            functions: vec![],
        },
        catalog: SqlCompletionCatalogSnapshot {
            revision: "mssql-rev".to_string(),
            databases: vec![
                SqlCompletionCatalogDatabase {
                    name: "MssqlApp".to_string(),
                },
                SqlCompletionCatalogDatabase {
                    name: "ArchiveDb".to_string(),
                },
            ],
            schemas: vec![
                SqlCompletionCatalogSchema {
                    database: "MssqlApp".to_string(),
                    name: "dbo".to_string(),
                },
                SqlCompletionCatalogSchema {
                    database: "MssqlApp".to_string(),
                    name: "sales".to_string(),
                },
            ],
            objects: vec![
                SqlCompletionCatalogObject {
                    kind: "table".to_string(),
                    database: "MssqlApp".to_string(),
                    schema: "sales".to_string(),
                    name: "Order Details".to_string(),
                    qualified_name: "sales.Order Details".to_string(),
                },
                SqlCompletionCatalogObject {
                    kind: "view".to_string(),
                    database: "MssqlApp".to_string(),
                    schema: "dbo".to_string(),
                    name: "SalesSummary".to_string(),
                    qualified_name: "dbo.SalesSummary".to_string(),
                },
            ],
            columns: vec![
                column("MssqlApp", "sales", "Order Details", "Order ID"),
                column("MssqlApp", "sales", "Order Details", "Ship Date"),
            ],
            functions: vec![SqlCompletionCatalogFunction {
                database: "MssqlApp".to_string(),
                schema: "dbo".to_string(),
                name: "usp_RebuildLeaderboard".to_string(),
                qualified_name: "dbo.usp_RebuildLeaderboard".to_string(),
                arguments: Some("@season int".to_string()),
                return_type: None,
            }],
            extensions: vec![],
        },
    }
}

fn empty_request(text: &str) -> SqlCompletionRequest {
    let mut req = request(text);
    req.catalog.schemas.clear();
    req.catalog.databases.clear();
    req.catalog.objects.clear();
    req.catalog.columns.clear();
    req.catalog.functions.clear();
    req
}

fn column(database: &str, schema: &str, table: &str, name: &str) -> SqlCompletionCatalogColumn {
    SqlCompletionCatalogColumn {
        database: database.to_string(),
        schema: schema.to_string(),
        table: table.to_string(),
        name: name.to_string(),
        qualified_table_name: format!("{schema}.{table}"),
    }
}

fn labels(result: &SqlCompletionCoreResult) -> Vec<String> {
    result.items.iter().map(|item| item.label.clone()).collect()
}

fn assert_completion_contains(text: &str, label: &str) {
    let result = complete_sql(empty_request(text));
    let result_labels = labels(&result);
    assert!(
        result_labels.contains(&label.to_string()),
        "MSSQL completion for {text:?} did not contain {label:?}; got {result_labels:?}"
    );
}

fn assert_completion_excludes(text: &str, label: &str) {
    let result = complete_sql(empty_request(text));
    let result_labels = labels(&result);
    assert!(
        !result_labels.contains(&label.to_string()),
        "MSSQL completion for {text:?} unexpectedly contained {label:?}; got {result_labels:?}"
    );
}

#[test]
fn reference_vocabulary_smoke_without_sqlcmd_scripting() {
    assert_completion_contains("TO", "TOP");
    assert_completion_contains("EXEC", "EXECUTE");
    assert_completion_contains("CREATE ", "CREATE PROCEDURE");
    assert_completion_contains("OUT", "OUTPUT");
    assert_completion_contains("GET", "GETDATE");
    assert_completion_contains("TRY_CON", "TRY_CONVERT");
    assert_completion_excludes("ILI", "ILIKE");
    assert_completion_excludes("PRA", "PRAGMA");

    let sqlcmd_result = complete_sql(empty_request(":CON"));
    assert!(!labels(&sqlcmd_result).contains(&":CONNECT".to_string()));
    assert!(
        !sqlcmd_result
            .items
            .iter()
            .any(|item| item.kind == "meta-command"),
        "MSSQL completion must not imply SQLCMD scripting commands are executable: {:?}",
        sqlcmd_result.items
    );
}

#[test]
fn catalog_context_suggests_bracket_identifiers_and_procedures() {
    let table_result = complete_sql(request("SELECT * FROM [Order"));
    let table_item = table_result
        .items
        .iter()
        .find(|item| item.label == "Order Details")
        .expect("MSSQL bracketed table candidate");
    assert_eq!(table_item.kind, "table");
    assert_eq!(table_item.apply.as_deref(), Some("[Order Details]"));
    assert_eq!(
        table_result.replace_range.from,
        CompletionCursorOffsets {
            utf16: 14,
            utf8: 14
        }
    );

    let column_result = complete_sql(request("SELECT [Order Details].[Ship"));
    let column_item = column_result
        .items
        .iter()
        .find(|item| item.label == "Ship Date")
        .expect("MSSQL bracketed column candidate");
    assert_eq!(column_item.kind, "column");
    assert_eq!(column_item.apply.as_deref(), Some("[Ship Date]"));
    assert_eq!(column_item.detail.as_deref(), Some("sales.Order Details"));

    let procedure_result = complete_sql(request("EXEC dbo.usp_"));
    let procedure_item = procedure_result
        .items
        .iter()
        .find(|item| item.label == "usp_RebuildLeaderboard")
        .expect("MSSQL procedure catalog candidate");
    assert_eq!(procedure_item.kind, "function");
    assert_eq!(
        procedure_item.detail.as_deref(),
        Some("dbo.usp_RebuildLeaderboard")
    );
}

#[test]
fn catalog_context_suggests_live_database_schema_object_and_column_paths() {
    let database_result = complete_sql(request("USE Mss"));
    let database_item = database_result
        .items
        .iter()
        .find(|item| item.label == "MssqlApp")
        .expect("MSSQL database catalog candidate");
    assert_eq!(database_item.kind, "database");
    assert_eq!(database_item.apply.as_deref(), Some("MssqlApp"));

    let schema_result = complete_sql(request("SELECT * FROM MssqlApp."));
    let schema_item = schema_result
        .items
        .iter()
        .find(|item| item.label == "sales")
        .expect("MSSQL database-qualified schema candidate");
    assert_eq!(schema_item.kind, "schema");
    assert_eq!(schema_item.detail.as_deref(), Some("MssqlApp"));

    let table_result = complete_sql(request("SELECT * FROM [MssqlApp].[sales].[Order"));
    let table_item = table_result
        .items
        .iter()
        .find(|item| item.label == "Order Details")
        .expect("MSSQL database/schema-qualified table candidate");
    assert_eq!(table_item.kind, "table");
    assert_eq!(table_item.apply.as_deref(), Some("[Order Details]"));

    let view_result = complete_sql(request("SELECT * FROM [MssqlApp].[dbo].Sales"));
    let view_item = view_result
        .items
        .iter()
        .find(|item| item.label == "SalesSummary")
        .expect("MSSQL database/schema-qualified view candidate");
    assert_eq!(view_item.kind, "view");

    let procedure_result = complete_sql(request("EXEC [MssqlApp].[dbo].usp_"));
    let procedure_item = procedure_result
        .items
        .iter()
        .find(|item| item.label == "usp_RebuildLeaderboard")
        .expect("MSSQL database/schema-qualified procedure candidate");
    assert_eq!(procedure_item.kind, "function");

    let column_result = complete_sql(request("SELECT [MssqlApp].[sales].[Order Details].[Ship"));
    let column_item = column_result
        .items
        .iter()
        .find(|item| item.label == "Ship Date")
        .expect("MSSQL database/schema/table-qualified column candidate");
    assert_eq!(column_item.kind, "column");
    assert_eq!(column_item.apply.as_deref(), Some("[Ship Date]"));
}

#[test]
fn empty_catalog_fallback_is_non_throwing() {
    let database_result = complete_sql(empty_request("USE "));
    assert_eq!(
        database_result.metadata.completion_state,
        CompletionState::DatabaseName
    );
    assert!(database_result.items.is_empty());

    let relation_result = complete_sql(empty_request("SELECT * FROM dbo."));
    assert!(relation_result.items.is_empty());

    let column_result = complete_sql(empty_request("SELECT dbo.users."));
    assert!(column_result.items.is_empty());
}
