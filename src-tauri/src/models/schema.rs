use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: String,
    pub row_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub fk_reference: Option<String>,
    pub comment: Option<String>,
    /// CHECK constraint expressions where this column appears in the
    /// constraint's column list. Multiple constraints can target the
    /// same column; each entry is the full `pg_get_constraintdef()`
    /// output (e.g. `"CHECK ((age >= 0))"`). Empty when no CHECK
    /// constraint references the column. `#[serde(default)]` keeps
    /// payloads from older callers (or non-PG adapters that don't
    /// populate the field) deserializing to an empty vector.
    #[serde(default)]
    pub check_clauses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableData {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_count: i64,
    pub page: i32,
    pub page_size: i32,
    pub executed_query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub index_type: String,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: String,
    pub columns: Vec<String>,
    pub reference_table: Option<String>,
    pub reference_columns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FilterOperator {
    Eq,
    Neq,
    Gt,
    Lt,
    Gte,
    Lte,
    Like,
    IsNull,
    IsNotNull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCondition {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<String>,
}

/// Types of column changes supported by ALTER TABLE.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ColumnChange {
    Add {
        name: String,
        data_type: String,
        nullable: bool,
        default_value: Option<String>,
    },
    Modify {
        name: String,
        new_data_type: Option<String>,
        new_nullable: Option<bool>,
        new_default_value: Option<String>,
    },
    Drop {
        name: String,
    },
}

/// Request payload for ALTER TABLE operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterTableRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub changes: Vec<ColumnChange>,
    #[serde(default)]
    pub preview_only: bool,
}

/// Request payload for creating an index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIndexRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub index_name: String,
    pub columns: Vec<String>,
    pub index_type: String,
    #[serde(default)]
    pub is_unique: bool,
    #[serde(default)]
    pub preview_only: bool,
}

/// Request payload for dropping an index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropIndexRequest {
    pub connection_id: String,
    pub schema: String,
    pub index_name: String,
    #[serde(default)]
    pub if_exists: bool,
    #[serde(default)]
    pub preview_only: bool,
}

/// Types of constraints supported by ADD CONSTRAINT.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConstraintDefinition {
    PrimaryKey {
        columns: Vec<String>,
    },
    ForeignKey {
        columns: Vec<String>,
        reference_table: String,
        reference_columns: Vec<String>,
        /// Sprint 229 — referential action on DELETE of the referenced
        /// row. Whitelist (case-sensitive, PG canonical uppercase):
        /// `"NO ACTION"` | `"RESTRICT"` | `"CASCADE"` | `"SET NULL"` |
        /// `"SET DEFAULT"`. `#[serde(default)]` keeps Sprint 226+227+228
        /// callers byte-equivalent — those payloads omit the field, it
        /// deserializes to `None`, and the SQL emitter skips the
        /// `ON DELETE …` clause entirely (PG default = NO ACTION).
        #[serde(default)]
        on_delete: Option<String>,
        /// Sprint 229 — referential action on UPDATE of the referenced
        /// row. Same whitelist + default-omit semantics as `on_delete`.
        #[serde(default)]
        on_update: Option<String>,
    },
    Unique {
        columns: Vec<String>,
    },
    Check {
        expression: String,
    },
}

/// Request payload for adding a constraint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddConstraintRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub constraint_name: String,
    pub definition: ConstraintDefinition,
    #[serde(default)]
    pub preview_only: bool,
}

/// Request payload for dropping a constraint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropConstraintRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub constraint_name: String,
    #[serde(default)]
    pub preview_only: bool,
}

/// Single column definition for `CREATE TABLE` (Sprint 226).
///
/// A new struct rather than reusing `ColumnChange::Add` because Create
/// does not need the `Modify` / `Drop` enum variants and a flat shape
/// keeps the request payload simpler for the `CreateTableDialog`. If
/// `ColumnChange::Add` later diverges (e.g. ALTER-specific defaults),
/// the two stay decoupled.
///
/// Sprint 227 adds optional `comment` (`#[serde(default)]` for
/// back-compat with Sprint 226 callers that omit the field — those
/// payloads deserialize to `None`). When `Some(...)` and the trimmed
/// value is non-empty, the PG `create_table` impl emits a
/// `COMMENT ON COLUMN "<schema>"."<table>"."<col>" IS '<escaped>';`
/// statement inside the same transaction (atomic policy = C,
/// partial-atomic).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
}

/// Request payload for `RENAME TABLE` (Sprint 235).
///
/// Mirrors the Sprint 226 `CreateTableRequest` shape: `connection_id`,
/// `schema`, `table` identify the target; `new_name` is the rename
/// destination; `preview_only` (default `false`) toggles between SQL
/// emission and BEGIN/COMMIT execution. `#[serde(rename_all = "camelCase")]`
/// keeps the wire payload aligned with the rest of the
/// `*Request` family that the frontend's `@lib/tauri` wrappers send.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTableRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub new_name: String,
    #[serde(default)]
    pub preview_only: bool,
}

/// Request payload for `DROP TABLE` (Sprint 235).
///
/// `cascade` is opt-in (default `false` → PG's implicit RESTRICT, byte-
/// equivalent emission omits the `RESTRICT` keyword). `preview_only`
/// (default `false`) is the same preview/execute switch the rest of the
/// Phase 24-26 DDL family already uses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropTableRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    #[serde(default)]
    pub cascade: bool,
    #[serde(default)]
    pub preview_only: bool,
}

/// Request payload for `ADD COLUMN` (Sprint 236).
///
/// Mirrors the Sprint 235 `RenameTableRequest` / `DropTableRequest` shape
/// (camelCase wire form) so the new `AddColumnDialog` can drive a
/// preview/execute lifecycle through `useDdlPreviewExecution`. The
/// `column` field reuses the Sprint 226 `ColumnDefinition` struct
/// verbatim (`name`, `data_type`, `nullable`, `default_value`,
/// optional `comment`) so the Sprint 226 frontend types stay byte-
/// equivalent. `check_expression` is request-level (NOT inside
/// `ColumnDefinition`) so the `CreateTableRequest` payload shape stays
/// diff = 0; when `Some(...)` and the trimmed expression is non-empty,
/// the SQL emitter appends `CHECK (<expr>)` after `DEFAULT` (free-text
/// passthrough — no escaping, no syntax check, mirrors Sprint 229
/// CHECK constraint contract).
///
/// `preview_only` (default `false`) toggles between SQL emission and
/// `BEGIN/COMMIT` execution. `comment` on `ColumnDefinition` is
/// silently ignored by `add_column` this sprint — Sprint 237 polish
/// adds the `COMMENT ON COLUMN` chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddColumnRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub column: ColumnDefinition,
    #[serde(default)]
    pub check_expression: Option<String>,
    #[serde(default)]
    pub preview_only: bool,
}

/// Request payload for `DROP COLUMN` (Sprint 236).
///
/// `cascade` opt-in (default `false` → PG's implicit RESTRICT, byte-
/// equivalent emission omits the `RESTRICT` keyword — mirrors Sprint
/// 235 `DropTableRequest` convention). No pre-existence check on the
/// backend (let PG surface `column "X" does not exist` verbatim).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropColumnRequest {
    pub connection_id: String,
    pub schema: String,
    pub table: String,
    pub column_name: String,
    #[serde(default)]
    pub cascade: bool,
    #[serde(default)]
    pub preview_only: bool,
}

/// Request payload for `CREATE TABLE` (Sprint 226).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTableRequest {
    pub connection_id: String,
    pub schema: String,
    pub name: String,
    pub columns: Vec<ColumnDefinition>,
    #[serde(default)]
    pub primary_key: Option<Vec<String>>,
    #[serde(default)]
    pub preview_only: bool,
    /// Sprint 234 — table-level COMMENT ON TABLE statement, emitted
    /// inside the same `create_table` transaction as the per-column
    /// `COMMENT ON COLUMN` statements (atomic policy = C). When `None`
    /// or `Some(empty-after-trim)`, no statement is emitted (Sprint
    /// 226-233 callers stay byte-equivalent).
    #[serde(default)]
    pub table_comment: Option<String>,
}

/// Result returned by schema change operations.
/// When preview_only is true, `sql` contains the generated SQL.
/// When preview_only is false, `sql` contains the executed SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaChangeResult {
    pub sql: String,
}

/// Sprint 240 — single child index entry inside a `CreateTablePlanRequest`.
///
/// Mirrors `CreateIndexRequest` minus the `connection_id` / `schema` /
/// `table` / `preview_only` fields (those are inherited from the parent
/// plan request — one round-trip per CREATE TABLE workflow). The
/// adapter layer fans this out into a `CreateIndexRequest` per entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTablePlanIndex {
    pub index_name: String,
    pub columns: Vec<String>,
    pub index_type: String,
    #[serde(default)]
    pub is_unique: bool,
}

/// Sprint 240 — single child constraint entry inside a
/// `CreateTablePlanRequest`. Mirrors `AddConstraintRequest` minus the
/// connection / schema / table / preview-flag fields. The adapter layer
/// fans this out into an `AddConstraintRequest` per entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTablePlanConstraint {
    pub constraint_name: String,
    pub definition: ConstraintDefinition,
}

/// Sprint 240 — unified `CREATE TABLE + indexes + constraints` request.
///
/// Architecture intent (per user feedback in Sprint 240): the SQL
/// preview the user sees should come from the same server-side emitter
/// that ultimately executes. Pre-Sprint-240 the `CreateTableDialog`
/// fanned out N+1 round-trips during preview (1 `create_table` +
/// N `create_index` + M `add_constraint`); Sprint 240 collapses this
/// to a single `create_table_plan` IPC.
///
/// Atomic policy = C (partial-atomic) — the parent CREATE TABLE
/// statement runs inside its own transaction (with COMMENTs); each
/// child index / constraint runs in its own transaction. This matches
/// the per-call behaviour the dialog had before, just over one round
/// trip instead of N+1.
///
/// `preview_only` (default `false`) toggles between SQL emission and
/// execution. In preview mode the adapter joins each child's emitted
/// SQL with `;\n` so the frontend can render the full plan in one
/// pane. `#[serde(rename_all = "camelCase")]` keeps the wire form
/// aligned with the rest of the Sprint 235+ `*Request` family.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTablePlanRequest {
    pub connection_id: String,
    pub schema: String,
    pub name: String,
    pub columns: Vec<ColumnDefinition>,
    #[serde(default)]
    pub primary_key: Option<Vec<String>>,
    #[serde(default)]
    pub table_comment: Option<String>,
    #[serde(default)]
    pub indexes: Vec<CreateTablePlanIndex>,
    #[serde(default)]
    pub constraints: Vec<CreateTablePlanConstraint>,
    #[serde(default)]
    pub preview_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewInfo {
    pub name: String,
    pub schema: String,
    pub definition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionInfo {
    pub name: String,
    pub schema: String,
    pub arguments: Option<String>,
    pub return_type: Option<String>,
    pub language: Option<String>,
    pub source: Option<String>,
    pub kind: String, // "function", "procedure", "aggregate", "window"
}

/// Sprint 230 — single Postgres type entry returned by
/// `list_postgres_types(connection_id)`. Sourced from
/// `pg_catalog.pg_type` joined with `pg_catalog.pg_namespace`.
///
/// The `type_kind` field maps the PG `pg_type.typtype` column through a
/// closed whitelist:
///   `'b'` → `"base"`     (built-in scalar / extension types)
///   `'d'` → `"domain"`   (`CREATE DOMAIN`)
///   `'e'` → `"enum"`     (`CREATE TYPE … AS ENUM`)
///   `'r'` → `"range"`    (`CREATE TYPE … AS RANGE`)
///   `'c'` → `"composite"` (`CREATE TYPE … AS (…)`; auto row types
///                          are excluded by the SQL filter)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostgresTypeInfo {
    pub schema: String,
    pub name: String,
    pub type_kind: String,
}

#[cfg(test)]
mod tests {
    use super::*;
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
        };
        let json = serde_json::to_string(&change).unwrap();
        let deserialized: ColumnChange = serde_json::from_str(&json).unwrap();
        match deserialized {
            ColumnChange::Modify {
                name,
                new_data_type,
                new_nullable,
                new_default_value,
            } => {
                assert_eq!(name, "age");
                assert_eq!(new_data_type, Some("bigint".to_string()));
                assert_eq!(new_nullable, Some(true));
                assert_eq!(new_default_value, Some("0".to_string()));
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
            if_exists: true,
            preview_only: false,
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

    #[test]
    fn view_info_serde_roundtrip() {
        let info = ViewInfo {
            name: "active_users".to_string(),
            schema: "public".to_string(),
            definition: Some("SELECT * FROM users WHERE active = true".to_string()),
        };
        let json = serde_json::to_string(&info).unwrap();
        let deserialized: ViewInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "active_users");
        assert_eq!(deserialized.schema, "public");
        assert_eq!(
            deserialized.definition,
            Some("SELECT * FROM users WHERE active = true".to_string())
        );

        let info_no_def = ViewInfo {
            name: "simple_view".to_string(),
            schema: "public".to_string(),
            definition: None,
        };
        let json_no_def = serde_json::to_string(&info_no_def).unwrap();
        let deserialized_no_def: ViewInfo = serde_json::from_str(&json_no_def).unwrap();
        assert_eq!(deserialized_no_def.definition, None);
    }

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
            }],
            primary_key: None,
            preview_only: true,
            table_comment: Some("user accounts".to_string()),
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
            },
            check_expression: Some("email LIKE '%@%'".to_string()),
            preview_only: true,
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

    #[test]
    fn function_info_serde_roundtrip() {
        let info = FunctionInfo {
            name: "calculate_total".to_string(),
            schema: "public".to_string(),
            arguments: Some("user_id integer".to_string()),
            return_type: Some("numeric".to_string()),
            language: Some("plpgsql".to_string()),
            source: Some("BEGIN RETURN 0; END".to_string()),
            kind: "function".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        let deserialized: FunctionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "calculate_total");
        assert_eq!(deserialized.kind, "function");
        assert_eq!(deserialized.arguments, Some("user_id integer".to_string()));
        assert_eq!(deserialized.return_type, Some("numeric".to_string()));
        assert_eq!(deserialized.language, Some("plpgsql".to_string()));
        assert_eq!(deserialized.source, Some("BEGIN RETURN 0; END".to_string()));

        let info_minimal = FunctionInfo {
            name: "do_something".to_string(),
            schema: "public".to_string(),
            arguments: None,
            return_type: None,
            language: None,
            source: None,
            kind: "procedure".to_string(),
        };
        let json_minimal = serde_json::to_string(&info_minimal).unwrap();
        let deserialized_minimal: FunctionInfo = serde_json::from_str(&json_minimal).unwrap();
        assert_eq!(deserialized_minimal.kind, "procedure");
        assert!(deserialized_minimal.arguments.is_none());
        assert!(deserialized_minimal.return_type.is_none());
    }
}
