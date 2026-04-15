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

/// Result returned by schema change operations.
/// When preview_only is true, `sql` contains the generated SQL.
/// When preview_only is false, `sql` contains the executed SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaChangeResult {
    pub sql: String,
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
        let def = ConstraintDefinition::ForeignKey {
            columns: vec!["user_id".to_string()],
            reference_table: "users".to_string(),
            reference_columns: vec!["id".to_string()],
        };
        let json = serde_json::to_string(&def).unwrap();
        let deserialized: ConstraintDefinition = serde_json::from_str(&json).unwrap();
        match deserialized {
            ConstraintDefinition::ForeignKey {
                columns,
                reference_table,
                reference_columns,
            } => {
                assert_eq!(columns, vec!["user_id".to_string()]);
                assert_eq!(reference_table, "users");
                assert_eq!(reference_columns, vec!["id".to_string()]);
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
