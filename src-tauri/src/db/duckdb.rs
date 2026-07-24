//! DuckDB adapter entrypoint.
//!
//! First runtime slice: file-backed `.duckdb` lifecycle, baseline catalog
//! reads, table preview, and single-statement query execution. CSV/Parquet/JSON
//! analytics shortcuts, extension install/load, DDL helpers, and write parity
//! stay explicit unsupported surfaces until their follow-up sprints.

use std::future::Future;
use std::pin::Pin;

use crate::error::AppError;
use crate::models::{
    AddColumnRequest, AddConstraintRequest, AlterTableRequest, ColumnInfo, ConnectionConfig,
    ConstraintInfo, CreateIndexRequest, CreateTableRequest, DropColumnRequest,
    DropConstraintRequest, DropIndexRequest, DropTableRequest, FileAnalyticsPreview,
    FileAnalyticsQueryResponse, FileAnalyticsSource, FileAnalyticsSourceMetadata, FilterCondition,
    IndexInfo, RenameTableRequest, SchemaChangeResult, TableData, TableInfo, ViewInfo,
};

use super::{DbAdapter, NamespaceInfo, NamespaceLabel, RdbAdapter, RdbQueryResult};

mod batch;
mod connection;
mod file_analytics;
mod queries;
mod sql_text;
mod value;

pub use connection::DuckdbAdapter;

fn duckdb_unsupported(feature: &str) -> AppError {
    AppError::Unsupported(format!("DuckDB adapter does not support {feature} yet"))
}

impl DbAdapter for DuckdbAdapter {
    fn kind(&self) -> crate::models::DatabaseType {
        crate::models::DatabaseType::Duckdb
    }

    fn connect<'a>(
        &'a self,
        config: &'a ConnectionConfig,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.connect_file(config).await })
    }

    fn disconnect<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.disconnect_file().await })
    }

    fn ping<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.ping().await })
    }
}

impl RdbAdapter for DuckdbAdapter {
    fn namespace_label(&self) -> NamespaceLabel {
        NamespaceLabel::Schema
    }

    fn list_namespaces<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<NamespaceInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { DuckdbAdapter::list_namespaces(self).await })
    }

    fn current_database<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Option<String>, AppError>> + Send + 'a>> {
        Box::pin(async move { Ok(self.current_database_path().await) })
    }

    fn list_tables<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<TableInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { DuckdbAdapter::list_tables(self, namespace).await })
    }

    fn get_columns<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            if cancel.is_some_and(tokio_util::sync::CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            DuckdbAdapter::get_table_columns(self, namespace, table).await
        })
    }

    fn execute_sql<'a>(
        &'a self,
        sql: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<RdbQueryResult, AppError>> + Send + 'a>> {
        Box::pin(async move {
            self.execute_query(sql, cancel, crate::db::row_cap::current())
                .await
        })
    }

    // ADR 0051 Stage 1 — DuckDB inherited the trait `Unsupported` default, so
    // structured grid row edits (which route through `execute_sql_batch`) were
    // blocked even on a `read_only=false` connection. This wires the
    // BEGIN..COMMIT batch (#1070). `dry_run_sql_batch` stays inherited pending
    // Stage 3.
    fn execute_sql_batch<'a>(
        &'a self,
        statements: &'a [String],
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<RdbQueryResult>, AppError>> + Send + 'a>> {
        Box::pin(async move { self.execute_query_batch(statements, cancel).await })
    }

    #[allow(clippy::too_many_arguments)]
    fn query_table_data<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        page: i32,
        page_size: i32,
        order_by: Option<&'a str>,
        filters: Option<&'a [FilterCondition]>,
        raw_where: Option<&'a str>,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<TableData, AppError>> + Send + 'a>> {
        Box::pin(async move {
            self.query_table_data(
                namespace, table, page, page_size, order_by, filters, raw_where, cancel,
            )
            .await
        })
    }

    fn register_file_analytics_source<'a>(
        &'a self,
        path: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<FileAnalyticsSource, AppError>> + Send + 'a>> {
        Box::pin(async move { self.register_file_analytics_source(path).await })
    }

    fn list_file_analytics_source_metadata<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<FileAnalyticsSourceMetadata>, AppError>> + Send + 'a>>
    {
        Box::pin(async move { self.list_file_analytics_source_metadata().await })
    }

    fn clear_file_analytics_sources<'a>(
        &'a self,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.clear_file_analytics_sources().await })
    }

    fn preview_file_analytics_source<'a>(
        &'a self,
        source_id: &'a str,
        limit: Option<u32>,
    ) -> Pin<Box<dyn Future<Output = Result<FileAnalyticsPreview, AppError>> + Send + 'a>> {
        Box::pin(async move { self.preview_file_analytics_source(source_id, limit).await })
    }

    fn execute_file_analytics_query<'a>(
        &'a self,
        source_id: &'a str,
        sql: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<FileAnalyticsQueryResponse, AppError>> + Send + 'a>>
    {
        Box::pin(async move { self.execute_file_analytics_query(source_id, sql).await })
    }

    fn drop_table<'a>(
        &'a self,
        _req: &'a DropTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("table drop")) })
    }

    fn rename_table<'a>(
        &'a self,
        _req: &'a RenameTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("table rename")) })
    }

    fn alter_table<'a>(
        &'a self,
        _req: &'a AlterTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("table alteration")) })
    }

    fn add_column<'a>(
        &'a self,
        _req: &'a AddColumnRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("column creation")) })
    }

    fn drop_column<'a>(
        &'a self,
        _req: &'a DropColumnRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("column drop")) })
    }

    fn create_table<'a>(
        &'a self,
        _req: &'a CreateTableRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("table creation")) })
    }

    fn create_index<'a>(
        &'a self,
        _req: &'a CreateIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("index creation")) })
    }

    fn drop_index<'a>(
        &'a self,
        _req: &'a DropIndexRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("index drop")) })
    }

    fn add_constraint<'a>(
        &'a self,
        _req: &'a AddConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("constraint creation")) })
    }

    fn drop_constraint<'a>(
        &'a self,
        _req: &'a DropConstraintRequest,
    ) -> Pin<Box<dyn Future<Output = Result<SchemaChangeResult, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("constraint drop")) })
    }

    fn get_table_indexes<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<IndexInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            if cancel.is_some_and(tokio_util::sync::CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            DuckdbAdapter::get_table_indexes(self, namespace, table).await
        })
    }

    fn get_table_constraints<'a>(
        &'a self,
        namespace: &'a str,
        table: &'a str,
        cancel: Option<&'a tokio_util::sync::CancellationToken>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ConstraintInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move {
            if cancel.is_some_and(tokio_util::sync::CancellationToken::is_cancelled) {
                return Err(AppError::Database("Operation cancelled".into()));
            }
            DuckdbAdapter::get_table_constraints(self, namespace, table).await
        })
    }

    fn list_views<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ViewInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { DuckdbAdapter::list_views(self, namespace).await })
    }

    fn get_view_definition<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async move { DuckdbAdapter::get_view_definition(self, namespace, view).await })
    }

    fn get_view_columns<'a>(
        &'a self,
        namespace: &'a str,
        view: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ColumnInfo>, AppError>> + Send + 'a>> {
        Box::pin(async move { DuckdbAdapter::get_table_columns(self, namespace, view).await })
    }

    fn list_schema_columns<'a>(
        &'a self,
        namespace: &'a str,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<std::collections::HashMap<String, Vec<ColumnInfo>>, AppError>,
                > + Send
                + 'a,
        >,
    > {
        Box::pin(async move { self.list_schema_columns(namespace).await })
    }

    fn get_function_source<'a>(
        &'a self,
        _namespace: &'a str,
        _function: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, AppError>> + Send + 'a>> {
        Box::pin(async { Err(duckdb_unsupported("function source introspection")) })
    }
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::db::{DbAdapter, RdbAdapter};
    use crate::models::{ConnectionConfig, DatabaseType, QueryType};

    fn duckdb_config(path: &str, read_only: bool) -> ConnectionConfig {
        ConnectionConfig {
            id: "duckdb-unit".to_string(),
            name: "DuckDB unit".to_string(),
            db_type: DatabaseType::Duckdb,
            host: String::new(),
            port: 0,
            user: String::new(),
            password: String::new(),
            database: path.to_string(),
            read_only,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
            trust_server_certificate: None,
            oracle_use_sid: None,
            wallet_path: None,
            wallet_password: String::new(),
        }
    }

    fn seed_duckdb(path: &std::path::Path) {
        let conn = duckdb::Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE SCHEMA app;
             CREATE TABLE app.users (
                 id INTEGER PRIMARY KEY,
                 email VARCHAR NOT NULL,
                 name VARCHAR NOT NULL,
                 active BOOLEAN NOT NULL DEFAULT true
             );
             CREATE TABLE app.orders (
                 id INTEGER,
                 user_id INTEGER NOT NULL,
                 total_cents INTEGER NOT NULL
             );
             CREATE VIEW app.active_users AS
                 SELECT id, email FROM app.users WHERE active = true;
             INSERT INTO app.users VALUES
                 (1, 'ada@example.test', 'Ada', true),
                 (2, 'bob@example.test', 'Bob', false);
             INSERT INTO app.orders VALUES (1, 1, 1250);",
        )
        .unwrap();
    }

    async fn connected_fixture(read_only: bool) -> (TempDir, DuckdbAdapter) {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("fixture.duckdb");
        seed_duckdb(&db_path);

        let adapter = DuckdbAdapter::new();
        adapter
            .connect(&duckdb_config(db_path.to_str().unwrap(), read_only))
            .await
            .unwrap();

        (dir, adapter)
    }

    #[tokio::test]
    async fn duckdb_unit_browses_catalog_and_view_columns() {
        let (_dir, adapter) = connected_fixture(false).await;

        let schemas = adapter.list_namespaces().await.unwrap();
        assert!(schemas.iter().any(|schema| schema.name == "app"));

        let tables = adapter.list_tables("app").await.unwrap();
        assert_eq!(
            tables
                .iter()
                .map(|table| table.name.as_str())
                .collect::<Vec<_>>(),
            vec!["orders", "users"]
        );
        assert_eq!(
            tables
                .iter()
                .find(|table| table.name == "orders")
                .unwrap()
                .row_count,
            Some(1)
        );

        let columns = adapter.get_columns("app", "users", None).await.unwrap();
        assert_eq!(
            columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            vec!["id", "email", "name", "active"]
        );

        let views = <DuckdbAdapter as RdbAdapter>::list_views(&adapter, "app")
            .await
            .unwrap();
        assert!(views.iter().any(|view| view.name == "active_users"));

        let view_columns =
            <DuckdbAdapter as RdbAdapter>::get_view_columns(&adapter, "app", "active_users")
                .await
                .unwrap();
        assert_eq!(
            view_columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            vec!["id", "email"]
        );
    }

    #[tokio::test]
    async fn duckdb_unit_executes_query_and_table_page() {
        let (_dir, adapter) = connected_fixture(false).await;

        let query_result = adapter
            .execute_sql("SELECT id, email FROM app.active_users ORDER BY id", None)
            .await
            .unwrap();
        assert!(matches!(query_result.query_type, QueryType::Select));
        assert_eq!(query_result.total_count, 1);
        assert_eq!(
            query_result.rows[0][1],
            serde_json::json!("ada@example.test")
        );

        let page = adapter
            .query_table_data("app", "users", 1, 1, Some("id DESC"), None, None, None)
            .await
            .unwrap();
        assert_eq!(page.total_count, 2);
        assert_eq!(page.rows[0][0], serde_json::json!(2));
    }

    #[tokio::test]
    async fn duckdb_unit_read_only_and_deferred_features_fail_clearly() {
        let (_dir, adapter) = connected_fixture(true).await;
        let result = adapter
            .execute_sql(
                "INSERT INTO app.users VALUES (3, 'new@example.test', 'New', true)",
                None,
            )
            .await;
        match result {
            Err(AppError::Database(message)) => assert!(
                message.to_ascii_lowercase().contains("read-only")
                    || message.to_ascii_lowercase().contains("read only"),
            ),
            other => panic!("Expected read-only database error, got: {other:?}"),
        }

        let (_dir, adapter) = connected_fixture(false).await;
        let extension_result = adapter.execute_sql("INSTALL httpfs", None).await;
        assert!(matches!(extension_result, Err(AppError::Unsupported(_))));

        let analytics_result = adapter
            .execute_sql("SELECT * FROM read_csv_auto('users.csv')", None)
            .await;
        assert!(matches!(analytics_result, Err(AppError::Unsupported(_))));
    }

    #[tokio::test]
    async fn duckdb_unit_extension_and_file_capability_gate_is_explicit() {
        let (dir, adapter) = connected_fixture(false).await;
        let parquet_path = dir.path().join("users.parquet");
        let other_db_path = dir.path().join("other.duckdb");
        let csv_path = dir.path().join("users.csv");

        for sql in [
            "INSTALL httpfs".to_string(),
            "FORCE INSTALL httpfs".to_string(),
            "LOAD httpfs".to_string(),
            "SELECT install_extension('httpfs')".to_string(),
            "SELECT load_extension('httpfs')".to_string(),
            format!("COPY app.users TO '{}'", parquet_path.display()),
            format!("ATTACH '{}' AS other", other_db_path.display()),
            "SET enable_external_access = true".to_string(),
            "PRAGMA enable_external_access=true".to_string(),
            "SET autoload_known_extensions = true".to_string(),
            format!("SELECT * FROM read_csv_auto('{}')", csv_path.display()),
            format!("SELECT * FROM '{}'", csv_path.display()),
        ] {
            let result = adapter.execute_sql(&sql, None).await;
            assert!(
                matches!(result, Err(AppError::Unsupported(_))),
                "{sql} should be capability-gated, got {result:?}"
            );
        }
    }

    #[tokio::test]
    async fn duckdb_unit_native_cancel_is_unsupported_until_interrupt_is_wired() {
        let (_dir, adapter) = connected_fixture(false).await;
        let result = adapter.cancel_query(1).await;
        assert!(matches!(result, Err(AppError::Unsupported(_))));
    }

    // Issue #1070 — before this fix, `get_table_indexes`/`get_table_constraints`
    // were silent `Ok(vec![])` stubs, so a DuckDB table with real indexes and
    // constraints rendered as "none" in Structure (no error to tip the user off).
    // This seeds explicit indexes + PK/UNIQUE/FK/CHECK and asserts they surface.
    async fn introspection_fixture() -> (TempDir, DuckdbAdapter) {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("introspection.duckdb");
        {
            let conn = duckdb::Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE SCHEMA app;
                 CREATE TABLE app.users (
                     id INTEGER PRIMARY KEY,
                     email VARCHAR UNIQUE NOT NULL,
                     age INTEGER CHECK (age >= 0)
                 );
                 CREATE TABLE app.orders (
                     id INTEGER PRIMARY KEY,
                     user_id INTEGER NOT NULL,
                     FOREIGN KEY (user_id) REFERENCES app.users(id)
                 );
                 CREATE INDEX idx_orders_user ON app.orders(user_id);",
            )
            .unwrap();
        }
        let adapter = DuckdbAdapter::new();
        adapter
            .connect(&duckdb_config(db_path.to_str().unwrap(), false))
            .await
            .unwrap();
        (dir, adapter)
    }

    #[tokio::test]
    async fn duckdb_get_table_indexes_returns_real_indexes_1070() {
        let (_dir, adapter) = introspection_fixture().await;

        let indexes =
            <DuckdbAdapter as RdbAdapter>::get_table_indexes(&adapter, "app", "orders", None)
                .await
                .unwrap();

        // The explicit CREATE INDEX must surface (stub returned []); PK-backed
        // indexes stay out of duckdb_indexes() and belong to constraints.
        let idx = indexes
            .iter()
            .find(|i| i.name == "idx_orders_user")
            .expect("explicit index must be listed");
        assert_eq!(idx.columns, vec!["user_id".to_string()]);
        assert!(!idx.is_primary);
        assert!(!idx.is_unique);
        assert_eq!(idx.index_type, "ART");
    }

    #[tokio::test]
    async fn duckdb_get_table_constraints_maps_pk_unique_check_fk_1070() {
        let (_dir, adapter) = introspection_fixture().await;

        let users =
            <DuckdbAdapter as RdbAdapter>::get_table_constraints(&adapter, "app", "users", None)
                .await
                .unwrap();
        // NOT NULL is a column property and must not leak in as a constraint row.
        assert!(
            users.iter().all(|c| c.constraint_type != "NOT NULL"),
            "NOT NULL must be filtered: {users:?}"
        );
        let types: Vec<&str> = users.iter().map(|c| c.constraint_type.as_str()).collect();
        assert!(types.contains(&"PRIMARY KEY"), "{users:?}");
        assert!(types.contains(&"UNIQUE"), "{users:?}");
        assert!(types.contains(&"CHECK"), "{users:?}");
        let pk = users
            .iter()
            .find(|c| c.constraint_type == "PRIMARY KEY")
            .unwrap();
        assert_eq!(pk.columns, vec!["id".to_string()]);

        let orders =
            <DuckdbAdapter as RdbAdapter>::get_table_constraints(&adapter, "app", "orders", None)
                .await
                .unwrap();
        let fk = orders
            .iter()
            .find(|c| c.constraint_type == "FOREIGN KEY")
            .expect("FK must surface with its reference");
        assert_eq!(fk.columns, vec!["user_id".to_string()]);
        assert_eq!(fk.reference_table.as_deref(), Some("users"));
        assert_eq!(fk.reference_columns, Some(vec!["id".to_string()]));
    }
}
