mod decode;
mod queries;
mod shape;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use oracle_rs::{Connection as OracleConnection, Value};

use crate::error::AppError;
use crate::models::{
    ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, SchemaInfo, TableInfo, TriggerInfo,
    ViewInfo,
};

use self::decode::{
    format_fk_reference, query_rows, query_rows_or_empty_on_metadata_denied, row_bool_yn, row_i64,
    row_optional_string, row_string,
};
use self::queries::*;
use self::shape::{
    build_constraints, build_functions, build_indexes, build_object_columns, build_schema_columns,
    build_sequences, build_synonyms, build_tables, build_triggers, build_views,
    OracleColumnCatalogRow, OracleConstraintCatalogRow, OracleIndexCatalogRow,
    OracleRoutineCatalogRow, OracleRoutineParamCatalogRow, OracleSchemaColumnCatalogRow,
    OracleSequenceCatalogRow, OracleSynonymCatalogRow, OracleTableCatalogRow,
    OracleTriggerCatalogRow, OracleViewCatalogRow,
};
use super::{
    map_oracle_connection_error, OracleAdapter, ORACLE_ROOT_CONTAINER, ORACLE_SEED_CONTAINER,
};

/// #1072 — the DB picker's entries must be *dialable* names, not container
/// names: `switch_database` re-dials the pick as a TNS `SERVICE_NAME` (Oracle
/// has no `USE <db>`), so the list axis and the dial axis have to be the same
/// axis. Oracle auto-creates a default service named after each PDB, which is
/// why a PDB name dials, while `CDB$ROOT` is a container with no service of
/// that name (offering it is a guaranteed ORA-12514) and `PDB$SEED` is a
/// read-only clone template. The stored target is always kept — from a CDB root
/// session `CON_NAME` is `CDB$ROOT`, so the stored service is the only way back
/// to the container the user is on. SID profiles list the stored SID alone: a
/// PDB name is not a SID (ORA-12505), matching the fail-closed
/// `switch_active_service`. Duplicates fold case-insensitively (Oracle folds
/// unquoted identifiers) and keep the stored spelling, so the picker can
/// highlight the active entry.
pub(super) fn switch_target_names(
    stored: Option<&str>,
    containers: &[String],
    use_sid: bool,
) -> Vec<String> {
    let mut names: BTreeMap<String, String> = BTreeMap::new();
    if let Some(stored) = stored.map(str::trim).filter(|name| !name.is_empty()) {
        names.insert(stored.to_ascii_uppercase(), stored.to_string());
    }
    if !use_sid {
        for container in containers {
            let container = container.trim();
            let key = container.to_ascii_uppercase();
            if container.is_empty() || key == ORACLE_ROOT_CONTAINER || key == ORACLE_SEED_CONTAINER
            {
                continue;
            }
            names.entry(key).or_insert_with(|| container.to_string());
        }
    }
    names.into_values().collect()
}

impl OracleAdapter {
    pub async fn list_databases(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let rows = self
            .query_catalog_rows_strict(
                "Oracle current database probe failed",
                CURRENT_DATABASE_SQL,
                &[],
            )
            .await?;
        let mut containers: Vec<String> = rows
            .first()
            .map(|row| row_optional_string(row, 0, "current database"))
            .transpose()?
            .flatten()
            .into_iter()
            .collect();

        let (stored, use_sid) = {
            let guard = self.state.lock().await;
            match guard.connected_config.as_ref() {
                Some(config) => (
                    Some(config.database.trim().to_string()),
                    config.oracle_use_sid.unwrap_or(false),
                ),
                None => (None, false),
            }
        };

        // #1072 — the list feeds the switch-database picker, so it must offer
        // the other containers this session could dial, not just its own.
        // Best-effort end to end: a denied / absent `v$pdbs`, a second login
        // that fails, or an undecodable row must never cost the caller the
        // entries it already has, so an unprivileged session or a non-CDB keeps
        // exactly the pre-#1072 single-entry list.
        if !use_sid {
            for row in self
                .query_catalog_rows("Oracle container catalog query failed", OPEN_PDBS_SQL, &[])
                .await
                .unwrap_or_default()
            {
                if let Ok(name) = row_string(&row, 0, "container name") {
                    containers.push(name);
                }
            }
        }

        Ok(switch_target_names(stored.as_deref(), &containers, use_sid)
            .into_iter()
            .map(|name| SchemaInfo { name })
            .collect())
    }

    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let current_schema = self.current_schema_name().await?;
        let mut names = BTreeSet::new();
        if let Some(schema) = current_schema {
            names.insert(schema);
        }

        for row in self
            .query_catalog_rows("Oracle schema catalog query failed", USER_SCHEMAS_SQL, &[])
            .await?
        {
            let name = row_string(&row, 0, "schema name")?;
            if !name.is_empty() {
                names.insert(name);
            }
        }

        Ok(names.into_iter().map(|name| SchemaInfo { name }).collect())
    }

    async fn current_schema_name(&self) -> Result<Option<String>, AppError> {
        let rows = self
            .query_catalog_rows_strict(
                "Oracle current schema probe failed",
                CURRENT_SCHEMA_SQL,
                &[],
            )
            .await?;
        rows.first()
            .map(|row| row_optional_string(row, 0, "current schema"))
            .transpose()
            .map(Option::flatten)
    }

    pub async fn list_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let params = owner_params(schema);
        let rows = self
            .query_catalog_rows("Oracle table catalog query failed", TABLES_SQL, &params)
            .await?;
        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(OracleTableCatalogRow {
                    name: row_string(&row, 0, "table name")?,
                    row_count: row_i64(&row, 1, "table row count")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        Ok(build_tables(schema, catalog_rows))
    }

    pub async fn get_table_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        self.get_object_columns(schema, table, true).await
    }

    pub async fn get_view_columns(
        &self,
        schema: &str,
        view: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        self.get_object_columns(schema, view, false).await
    }

    async fn get_object_columns(
        &self,
        schema: &str,
        object: &str,
        include_table_metadata: bool,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let connection = self.open_catalog_connection().await?;
        let result = async {
            let params = owner_object_params(schema, object);
            let rows = query_rows_or_empty_on_metadata_denied(
                &connection,
                "Oracle column catalog query failed",
                OBJECT_COLUMNS_SQL,
                &params,
            )
            .await?;
            let pk_columns = if include_table_metadata {
                table_pk_columns(&connection, schema, object).await?
            } else {
                HashSet::new()
            };
            let fk_map = if include_table_metadata {
                table_fk_map(&connection, schema, object).await?
            } else {
                HashMap::new()
            };
            let check_map = if include_table_metadata {
                table_check_map(&connection, schema, object).await?
            } else {
                HashMap::new()
            };

            let catalog_rows = rows
                .into_iter()
                .map(|row| {
                    Ok(OracleColumnCatalogRow {
                        name: row_string(&row, 0, "column name")?,
                        data_type: row_string(&row, 1, "column type")?,
                        data_type_base: row_string(&row, 2, "column data type")?,
                        nullable: row_bool_yn(&row, 3, "column nullability")?,
                        default_value: row_optional_string(&row, 4, "column default")?,
                        comment: row_optional_string(&row, 5, "column comment")?,
                        is_identity: row_bool_yn(&row, 6, "column identity")?,
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?;

            Ok(build_object_columns(
                catalog_rows,
                &pk_columns,
                &fk_map,
                &check_map,
            ))
        }
        .await;
        close_catalog_connection(connection, result).await
    }

    pub async fn list_schema_columns(
        &self,
        schema: &str,
    ) -> Result<HashMap<String, Vec<ColumnInfo>>, AppError> {
        let connection = self.open_catalog_connection().await?;
        let result = async {
            let params = owner_params(schema);
            let rows = query_rows_or_empty_on_metadata_denied(
                &connection,
                "Oracle schema column catalog query failed",
                SCHEMA_COLUMNS_SQL,
                &params,
            )
            .await?;
            let pk_set = schema_pk_set(&connection, schema).await?;
            let fk_map = schema_fk_map(&connection, schema).await?;
            let check_map = schema_check_map(&connection, schema).await?;
            let catalog_rows = rows
                .into_iter()
                .map(|row| {
                    Ok(OracleSchemaColumnCatalogRow {
                        table_name: row_string(&row, 0, "object name")?,
                        column: OracleColumnCatalogRow {
                            name: row_string(&row, 1, "column name")?,
                            data_type: row_string(&row, 2, "column type")?,
                            data_type_base: row_string(&row, 3, "column data type")?,
                            nullable: row_bool_yn(&row, 4, "column nullability")?,
                            default_value: row_optional_string(&row, 5, "column default")?,
                            comment: row_optional_string(&row, 6, "column comment")?,
                            is_identity: row_bool_yn(&row, 7, "column identity")?,
                        },
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?;

            Ok(build_schema_columns(
                catalog_rows,
                &pk_set,
                &fk_map,
                &check_map,
            ))
        }
        .await;
        close_catalog_connection(connection, result).await
    }

    pub async fn get_table_indexes(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let params = owner_object_params(schema, table);
        let rows = self
            .query_catalog_rows("Oracle index catalog query failed", INDEXES_SQL, &params)
            .await?;
        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(OracleIndexCatalogRow {
                    name: row_string(&row, 0, "index name")?,
                    column: row_string(&row, 1, "index column")?,
                    index_type: row_string(&row, 2, "index type")?,
                    is_unique: row_bool_yn(&row, 3, "index uniqueness")?,
                    is_primary: row_bool_yn(&row, 4, "index primary flag")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;

        Ok(build_indexes(catalog_rows))
    }

    pub async fn get_table_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, AppError> {
        let params = owner_object_params(schema, table);
        let rows = self
            .query_catalog_rows(
                "Oracle constraint catalog query failed",
                CONSTRAINTS_SQL,
                &params,
            )
            .await?;
        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(OracleConstraintCatalogRow {
                    name: row_string(&row, 0, "constraint name")?,
                    constraint_type: row_string(&row, 1, "constraint type")?,
                    column: row_optional_string(&row, 2, "constraint column")?,
                    reference_table: row_optional_string(&row, 3, "reference table")?,
                    reference_column: row_optional_string(&row, 4, "reference column")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;

        Ok(build_constraints(catalog_rows))
    }

    pub async fn list_views(&self, schema: &str) -> Result<Vec<ViewInfo>, AppError> {
        let params = owner_params(schema);
        let rows = self
            .query_catalog_rows("Oracle view catalog query failed", VIEWS_SQL, &params)
            .await?;
        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(OracleViewCatalogRow {
                    name: row_string(&row, 0, "view name")?,
                    definition: None,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        Ok(build_views(schema, catalog_rows))
    }

    pub async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, AppError> {
        let params = owner_object_params(schema, view);
        let rows = self
            .query_catalog_rows(
                "Oracle view definition query failed",
                VIEW_DEFINITION_SQL,
                &params,
            )
            .await?;
        rows.first()
            .map(|row| row_optional_string(row, 0, "view definition"))
            .transpose()
            .map(Option::flatten)
            .map(|definition| definition.unwrap_or_default())
    }

    pub async fn list_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>, AppError> {
        let connection = self.open_catalog_connection().await?;
        let result = async {
            let params = owner_params(schema);
            let rows = query_rows_or_empty_on_metadata_denied(
                &connection,
                "Oracle routine catalog query failed",
                ROUTINES_SQL,
                &params,
            )
            .await?;
            let param_rows = query_rows_or_empty_on_metadata_denied(
                &connection,
                "Oracle routine parameter catalog query failed",
                ROUTINE_PARAMS_SQL,
                &params,
            )
            .await?;
            let sequence_rows = query_rows_or_empty_on_metadata_denied(
                &connection,
                "Oracle sequence catalog query failed",
                SEQUENCES_SQL,
                &params,
            )
            .await?;
            let synonym_rows = query_rows_or_empty_on_metadata_denied(
                &connection,
                "Oracle synonym catalog query failed",
                SYNONYMS_SQL,
                &params,
            )
            .await?;
            let params = param_rows
                .into_iter()
                .map(|row| {
                    Ok(OracleRoutineParamCatalogRow {
                        routine_name: row_string(&row, 0, "routine name")?,
                        parameter_name: row_optional_string(&row, 1, "parameter name")?,
                        data_type: row_string(&row, 2, "parameter type")?,
                        direction: row_optional_string(&row, 3, "parameter direction")?,
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?;
            let routines = rows
                .into_iter()
                .map(|row| {
                    Ok(OracleRoutineCatalogRow {
                        name: row_string(&row, 0, "routine name")?,
                        kind: row_string(&row, 1, "routine kind")?,
                        return_type: row_optional_string(&row, 2, "routine return type")?,
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?;

            let sequences = sequence_rows
                .into_iter()
                .map(|row| {
                    Ok(OracleSequenceCatalogRow {
                        name: row_string(&row, 0, "sequence name")?,
                        min_value: row_optional_string(&row, 1, "sequence min value")?,
                        max_value: row_optional_string(&row, 2, "sequence max value")?,
                        increment_by: row_optional_string(&row, 3, "sequence increment")?,
                        cycle: row_bool_yn(&row, 4, "sequence cycle flag")?,
                        ordered: row_bool_yn(&row, 5, "sequence order flag")?,
                        cache_size: row_optional_string(&row, 6, "sequence cache size")?,
                        last_number: row_optional_string(&row, 7, "sequence last number")?,
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?;
            let synonyms = synonym_rows
                .into_iter()
                .map(|row| {
                    Ok(OracleSynonymCatalogRow {
                        name: row_string(&row, 0, "synonym name")?,
                        target_owner: row_optional_string(&row, 1, "synonym target owner")?,
                        target_name: row_optional_string(&row, 2, "synonym target name")?,
                        db_link: row_optional_string(&row, 3, "synonym db link")?,
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?;

            let mut functions = build_functions(schema, routines, params);
            functions.extend(build_sequences(schema, sequences));
            functions.extend(build_synonyms(schema, synonyms));
            functions.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.name.cmp(&b.name)));
            Ok(functions)
        }
        .await;
        close_catalog_connection(connection, result).await
    }

    pub async fn get_function_source(
        &self,
        schema: &str,
        function: &str,
    ) -> Result<String, AppError> {
        let (object_name, source_type) = routine_source_target(function);
        let params = vec![
            Value::String(schema.to_string()),
            Value::String(object_name),
            Value::String(source_type),
        ];
        let rows = self
            .query_catalog_rows(
                "Oracle routine source query failed",
                ROUTINE_SOURCE_SQL,
                &params,
            )
            .await?;
        let mut source = String::new();
        for row in rows {
            source.push_str(&row_string(&row, 0, "routine source line")?);
        }
        Ok(source)
    }

    // #1072 (2차) — trigger list for one table, sourced from `all_triggers` like
    // the sibling `list_views` / `list_functions` catalog reads.
    pub async fn list_triggers(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<TriggerInfo>, AppError> {
        let params = owner_object_params(schema, table);
        let rows = self
            .query_catalog_rows("Oracle trigger catalog query failed", TRIGGERS_SQL, &params)
            .await?;
        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(OracleTriggerCatalogRow {
                    name: row_string(&row, 0, "trigger name")?,
                    trigger_type: row_string(&row, 1, "trigger type")?,
                    triggering_event: row_string(&row, 2, "triggering event")?,
                    when_clause: row_optional_string(&row, 3, "trigger when clause")?,
                    status: row_string(&row, 4, "trigger status")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        Ok(build_triggers(schema, table, catalog_rows))
    }

    async fn open_catalog_connection(&self) -> Result<OracleConnection, AppError> {
        let config = self.connected_config().await?;
        let timeout_secs = super::connection_timeout_secs(&config);
        Self::open_connection(&config, timeout_secs).await
    }

    async fn query_catalog_rows(
        &self,
        context: &'static str,
        sql: &str,
        params: &[Value],
    ) -> Result<Vec<oracle_rs::Row>, AppError> {
        let connection = self.open_catalog_connection().await?;
        let result =
            query_rows_or_empty_on_metadata_denied(&connection, context, sql, params).await;
        close_catalog_connection(connection, result).await
    }

    async fn query_catalog_rows_strict(
        &self,
        context: &'static str,
        sql: &str,
        params: &[Value],
    ) -> Result<Vec<oracle_rs::Row>, AppError> {
        let connection = self.open_catalog_connection().await?;
        let result = query_rows(&connection, context, sql, params).await;
        close_catalog_connection(connection, result).await
    }
}

async fn close_catalog_connection<T>(
    connection: OracleConnection,
    result: Result<T, AppError>,
) -> Result<T, AppError> {
    let close_result = connection
        .close()
        .await
        .map_err(map_oracle_connection_error);
    match (result, close_result) {
        (Ok(value), Ok(())) => Ok(value),
        (Ok(_), Err(error)) => Err(error),
        (Err(error), _) => Err(error),
    }
}

pub(super) async fn table_pk_columns(
    connection: &OracleConnection,
    schema: &str,
    table: &str,
) -> Result<HashSet<String>, AppError> {
    let params = owner_object_params(schema, table);
    let rows = query_rows_or_empty_on_metadata_denied(
        connection,
        "Oracle primary-key catalog query failed",
        TABLE_PRIMARY_KEYS_SQL,
        &params,
    )
    .await?;
    rows.into_iter()
        .map(|row| row_string(&row, 0, "primary-key column"))
        .collect()
}

async fn table_fk_map(
    connection: &OracleConnection,
    schema: &str,
    table: &str,
) -> Result<HashMap<String, String>, AppError> {
    let params = owner_object_params(schema, table);
    let rows = query_rows_or_empty_on_metadata_denied(
        connection,
        "Oracle foreign-key catalog query failed",
        TABLE_FOREIGN_KEYS_SQL,
        &params,
    )
    .await?;
    let mut map = HashMap::new();
    for row in rows {
        map.insert(
            row_string(&row, 0, "foreign-key column")?,
            format_fk_reference(
                &row_string(&row, 1, "reference schema")?,
                &row_string(&row, 2, "reference table")?,
                &row_string(&row, 3, "reference column")?,
            ),
        );
    }
    Ok(map)
}

async fn table_check_map(
    connection: &OracleConnection,
    schema: &str,
    table: &str,
) -> Result<HashMap<String, Vec<String>>, AppError> {
    let params = owner_object_params(schema, table);
    let rows = query_rows_or_empty_on_metadata_denied(
        connection,
        "Oracle check-constraint catalog query failed",
        TABLE_CHECKS_SQL,
        &params,
    )
    .await?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let Some(column) = row_optional_string(&row, 0, "check column")? else {
            continue;
        };
        let Some(definition) = row_optional_string(&row, 1, "check definition")? else {
            continue;
        };
        map.entry(column)
            .or_default()
            .push(format!("CHECK ({definition})"));
    }
    Ok(map)
}

async fn schema_pk_set(
    connection: &OracleConnection,
    schema: &str,
) -> Result<HashSet<(String, String)>, AppError> {
    let params = owner_params(schema);
    let rows = query_rows_or_empty_on_metadata_denied(
        connection,
        "Oracle schema primary-key catalog query failed",
        SCHEMA_PRIMARY_KEYS_SQL,
        &params,
    )
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok((
                row_string(&row, 0, "primary-key table")?,
                row_string(&row, 1, "primary-key column")?,
            ))
        })
        .collect()
}

async fn schema_fk_map(
    connection: &OracleConnection,
    schema: &str,
) -> Result<HashMap<(String, String), String>, AppError> {
    let params = owner_params(schema);
    let rows = query_rows_or_empty_on_metadata_denied(
        connection,
        "Oracle schema foreign-key catalog query failed",
        SCHEMA_FOREIGN_KEYS_SQL,
        &params,
    )
    .await?;
    let mut map = HashMap::new();
    for row in rows {
        map.insert(
            (
                row_string(&row, 0, "foreign-key table")?,
                row_string(&row, 1, "foreign-key column")?,
            ),
            format_fk_reference(
                &row_string(&row, 2, "reference schema")?,
                &row_string(&row, 3, "reference table")?,
                &row_string(&row, 4, "reference column")?,
            ),
        );
    }
    Ok(map)
}

async fn schema_check_map(
    connection: &OracleConnection,
    schema: &str,
) -> Result<HashMap<(String, String), Vec<String>>, AppError> {
    let params = owner_params(schema);
    let rows = query_rows_or_empty_on_metadata_denied(
        connection,
        "Oracle schema check-constraint catalog query failed",
        SCHEMA_CHECKS_SQL,
        &params,
    )
    .await?;
    let mut map: HashMap<(String, String), Vec<String>> = HashMap::new();
    for row in rows {
        let Some(column) = row_optional_string(&row, 1, "check column")? else {
            continue;
        };
        let Some(definition) = row_optional_string(&row, 2, "check definition")? else {
            continue;
        };
        map.entry((row_string(&row, 0, "check table")?, column))
            .or_default()
            .push(format!("CHECK ({definition})"));
    }
    Ok(map)
}

fn owner_params(schema: &str) -> Vec<Value> {
    vec![Value::String(schema.to_string())]
}

fn owner_object_params(schema: &str, object: &str) -> Vec<Value> {
    vec![
        Value::String(schema.to_string()),
        Value::String(object.to_string()),
    ]
}

fn routine_source_target(function: &str) -> (String, String) {
    let object = function.split('.').next().unwrap_or(function).to_string();
    if function.contains('.') {
        (object, "PACKAGE BODY".to_string())
    } else {
        (object, "%".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_string_param(value: &Value, expected: &str) {
        match value {
            Value::String(actual) => assert_eq!(actual, expected),
            other => panic!("expected string param, got {other:?}"),
        }
    }

    #[test]
    fn owner_params_preserve_oracle_identifier_case() {
        let params = owner_params("APP");

        assert_eq!(params.len(), 1);
        assert_string_param(&params[0], "APP");
    }

    #[test]
    fn owner_object_params_keep_owner_then_object_order() {
        let params = owner_object_params("APP", "USERS");

        assert_eq!(params.len(), 2);
        assert_string_param(&params[0], "APP");
        assert_string_param(&params[1], "USERS");
    }

    #[test]
    fn view_list_query_does_not_decode_long_definition_column() {
        let sql = VIEWS_SQL.to_ascii_lowercase();

        assert!(
            !sql.contains("text") && !sql.contains("definition"),
            "Oracle view browse must not read ALL_VIEWS.TEXT LONG values"
        );
    }

    #[test]
    fn view_definition_query_does_not_decode_all_views_text_long() {
        let sql = VIEW_DEFINITION_SQL.to_ascii_lowercase();

        assert!(
            !sql.contains("all_views") && !sql.contains("text"),
            "Oracle lazy view definition must not read ALL_VIEWS.TEXT LONG values"
        );
        assert!(sql.contains("dbms_metadata.get_ddl"));
    }

    #[test]
    fn routine_source_target_routes_package_members_to_package_body() {
        assert_eq!(
            routine_source_target("CATALOG_API"),
            ("CATALOG_API".to_string(), "%".to_string())
        );
        assert_eq!(
            routine_source_target("CATALOG_API.FIND_USER"),
            ("CATALOG_API".to_string(), "PACKAGE BODY".to_string())
        );
    }
}
