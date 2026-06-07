mod decode;
mod queries;

use std::collections::{BTreeMap, HashMap, HashSet};

use tiberius::ToSql;

use crate::error::AppError;
use crate::models::{
    ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, SchemaInfo, TableInfo, ViewInfo,
};

use self::decode::{
    format_fk_reference, map_mssql_data_type, query_rows, query_rows_or_empty_on_metadata_denied,
    row_bool, row_i64, row_optional_string, row_string, MssqlClient,
};
use self::queries::*;
use super::MssqlAdapter;

impl MssqlAdapter {
    pub async fn list_databases(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server database catalog query failed",
            USER_DATABASES_SQL,
            &[],
        )
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(SchemaInfo {
                    name: row_string(&row, 0, "database name")?,
                })
            })
            .collect()
    }

    pub async fn switch_active_database(&self, db_name: &str) -> Result<(), AppError> {
        let db_name = db_name.trim();
        if db_name.is_empty() {
            return Err(AppError::Validation(
                "SQL Server database name is required".into(),
            ));
        }

        let mut config = self.connected_config().await?;
        config.database = db_name.to_string();
        Self::test(&config).await?;
        let mut connected_config = self.connected_config.lock().await;
        *connected_config = Some(config);
        Ok(())
    }

    pub async fn current_database_name(&self) -> Result<Option<String>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let rows = query_rows(
            &mut client,
            "SQL Server current database probe failed",
            CURRENT_DATABASE_SQL,
            &[],
        )
        .await?;
        Ok(rows
            .first()
            .map(|row| row_optional_string(row, 0, "current database"))
            .transpose()?
            .flatten())
    }

    pub async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server schema catalog query failed",
            USER_SCHEMAS_SQL,
            &[],
        )
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(SchemaInfo {
                    name: row_string(&row, 0, "schema name")?,
                })
            })
            .collect()
    }

    pub async fn list_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let params: [&dyn ToSql; 1] = [&schema];
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server table catalog query failed",
            TABLES_SQL,
            &params,
        )
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(TableInfo {
                    name: row_string(&row, 0, "table name")?,
                    schema: schema.to_string(),
                    row_count: row_i64(&row, 1, "table row count")?,
                })
            })
            .collect()
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
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let params: [&dyn ToSql; 2] = [&schema, &object];
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server column catalog query failed",
            OBJECT_COLUMNS_SQL,
            &params,
        )
        .await?;
        let pk_columns = if include_table_metadata {
            table_pk_columns(&mut client, schema, object).await?
        } else {
            HashSet::new()
        };
        let fk_map = if include_table_metadata {
            table_fk_map(&mut client, schema, object).await?
        } else {
            HashMap::new()
        };
        let check_map = if include_table_metadata {
            table_check_map(&mut client, schema, object).await?
        } else {
            HashMap::new()
        };

        rows.into_iter()
            .map(|row| {
                let name = row_string(&row, 1, "column name")?;
                let data_type_base = row_string(&row, 3, "column data type")?;
                let fk_reference = fk_map.get(&name).cloned();
                Ok(ColumnInfo {
                    name: name.clone(),
                    data_type: row_string(&row, 2, "column type")?,
                    nullable: row_bool(&row, 4, "column nullability")?,
                    default_value: row_optional_string(&row, 5, "column default")?,
                    is_primary_key: pk_columns.contains(&name),
                    is_foreign_key: fk_reference.is_some(),
                    fk_reference,
                    comment: row_optional_string(&row, 6, "column comment")?,
                    check_clauses: check_map.get(&name).cloned().unwrap_or_default(),
                    category: map_mssql_data_type(&data_type_base),
                })
            })
            .collect()
    }

    pub async fn list_schema_columns(
        &self,
        schema: &str,
    ) -> Result<HashMap<String, Vec<ColumnInfo>>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let params: [&dyn ToSql; 1] = [&schema];
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server schema column catalog query failed",
            SCHEMA_COLUMNS_SQL,
            &params,
        )
        .await?;
        let pk_set = schema_pk_set(&mut client, schema).await?;
        let fk_map = schema_fk_map(&mut client, schema).await?;
        let check_map = schema_check_map(&mut client, schema).await?;
        let mut result: HashMap<String, Vec<ColumnInfo>> = HashMap::new();

        for row in rows {
            let table_name = row_string(&row, 0, "object name")?;
            let column_name = row_string(&row, 1, "column name")?;
            let data_type_base = row_string(&row, 3, "column data type")?;
            let key = (table_name.clone(), column_name.clone());
            let fk_reference = fk_map.get(&key).cloned();
            let check_clauses = check_map.get(&key).cloned().unwrap_or_default();
            result.entry(table_name).or_default().push(ColumnInfo {
                name: column_name.clone(),
                data_type: row_string(&row, 2, "column type")?,
                nullable: row_bool(&row, 4, "column nullability")?,
                default_value: row_optional_string(&row, 5, "column default")?,
                is_primary_key: pk_set.contains(&key),
                is_foreign_key: fk_reference.is_some(),
                fk_reference,
                comment: row_optional_string(&row, 6, "column comment")?,
                check_clauses,
                category: map_mssql_data_type(&data_type_base),
            });
        }

        Ok(result)
    }

    pub async fn get_table_indexes(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let params: [&dyn ToSql; 2] = [&schema, &table];
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server index catalog query failed",
            INDEXES_SQL,
            &params,
        )
        .await?;

        let mut map: BTreeMap<String, (bool, bool, String, Vec<String>)> = BTreeMap::new();
        for row in rows {
            let name = row_string(&row, 0, "index name")?;
            let column = row_string(&row, 1, "index column")?;
            let index_type = row_string(&row, 2, "index type")?.to_ascii_lowercase();
            let is_unique = row_bool(&row, 3, "index uniqueness")?;
            let is_primary = row_bool(&row, 4, "index primary flag")?;
            let entry = map
                .entry(name)
                .or_insert((is_unique, is_primary, index_type, Vec::new()));
            if !entry.3.contains(&column) {
                entry.3.push(column);
            }
        }

        Ok(map
            .into_iter()
            .map(
                |(name, (is_unique, is_primary, index_type, columns))| IndexInfo {
                    name,
                    columns,
                    index_type,
                    is_unique,
                    is_primary,
                },
            )
            .collect())
    }

    pub async fn get_table_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let params: [&dyn ToSql; 2] = [&schema, &table];
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server constraint catalog query failed",
            CONSTRAINTS_SQL,
            &params,
        )
        .await?;

        type ConstraintAccum = (String, Vec<String>, Option<String>, Vec<String>);
        let mut map: BTreeMap<String, ConstraintAccum> = BTreeMap::new();
        for row in rows {
            let name = row_string(&row, 0, "constraint name")?;
            let constraint_type = row_string(&row, 1, "constraint type")?;
            let column = row_optional_string(&row, 2, "constraint column")?;
            let reference_table = row_optional_string(&row, 3, "reference table")?;
            let reference_column = row_optional_string(&row, 4, "reference column")?;
            let entry = map.entry(name).or_insert((
                constraint_type,
                Vec::new(),
                reference_table,
                Vec::new(),
            ));
            if let Some(column) = column {
                if !entry.1.contains(&column) {
                    entry.1.push(column);
                }
            }
            if let Some(reference_column) = reference_column {
                if !entry.3.contains(&reference_column) {
                    entry.3.push(reference_column);
                }
            }
        }

        Ok(map
            .into_iter()
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
            .collect())
    }

    pub async fn list_views(&self, schema: &str) -> Result<Vec<ViewInfo>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let params: [&dyn ToSql; 1] = [&schema];
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server view catalog query failed",
            VIEWS_SQL,
            &params,
        )
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(ViewInfo {
                    name: row_string(&row, 0, "view name")?,
                    schema: schema.to_string(),
                    definition: row_optional_string(&row, 1, "view definition")?,
                })
            })
            .collect()
    }

    pub async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let params: [&dyn ToSql; 2] = [&schema, &view];
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server view definition query failed",
            VIEW_DEFINITION_SQL,
            &params,
        )
        .await?;
        match rows.first() {
            Some(row) => Ok(row_optional_string(row, 0, "view definition")?.unwrap_or_default()),
            None => Err(AppError::Connection(format!(
                "View {schema}.{view} not found"
            ))),
        }
    }

    pub async fn list_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let params: [&dyn ToSql; 1] = [&schema];
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server routine catalog query failed",
            ROUTINES_SQL,
            &params,
        )
        .await?;
        let param_rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server routine parameter catalog query failed",
            ROUTINE_PARAMS_SQL,
            &params,
        )
        .await?;
        let mut args: HashMap<String, Vec<String>> = HashMap::new();
        for row in param_rows {
            let routine_name = row_string(&row, 0, "routine name")?;
            let parameter_name = row_string(&row, 1, "parameter name")?;
            let data_type = row_string(&row, 2, "parameter type")?;
            let is_output = row_bool(&row, 3, "parameter output flag")?;
            let suffix = if is_output { " OUTPUT" } else { "" };
            args.entry(routine_name)
                .or_default()
                .push(format!("{parameter_name} {data_type}{suffix}"));
        }

        rows.into_iter()
            .map(|row| {
                let name = row_string(&row, 1, "routine name")?;
                Ok(FunctionInfo {
                    name: name.clone(),
                    schema: schema.to_string(),
                    arguments: args.remove(&name).map(|parts| parts.join(", ")),
                    return_type: row_optional_string(&row, 3, "routine return type")?,
                    language: Some("T-SQL".into()),
                    source: row_optional_string(&row, 4, "routine source")?,
                    kind: row_string(&row, 2, "routine kind")?,
                })
            })
            .collect()
    }

    pub async fn get_function_source(
        &self,
        schema: &str,
        function: &str,
    ) -> Result<String, AppError> {
        let config = self.connected_config().await?;
        let mut client = Self::connect_client(&config).await?;
        let params: [&dyn ToSql; 2] = [&schema, &function];
        let rows = query_rows_or_empty_on_metadata_denied(
            &mut client,
            "SQL Server routine source query failed",
            ROUTINE_SOURCE_SQL,
            &params,
        )
        .await?;
        match rows.first() {
            Some(row) => Ok(row_optional_string(row, 0, "routine source")?.unwrap_or_default()),
            None => Err(AppError::Connection(format!(
                "Routine {schema}.{function} not found"
            ))),
        }
    }
}

async fn table_pk_columns(
    client: &mut MssqlClient,
    schema: &str,
    table: &str,
) -> Result<HashSet<String>, AppError> {
    let params: [&dyn ToSql; 2] = [&schema, &table];
    let rows = query_rows_or_empty_on_metadata_denied(
        client,
        "SQL Server primary-key catalog query failed",
        TABLE_PRIMARY_KEYS_SQL,
        &params,
    )
    .await?;
    rows.into_iter()
        .map(|row| row_string(&row, 0, "primary-key column"))
        .collect()
}

async fn table_fk_map(
    client: &mut MssqlClient,
    schema: &str,
    table: &str,
) -> Result<HashMap<String, String>, AppError> {
    let params: [&dyn ToSql; 2] = [&schema, &table];
    let rows = query_rows_or_empty_on_metadata_denied(
        client,
        "SQL Server foreign-key catalog query failed",
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
    client: &mut MssqlClient,
    schema: &str,
    table: &str,
) -> Result<HashMap<String, Vec<String>>, AppError> {
    let params: [&dyn ToSql; 2] = [&schema, &table];
    let rows = query_rows_or_empty_on_metadata_denied(
        client,
        "SQL Server check-constraint catalog query failed",
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
        map.entry(column).or_default().push(definition);
    }
    Ok(map)
}

async fn schema_pk_set(
    client: &mut MssqlClient,
    schema: &str,
) -> Result<HashSet<(String, String)>, AppError> {
    let params: [&dyn ToSql; 1] = [&schema];
    let rows = query_rows_or_empty_on_metadata_denied(
        client,
        "SQL Server schema primary-key catalog query failed",
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
    client: &mut MssqlClient,
    schema: &str,
) -> Result<HashMap<(String, String), String>, AppError> {
    let params: [&dyn ToSql; 1] = [&schema];
    let rows = query_rows_or_empty_on_metadata_denied(
        client,
        "SQL Server schema foreign-key catalog query failed",
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
    client: &mut MssqlClient,
    schema: &str,
) -> Result<HashMap<(String, String), Vec<String>>, AppError> {
    let params: [&dyn ToSql; 1] = [&schema];
    let rows = query_rows_or_empty_on_metadata_denied(
        client,
        "SQL Server schema check-constraint catalog query failed",
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
            .push(definition);
    }
    Ok(map)
}
