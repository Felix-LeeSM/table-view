use super::super::*;
use crate::models::ColumnCategory;
use serde_json;

#[test]
fn schema_info_serde_roundtrip() {
    let info = SchemaInfo {
        name: "public".to_string(),
    };
    let json = serde_json::to_string(&info).unwrap();
    let deserialized: SchemaInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.name, "public");
}

#[test]
fn table_info_serde_roundtrip() {
    // With row_count
    let info = TableInfo {
        name: "users".to_string(),
        schema: "public".to_string(),
        row_count: Some(42),
    };
    let json = serde_json::to_string(&info).unwrap();
    let deserialized: TableInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.name, "users");
    assert_eq!(deserialized.schema, "public");
    assert_eq!(deserialized.row_count, Some(42));

    // Without row_count
    let info_no_count = TableInfo {
        name: "orders".to_string(),
        schema: "public".to_string(),
        row_count: None,
    };
    let json_no_count = serde_json::to_string(&info_no_count).unwrap();
    let deserialized_no_count: TableInfo = serde_json::from_str(&json_no_count).unwrap();
    assert_eq!(deserialized_no_count.row_count, None);
}

#[test]
fn column_info_full_fields() {
    let col = ColumnInfo {
        name: "user_id".to_string(),
        data_type: "integer".to_string(),
        nullable: false,
        default_value: Some("nextval('seq')".to_string()),
        is_primary_key: true,
        is_foreign_key: false,
        fk_reference: None,
        comment: Some("Primary user identifier".to_string()),
        check_clauses: vec!["CHECK ((user_id > 0))".to_string()],
        category: ColumnCategory::Int,
    };
    let json = serde_json::to_string(&col).unwrap();
    let deserialized: ColumnInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.name, "user_id");
    assert_eq!(deserialized.data_type, "integer");
    assert!(!deserialized.nullable);
    assert_eq!(
        deserialized.default_value,
        Some("nextval('seq')".to_string())
    );
    assert!(deserialized.is_primary_key);
    assert!(!deserialized.is_foreign_key);
    assert!(deserialized.fk_reference.is_none());
    assert_eq!(
        deserialized.comment,
        Some("Primary user identifier".to_string())
    );
    assert_eq!(deserialized.check_clauses, vec!["CHECK ((user_id > 0))"]);
}

#[test]
fn column_info_minimal_fields() {
    let col = ColumnInfo {
        name: "description".to_string(),
        data_type: "text".to_string(),
        nullable: true,
        default_value: None,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: None,
        comment: None,
        check_clauses: Vec::new(),
        category: ColumnCategory::Text,
    };
    let json = serde_json::to_string(&col).unwrap();
    let deserialized: ColumnInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.name, "description");
    assert!(deserialized.nullable);
    assert!(!deserialized.is_primary_key);
    assert!(!deserialized.is_foreign_key);
    assert!(deserialized.default_value.is_none());
    assert!(deserialized.fk_reference.is_none());
    assert!(deserialized.comment.is_none());
    assert!(deserialized.check_clauses.is_empty());
}

/// Back-compat: payloads that omit `check_clauses` (older callers,
/// non-PG adapters) deserialize to an empty vector via
/// `#[serde(default)]`.
#[test]
fn column_info_serde_back_compat_missing_check_clauses() {
    let json = r#"{
            "name": "legacy",
            "data_type": "text",
            "nullable": true,
            "default_value": null,
            "is_primary_key": false,
            "is_foreign_key": false,
            "fk_reference": null,
            "comment": null
        }"#;
    let parsed: ColumnInfo = serde_json::from_str(json).unwrap();
    assert!(parsed.check_clauses.is_empty());
}

#[test]
fn table_data_serde_roundtrip() {
    let data = TableData {
        columns: vec![
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                nullable: false,
                default_value: None,
                is_primary_key: true,
                is_foreign_key: false,
                fk_reference: None,
                comment: None,
                check_clauses: Vec::new(),
                category: ColumnCategory::Int,
            },
            ColumnInfo {
                name: "name".to_string(),
                data_type: "text".to_string(),
                nullable: true,
                default_value: None,
                is_primary_key: false,
                is_foreign_key: false,
                fk_reference: None,
                comment: Some("User display name".to_string()),
                check_clauses: Vec::new(),
                category: ColumnCategory::Text,
            },
        ],
        rows: vec![
            vec![serde_json::json!(1), serde_json::json!("Alice")],
            vec![serde_json::json!(2), serde_json::json!("Bob")],
        ],
        total_count: 2,
        page: 1,
        page_size: 50,
        executed_query: "SELECT * FROM \"public\".\"users\" LIMIT 50 OFFSET 0".to_string(),
    };
    let json = serde_json::to_string(&data).unwrap();
    let deserialized: TableData = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.columns.len(), 2);
    assert_eq!(deserialized.rows.len(), 2);
    assert_eq!(deserialized.total_count, 2);
    assert_eq!(deserialized.page, 1);
    assert_eq!(deserialized.page_size, 50);
    assert_eq!(
        deserialized.executed_query,
        "SELECT * FROM \"public\".\"users\" LIMIT 50 OFFSET 0"
    );
    // Verify row values roundtrip
    assert_eq!(deserialized.rows[0][0], serde_json::json!(1));
    assert_eq!(deserialized.rows[1][1], serde_json::json!("Bob"));
}
