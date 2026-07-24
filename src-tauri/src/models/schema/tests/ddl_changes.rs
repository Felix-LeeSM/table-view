//! Purpose: DDL request/enum serde **wire contract** lock — 이슈 #1625
//! (2026-07-24). 이전 13개 테스트는 `to_string → from_str` 왕복만 재단언해
//! 실제 JSON wire(키/tag)를 검증하지 않았다 (testing-scenarios P9 —
//! serde derive roundtrip 은 라이브러리 재검증). 여기서는 `to_value` 결과를
//! 기대 `json!` Value 와 **완전 일치**로 lock 해, 향후 `rename_all` 추가·필드
//! 이름 변경·enum tag 변경이 조용히 wire 를 깨면 fail 하도록 강화한다.
//!
//! Wire 형식 note: `ColumnChange` / `ConstraintDefinition` 은
//! `#[serde(tag = "type", rename_all = "snake_case")]`, 나머지 request
//! 구조체는 `rename_all` 없음 → 필드가 Rust snake_case 그대로 나간다. (이
//! surface 는 camelCase 가 아니다.) `#[serde(default)]` 필드도
//! `skip_serializing_if` 가 없어 항상 직렬화되므로 wire 에 null 로 등장한다.

use super::super::*;
use serde_json::json;

/// `$value` 를 직렬화해 정확한 JSON wire 를 `$wire` 와 Value 동치로 단언한 뒤
/// 역직렬화까지 확인. Value 동치가 모든 키/tag 를 고정하므로 예전 왕복-only
/// 테스트가 놓친 rename/tag 회귀를 잡는다.
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
        },
        json!({
            "type": "modify",
            "name": "age",
            "new_data_type": "bigint",
            "new_nullable": true,
            "new_default_value": "0",
            "using_expression": null,
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

/// Sprint 237 back-compat — `using_expression = Some` 는 snake_case 키로
/// 직렬화되고, 그 필드를 생략한 pre-Sprint-237 payload 는 `#[serde(default)]`
/// 로 `None` 이 된다. 이 cross-version deserialize 분기는 위 table 의 subset
/// 이 아니라 별도 계약이므로 명시 유지 (issue #1625 요구).
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
        },
        json!({
            "type": "modify",
            "name": "age",
            "new_data_type": "int",
            "new_nullable": null,
            "new_default_value": null,
            "using_expression": "age::int",
        }),
    );

    // 필드 생략 legacy payload → None.
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

    // Sprint 229 back-compat — on_delete/on_update 를 생략한 pre-229 payload 는
    // `#[serde(default)]` 로 None 이 된다 (별도 deserialize 분기).
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
