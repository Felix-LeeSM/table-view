use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::db::{BoxFuture, NamespaceInfo};
use crate::error::AppError;
use crate::models::{
    ColumnInfo, ConnectionConfig, ConstraintInfo, FunctionInfo, IndexInfo, TableInfo, ViewInfo,
};

use super::support::{
    format_mssql_data_type, json_bool, json_i64, json_string, map_mssql_data_type, qualified_table,
    quote_ident, sql_string, validate_identifier,
};
use super::MssqlAdapter;

impl MssqlAdapter {
    pub(super) async fn schema_rows(
        config: &ConnectionConfig,
        sql: &str,
    ) -> Result<Vec<Vec<Value>>, AppError> {
        Ok(Self::query_select(config, sql).await?.rows)
    }

    pub(super) async fn table_columns_inner(
        config: &ConnectionConfig,
        namespace: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let schema_lit = sql_string(namespace);
        let table_lit = sql_string(table);
        let rows = Self::schema_rows(
            config,
            &format!(
                "SELECT c.name, \
                        ty.name AS data_type, \
                        c.max_length, c.precision, c.scale, \
                        c.is_nullable, \
                        dc.definition AS default_value, \
                        CAST(ep.value AS NVARCHAR(MAX)) AS comment \
                 FROM sys.columns c \
                 JOIN sys.tables t ON t.object_id = c.object_id \
                 JOIN sys.schemas s ON s.schema_id = t.schema_id \
                 JOIN sys.types ty ON ty.user_type_id = c.user_type_id \
                 LEFT JOIN sys.default_constraints dc \
                   ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id \
                 LEFT JOIN sys.extended_properties ep \
                   ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description' \
                 WHERE s.name = {schema_lit} AND t.name = {table_lit} \
                 ORDER BY c.column_id"
            ),
        )
        .await?;

        let pk_rows = Self::schema_rows(
            config,
            &format!(
                "SELECT c.name \
                 FROM sys.indexes i \
                 JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id \
                 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
                 JOIN sys.tables t ON t.object_id = i.object_id \
                 JOIN sys.schemas s ON s.schema_id = t.schema_id \
                 WHERE i.is_primary_key = 1 AND s.name = {schema_lit} AND t.name = {table_lit} \
                 ORDER BY ic.key_ordinal"
            ),
        )
        .await?;
        let fk_rows = Self::schema_rows(
            config,
            &format!(
                "SELECT pc.name, rs.name, rt.name, rc.name \
                 FROM sys.foreign_key_columns fkc \
                 JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
                 JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
                 JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id \
                 JOIN sys.schemas ps ON ps.schema_id = pt.schema_id \
                 JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id \
                 JOIN sys.schemas rs ON rs.schema_id = rt.schema_id \
                 WHERE ps.name = {schema_lit} AND pt.name = {table_lit} \
                 ORDER BY fkc.constraint_column_id"
            ),
        )
        .await?;

        let check_rows = Self::schema_rows(
            config,
            &format!(
                "SELECT c.name, cc.definition \
                 FROM sys.check_constraints cc \
                 JOIN sys.tables t ON t.object_id = cc.parent_object_id \
                 JOIN sys.schemas s ON s.schema_id = t.schema_id \
                 LEFT JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = cc.parent_column_id \
                 WHERE s.name = {schema_lit} AND t.name = {table_lit}"
            ),
        )
        .await?;

        Ok(mssql_columns_from_rows(rows, pk_rows, fk_rows, check_rows))
    }

    pub(super) fn list_namespaces_box<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let config = self.connected_config().await?;
            let rows = Self::schema_rows(
                &config,
                "SELECT name FROM sys.schemas \
                 WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA') \
                 ORDER BY name",
            )
            .await?;
            Ok(rows
                .into_iter()
                .filter_map(|row| json_string(row.first()).map(|name| NamespaceInfo { name }))
                .collect())
        })
    }

    pub(super) fn list_databases_box<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<NamespaceInfo>, AppError>> {
        Box::pin(async move {
            let config = self.connected_config().await?;
            let rows = Self::schema_rows(
                &config,
                "SELECT name FROM sys.databases \
                 WHERE state_desc = 'ONLINE' AND name NOT IN ('tempdb') \
                 ORDER BY name",
            )
            .await?;
            Ok(rows
                .into_iter()
                .filter_map(|row| json_string(row.first()).map(|name| NamespaceInfo { name }))
                .collect())
        })
    }

    pub(super) fn current_database_box<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move {
            let config = self.connected_config().await?;
            let result = Self::query_select(&config, "SELECT DB_NAME()").await?;
            Ok(result
                .rows
                .first()
                .and_then(|row| row.first())
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned))
        })
    }

    pub(super) fn list_tables_box<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<TableInfo>, AppError>> {
        Box::pin(async move {
            let config = self.connected_config().await?;
            let schema_lit = sql_string(namespace);
            let rows = Self::schema_rows(
                &config,
                &format!(
                    "SELECT t.name, CAST(SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END) AS BIGINT) AS row_count \
                     FROM sys.tables t \
                     JOIN sys.schemas s ON s.schema_id = t.schema_id \
                     LEFT JOIN sys.partitions p ON p.object_id = t.object_id \
                     WHERE s.name = {schema_lit} \
                     GROUP BY t.name \
                     ORDER BY t.name"
                ),
            )
            .await?;
            Ok(rows
                .into_iter()
                .filter_map(|row| {
                    let name = json_string(row.first())?;
                    Some(TableInfo {
                        name,
                        schema: namespace.to_string(),
                        row_count: json_i64(row.get(1)),
                    })
                })
                .collect())
        })
    }

    pub(super) fn get_columns_box<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            let config = self.connected_config().await?;
            let work = Self::table_columns_inner(&config, namespace, table);
            match cancel {
                Some(token) => tokio::select! {
                    result = work => result,
                    _ = token.cancelled() => Err(AppError::Database("Operation cancelled".into())),
                },
                None => work.await,
            }
        })
    }

    pub(super) fn count_null_rows_box<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        column: &'a str,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move {
            validate_identifier(namespace, "Schema name")?;
            validate_identifier(table, "Table name")?;
            validate_identifier(column, "Column name")?;
            let config = self.connected_config().await?;
            let sql = format!(
                "SELECT COUNT_BIG(*) FROM {} WHERE {} IS NULL",
                qualified_table(namespace, table),
                quote_ident(column)
            );
            let result = Self::query_select(&config, &sql).await?;
            Ok(result
                .rows
                .first()
                .and_then(|row| row.first())
                .and_then(|value| json_i64(Some(value)))
                .unwrap_or(0))
        })
    }

    pub(super) fn get_table_indexes_box<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<IndexInfo>, AppError>> {
        Box::pin(async move {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            let config = self.connected_config().await?;
            let schema_lit = sql_string(namespace);
            let table_lit = sql_string(table);
            let rows = Self::schema_rows(
                &config,
                &format!(
                    "SELECT i.name, c.name, i.type_desc, i.is_unique, i.is_primary_key \
                     FROM sys.indexes i \
                     JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id \
                     JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
                     JOIN sys.tables t ON t.object_id = i.object_id \
                     JOIN sys.schemas s ON s.schema_id = t.schema_id \
                     WHERE s.name = {schema_lit} AND t.name = {table_lit} AND i.name IS NOT NULL \
                     ORDER BY i.name, ic.key_ordinal"
                ),
            )
            .await?;
            Ok(mssql_indexes_from_rows(rows))
        })
    }

    pub(super) fn get_table_constraints_box<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a CancellationToken>,
    ) -> BoxFuture<'a, Result<Vec<ConstraintInfo>, AppError>> {
        Box::pin(async move {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            let config = self.connected_config().await?;
            let schema_lit = sql_string(namespace);
            let table_lit = sql_string(table);
            let rows = Self::schema_rows(
                &config,
                &format!(
                    "SELECT kc.name, kc.type_desc, c.name, NULL, NULL \
                     FROM sys.key_constraints kc \
                     JOIN sys.tables t ON t.object_id = kc.parent_object_id \
                     JOIN sys.schemas s ON s.schema_id = t.schema_id \
                     JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id \
                     JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
                     WHERE s.name = {schema_lit} AND t.name = {table_lit} \
                     UNION ALL \
                     SELECT fk.name, 'FOREIGN KEY', pc.name, rt.name, rc.name \
                     FROM sys.foreign_keys fk \
                     JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id \
                     JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
                     JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
                     JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id \
                     JOIN sys.schemas ps ON ps.schema_id = pt.schema_id \
                     JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id \
                     WHERE ps.name = {schema_lit} AND pt.name = {table_lit} \
                     UNION ALL \
                     SELECT cc.name, 'CHECK', NULL, NULL, NULL \
                     FROM sys.check_constraints cc \
                     JOIN sys.tables t ON t.object_id = cc.parent_object_id \
                     JOIN sys.schemas s ON s.schema_id = t.schema_id \
                     WHERE s.name = {schema_lit} AND t.name = {table_lit}"
                ),
            )
            .await?;
            Ok(mssql_constraints_from_rows(rows))
        })
    }

    pub(super) fn list_views_box<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ViewInfo>, AppError>> {
        Box::pin(async move {
            let config = self.connected_config().await?;
            let schema_lit = sql_string(namespace);
            let rows = Self::schema_rows(
                &config,
                &format!(
                    "SELECT v.name, OBJECT_DEFINITION(v.object_id) \
                     FROM sys.views v \
                     JOIN sys.schemas s ON s.schema_id = v.schema_id \
                     WHERE s.name = {schema_lit} ORDER BY v.name"
                ),
            )
            .await?;
            Ok(rows
                .into_iter()
                .filter_map(|row| {
                    let name = json_string(row.first())?;
                    Some(ViewInfo {
                        name,
                        schema: namespace.to_string(),
                        definition: json_string(row.get(1)),
                    })
                })
                .collect())
        })
    }

    pub(super) fn list_functions_box<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<Vec<FunctionInfo>, AppError>> {
        Box::pin(async move {
            let config = self.connected_config().await?;
            let schema_lit = sql_string(namespace);
            let rows = Self::schema_rows(
                &config,
                &format!(
                    "SELECT o.name, o.type_desc, OBJECT_DEFINITION(o.object_id) \
                     FROM sys.objects o \
                     JOIN sys.schemas s ON s.schema_id = o.schema_id \
                     WHERE s.name = {schema_lit} \
                       AND o.type IN ('FN','IF','TF','P') \
                     ORDER BY o.name"
                ),
            )
            .await?;
            Ok(rows
                .into_iter()
                .filter_map(|row| {
                    let name = json_string(row.first())?;
                    let kind = json_string(row.get(1)).unwrap_or_else(|| "routine".into());
                    Some(FunctionInfo {
                        name,
                        schema: namespace.to_string(),
                        arguments: None,
                        return_type: None,
                        language: Some("tsql".into()),
                        source: json_string(row.get(2)),
                        kind: kind.to_ascii_lowercase(),
                    })
                })
                .collect())
        })
    }

    pub(super) fn get_view_definition_box<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move {
            validate_identifier(namespace, "Schema name")?;
            validate_identifier(view, "View name")?;
            let config = self.connected_config().await?;
            let result = Self::query_select(
                &config,
                &format!(
                    "SELECT OBJECT_DEFINITION(OBJECT_ID({}))",
                    sql_string(&format!("{}.{}", namespace, view))
                ),
            )
            .await?;
            result
                .rows
                .first()
                .and_then(|row| row.first())
                .and_then(|v| v.as_str())
                .map(ToOwned::to_owned)
                .ok_or_else(|| AppError::NotFound(format!("View {namespace}.{view} not found")))
        })
    }

    pub(super) fn get_view_columns_box<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> BoxFuture<'a, Result<Vec<ColumnInfo>, AppError>> {
        Box::pin(async move {
            let config = self.connected_config().await?;
            Self::table_columns_inner(&config, namespace, view).await
        })
    }

    pub(super) fn list_schema_columns_box<'a>(
        &'a self,
        namespace: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, Vec<ColumnInfo>>, AppError>> {
        Box::pin(async move {
            let tables = self.list_tables_box(namespace).await?;
            let config = self.connected_config().await?;
            let mut result = HashMap::new();
            for table in tables {
                result.insert(
                    table.name.clone(),
                    Self::table_columns_inner(&config, namespace, &table.name).await?,
                );
            }
            Ok(result)
        })
    }

    pub(super) fn get_function_source_box<'a>(
        &'a self,
        namespace: &'a str,
        function: &'a str,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move {
            validate_identifier(namespace, "Schema name")?;
            validate_identifier(function, "Function name")?;
            let config = self.connected_config().await?;
            let result = Self::query_select(
                &config,
                &format!(
                    "SELECT OBJECT_DEFINITION(OBJECT_ID({}))",
                    sql_string(&format!("{}.{}", namespace, function))
                ),
            )
            .await?;
            result
                .rows
                .first()
                .and_then(|row| row.first())
                .and_then(|v| v.as_str())
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    AppError::NotFound(format!("Function {namespace}.{function} not found"))
                })
        })
    }
}

pub(super) fn mssql_columns_from_rows(
    rows: Vec<Vec<Value>>,
    pk_rows: Vec<Vec<Value>>,
    fk_rows: Vec<Vec<Value>>,
    check_rows: Vec<Vec<Value>>,
) -> Vec<ColumnInfo> {
    let pk_set: HashSet<String> = pk_rows
        .into_iter()
        .filter_map(|row| json_string(row.first()))
        .collect();

    let mut fk_map: HashMap<String, String> = HashMap::new();
    for row in fk_rows {
        let Some(col) = json_string(row.first()) else {
            continue;
        };
        let ref_schema = json_string(row.get(1)).unwrap_or_default();
        let ref_table = json_string(row.get(2)).unwrap_or_default();
        let ref_col = json_string(row.get(3)).unwrap_or_default();
        fk_map.insert(col, format!("{ref_schema}.{ref_table}({ref_col})"));
    }

    let mut check_map: HashMap<String, Vec<String>> = HashMap::new();
    for row in check_rows {
        let Some(col) = json_string(row.first()) else {
            continue;
        };
        if let Some(definition) = json_string(row.get(1)) {
            check_map.entry(col).or_default().push(definition);
        }
    }

    rows.into_iter()
        .filter_map(|row| {
            let name = json_string(row.first())?;
            let base_type = json_string(row.get(1)).unwrap_or_default();
            let max_length = json_i64(row.get(2));
            let precision = json_i64(row.get(3));
            let scale = json_i64(row.get(4));
            let data_type = format_mssql_data_type(&base_type, max_length, precision, scale);
            let nullable = json_bool(row.get(5)).unwrap_or(false);
            let default_value = json_string(row.get(6));
            let comment = json_string(row.get(7)).filter(|s| !s.is_empty());
            let is_foreign_key = fk_map.contains_key(&name);
            Some(ColumnInfo {
                name: name.clone(),
                data_type: data_type.clone(),
                nullable,
                default_value,
                is_primary_key: pk_set.contains(&name),
                is_foreign_key,
                fk_reference: fk_map.get(&name).cloned(),
                comment,
                check_clauses: check_map.remove(&name).unwrap_or_default(),
                category: map_mssql_data_type(&base_type),
            })
        })
        .collect()
}

pub(super) fn mssql_indexes_from_rows(rows: Vec<Vec<Value>>) -> Vec<IndexInfo> {
    let mut map: BTreeMap<String, (String, bool, bool, Vec<String>)> = BTreeMap::new();
    for row in rows {
        let Some(name) = json_string(row.first()) else {
            continue;
        };
        let col = json_string(row.get(1)).unwrap_or_default();
        let kind = json_string(row.get(2)).unwrap_or_else(|| "INDEX".into());
        let is_unique = json_bool(row.get(3)).unwrap_or(false);
        let is_primary = json_bool(row.get(4)).unwrap_or(false);
        let entry =
            map.entry(name)
                .or_insert((kind.to_lowercase(), is_unique, is_primary, Vec::new()));
        entry.3.push(col);
    }
    map.into_iter()
        .map(
            |(name, (index_type, is_unique, is_primary, columns))| IndexInfo {
                name,
                columns,
                index_type,
                is_unique,
                is_primary,
            },
        )
        .collect()
}

pub(super) fn mssql_constraints_from_rows(rows: Vec<Vec<Value>>) -> Vec<ConstraintInfo> {
    type Accum = (String, Vec<String>, Option<String>, Vec<String>);
    let mut map: BTreeMap<String, Accum> = BTreeMap::new();
    for row in rows {
        let Some(name) = json_string(row.first()) else {
            continue;
        };
        let ctype = json_string(row.get(1)).unwrap_or_default();
        let entry = map
            .entry(name)
            .or_insert((ctype, Vec::new(), None, Vec::new()));
        if let Some(col) = json_string(row.get(2)) {
            if !entry.1.contains(&col) {
                entry.1.push(col);
            }
        }
        if let Some(ref_table) = json_string(row.get(3)) {
            entry.2 = Some(ref_table);
        }
        if let Some(ref_col) = json_string(row.get(4)) {
            if !entry.3.contains(&ref_col) {
                entry.3.push(ref_col);
            }
        }
    }
    map.into_iter()
        .map(
            |(name, (constraint_type, columns, reference_table, reference_columns))| {
                ConstraintInfo {
                    name,
                    constraint_type,
                    columns,
                    reference_table,
                    reference_columns: if reference_columns.is_empty() {
                        None
                    } else {
                        Some(reference_columns)
                    },
                }
            },
        )
        .collect()
}
