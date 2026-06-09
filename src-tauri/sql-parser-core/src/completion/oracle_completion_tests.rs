use super::*;

fn request(text: &str) -> SqlCompletionRequest {
    SqlCompletionRequest {
        text: text.to_string(),
        cursor: CompletionCursorOffsets {
            utf16: text.len(),
            utf8: text.len(),
        },
        dialect: "oracle".to_string(),
        shell: "none".to_string(),
        server_version: Some("23ai".to_string()),
        vocabulary: SqlCompletionVocabulary {
            keywords: vec![],
            functions: vec![],
        },
        catalog: SqlCompletionCatalogSnapshot {
            revision: "oracle-rev".to_string(),
            databases: vec![SqlCompletionCatalogDatabase {
                name: "FREEPDB1".to_string(),
            }],
            schemas: vec![SqlCompletionCatalogSchema {
                database: "FREEPDB1".to_string(),
                name: "APP".to_string(),
            }],
            objects: vec![
                SqlCompletionCatalogObject {
                    kind: "table".to_string(),
                    database: "FREEPDB1".to_string(),
                    schema: "APP".to_string(),
                    name: "ORDERS".to_string(),
                    qualified_name: "APP.ORDERS".to_string(),
                },
                SqlCompletionCatalogObject {
                    kind: "view".to_string(),
                    database: "FREEPDB1".to_string(),
                    schema: "APP".to_string(),
                    name: "ACTIVE_ORACLE_USERS".to_string(),
                    qualified_name: "APP.ACTIVE_ORACLE_USERS".to_string(),
                },
            ],
            columns: vec![
                column("FREEPDB1", "APP", "ORDERS", "ORDER_ID"),
                column("FREEPDB1", "APP", "ORDERS", "STATUS"),
            ],
            functions: vec![
                catalog_function("FREEPDB1", "APP", "CATALOG_API", "package", None, "PL/SQL"),
                catalog_function(
                    "FREEPDB1",
                    "APP",
                    "ORDER_SEQ",
                    "sequence",
                    Some("next 101"),
                    "Oracle sequence",
                ),
                catalog_function(
                    "FREEPDB1",
                    "APP",
                    "ACTIVE_USERS_ALIAS",
                    "synonym",
                    Some("APP.ACTIVE_ORACLE_USERS"),
                    "Oracle synonym",
                ),
            ],
            extensions: vec![],
        },
    }
}

fn empty_request(text: &str) -> SqlCompletionRequest {
    let mut req = request(text);
    req.catalog.databases.clear();
    req.catalog.schemas.clear();
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

fn catalog_function(
    database: &str,
    schema: &str,
    name: &str,
    kind: &str,
    return_type: Option<&str>,
    language: &str,
) -> SqlCompletionCatalogFunction {
    SqlCompletionCatalogFunction {
        database: database.to_string(),
        schema: schema.to_string(),
        name: name.to_string(),
        qualified_name: format!("{schema}.{name}"),
        arguments: None,
        return_type: return_type.map(str::to_string),
        kind: kind.to_string(),
        language: Some(language.to_string()),
    }
}

#[test]
fn catalog_context_suggests_oracle_schema_table_column_and_metadata_objects() {
    let schema_result = complete_sql(request("SELECT * FROM FREEPDB1."));
    let schema_item = schema_result
        .items
        .iter()
        .find(|item| item.label == "APP")
        .expect("Oracle database-qualified schema candidate");
    assert_eq!(schema_item.kind, "schema");
    assert_eq!(schema_item.detail.as_deref(), Some("FREEPDB1"));

    let table_result = complete_sql(request("SELECT * FROM APP.ORD"));
    let table_item = table_result
        .items
        .iter()
        .find(|item| item.label == "ORDERS")
        .expect("Oracle schema-qualified table candidate");
    assert_eq!(table_item.kind, "table");
    assert_eq!(table_item.detail.as_deref(), Some("APP"));

    let column_result = complete_sql(request("SELECT APP.ORDERS.ORD"));
    let column_item = column_result
        .items
        .iter()
        .find(|item| item.label == "ORDER_ID")
        .expect("Oracle schema/table-qualified column candidate");
    assert_eq!(column_item.kind, "column");
    assert_eq!(column_item.detail.as_deref(), Some("APP.ORDERS"));

    let package_result = complete_sql(request("SELECT CATALOG"));
    let package_item = package_result
        .items
        .iter()
        .find(|item| item.label == "CATALOG_API")
        .expect("Oracle package catalog candidate");
    assert_eq!(package_item.kind, "package");
    assert_eq!(package_item.detail.as_deref(), Some("APP.CATALOG_API"));

    let sequence_result = complete_sql(request("SELECT ORDER_"));
    let sequence_item = sequence_result
        .items
        .iter()
        .find(|item| item.label == "ORDER_SEQ")
        .expect("Oracle sequence catalog candidate");
    assert_eq!(sequence_item.kind, "sequence");
    assert_eq!(
        sequence_item.detail.as_deref(),
        Some("APP.ORDER_SEQ -> next 101")
    );

    let synonym_result = complete_sql(request("SELECT * FROM ACTIVE_"));
    let synonym_item = synonym_result
        .items
        .iter()
        .find(|item| item.label == "ACTIVE_USERS_ALIAS")
        .expect("Oracle synonym relation candidate");
    assert_eq!(synonym_item.kind, "synonym");
    assert_eq!(
        synonym_item.detail.as_deref(),
        Some("APP.ACTIVE_USERS_ALIAS -> APP.ACTIVE_ORACLE_USERS")
    );
}

#[test]
fn sequence_members_are_catalog_sensitive() {
    let result = complete_sql(request("SELECT APP.ORDER_SEQ.N"));
    let nextval = result
        .items
        .iter()
        .find(|item| item.label == "NEXTVAL")
        .expect("Oracle sequence NEXTVAL candidate");
    assert_eq!(nextval.kind, "keyword");
    assert_eq!(nextval.detail.as_deref(), Some("Oracle sequence member"));

    let missing_sequence = complete_sql(request("SELECT APP.MISSING_SEQ.N"));
    assert!(!missing_sequence
        .items
        .iter()
        .any(|item| item.label == "NEXTVAL"));
}

#[test]
fn no_context_catalog_fallback_is_safe() {
    let relation_result = complete_sql(empty_request("SELECT * FROM APP."));
    assert!(relation_result.items.is_empty());

    let column_result = complete_sql(empty_request("SELECT APP.ORDERS."));
    assert!(column_result.items.is_empty());

    let sequence_result = complete_sql(empty_request("SELECT APP.ORDER_SEQ.N"));
    assert!(!sequence_result
        .items
        .iter()
        .any(|item| item.label == "NEXTVAL"));
}
