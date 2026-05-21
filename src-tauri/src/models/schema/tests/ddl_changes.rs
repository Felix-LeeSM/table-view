use super::super::*;
use serde_json;

#[test]
fn column_change_add_serde_roundtrip() {
    let change = ColumnChange::Add {
        name: "email".to_string(),
        data_type: "varchar(255)".to_string(),
        nullable: false,
        default_value: None,
    };
    let json = serde_json::to_string(&change).unwrap();
    let deserialized: ColumnChange = serde_json::from_str(&json).unwrap();
    match deserialized {
        ColumnChange::Add {
            name,
            data_type,
            nullable,
            default_value,
        } => {
            assert_eq!(name, "email");
            assert_eq!(data_type, "varchar(255)");
            assert!(!nullable);
            assert!(default_value.is_none());
        }
        _ => panic!("Expected ColumnChange::Add"),
    }
}

#[test]
fn column_change_modify_serde_roundtrip() {
    let change = ColumnChange::Modify {
        name: "age".to_string(),
        new_data_type: Some("bigint".to_string()),
        new_nullable: Some(true),
        new_default_value: Some("0".to_string()),
        using_expression: None,
    };
    let json = serde_json::to_string(&change).unwrap();
    let deserialized: ColumnChange = serde_json::from_str(&json).unwrap();
    match deserialized {
        ColumnChange::Modify {
            name,
            new_data_type,
            new_nullable,
            new_default_value,
            using_expression,
        } => {
            assert_eq!(name, "age");
            assert_eq!(new_data_type, Some("bigint".to_string()));
            assert_eq!(new_nullable, Some(true));
            assert_eq!(new_default_value, Some("0".to_string()));
            assert_eq!(using_expression, None);
        }
        _ => panic!("Expected ColumnChange::Modify"),
    }
}

/// Sprint 237 — round-trip with `using_expression = Some(...)` to
/// pin the new field through serde, plus a back-compat probe where
/// the JSON payload omits `using_expression` entirely → deserialises
/// to `None` via `#[serde(default)]` (pre-Sprint-237 caller
/// byte-equivalence invariant).
#[test]
fn column_change_modify_using_expression_serde_roundtrip() {
    let change = ColumnChange::Modify {
        name: "age".to_string(),
        new_data_type: Some("int".to_string()),
        new_nullable: None,
        new_default_value: None,
        using_expression: Some("age::int".to_string()),
    };
    let json = serde_json::to_string(&change).unwrap();
    assert!(
        json.contains("\"using_expression\":\"age::int\""),
        "expected using_expression in wire form, got: {json}"
    );
    let deserialized: ColumnChange = serde_json::from_str(&json).unwrap();
    match deserialized {
        ColumnChange::Modify {
            using_expression, ..
        } => {
            assert_eq!(using_expression, Some("age::int".to_string()));
        }
        _ => panic!("Expected ColumnChange::Modify"),
    }

    // Back-compat — payload that omits `using_expression` (pre-
    // Sprint-237 caller) deserialises to `None` via
    // `#[serde(default)]`.
    let legacy = r#"{
            "type":"modify",
            "name":"age",
            "new_data_type":"bigint",
            "new_nullable":null,
            "new_default_value":null
        }"#;
    let parsed: ColumnChange = serde_json::from_str(legacy).unwrap();
    match parsed {
        ColumnChange::Modify {
            using_expression, ..
        } => {
            assert!(using_expression.is_none());
        }
        _ => panic!("Expected ColumnChange::Modify"),
    }
}

#[test]
fn column_change_drop_serde_roundtrip() {
    let change = ColumnChange::Drop {
        name: "legacy_field".to_string(),
    };
    let json = serde_json::to_string(&change).unwrap();
    let deserialized: ColumnChange = serde_json::from_str(&json).unwrap();
    match deserialized {
        ColumnChange::Drop { name } => {
            assert_eq!(name, "legacy_field");
        }
        _ => panic!("Expected ColumnChange::Drop"),
    }
}

#[test]
fn alter_table_request_serde_roundtrip() {
    let req = AlterTableRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        table: "users".to_string(),
        changes: vec![
            ColumnChange::Add {
                name: "created_at".to_string(),
                data_type: "timestamp".to_string(),
                nullable: true,
                default_value: Some("now()".to_string()),
            },
            ColumnChange::Drop {
                name: "old_column".to_string(),
            },
        ],
        preview_only: true,
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    let deserialized: AlterTableRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.connection_id, "conn1");
    assert_eq!(deserialized.changes.len(), 2);
    assert!(deserialized.preview_only);
}

#[test]
fn create_index_request_serde_roundtrip() {
    let req = CreateIndexRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        table: "users".to_string(),
        index_name: "idx_users_email".to_string(),
        columns: vec!["email".to_string()],
        index_type: "btree".to_string(),
        is_unique: true,
        preview_only: false,
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    let deserialized: CreateIndexRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.index_name, "idx_users_email");
    assert!(deserialized.is_unique);
    assert!(!deserialized.preview_only);
}

#[test]
fn drop_index_request_serde_roundtrip() {
    let req = DropIndexRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        index_name: "idx_users_email".to_string(),
        table: String::new(),
        if_exists: true,
        preview_only: false,
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    let deserialized: DropIndexRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.index_name, "idx_users_email");
    assert!(deserialized.if_exists);
}

#[test]
fn constraint_definition_primary_key_serde() {
    let def = ConstraintDefinition::PrimaryKey {
        columns: vec!["id".to_string()],
    };
    let json = serde_json::to_string(&def).unwrap();
    let deserialized: ConstraintDefinition = serde_json::from_str(&json).unwrap();
    match deserialized {
        ConstraintDefinition::PrimaryKey { columns } => {
            assert_eq!(columns, vec!["id".to_string()]);
        }
        _ => panic!("Expected PrimaryKey"),
    }
}

#[test]
fn constraint_definition_foreign_key_serde() {
    // Sprint 229 — Rust struct construction requires complete field
    // listings; the new `on_delete` / `on_update` fields default to
    // `None`. JSON payloads that omit these keys (Sprint 226+227+228
    // callers) deserialize to the same `None` via `#[serde(default)]`.
    let def = ConstraintDefinition::ForeignKey {
        columns: vec!["user_id".to_string()],
        reference_table: "users".to_string(),
        reference_columns: vec!["id".to_string()],
        on_delete: None,
        on_update: None,
    };
    let json = serde_json::to_string(&def).unwrap();
    let deserialized: ConstraintDefinition = serde_json::from_str(&json).unwrap();
    match deserialized {
        ConstraintDefinition::ForeignKey {
            columns,
            reference_table,
            reference_columns,
            on_delete,
            on_update,
        } => {
            assert_eq!(columns, vec!["user_id".to_string()]);
            assert_eq!(reference_table, "users");
            assert_eq!(reference_columns, vec!["id".to_string()]);
            assert!(on_delete.is_none());
            assert!(on_update.is_none());
        }
        _ => panic!("Expected ForeignKey"),
    }
}

#[test]
fn constraint_definition_unique_serde() {
    let def = ConstraintDefinition::Unique {
        columns: vec!["email".to_string()],
    };
    let json = serde_json::to_string(&def).unwrap();
    let deserialized: ConstraintDefinition = serde_json::from_str(&json).unwrap();
    match deserialized {
        ConstraintDefinition::Unique { columns } => {
            assert_eq!(columns, vec!["email".to_string()]);
        }
        _ => panic!("Expected Unique"),
    }
}

#[test]
fn constraint_definition_check_serde() {
    let def = ConstraintDefinition::Check {
        expression: "age > 0".to_string(),
    };
    let json = serde_json::to_string(&def).unwrap();
    let deserialized: ConstraintDefinition = serde_json::from_str(&json).unwrap();
    match deserialized {
        ConstraintDefinition::Check { expression } => {
            assert_eq!(expression, "age > 0");
        }
        _ => panic!("Expected Check"),
    }
}

#[test]
fn add_constraint_request_serde_roundtrip() {
    let req = AddConstraintRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        table: "orders".to_string(),
        constraint_name: "fk_user".to_string(),
        definition: ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".to_string()],
            reference_table: "users".to_string(),
            reference_columns: vec!["id".to_string()],
            on_delete: None,
            on_update: None,
        },
        preview_only: true,
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    let deserialized: AddConstraintRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.constraint_name, "fk_user");
    assert!(deserialized.preview_only);
}

#[test]
fn drop_constraint_request_serde_roundtrip() {
    let req = DropConstraintRequest {
        connection_id: "conn1".to_string(),
        schema: "public".to_string(),
        table: "orders".to_string(),
        constraint_name: "fk_user".to_string(),
        preview_only: false,
        expected_database: None,
    };
    let json = serde_json::to_string(&req).unwrap();
    let deserialized: DropConstraintRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.constraint_name, "fk_user");
    assert!(!deserialized.preview_only);
}

#[test]
fn schema_change_result_serde_roundtrip() {
    let result = SchemaChangeResult {
        sql: "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" varchar(255)".to_string(),
    };
    let json = serde_json::to_string(&result).unwrap();
    let deserialized: SchemaChangeResult = serde_json::from_str(&json).unwrap();
    assert_eq!(
        deserialized.sql,
        "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" varchar(255)"
    );
}
