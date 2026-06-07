use std::collections::{BTreeMap, HashMap, HashSet};

use crate::models::{ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, TableInfo, ViewInfo};

use super::decode::map_mssql_data_type;

#[derive(Debug, Clone)]
pub(super) struct MssqlTableCatalogRow {
    pub(super) name: String,
    pub(super) row_count: Option<i64>,
}

#[derive(Debug, Clone)]
pub(super) struct MssqlColumnCatalogRow {
    pub(super) name: String,
    pub(super) data_type: String,
    pub(super) data_type_base: String,
    pub(super) nullable: bool,
    pub(super) default_value: Option<String>,
    pub(super) comment: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct MssqlSchemaColumnCatalogRow {
    pub(super) table_name: String,
    pub(super) column: MssqlColumnCatalogRow,
}

#[derive(Debug, Clone)]
pub(super) struct MssqlIndexCatalogRow {
    pub(super) name: String,
    pub(super) column: String,
    pub(super) index_type: String,
    pub(super) is_unique: bool,
    pub(super) is_primary: bool,
}

#[derive(Debug, Clone)]
pub(super) struct MssqlConstraintCatalogRow {
    pub(super) name: String,
    pub(super) constraint_type: String,
    pub(super) column: Option<String>,
    pub(super) reference_table: Option<String>,
    pub(super) reference_column: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct MssqlViewCatalogRow {
    pub(super) name: String,
    pub(super) definition: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct MssqlRoutineCatalogRow {
    pub(super) name: String,
    pub(super) kind: String,
    pub(super) return_type: Option<String>,
    pub(super) source: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct MssqlRoutineParamCatalogRow {
    pub(super) routine_name: String,
    pub(super) parameter_name: String,
    pub(super) data_type: String,
    pub(super) is_output: bool,
}

pub(super) fn build_tables(schema: &str, rows: Vec<MssqlTableCatalogRow>) -> Vec<TableInfo> {
    rows.into_iter()
        .map(|row| TableInfo {
            name: row.name,
            schema: schema.to_string(),
            row_count: row.row_count,
        })
        .collect()
}

pub(super) fn build_object_columns(
    rows: Vec<MssqlColumnCatalogRow>,
    pk_columns: &HashSet<String>,
    fk_map: &HashMap<String, String>,
    check_map: &HashMap<String, Vec<String>>,
) -> Vec<ColumnInfo> {
    rows.into_iter()
        .map(|row| {
            let fk_reference = fk_map.get(&row.name).cloned();
            let check_clauses = check_map.get(&row.name).cloned().unwrap_or_default();
            build_column_info(
                row.clone(),
                pk_columns.contains(&row.name),
                fk_reference,
                check_clauses,
            )
        })
        .collect()
}

pub(super) fn build_schema_columns(
    rows: Vec<MssqlSchemaColumnCatalogRow>,
    pk_set: &HashSet<(String, String)>,
    fk_map: &HashMap<(String, String), String>,
    check_map: &HashMap<(String, String), Vec<String>>,
) -> HashMap<String, Vec<ColumnInfo>> {
    let mut result: HashMap<String, Vec<ColumnInfo>> = HashMap::new();
    for row in rows {
        let key = (row.table_name.clone(), row.column.name.clone());
        let fk_reference = fk_map.get(&key).cloned();
        let check_clauses = check_map.get(&key).cloned().unwrap_or_default();
        let column = build_column_info(
            row.column,
            pk_set.contains(&key),
            fk_reference,
            check_clauses,
        );
        result.entry(row.table_name).or_default().push(column);
    }
    result
}

fn build_column_info(
    row: MssqlColumnCatalogRow,
    is_primary_key: bool,
    fk_reference: Option<String>,
    check_clauses: Vec<String>,
) -> ColumnInfo {
    ColumnInfo {
        name: row.name,
        data_type: row.data_type,
        nullable: row.nullable,
        default_value: row.default_value,
        is_primary_key,
        is_foreign_key: fk_reference.is_some(),
        fk_reference,
        comment: row.comment,
        check_clauses,
        category: map_mssql_data_type(&row.data_type_base),
    }
}

pub(super) fn build_indexes(rows: Vec<MssqlIndexCatalogRow>) -> Vec<IndexInfo> {
    let mut map: BTreeMap<String, (bool, bool, String, Vec<String>)> = BTreeMap::new();
    for row in rows {
        let entry = map.entry(row.name).or_insert((
            row.is_unique,
            row.is_primary,
            row.index_type.to_ascii_lowercase(),
            Vec::new(),
        ));
        if !entry.3.contains(&row.column) {
            entry.3.push(row.column);
        }
    }

    map.into_iter()
        .map(
            |(name, (is_unique, is_primary, index_type, columns))| IndexInfo {
                name,
                columns,
                index_type,
                is_unique,
                is_primary,
            },
        )
        .collect()
}

pub(super) fn build_constraints(rows: Vec<MssqlConstraintCatalogRow>) -> Vec<ConstraintInfo> {
    type ConstraintAccum = (String, Vec<String>, Option<String>, Vec<String>);
    let mut map: BTreeMap<String, ConstraintAccum> = BTreeMap::new();
    for row in rows {
        let entry = map.entry(row.name).or_insert((
            row.constraint_type,
            Vec::new(),
            row.reference_table,
            Vec::new(),
        ));
        if let Some(column) = row.column {
            if !entry.1.contains(&column) {
                entry.1.push(column);
            }
        }
        if let Some(reference_column) = row.reference_column {
            if !entry.3.contains(&reference_column) {
                entry.3.push(reference_column);
            }
        }
    }

    map.into_iter()
        .map(
            |(name, (constraint_type, columns, reference_table, ref_cols))| ConstraintInfo {
                name,
                constraint_type,
                columns,
                reference_table,
                reference_columns: if ref_cols.is_empty() {
                    None
                } else {
                    Some(ref_cols)
                },
            },
        )
        .collect()
}

pub(super) fn build_views(schema: &str, rows: Vec<MssqlViewCatalogRow>) -> Vec<ViewInfo> {
    rows.into_iter()
        .map(|row| ViewInfo {
            name: row.name,
            schema: schema.to_string(),
            definition: row.definition,
        })
        .collect()
}

pub(super) fn build_functions(
    schema: &str,
    rows: Vec<MssqlRoutineCatalogRow>,
    param_rows: Vec<MssqlRoutineParamCatalogRow>,
) -> Vec<FunctionInfo> {
    let mut args: HashMap<String, Vec<String>> = HashMap::new();
    for row in param_rows {
        let suffix = if row.is_output { " OUTPUT" } else { "" };
        args.entry(row.routine_name).or_default().push(format!(
            "{} {}{}",
            row.parameter_name, row.data_type, suffix
        ));
    }

    rows.into_iter()
        .map(|row| FunctionInfo {
            name: row.name.clone(),
            schema: schema.to_string(),
            arguments: args.remove(&row.name).map(|parts| parts.join(", ")),
            return_type: row.return_type,
            language: Some("T-SQL".into()),
            source: row.source,
            kind: row.kind,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ColumnCategory;

    fn column(name: &str, data_type: &str, base: &str) -> MssqlColumnCatalogRow {
        MssqlColumnCatalogRow {
            name: name.into(),
            data_type: data_type.into(),
            data_type_base: base.into(),
            nullable: true,
            default_value: None,
            comment: None,
        }
    }

    #[test]
    fn build_tables_and_views_attach_schema_without_widening_claims() {
        let tables = build_tables(
            "dbo",
            vec![
                MssqlTableCatalogRow {
                    name: "users".into(),
                    row_count: Some(2),
                },
                MssqlTableCatalogRow {
                    name: "empty".into(),
                    row_count: None,
                },
            ],
        );
        assert_eq!(tables[0].schema, "dbo");
        assert_eq!(tables[0].row_count, Some(2));
        assert_eq!(tables[1].row_count, None);

        let views = build_views(
            "reporting",
            vec![MssqlViewCatalogRow {
                name: "active_users".into(),
                definition: Some("SELECT id FROM dbo.users".into()),
            }],
        );
        assert_eq!(views[0].schema, "reporting");
        assert_eq!(
            views[0].definition.as_deref(),
            Some("SELECT id FROM dbo.users")
        );
    }

    #[test]
    fn build_object_columns_marks_pk_fk_checks_and_display_categories() {
        let mut pk_columns = HashSet::new();
        pk_columns.insert("id".to_string());
        let mut fk_map = HashMap::new();
        fk_map.insert("account_id".to_string(), "dbo.accounts(id)".to_string());
        let mut check_map = HashMap::new();
        check_map.insert(
            "id".to_string(),
            vec![
                "CHECK ([id] > 0)".to_string(),
                "CHECK ([id] < 1000)".to_string(),
            ],
        );

        let columns = build_object_columns(
            vec![
                MssqlColumnCatalogRow {
                    nullable: false,
                    default_value: Some("((1))".into()),
                    comment: Some("identity".into()),
                    ..column("id", "int", "int")
                },
                column("account_id", "uniqueidentifier", "uniqueidentifier"),
                column("payload", "xml", "xml"),
            ],
            &pk_columns,
            &fk_map,
            &check_map,
        );

        assert!(columns[0].is_primary_key);
        assert!(!columns[0].nullable);
        assert_eq!(columns[0].category, ColumnCategory::Int);
        assert_eq!(columns[0].check_clauses.len(), 2);
        assert_eq!(columns[0].default_value.as_deref(), Some("((1))"));
        assert_eq!(columns[0].comment.as_deref(), Some("identity"));
        assert!(columns[1].is_foreign_key);
        assert_eq!(columns[1].fk_reference.as_deref(), Some("dbo.accounts(id)"));
        assert_eq!(columns[1].category, ColumnCategory::Uuid);
        assert_eq!(columns[2].category, ColumnCategory::Object);
    }

    #[test]
    fn build_schema_columns_groups_tables_and_applies_metadata_by_tuple_key() {
        let rows = vec![
            MssqlSchemaColumnCatalogRow {
                table_name: "orders".into(),
                column: column("id", "bigint", "bigint"),
            },
            MssqlSchemaColumnCatalogRow {
                table_name: "orders".into(),
                column: column("user_id", "int", "int"),
            },
            MssqlSchemaColumnCatalogRow {
                table_name: "events".into(),
                column: column("created_at", "datetime2", "datetime2"),
            },
        ];
        let pk_set = [("orders".to_string(), "id".to_string())]
            .into_iter()
            .collect();
        let fk_map = [(
            ("orders".to_string(), "user_id".to_string()),
            "dbo.users(id)".to_string(),
        )]
        .into_iter()
        .collect();
        let check_map = [(
            ("events".to_string(), "created_at".to_string()),
            vec!["CHECK ([created_at] IS NOT NULL)".to_string()],
        )]
        .into_iter()
        .collect();

        let columns = build_schema_columns(rows, &pk_set, &fk_map, &check_map);

        let order_columns = columns.get("orders").expect("orders columns");
        assert_eq!(order_columns.len(), 2);
        assert!(order_columns[0].is_primary_key);
        assert_eq!(
            order_columns[1].fk_reference.as_deref(),
            Some("dbo.users(id)")
        );
        let event_columns = columns.get("events").expect("events columns");
        assert_eq!(event_columns[0].category, ColumnCategory::Datetime);
        assert_eq!(event_columns[0].check_clauses.len(), 1);
    }

    #[test]
    fn build_indexes_deduplicates_columns_and_preserves_first_metadata() {
        let indexes = build_indexes(vec![
            MssqlIndexCatalogRow {
                name: "idx_users_email".into(),
                column: "email".into(),
                index_type: "NONCLUSTERED".into(),
                is_unique: true,
                is_primary: false,
            },
            MssqlIndexCatalogRow {
                name: "idx_users_email".into(),
                column: "email".into(),
                index_type: "NONCLUSTERED".into(),
                is_unique: true,
                is_primary: false,
            },
            MssqlIndexCatalogRow {
                name: "pk_users".into(),
                column: "id".into(),
                index_type: "CLUSTERED".into(),
                is_unique: true,
                is_primary: true,
            },
            MssqlIndexCatalogRow {
                name: "pk_users".into(),
                column: "tenant_id".into(),
                index_type: "CLUSTERED".into(),
                is_unique: true,
                is_primary: true,
            },
        ]);

        assert_eq!(indexes[0].name, "idx_users_email");
        assert_eq!(indexes[0].columns, vec!["email"]);
        assert_eq!(indexes[0].index_type, "nonclustered");
        assert!(indexes[0].is_unique);
        assert!(!indexes[0].is_primary);
        assert_eq!(indexes[1].name, "pk_users");
        assert_eq!(indexes[1].columns, vec!["id", "tenant_id"]);
        assert_eq!(indexes[1].index_type, "clustered");
        assert!(indexes[1].is_primary);
    }

    #[test]
    fn build_constraints_groups_fk_columns_and_keeps_check_without_reference() {
        let constraints = build_constraints(vec![
            MssqlConstraintCatalogRow {
                name: "fk_orders_users".into(),
                constraint_type: "FOREIGN KEY".into(),
                column: Some("user_id".into()),
                reference_table: Some("dbo.users".into()),
                reference_column: Some("id".into()),
            },
            MssqlConstraintCatalogRow {
                name: "fk_orders_users".into(),
                constraint_type: "FOREIGN KEY".into(),
                column: Some("tenant_id".into()),
                reference_table: Some("dbo.users".into()),
                reference_column: Some("tenant_id".into()),
            },
            MssqlConstraintCatalogRow {
                name: "fk_orders_users".into(),
                constraint_type: "FOREIGN KEY".into(),
                column: Some("tenant_id".into()),
                reference_table: Some("dbo.users".into()),
                reference_column: Some("tenant_id".into()),
            },
            MssqlConstraintCatalogRow {
                name: "ck_orders_total".into(),
                constraint_type: "CHECK".into(),
                column: Some("total".into()),
                reference_table: None,
                reference_column: None,
            },
            MssqlConstraintCatalogRow {
                name: "uq_orders_external_id".into(),
                constraint_type: "UNIQUE".into(),
                column: None,
                reference_table: None,
                reference_column: None,
            },
        ]);

        assert_eq!(constraints[0].name, "ck_orders_total");
        assert_eq!(constraints[0].columns, vec!["total"]);
        assert_eq!(constraints[0].reference_columns, None);
        assert_eq!(constraints[1].columns, vec!["user_id", "tenant_id"]);
        assert_eq!(constraints[1].reference_table.as_deref(), Some("dbo.users"));
        assert_eq!(
            constraints[1].reference_columns.as_ref().expect("ref cols"),
            &vec!["id".to_string(), "tenant_id".to_string()]
        );
        assert_eq!(constraints[2].name, "uq_orders_external_id");
        assert!(constraints[2].columns.is_empty());
        assert_eq!(constraints[2].reference_columns, None);
    }

    #[test]
    fn build_functions_formats_parameters_and_tsql_source_metadata() {
        let routines = build_functions(
            "dbo",
            vec![
                MssqlRoutineCatalogRow {
                    name: "touch_user".into(),
                    kind: "procedure".into(),
                    return_type: None,
                    source: Some("CREATE PROC dbo.touch_user AS SELECT 1".into()),
                },
                MssqlRoutineCatalogRow {
                    name: "score_user".into(),
                    kind: "function".into(),
                    return_type: Some("int".into()),
                    source: None,
                },
            ],
            vec![
                MssqlRoutineParamCatalogRow {
                    routine_name: "touch_user".into(),
                    parameter_name: "@id".into(),
                    data_type: "int".into(),
                    is_output: false,
                },
                MssqlRoutineParamCatalogRow {
                    routine_name: "touch_user".into(),
                    parameter_name: "@status".into(),
                    data_type: "nvarchar(20)".into(),
                    is_output: true,
                },
            ],
        );

        assert_eq!(routines[0].schema, "dbo");
        assert_eq!(routines[0].language.as_deref(), Some("T-SQL"));
        assert_eq!(
            routines[0].arguments.as_deref(),
            Some("@id int, @status nvarchar(20) OUTPUT")
        );
        assert_eq!(
            routines[0].source.as_deref(),
            Some("CREATE PROC dbo.touch_user AS SELECT 1")
        );
        assert_eq!(routines[1].return_type.as_deref(), Some("int"));
        assert_eq!(routines[1].arguments, None);
    }
}
