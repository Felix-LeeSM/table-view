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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableData {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_count: i64,
    pub page: i32,
    pub page_size: i32,
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
        };
        let json = serde_json::to_string(&col).unwrap();
        let deserialized: ColumnInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "description");
        assert!(deserialized.nullable);
        assert!(!deserialized.is_primary_key);
        assert!(!deserialized.is_foreign_key);
        assert!(deserialized.default_value.is_none());
        assert!(deserialized.fk_reference.is_none());
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
                },
                ColumnInfo {
                    name: "name".to_string(),
                    data_type: "text".to_string(),
                    nullable: true,
                    default_value: None,
                    is_primary_key: false,
                    is_foreign_key: false,
                    fk_reference: None,
                },
            ],
            rows: vec![
                vec![serde_json::json!(1), serde_json::json!("Alice")],
                vec![serde_json::json!(2), serde_json::json!("Bob")],
            ],
            total_count: 2,
            page: 1,
            page_size: 50,
        };
        let json = serde_json::to_string(&data).unwrap();
        let deserialized: TableData = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.columns.len(), 2);
        assert_eq!(deserialized.rows.len(), 2);
        assert_eq!(deserialized.total_count, 2);
        assert_eq!(deserialized.page, 1);
        assert_eq!(deserialized.page_size, 50);
        // Verify row values roundtrip
        assert_eq!(deserialized.rows[0][0], serde_json::json!(1));
        assert_eq!(deserialized.rows[1][1], serde_json::json!("Bob"));
    }
}
