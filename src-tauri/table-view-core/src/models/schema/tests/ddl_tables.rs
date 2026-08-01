use super::super::*;
use serde_json;

#[test]
fn create_table_request_table_comment_serde_roundtrip() {
    // Sprint 234 — `table_comment: Option<String>` field round-trips
    // with `#[serde(default)]` semantics:
    // - `Some("user accounts")` — stays Some after roundtrip.
    // - Payload that omits the field (Sprint 226-233 callers) — the
    //   default `None` is filled in.
    let req = CreateTableRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        name: "users".to_string(),
        columns: vec![ColumnDefinition {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            nullable: false,
            default_value: None,
            comment: None,
            is_identity: false,
        }],
        primary_key: None,
        preview_only: true,
        table_comment: Some("user accounts".to_string()),
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    let deserialized: CreateTableRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(
        deserialized.table_comment,
        Some("user accounts".to_string())
    );

    // Back-compat — payload omitting `table_comment` deserializes to
    // None (Sprint 226-233 caller invariant).
    let json_no_comment = r#"{
            "connection_id": "conn1",
            "schema": "public",
            "name": "users",
            "columns": [],
            "preview_only": true
        }"#;
    let parsed: CreateTableRequest = serde_json::from_str(json_no_comment).unwrap();
    assert!(parsed.table_comment.is_none());
}

// ── Sprint 235 — RenameTableRequest / DropTableRequest serde ──────

#[test]
fn rename_table_request_serde_roundtrip() {
    // Sprint 235 — `preview_only` round-trips with `#[serde(default)]`
    // semantics. Camel-case wire form mirrors the rest of the
    // `*Request` family ({ connectionId, schema, table, newName,
    // previewOnly }).
    let req = RenameTableRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        table: "users".to_string(),
        new_name: "people".to_string(),
        preview_only: true,
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    // camelCase wire form check.
    assert!(
        json.contains("\"connectionId\":\"conn1\""),
        "expected camelCase connectionId, got: {json}"
    );
    assert!(
        json.contains("\"newName\":\"people\""),
        "expected camelCase newName, got: {json}"
    );
    assert!(json.contains("\"previewOnly\":true"));
    let deserialized: RenameTableRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.connection_id, "conn1");
    assert_eq!(deserialized.schema, "public");
    assert_eq!(deserialized.table, "users");
    assert_eq!(deserialized.new_name, "people");
    assert!(deserialized.preview_only);

    // Back-compat — payload omitting `previewOnly` deserialises to
    // false (Sprint 235 default-flag invariant).
    let no_flag = r#"{"connectionId":"c","schema":"s","table":"t","newName":"n"}"#;
    let parsed: RenameTableRequest = serde_json::from_str(no_flag).unwrap();
    assert!(!parsed.preview_only);
}

#[test]
fn drop_table_request_serde_roundtrip() {
    // Sprint 235 — both flags `#[serde(default)]`-friendly. Wire form
    // is camelCase.
    let req = DropTableRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        table: "users".to_string(),
        cascade: true,
        preview_only: false,
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("\"connectionId\":\"conn1\""));
    assert!(json.contains("\"cascade\":true"));
    assert!(json.contains("\"previewOnly\":false"));
    let deserialized: DropTableRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.connection_id, "conn1");
    assert_eq!(deserialized.schema, "public");
    assert_eq!(deserialized.table, "users");
    assert!(deserialized.cascade);
    assert!(!deserialized.preview_only);

    // Back-compat — payload omitting both flags deserialises to false
    // (default-flag invariant).
    let minimal = r#"{"connectionId":"c","schema":"s","table":"t"}"#;
    let parsed: DropTableRequest = serde_json::from_str(minimal).unwrap();
    assert!(!parsed.cascade);
    assert!(!parsed.preview_only);
}

// ── Sprint 236 — AddColumnRequest / DropColumnRequest serde ───────

#[test]
fn add_column_request_serde_camelcase_roundtrip() {
    // Sprint 236 — wire form is camelCase. `checkExpression` is
    // optional (`#[serde(default)]`); when `None` the field is
    // emitted as `null` in the JSON body — both round-trip cleanly.
    // `column` reuses the Sprint 226 `ColumnDefinition` struct so
    // its inner field names stay snake_case (matching the
    // Sprint 226 wire shape).
    let req = AddColumnRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        table: "users".to_string(),
        column: ColumnDefinition {
            name: "email".to_string(),
            data_type: "varchar(255)".to_string(),
            nullable: false,
            default_value: Some("''".to_string()),
            comment: None,
            is_identity: false,
        },
        check_expression: Some("email LIKE '%@%'".to_string()),
        preview_only: true,
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(
        json.contains("\"connectionId\":\"conn1\""),
        "expected camelCase connectionId, got: {json}"
    );
    assert!(
        json.contains("\"checkExpression\":\"email LIKE '%@%'\""),
        "expected camelCase checkExpression, got: {json}"
    );
    assert!(json.contains("\"previewOnly\":true"));
    let deserialized: AddColumnRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.connection_id, "conn1");
    assert_eq!(deserialized.schema, "public");
    assert_eq!(deserialized.table, "users");
    assert_eq!(deserialized.column.name, "email");
    assert_eq!(deserialized.column.data_type, "varchar(255)");
    assert!(!deserialized.column.nullable);
    assert_eq!(deserialized.column.default_value, Some("''".to_string()));
    assert_eq!(
        deserialized.check_expression,
        Some("email LIKE '%@%'".to_string())
    );
    assert!(deserialized.preview_only);

    // Back-compat — payload omitting `checkExpression` and
    // `previewOnly` deserialises to None / false.
    let minimal = r#"{
            "connectionId":"c",
            "schema":"s",
            "table":"t",
            "column":{
                "name":"x",
                "data_type":"int",
                "nullable":true,
                "default_value":null
            }
        }"#;
    let parsed: AddColumnRequest = serde_json::from_str(minimal).unwrap();
    assert!(parsed.check_expression.is_none());
    assert!(!parsed.preview_only);
}

#[test]
fn drop_column_request_serde_camelcase_roundtrip() {
    // Sprint 236 — `cascade` + `previewOnly` both
    // `#[serde(default)]`-friendly. Wire form is camelCase, with
    // `columnName` being the column to drop.
    let req = DropColumnRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        table: "users".to_string(),
        column_name: "email".to_string(),
        cascade: true,
        preview_only: false,
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    assert!(json.contains("\"connectionId\":\"conn1\""));
    assert!(
        json.contains("\"columnName\":\"email\""),
        "expected camelCase columnName, got: {json}"
    );
    assert!(json.contains("\"cascade\":true"));
    assert!(json.contains("\"previewOnly\":false"));
    let deserialized: DropColumnRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.connection_id, "conn1");
    assert_eq!(deserialized.schema, "public");
    assert_eq!(deserialized.table, "users");
    assert_eq!(deserialized.column_name, "email");
    assert!(deserialized.cascade);
    assert!(!deserialized.preview_only);

    // Back-compat — payload omitting `cascade` + `previewOnly`
    // deserialises to false (Sprint 236 default-flag invariant).
    let minimal = r#"{"connectionId":"c","schema":"s","table":"t","columnName":"col"}"#;
    let parsed: DropColumnRequest = serde_json::from_str(minimal).unwrap();
    assert!(!parsed.cascade);
    assert!(!parsed.preview_only);
}
