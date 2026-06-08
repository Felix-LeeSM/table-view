use std::collections::{BTreeMap, HashMap, HashSet};

use crate::models::{ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, TableInfo, ViewInfo};

use super::decode::map_oracle_data_type;

#[derive(Debug, Clone)]
pub(super) struct OracleTableCatalogRow {
    pub(super) name: String,
    pub(super) row_count: Option<i64>,
}

#[derive(Debug, Clone)]
pub(super) struct OracleColumnCatalogRow {
    pub(super) name: String,
    pub(super) data_type: String,
    pub(super) data_type_base: String,
    pub(super) nullable: bool,
    pub(super) default_value: Option<String>,
    pub(super) comment: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct OracleSchemaColumnCatalogRow {
    pub(super) table_name: String,
    pub(super) column: OracleColumnCatalogRow,
}

#[derive(Debug, Clone)]
pub(super) struct OracleIndexCatalogRow {
    pub(super) name: String,
    pub(super) column: String,
    pub(super) index_type: String,
    pub(super) is_unique: bool,
    pub(super) is_primary: bool,
}

#[derive(Debug, Clone)]
pub(super) struct OracleConstraintCatalogRow {
    pub(super) name: String,
    pub(super) constraint_type: String,
    pub(super) column: Option<String>,
    pub(super) reference_table: Option<String>,
    pub(super) reference_column: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct OracleViewCatalogRow {
    pub(super) name: String,
    pub(super) definition: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct OracleRoutineCatalogRow {
    pub(super) name: String,
    pub(super) kind: String,
    pub(super) return_type: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct OracleRoutineParamCatalogRow {
    pub(super) routine_name: String,
    pub(super) parameter_name: Option<String>,
    pub(super) data_type: String,
    pub(super) direction: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct OracleSequenceCatalogRow {
    pub(super) name: String,
    pub(super) min_value: Option<String>,
    pub(super) max_value: Option<String>,
    pub(super) increment_by: Option<String>,
    pub(super) cycle: bool,
    pub(super) ordered: bool,
    pub(super) cache_size: Option<String>,
    pub(super) last_number: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct OracleSynonymCatalogRow {
    pub(super) name: String,
    pub(super) target_owner: Option<String>,
    pub(super) target_name: Option<String>,
    pub(super) db_link: Option<String>,
}

pub(super) fn build_tables(schema: &str, rows: Vec<OracleTableCatalogRow>) -> Vec<TableInfo> {
    rows.into_iter()
        .map(|row| TableInfo {
            name: row.name,
            schema: schema.to_string(),
            row_count: row.row_count,
        })
        .collect()
}

pub(super) fn build_object_columns(
    rows: Vec<OracleColumnCatalogRow>,
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
    rows: Vec<OracleSchemaColumnCatalogRow>,
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
    row: OracleColumnCatalogRow,
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
        category: map_oracle_data_type(&row.data_type_base),
    }
}

pub(super) fn build_indexes(rows: Vec<OracleIndexCatalogRow>) -> Vec<IndexInfo> {
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

pub(super) fn build_constraints(rows: Vec<OracleConstraintCatalogRow>) -> Vec<ConstraintInfo> {
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

pub(super) fn build_views(schema: &str, rows: Vec<OracleViewCatalogRow>) -> Vec<ViewInfo> {
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
    rows: Vec<OracleRoutineCatalogRow>,
    param_rows: Vec<OracleRoutineParamCatalogRow>,
) -> Vec<FunctionInfo> {
    let mut args: HashMap<String, Vec<String>> = HashMap::new();
    for row in param_rows {
        let name = row
            .parameter_name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "arg".to_string());
        let direction = row.direction.unwrap_or_default();
        let suffix = if direction.is_empty() {
            String::new()
        } else {
            format!(" {direction}")
        };
        args.entry(row.routine_name)
            .or_default()
            .push(format!("{name} {}{suffix}", row.data_type));
    }

    rows.into_iter()
        .map(|row| FunctionInfo {
            name: row.name.clone(),
            schema: schema.to_string(),
            arguments: args.remove(&row.name).map(|parts| parts.join(", ")),
            return_type: row.return_type,
            language: Some("PL/SQL".into()),
            source: None,
            kind: row.kind,
        })
        .collect()
}

pub(super) fn build_sequences(
    schema: &str,
    rows: Vec<OracleSequenceCatalogRow>,
) -> Vec<FunctionInfo> {
    rows.into_iter()
        .map(|row| {
            let arguments = sequence_summary(&row);
            FunctionInfo {
                name: row.name,
                schema: schema.to_string(),
                arguments: Some(arguments),
                return_type: row.last_number.map(|value| format!("next {value}")),
                language: Some("Oracle sequence".into()),
                source: None,
                kind: "sequence".into(),
            }
        })
        .collect()
}

pub(super) fn build_synonyms(
    schema: &str,
    rows: Vec<OracleSynonymCatalogRow>,
) -> Vec<FunctionInfo> {
    rows.into_iter()
        .map(|row| {
            let target = synonym_target(&row);
            FunctionInfo {
                name: row.name,
                schema: schema.to_string(),
                arguments: Some(target.clone()),
                return_type: Some(target),
                language: Some("Oracle synonym".into()),
                source: None,
                kind: "synonym".into(),
            }
        })
        .collect()
}

fn sequence_summary(row: &OracleSequenceCatalogRow) -> String {
    let mut parts = Vec::new();
    if let Some(increment) = &row.increment_by {
        parts.push(format!("increment {increment}"));
    }
    if let Some(cache_size) = &row.cache_size {
        parts.push(format!("cache {cache_size}"));
    }
    parts.push(if row.cycle { "cycle" } else { "no cycle" }.to_string());
    parts.push(if row.ordered { "order" } else { "no order" }.to_string());
    if let (Some(min), Some(max)) = (&row.min_value, &row.max_value) {
        parts.push(format!("range {min}..{max}"));
    }
    parts.join(", ")
}

fn synonym_target(row: &OracleSynonymCatalogRow) -> String {
    let target = match (&row.target_owner, &row.target_name) {
        (Some(owner), Some(name)) if !owner.is_empty() && !name.is_empty() => {
            format!("{owner}.{name}")
        }
        (_, Some(name)) if !name.is_empty() => name.clone(),
        _ => "unresolved target".to_string(),
    };
    match row.db_link.as_deref().filter(|link| !link.is_empty()) {
        Some(link) => format!("{target}@{link}"),
        None => target,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ColumnCategory;

    fn column(name: &str, data_type: &str, base: &str) -> OracleColumnCatalogRow {
        OracleColumnCatalogRow {
            name: name.into(),
            data_type: data_type.into(),
            data_type_base: base.into(),
            nullable: true,
            default_value: None,
            comment: None,
        }
    }

    #[test]
    fn build_tables_and_views_attach_schema_without_widening_runtime_claims() {
        let tables = build_tables(
            "HR",
            vec![OracleTableCatalogRow {
                name: "EMPLOYEES".into(),
                row_count: Some(42),
            }],
        );
        assert_eq!(tables[0].schema, "HR");
        assert_eq!(tables[0].row_count, Some(42));

        let views = build_views(
            "HR",
            vec![OracleViewCatalogRow {
                name: "ACTIVE_EMPLOYEES".into(),
                definition: Some("SELECT EMPLOYEE_ID FROM HR.EMPLOYEES".into()),
            }],
        );
        assert_eq!(views[0].schema, "HR");
        assert_eq!(
            views[0].definition.as_deref(),
            Some("SELECT EMPLOYEE_ID FROM HR.EMPLOYEES")
        );
    }

    #[test]
    fn build_object_columns_marks_pk_fk_checks_and_display_categories() {
        let mut pk_columns = HashSet::new();
        pk_columns.insert("EMPLOYEE_ID".to_string());
        let mut fk_map = HashMap::new();
        fk_map.insert(
            "DEPARTMENT_ID".to_string(),
            "HR.DEPARTMENTS(DEPARTMENT_ID)".to_string(),
        );
        let mut check_map = HashMap::new();
        check_map.insert("SALARY".to_string(), vec!["CHECK (SALARY > 0)".to_string()]);

        let columns = build_object_columns(
            vec![
                OracleColumnCatalogRow {
                    nullable: false,
                    default_value: Some("1".into()),
                    comment: Some("identity".into()),
                    ..column("EMPLOYEE_ID", "NUMBER(10,0)", "NUMBER")
                },
                column("DEPARTMENT_ID", "NUMBER(10,0)", "NUMBER"),
                column("PROFILE", "JSON", "JSON"),
                column("SALARY", "BINARY_DOUBLE", "BINARY_DOUBLE"),
            ],
            &pk_columns,
            &fk_map,
            &check_map,
        );

        assert!(columns[0].is_primary_key);
        assert!(!columns[0].nullable);
        assert_eq!(columns[0].category, ColumnCategory::Int);
        assert_eq!(columns[0].default_value.as_deref(), Some("1"));
        assert_eq!(columns[0].comment.as_deref(), Some("identity"));
        assert!(columns[1].is_foreign_key);
        assert_eq!(
            columns[1].fk_reference.as_deref(),
            Some("HR.DEPARTMENTS(DEPARTMENT_ID)")
        );
        assert_eq!(columns[2].category, ColumnCategory::Object);
        assert_eq!(columns[3].category, ColumnCategory::Float);
        assert_eq!(columns[3].check_clauses, vec!["CHECK (SALARY > 0)"]);
    }

    #[test]
    fn build_schema_columns_groups_tables_and_applies_metadata_by_tuple_key() {
        let rows = vec![
            OracleSchemaColumnCatalogRow {
                table_name: "EMPLOYEES".into(),
                column: column("EMPLOYEE_ID", "NUMBER(10,0)", "NUMBER"),
            },
            OracleSchemaColumnCatalogRow {
                table_name: "EMPLOYEES".into(),
                column: column("DEPARTMENT_ID", "NUMBER(10,0)", "NUMBER"),
            },
            OracleSchemaColumnCatalogRow {
                table_name: "AUDIT_LOG".into(),
                column: column("CREATED_AT", "TIMESTAMP(6)", "TIMESTAMP"),
            },
        ];
        let pk_set = [("EMPLOYEES".to_string(), "EMPLOYEE_ID".to_string())]
            .into_iter()
            .collect();
        let fk_map = [(
            ("EMPLOYEES".to_string(), "DEPARTMENT_ID".to_string()),
            "HR.DEPARTMENTS(DEPARTMENT_ID)".to_string(),
        )]
        .into_iter()
        .collect();
        let check_map = [(
            ("AUDIT_LOG".to_string(), "CREATED_AT".to_string()),
            vec!["CHECK (CREATED_AT IS NOT NULL)".to_string()],
        )]
        .into_iter()
        .collect();

        let columns = build_schema_columns(rows, &pk_set, &fk_map, &check_map);

        let employee_columns = columns.get("EMPLOYEES").expect("employees columns");
        assert_eq!(employee_columns.len(), 2);
        assert!(employee_columns[0].is_primary_key);
        assert_eq!(
            employee_columns[1].fk_reference.as_deref(),
            Some("HR.DEPARTMENTS(DEPARTMENT_ID)")
        );
        let audit_columns = columns.get("AUDIT_LOG").expect("audit columns");
        assert_eq!(audit_columns[0].category, ColumnCategory::Datetime);
        assert_eq!(audit_columns[0].check_clauses.len(), 1);
    }

    #[test]
    fn build_indexes_deduplicates_columns_and_preserves_first_metadata() {
        let indexes = build_indexes(vec![
            OracleIndexCatalogRow {
                name: "EMP_EMAIL_UK".into(),
                column: "EMAIL".into(),
                index_type: "NORMAL".into(),
                is_unique: true,
                is_primary: false,
            },
            OracleIndexCatalogRow {
                name: "EMP_EMAIL_UK".into(),
                column: "EMAIL".into(),
                index_type: "NORMAL".into(),
                is_unique: true,
                is_primary: false,
            },
            OracleIndexCatalogRow {
                name: "EMP_PK".into(),
                column: "EMPLOYEE_ID".into(),
                index_type: "NORMAL".into(),
                is_unique: true,
                is_primary: true,
            },
            OracleIndexCatalogRow {
                name: "EMP_PK".into(),
                column: "TENANT_ID".into(),
                index_type: "NORMAL".into(),
                is_unique: true,
                is_primary: true,
            },
        ]);

        assert_eq!(indexes[0].name, "EMP_EMAIL_UK");
        assert_eq!(indexes[0].columns, vec!["EMAIL"]);
        assert_eq!(indexes[0].index_type, "normal");
        assert!(indexes[0].is_unique);
        assert!(!indexes[0].is_primary);
        assert_eq!(indexes[1].columns, vec!["EMPLOYEE_ID", "TENANT_ID"]);
        assert!(indexes[1].is_primary);
    }

    #[test]
    fn build_constraints_groups_fk_columns_and_keeps_check_without_reference() {
        let constraints = build_constraints(vec![
            OracleConstraintCatalogRow {
                name: "EMP_DEPT_FK".into(),
                constraint_type: "FOREIGN KEY".into(),
                column: Some("DEPARTMENT_ID".into()),
                reference_table: Some("HR.DEPARTMENTS".into()),
                reference_column: Some("DEPARTMENT_ID".into()),
            },
            OracleConstraintCatalogRow {
                name: "EMP_DEPT_FK".into(),
                constraint_type: "FOREIGN KEY".into(),
                column: Some("TENANT_ID".into()),
                reference_table: Some("HR.DEPARTMENTS".into()),
                reference_column: Some("TENANT_ID".into()),
            },
            OracleConstraintCatalogRow {
                name: "EMP_SALARY_CK".into(),
                constraint_type: "CHECK".into(),
                column: Some("SALARY".into()),
                reference_table: None,
                reference_column: None,
            },
        ]);

        assert_eq!(constraints[0].name, "EMP_DEPT_FK");
        assert_eq!(constraints[0].columns, vec!["DEPARTMENT_ID", "TENANT_ID"]);
        assert_eq!(
            constraints[0].reference_columns.as_ref().expect("ref cols"),
            &vec!["DEPARTMENT_ID".to_string(), "TENANT_ID".to_string()]
        );
        assert_eq!(constraints[1].name, "EMP_SALARY_CK");
        assert_eq!(constraints[1].columns, vec!["SALARY"]);
        assert_eq!(constraints[1].reference_columns, None);
    }

    #[test]
    fn build_functions_formats_parameters_and_package_metadata() {
        let routines = build_functions(
            "HR",
            vec![
                OracleRoutineCatalogRow {
                    name: "TOUCH_EMPLOYEE".into(),
                    kind: "procedure".into(),
                    return_type: None,
                },
                OracleRoutineCatalogRow {
                    name: "SCORE_EMPLOYEE".into(),
                    kind: "function".into(),
                    return_type: Some("NUMBER".into()),
                },
                OracleRoutineCatalogRow {
                    name: "EMP_API".into(),
                    kind: "package".into(),
                    return_type: None,
                },
            ],
            vec![
                OracleRoutineParamCatalogRow {
                    routine_name: "TOUCH_EMPLOYEE".into(),
                    parameter_name: Some("P_ID".into()),
                    data_type: "NUMBER".into(),
                    direction: Some("IN".into()),
                },
                OracleRoutineParamCatalogRow {
                    routine_name: "TOUCH_EMPLOYEE".into(),
                    parameter_name: Some("P_STATUS".into()),
                    data_type: "VARCHAR2(20)".into(),
                    direction: Some("OUT".into()),
                },
            ],
        );

        assert_eq!(routines[0].schema, "HR");
        assert_eq!(routines[0].language.as_deref(), Some("PL/SQL"));
        assert_eq!(
            routines[0].arguments.as_deref(),
            Some("P_ID NUMBER IN, P_STATUS VARCHAR2(20) OUT")
        );
        assert_eq!(routines[1].return_type.as_deref(), Some("NUMBER"));
        assert_eq!(routines[2].kind, "package");
        assert!(routines[2].arguments.is_none());
    }

    #[test]
    fn build_sequences_formats_read_only_metadata_rows() {
        let sequences = build_sequences(
            "HR",
            vec![OracleSequenceCatalogRow {
                name: "EMPLOYEE_SEQ".into(),
                min_value: Some("1".into()),
                max_value: Some("999999".into()),
                increment_by: Some("1".into()),
                cycle: false,
                ordered: true,
                cache_size: Some("20".into()),
                last_number: Some("101".into()),
            }],
        );

        assert_eq!(sequences[0].schema, "HR");
        assert_eq!(sequences[0].kind, "sequence");
        assert_eq!(sequences[0].language.as_deref(), Some("Oracle sequence"));
        assert_eq!(sequences[0].return_type.as_deref(), Some("next 101"));
        assert_eq!(
            sequences[0].arguments.as_deref(),
            Some("increment 1, cache 20, no cycle, order, range 1..999999")
        );
        assert!(sequences[0].source.is_none());
    }

    #[test]
    fn build_synonyms_formats_target_metadata_rows() {
        let synonyms = build_synonyms(
            "HR",
            vec![OracleSynonymCatalogRow {
                name: "EMPLOYEES_PUBLIC".into(),
                target_owner: Some("HR".into()),
                target_name: Some("EMPLOYEES".into()),
                db_link: Some("REMOTE_DB".into()),
            }],
        );

        assert_eq!(synonyms[0].schema, "HR");
        assert_eq!(synonyms[0].kind, "synonym");
        assert_eq!(synonyms[0].language.as_deref(), Some("Oracle synonym"));
        assert_eq!(
            synonyms[0].arguments.as_deref(),
            Some("HR.EMPLOYEES@REMOTE_DB")
        );
        assert_eq!(
            synonyms[0].return_type.as_deref(),
            Some("HR.EMPLOYEES@REMOTE_DB")
        );
        assert!(synonyms[0].source.is_none());
    }

    #[test]
    fn build_sequence_and_synonym_metadata_handles_sparse_catalog_rows() {
        let sequences = build_sequences(
            "HR",
            vec![OracleSequenceCatalogRow {
                name: "EVENT_SEQ".into(),
                min_value: None,
                max_value: None,
                increment_by: None,
                cycle: true,
                ordered: false,
                cache_size: None,
                last_number: None,
            }],
        );

        assert_eq!(sequences[0].arguments.as_deref(), Some("cycle, no order"));
        assert!(sequences[0].return_type.is_none());

        let synonyms = build_synonyms(
            "HR",
            vec![
                OracleSynonymCatalogRow {
                    name: "EMPLOYEES_ALIAS".into(),
                    target_owner: Some(String::new()),
                    target_name: Some("EMPLOYEES".into()),
                    db_link: None,
                },
                OracleSynonymCatalogRow {
                    name: "BROKEN_ALIAS".into(),
                    target_owner: None,
                    target_name: None,
                    db_link: Some(String::new()),
                },
            ],
        );

        assert_eq!(synonyms[0].arguments.as_deref(), Some("EMPLOYEES"));
        assert_eq!(synonyms[1].arguments.as_deref(), Some("unresolved target"));
    }
}
