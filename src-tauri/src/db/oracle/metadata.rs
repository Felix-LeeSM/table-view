use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::db::NamespaceInfo;
use crate::error::AppError;
use crate::models::{
    ColumnInfo, ConnectionConfig, ConstraintInfo, FunctionInfo, IndexInfo, TableInfo, ViewInfo,
};

use super::common::{
    format_oracle_dictionary_type, json_i64, json_string, map_oracle_data_type,
    oracle_canonical_name, oracle_constraint_type, oracle_name_literal, qualified_table,
    quote_ident, validate_identifier, SYSTEM_SCHEMAS,
};
use super::OracleAdapter;

impl OracleAdapter {
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
        let owner = oracle_name_literal(namespace);
        let table_name = oracle_name_literal(table);
        let rows = Self::schema_rows(
            config,
            &format!(
                "SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, data_default \
                 FROM all_tab_columns \
                 WHERE owner = {owner} AND table_name = {table_name} \
                 ORDER BY column_id"
            ),
        )
        .await?;

        let pk_rows = Self::schema_rows(
            config,
            &format!(
                "SELECT cols.column_name \
                 FROM all_constraints cons \
                 JOIN all_cons_columns cols \
                   ON cols.owner = cons.owner AND cols.constraint_name = cons.constraint_name \
                  AND cols.table_name = cons.table_name \
                 WHERE cons.owner = {owner} AND cons.table_name = {table_name} AND cons.constraint_type = 'P' \
                 ORDER BY cols.position"
            ),
        )
        .await?;
        let fk_rows = Self::schema_rows(
            config,
            &format!(
                "SELECT cols.column_name, rcols.owner, rcols.table_name, rcols.column_name \
                 FROM all_constraints cons \
                 JOIN all_cons_columns cols \
                   ON cols.owner = cons.owner AND cols.constraint_name = cons.constraint_name \
                  AND cols.table_name = cons.table_name \
                 JOIN all_constraints rcons \
                   ON rcons.owner = cons.r_owner AND rcons.constraint_name = cons.r_constraint_name \
                 JOIN all_cons_columns rcols \
                   ON rcols.owner = rcons.owner AND rcols.constraint_name = rcons.constraint_name \
                  AND rcols.position = cols.position \
                 WHERE cons.owner = {owner} AND cons.table_name = {table_name} AND cons.constraint_type = 'R' \
                 ORDER BY cols.position"
            ),
        )
        .await?;

        let check_rows = Self::schema_rows(
            config,
            &format!(
                "SELECT cols.column_name, cons.search_condition_vc \
                 FROM all_constraints cons \
                 LEFT JOIN all_cons_columns cols \
                   ON cols.owner = cons.owner AND cols.constraint_name = cons.constraint_name \
                  AND cols.table_name = cons.table_name \
                 WHERE cons.owner = {owner} AND cons.table_name = {table_name} AND cons.constraint_type = 'C'"
            ),
        )
        .await?;
        Ok(oracle_columns_from_rows(rows, pk_rows, fk_rows, check_rows))
    }

    pub(super) async fn list_namespaces_impl(&self) -> Result<Vec<NamespaceInfo>, AppError> {
        let config = self.connected_config().await?;
        let system_list = SYSTEM_SCHEMAS
            .iter()
            .map(|schema| format!("'{schema}'"))
            .collect::<Vec<_>>()
            .join(", ");
        let rows = Self::schema_rows(
            &config,
            &format!(
                "SELECT owner FROM ( \
               SELECT DISTINCT owner FROM all_tables WHERE owner NOT IN ({system_list}) \
               UNION SELECT USER FROM dual \
             ) ORDER BY owner"
            ),
        )
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| json_string(row.first()).map(|name| NamespaceInfo { name }))
            .collect())
    }

    pub(super) async fn current_database_impl(&self) -> Result<Option<String>, AppError> {
        let config = self.connected_config().await?;
        let result = Self::query_select(
            &config,
            "SELECT SYS_CONTEXT('USERENV', 'SERVICE_NAME') FROM dual",
        )
        .await?;
        Ok(result
            .rows
            .first()
            .and_then(|row| row.first())
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned))
    }

    pub(super) async fn list_tables_impl(
        &self,
        namespace: &str,
    ) -> Result<Vec<TableInfo>, AppError> {
        let config = self.connected_config().await?;
        let owner = oracle_name_literal(namespace);
        let rows = Self::schema_rows(
            &config,
            &format!(
                "SELECT table_name, num_rows \
             FROM all_tables \
             WHERE owner = {owner} \
             ORDER BY table_name"
            ),
        )
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let name = json_string(row.first())?;
                Some(TableInfo {
                    name,
                    schema: oracle_canonical_name(namespace),
                    row_count: json_i64(row.get(1)),
                })
            })
            .collect())
    }

    pub(super) async fn get_columns_impl(
        &self,
        namespace: &str,
        table: &str,
        cancel: Option<&CancellationToken>,
    ) -> Result<Vec<ColumnInfo>, AppError> {
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
    }

    pub(super) async fn count_null_rows_impl(
        &self,
        namespace: &str,
        table: &str,
        column: &str,
    ) -> Result<i64, AppError> {
        validate_identifier(namespace, "Schema name")?;
        validate_identifier(table, "Table name")?;
        validate_identifier(column, "Column name")?;
        let config = self.connected_config().await?;
        let sql = format!(
            "SELECT COUNT(*) FROM {} WHERE {} IS NULL",
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
    }

    pub(super) async fn get_table_indexes_impl(
        &self,
        namespace: &str,
        table: &str,
        cancel: Option<&CancellationToken>,
    ) -> Result<Vec<IndexInfo>, AppError> {
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Operation cancelled".into()));
        }
        let config = self.connected_config().await?;
        let owner = oracle_name_literal(namespace);
        let table_name = oracle_name_literal(table);
        let rows = Self::schema_rows(
            &config,
            &format!(
                "SELECT ind.index_name, cols.column_name, ind.index_type, ind.uniqueness, \
                    CASE WHEN cons.constraint_type = 'P' THEN 1 ELSE 0 END \
             FROM all_indexes ind \
             JOIN all_ind_columns cols \
               ON cols.index_owner = ind.owner AND cols.index_name = ind.index_name \
             LEFT JOIN all_constraints cons \
               ON cons.owner = ind.owner AND cons.index_name = ind.index_name \
              AND cons.constraint_type = 'P' \
             WHERE ind.owner = {owner} AND ind.table_name = {table_name} \
             ORDER BY ind.index_name, cols.column_position"
            ),
        )
        .await?;
        Ok(oracle_indexes_from_rows(rows))
    }

    pub(super) async fn get_table_constraints_impl(
        &self,
        namespace: &str,
        table: &str,
        cancel: Option<&CancellationToken>,
    ) -> Result<Vec<ConstraintInfo>, AppError> {
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Err(AppError::Database("Operation cancelled".into()));
        }
        let config = self.connected_config().await?;
        let owner = oracle_name_literal(namespace);
        let table_name = oracle_name_literal(table);
        let rows = Self::schema_rows(
        &config,
        &format!(
            "SELECT cons.constraint_name, cons.constraint_type, cols.column_name, rcols.table_name, rcols.column_name \
             FROM all_constraints cons \
             LEFT JOIN all_cons_columns cols \
               ON cols.owner = cons.owner AND cols.constraint_name = cons.constraint_name \
              AND cols.table_name = cons.table_name \
             LEFT JOIN all_constraints rcons \
               ON rcons.owner = cons.r_owner AND rcons.constraint_name = cons.r_constraint_name \
             LEFT JOIN all_cons_columns rcols \
               ON rcols.owner = rcons.owner AND rcols.constraint_name = rcons.constraint_name \
              AND rcols.position = cols.position \
             WHERE cons.owner = {owner} AND cons.table_name = {table_name} \
               AND cons.constraint_type IN ('P','U','R','C') \
             ORDER BY cons.constraint_name, cols.position"
        ),
    )
    .await?;
        Ok(oracle_constraints_from_rows(rows))
    }

    pub(super) async fn list_views_impl(&self, namespace: &str) -> Result<Vec<ViewInfo>, AppError> {
        let config = self.connected_config().await?;
        let owner = oracle_name_literal(namespace);
        let rows = Self::schema_rows(
            &config,
            &format!(
                "SELECT view_name, text_vc FROM all_views WHERE owner = {owner} ORDER BY view_name"
            ),
        )
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let name = json_string(row.first())?;
                Some(ViewInfo {
                    name,
                    schema: oracle_canonical_name(namespace),
                    definition: json_string(row.get(1)),
                })
            })
            .collect())
    }

    pub(super) async fn list_functions_impl(
        &self,
        namespace: &str,
    ) -> Result<Vec<FunctionInfo>, AppError> {
        let config = self.connected_config().await?;
        let owner = oracle_name_literal(namespace);
        let rows = Self::schema_rows(
            &config,
            &format!(
                "SELECT object_name, object_type \
             FROM all_objects \
             WHERE owner = {owner} AND object_type IN ('FUNCTION','PROCEDURE','PACKAGE') \
             ORDER BY object_name"
            ),
        )
        .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let name = json_string(row.first())?;
                let kind = json_string(row.get(1)).unwrap_or_else(|| "FUNCTION".into());
                Some(FunctionInfo {
                    name,
                    schema: oracle_canonical_name(namespace),
                    arguments: None,
                    return_type: None,
                    language: Some("plsql".into()),
                    source: None,
                    kind: kind.to_ascii_lowercase(),
                })
            })
            .collect())
    }

    pub(super) async fn get_view_definition_impl(
        &self,
        namespace: &str,
        view: &str,
    ) -> Result<String, AppError> {
        let config = self.connected_config().await?;
        let owner = oracle_name_literal(namespace);
        let view_name = oracle_name_literal(view);
        let result = Self::query_select(
            &config,
            &format!(
                "SELECT text_vc FROM all_views WHERE owner = {owner} AND view_name = {view_name}"
            ),
        )
        .await?;
        result
            .rows
            .first()
            .and_then(|row| row.first())
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned)
            .ok_or_else(|| AppError::NotFound(format!("View {namespace}.{view} not found")))
    }

    pub(super) async fn get_view_columns_impl(
        &self,
        namespace: &str,
        view: &str,
    ) -> Result<Vec<ColumnInfo>, AppError> {
        let config = self.connected_config().await?;
        Self::table_columns_inner(&config, namespace, view).await
    }

    pub(super) async fn list_schema_columns_impl(
        &self,
        namespace: &str,
    ) -> Result<HashMap<String, Vec<ColumnInfo>>, AppError> {
        let tables = self.list_tables_impl(namespace).await?;
        let config = self.connected_config().await?;
        let mut result = HashMap::new();
        for table in tables {
            result.insert(
                table.name.clone(),
                Self::table_columns_inner(&config, namespace, &table.name).await?,
            );
        }
        Ok(result)
    }

    pub(super) async fn get_function_source_impl(
        &self,
        namespace: &str,
        function: &str,
    ) -> Result<String, AppError> {
        let config = self.connected_config().await?;
        let owner = oracle_name_literal(namespace);
        let name = oracle_name_literal(function);
        let result = Self::query_select(
            &config,
            &format!(
                "SELECT text FROM all_source WHERE owner = {owner} AND name = {name} ORDER BY line"
            ),
        )
        .await?;
        if result.rows.is_empty() {
            return Err(AppError::NotFound(format!(
                "Function {namespace}.{function} not found"
            )));
        }
        Ok(result
            .rows
            .iter()
            .filter_map(|row| row.first().and_then(|value| value.as_str()))
            .collect::<Vec<_>>()
            .join(""))
    }
}

pub(super) fn oracle_columns_from_rows(
    rows: Vec<Vec<Value>>,
    pk_rows: Vec<Vec<Value>>,
    fk_rows: Vec<Vec<Value>>,
    check_rows: Vec<Vec<Value>>,
) -> Vec<ColumnInfo> {
    let pk_set: HashSet<String> = pk_rows
        .into_iter()
        .filter_map(|row| json_string(row.first()))
        .collect();

    let mut fk_map = HashMap::new();
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
            let data_type = format_oracle_dictionary_type(
                &base_type,
                json_i64(row.get(2)),
                json_i64(row.get(3)),
                json_i64(row.get(4)),
            );
            let nullable = json_string(row.get(5))
                .map(|value| value.eq_ignore_ascii_case("Y"))
                .unwrap_or(true);
            let default_value = json_string(row.get(6));
            let is_foreign_key = fk_map.contains_key(&name);
            Some(ColumnInfo {
                name: name.clone(),
                data_type: data_type.clone(),
                nullable,
                default_value,
                is_primary_key: pk_set.contains(&name),
                is_foreign_key,
                fk_reference: fk_map.get(&name).cloned(),
                comment: None,
                check_clauses: check_map.remove(&name).unwrap_or_default(),
                category: map_oracle_data_type(&data_type),
            })
        })
        .collect()
}

pub(super) fn oracle_indexes_from_rows(rows: Vec<Vec<Value>>) -> Vec<IndexInfo> {
    let mut map: BTreeMap<String, (String, bool, bool, Vec<String>)> = BTreeMap::new();
    for row in rows {
        let Some(name) = json_string(row.first()) else {
            continue;
        };
        let col = json_string(row.get(1)).unwrap_or_default();
        let index_type = json_string(row.get(2))
            .unwrap_or_else(|| "INDEX".into())
            .to_ascii_lowercase();
        let is_unique = json_string(row.get(3))
            .map(|v| v.eq_ignore_ascii_case("UNIQUE"))
            .unwrap_or(false);
        let is_primary = json_i64(row.get(4)).unwrap_or(0) == 1;
        let entry = map
            .entry(name)
            .or_insert((index_type, is_unique, is_primary, Vec::new()));
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

pub(super) fn oracle_constraints_from_rows(rows: Vec<Vec<Value>>) -> Vec<ConstraintInfo> {
    type Accum = (String, Vec<String>, Option<String>, Vec<String>);
    let mut map: BTreeMap<String, Accum> = BTreeMap::new();
    for row in rows {
        let Some(name) = json_string(row.first()) else {
            continue;
        };
        let ctype = oracle_constraint_type(json_string(row.get(1)).as_deref());
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
