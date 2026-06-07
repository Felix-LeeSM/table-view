mod decode;
mod queries;
mod shape;

use std::collections::{HashMap, HashSet};

use tiberius::{Row, ToSql};

use crate::error::AppError;
use crate::models::{
    ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, SchemaInfo, TableInfo, ViewInfo,
};

use self::decode::{
    format_fk_reference, query_rows, query_rows_or_empty_on_metadata_denied, row_bool, row_i64,
    row_optional_string, row_string, MssqlClient,
};
use self::queries::*;
use self::shape::{
    build_constraints, build_functions, build_indexes, build_object_columns, build_schema_columns,
    build_tables, build_views, MssqlColumnCatalogRow, MssqlConstraintCatalogRow,
    MssqlIndexCatalogRow, MssqlRoutineCatalogRow, MssqlRoutineParamCatalogRow,
    MssqlSchemaColumnCatalogRow, MssqlTableCatalogRow, MssqlViewCatalogRow,
};
use super::MssqlAdapter;

impl MssqlAdapter {
    pub async fn list_databases(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let rows = self
            .query_catalog_rows(
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
        let rows = self
            .query_catalog_rows_strict(
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
        let rows = self
            .query_catalog_rows(
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
        let params: [&dyn ToSql; 1] = [&schema];
        let rows = self
            .query_catalog_rows("SQL Server table catalog query failed", TABLES_SQL, &params)
            .await?;
        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(MssqlTableCatalogRow {
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
        let mut client = self.connected_client().await?;
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

        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(MssqlColumnCatalogRow {
                    name: row_string(&row, 1, "column name")?,
                    data_type: row_string(&row, 2, "column type")?,
                    data_type_base: row_string(&row, 3, "column data type")?,
                    nullable: row_bool(&row, 4, "column nullability")?,
                    default_value: row_optional_string(&row, 5, "column default")?,
                    comment: row_optional_string(&row, 6, "column comment")?,
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

    pub async fn list_schema_columns(
        &self,
        schema: &str,
    ) -> Result<HashMap<String, Vec<ColumnInfo>>, AppError> {
        let mut client = self.connected_client().await?;
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
        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(MssqlSchemaColumnCatalogRow {
                    table_name: row_string(&row, 0, "object name")?,
                    column: MssqlColumnCatalogRow {
                        name: row_string(&row, 1, "column name")?,
                        data_type: row_string(&row, 2, "column type")?,
                        data_type_base: row_string(&row, 3, "column data type")?,
                        nullable: row_bool(&row, 4, "column nullability")?,
                        default_value: row_optional_string(&row, 5, "column default")?,
                        comment: row_optional_string(&row, 6, "column comment")?,
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

    pub async fn get_table_indexes(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, AppError> {
        let params: [&dyn ToSql; 2] = [&schema, &table];
        let rows = self
            .query_catalog_rows(
                "SQL Server index catalog query failed",
                INDEXES_SQL,
                &params,
            )
            .await?;

        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(MssqlIndexCatalogRow {
                    name: row_string(&row, 0, "index name")?,
                    column: row_string(&row, 1, "index column")?,
                    index_type: row_string(&row, 2, "index type")?,
                    is_unique: row_bool(&row, 3, "index uniqueness")?,
                    is_primary: row_bool(&row, 4, "index primary flag")?,
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
        let params: [&dyn ToSql; 2] = [&schema, &table];
        let rows = self
            .query_catalog_rows(
                "SQL Server constraint catalog query failed",
                CONSTRAINTS_SQL,
                &params,
            )
            .await?;

        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(MssqlConstraintCatalogRow {
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
        let params: [&dyn ToSql; 1] = [&schema];
        let rows = self
            .query_catalog_rows("SQL Server view catalog query failed", VIEWS_SQL, &params)
            .await?;
        let catalog_rows = rows
            .into_iter()
            .map(|row| {
                Ok(MssqlViewCatalogRow {
                    name: row_string(&row, 0, "view name")?,
                    definition: row_optional_string(&row, 1, "view definition")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        Ok(build_views(schema, catalog_rows))
    }

    pub async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, AppError> {
        let params: [&dyn ToSql; 2] = [&schema, &view];
        let rows = self
            .query_catalog_rows(
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
        let mut client = self.connected_client().await?;
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
        let params = param_rows
            .into_iter()
            .map(|row| {
                Ok(MssqlRoutineParamCatalogRow {
                    routine_name: row_string(&row, 0, "routine name")?,
                    parameter_name: row_string(&row, 1, "parameter name")?,
                    data_type: row_string(&row, 2, "parameter type")?,
                    is_output: row_bool(&row, 3, "parameter output flag")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        let routines = rows
            .into_iter()
            .map(|row| {
                Ok(MssqlRoutineCatalogRow {
                    name: row_string(&row, 1, "routine name")?,
                    kind: row_string(&row, 2, "routine kind")?,
                    return_type: row_optional_string(&row, 3, "routine return type")?,
                    source: row_optional_string(&row, 4, "routine source")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;

        Ok(build_functions(schema, routines, params))
    }

    pub async fn get_function_source(
        &self,
        schema: &str,
        function: &str,
    ) -> Result<String, AppError> {
        let params: [&dyn ToSql; 2] = [&schema, &function];
        let rows = self
            .query_catalog_rows(
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

    async fn connected_client(&self) -> Result<MssqlClient, AppError> {
        let config = self.connected_config().await?;
        Self::connect_client(&config).await
    }

    async fn query_catalog_rows(
        &self,
        context: &'static str,
        sql: &str,
        params: &[&dyn ToSql],
    ) -> Result<Vec<Row>, AppError> {
        let mut client = self.connected_client().await?;
        query_rows_or_empty_on_metadata_denied(&mut client, context, sql, params).await
    }

    async fn query_catalog_rows_strict(
        &self,
        context: &'static str,
        sql: &str,
        params: &[&dyn ToSql],
    ) -> Result<Vec<Row>, AppError> {
        let mut client = self.connected_client().await?;
        query_rows(&mut client, context, sql, params).await
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
