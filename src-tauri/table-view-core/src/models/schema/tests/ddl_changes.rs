//! Purpose: DDL request/enum serde **wire contract** lock — issue #1625
//! (2026-07-24). The earlier tests only re-asserted the `to_string → from_str`
//! round trip and never checked the real JSON wire (keys / tag)
//! (testing-scenarios P9 — a serde derive round trip only re-verifies the
//! library). Here the `to_value` result is locked to **exact equality** with
//! the expected `json!` Value, so a later `rename_all`, a field rename, or an
//! enum tag change that silently breaks the wire makes the test fail.
//!
//! Wire format note: `ColumnChange` / `ConstraintDefinition` carry
//! `#[serde(tag = "type", rename_all = "snake_case")]`; the other request
//! structs have no `rename_all`, so their fields go out as Rust snake_case.
//! (This surface is not camelCase.) A `#[serde(default)]` field has no
//! `skip_serializing_if` either, so it is always serialized and shows up on the
//! wire as null.

use super::super::*;
use serde_json::json;

/// Serializes `$value`, asserts the exact JSON wire is Value-equal to `$wire`,
/// then checks deserialization too. Value equality pins every key and tag, so it
/// catches the rename / tag regressions the old round-trip-only tests missed.
macro_rules! assert_wire {
    ($ty:ty, $value:expr, $wire:expr $(,)?) => {{
        let value: $ty = $value;
        let got = serde_json::to_value(&value).expect("serialize");
        assert_eq!(got, $wire, "wire mismatch for {}", stringify!($ty));
        let _back: $ty = serde_json::from_value(got).expect("deserialize");
    }};
}

#[test]
fn column_change_wire_and_roundtrip() {
    assert_wire!(
        ColumnChange,
        ColumnChange::Add {
            name: "email".to_string(),
            data_type: "varchar(255)".to_string(),
            nullable: false,
            default_value: None,
        },
        json!({
            "type": "add",
            "name": "email",
            "data_type": "varchar(255)",
            "nullable": false,
            "default_value": null,
        }),
    );
    assert_wire!(
        ColumnChange,
        ColumnChange::Modify {
            name: "age".to_string(),
            new_data_type: Some("bigint".to_string()),
            new_nullable: Some(true),
            new_default_value: Some("0".to_string()),
            using_expression: None,
            new_comment: None,
        },
        json!({
            "type": "modify",
            "name": "age",
            "new_data_type": "bigint",
            "new_nullable": true,
            "new_default_value": "0",
            "using_expression": null,
            "new_comment": null,
        }),
    );
    assert_wire!(
        ColumnChange,
        ColumnChange::Drop {
            name: "legacy_field".to_string(),
        },
        json!({ "type": "drop", "name": "legacy_field" }),
    );
}

/// Back-compat — `using_expression = Some` serializes under its snake_case key,
/// and an older payload that omits the field becomes `None` via
/// `#[serde(default)]`. This cross-version deserialize branch is a separate
/// contract, not a subset of the table above, so it stays explicit (required by
/// issue #1625).
#[test]
fn column_change_modify_using_expression_wire_and_backcompat() {
    assert_wire!(
        ColumnChange,
        ColumnChange::Modify {
            name: "age".to_string(),
            new_data_type: Some("int".to_string()),
            new_nullable: None,
            new_default_value: None,
            using_expression: Some("age::int".to_string()),
            new_comment: None,
        },
        json!({
            "type": "modify",
            "name": "age",
            "new_data_type": "int",
            "new_nullable": null,
            "new_default_value": null,
            "using_expression": "age::int",
            "new_comment": null,
        }),
    );

    // Legacy payload with the field omitted → None.
    let legacy = json!({
        "type": "modify",
        "name": "age",
        "new_data_type": "bigint",
        "new_nullable": null,
        "new_default_value": null,
    });
    match serde_json::from_value(legacy).expect("deserialize legacy") {
        ColumnChange::Modify {
            using_expression, ..
        } => assert!(using_expression.is_none()),
        _ => panic!("Expected ColumnChange::Modify"),
    }
}

/// #1735 — `new_comment` wire lock: `Some(text)` serializes under the
/// snake_case `new_comment` key, and a payload omitting the field (pre-#1735
/// caller) deserializes to `None` via `#[serde(default)]` (2026-07-25).
#[test]
fn column_change_modify_new_comment_wire_and_backcompat() {
    assert_wire!(
        ColumnChange,
        ColumnChange::Modify {
            name: "email".to_string(),
            new_data_type: None,
            new_nullable: None,
            new_default_value: None,
            using_expression: None,
            new_comment: Some("primary contact".to_string()),
        },
        json!({
            "type": "modify",
            "name": "email",
            "new_data_type": null,
            "new_nullable": null,
            "new_default_value": null,
            "using_expression": null,
            "new_comment": "primary contact",
        }),
    );

    // Legacy payload with the field omitted → None (comment unchanged).
    let legacy = json!({
        "type": "modify",
        "name": "email",
        "new_data_type": null,
        "new_nullable": null,
        "new_default_value": null,
    });
    match serde_json::from_value(legacy).expect("deserialize legacy") {
        ColumnChange::Modify { new_comment, .. } => assert!(new_comment.is_none()),
        _ => panic!("Expected ColumnChange::Modify"),
    }
}

#[test]
fn constraint_definition_wire_and_roundtrip() {
    assert_wire!(
        ConstraintDefinition,
        ConstraintDefinition::PrimaryKey {
            columns: vec!["id".to_string()],
        },
        json!({ "type": "primary_key", "columns": ["id"] }),
    );
    assert_wire!(
        ConstraintDefinition,
        ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".to_string()],
            reference_table: "users".to_string(),
            reference_columns: vec!["id".to_string()],
            on_delete: None,
            on_update: None,
        },
        json!({
            "type": "foreign_key",
            "columns": ["user_id"],
            "reference_table": "users",
            "reference_columns": ["id"],
            "on_delete": null,
            "on_update": null,
        }),
    );
    assert_wire!(
        ConstraintDefinition,
        ConstraintDefinition::Unique {
            columns: vec!["email".to_string()],
        },
        json!({ "type": "unique", "columns": ["email"] }),
    );
    assert_wire!(
        ConstraintDefinition,
        ConstraintDefinition::Check {
            expression: "age > 0".to_string(),
        },
        json!({ "type": "check", "expression": "age > 0" }),
    );

    // Back-compat — an older payload that omits on_delete/on_update becomes
    // None via `#[serde(default)]` (a separate deserialize branch).
    let legacy = json!({
        "type": "foreign_key",
        "columns": ["user_id"],
        "reference_table": "users",
        "reference_columns": ["id"],
    });
    match serde_json::from_value(legacy).expect("deserialize legacy FK") {
        ConstraintDefinition::ForeignKey {
            on_delete,
            on_update,
            ..
        } => {
            assert!(on_delete.is_none());
            assert!(on_update.is_none());
        }
        _ => panic!("Expected ForeignKey"),
    }
}

#[test]
fn request_structs_wire_and_roundtrip() {
    assert_wire!(
        AlterTableRequest,
        AlterTableRequest {
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
        },
        json!({
            "connection_id": "conn1",
            "schema": "public",
            "table": "users",
            "changes": [
                {
                    "type": "add",
                    "name": "created_at",
                    "data_type": "timestamp",
                    "nullable": true,
                    "default_value": "now()",
                },
                { "type": "drop", "name": "old_column" },
            ],
            "preview_only": true,
            "expected_database": null,
        }),
    );
    assert_wire!(
        CreateIndexRequest,
        CreateIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            index_name: "idx_users_email".to_string(),
            columns: vec!["email".to_string()],
            index_type: "btree".to_string(),
            is_unique: true,
            preview_only: false,
            expected_database: None,
        },
        json!({
            "connection_id": "conn1",
            "schema": "public",
            "table": "users",
            "index_name": "idx_users_email",
            "columns": ["email"],
            "index_type": "btree",
            "is_unique": true,
            "preview_only": false,
            "expected_database": null,
        }),
    );
    assert_wire!(
        DropIndexRequest,
        DropIndexRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            index_name: "idx_users_email".to_string(),
            table: String::new(),
            if_exists: true,
            preview_only: false,
            expected_database: None,
        },
        json!({
            "connection_id": "conn1",
            "schema": "public",
            "index_name": "idx_users_email",
            "table": "",
            "if_exists": true,
            "preview_only": false,
            "expected_database": null,
        }),
    );
    assert_wire!(
        AddConstraintRequest,
        AddConstraintRequest {
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
        },
        json!({
            "connection_id": "conn1",
            "schema": "public",
            "table": "orders",
            "constraint_name": "fk_user",
            "definition": {
                "type": "foreign_key",
                "columns": ["user_id"],
                "reference_table": "users",
                "reference_columns": ["id"],
                "on_delete": null,
                "on_update": null,
            },
            "preview_only": true,
            "expected_database": null,
        }),
    );
    assert_wire!(
        DropConstraintRequest,
        DropConstraintRequest {
            connection_id: "conn1".to_string(),
            schema: "public".to_string(),
            table: "orders".to_string(),
            constraint_name: "fk_user".to_string(),
            preview_only: false,
            expected_database: None,
        },
        json!({
            "connection_id": "conn1",
            "schema": "public",
            "table": "orders",
            "constraint_name": "fk_user",
            "preview_only": false,
            "expected_database": null,
        }),
    );
    assert_wire!(
        SchemaChangeResult,
        SchemaChangeResult {
            sql: "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" varchar(255)".to_string(),
        },
        json!({
            "sql": "ALTER TABLE \"public\".\"users\" ADD COLUMN \"email\" varchar(255)",
        }),
    );
}
