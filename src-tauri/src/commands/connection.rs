//! Sprint 209 — `commands/connection` entry. 1710-line god file 를
//! 6-way split (entry + session / crud / groups / io / sqlite_file).
//!
//! Entry retains:
//!   - `AppState` + `impl AppState` + `impl Default for AppState` —
//!     8 internal `crate::commands::*` users import this directly.
//!   - `make_adapter` `pub(crate)` factory — used by `crud::connect` and
//!     `session::keep_alive_loop`.
//!   - `SaveConnectionRequest` / `TestConnectionRequest` request bodies —
//!     consumed by `crud::save_connection` / `crud::test_connection` and
//!     constructed in tests under `test_helpers`.
//!   - `pub use {session,crud,groups,io,sqlite_file}::*;` re-exports so
//!     `lib.rs::invoke_handler!` and external users keep
//!     `commands::connection::<command>` paths.
//!
//! `mod test_helpers` (cfg-test) provides the shared fixtures
//! (`sample_connection` / `save_via_command` / `setup_test_env` / …) every
//! sub-module's `#[cfg(test)] mod tests` reuses.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::warn;

use crate::db::mongodb::MongoAdapter;
use crate::db::mysql::MysqlAdapter;
use crate::db::postgres::PostgresAdapter;
use crate::db::redis::RedisAdapter;
use crate::db::search::SearchEngineAdapter;
use crate::db::sqlite::SqliteAdapter;
use crate::db::ActiveAdapter;
use crate::db::DuckdbAdapter;
use crate::db::MssqlAdapter;
use crate::db::OracleRuntimeAdapter;
use crate::error::AppError;
use crate::models::{ConnectionConfigPublic, ConnectionStatus, DatabaseType};
use crate::state::introspection_pool::IntrospectionPool;

pub mod crud;
pub mod groups;
pub mod io;
pub mod session;
pub mod sqlite_file;

pub use crud::{
    connect, delete_connection, disconnect, list_connections, save_connection, test_connection,
};
pub use groups::{delete_group, list_groups, move_connection_to_group, save_group};
pub use io::{
    export_connections, export_connections_encrypted, import_connections,
    import_connections_encrypted, EncryptedExportResult, ExportPayload, ImportResult, RenamedEntry,
};
pub use session::get_session_id;
pub use sqlite_file::create_sqlite_database_file;

/// Build an `ActiveAdapter` for the given database type.
///
/// Sprint 65 adds MongoDB dispatch on top of Sprint 64's Postgres wiring.
/// Sprint 281 (Phase 17 Slice A) wires MySQL — RdbAdapter read path
/// (namespaces / tables / columns) is live; DDL / queries / streaming
/// surfaces still return `AppError::Unsupported` until Slice B~G land.
/// MariaDB shares the MySQL protocol adapter while preserving its distinct
/// `DatabaseType` on the active adapter. SQLite and DuckDB have file-backed
/// adapters. SQL Server uses the bounded MSSQL runtime slice: lifecycle,
/// catalog/table/view/routine browse, tabular query, batch DML, and
/// cooperative cancel. Oracle uses the #905/#906 bounded runtime RDB wrapper:
/// service-name lifecycle, catalog metadata, SELECT/DML batch, cooperative
/// cancel, tabular table-data queries, and frontend SQL-batch row edits are
/// live, while switch-database, structured DDL, source/body, trigger, and admin
/// surfaces return Unsupported.
pub(crate) fn make_adapter(db_type: &DatabaseType) -> Result<ActiveAdapter, AppError> {
    match db_type {
        DatabaseType::Postgresql => Ok(ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()))),
        DatabaseType::Mysql => Ok(ActiveAdapter::Rdb(Box::new(MysqlAdapter::new()))),
        DatabaseType::Mariadb => Ok(ActiveAdapter::Rdb(Box::new(MysqlAdapter::new_mariadb()))),
        DatabaseType::Sqlite => Ok(ActiveAdapter::Rdb(Box::new(SqliteAdapter::new()))),
        DatabaseType::Duckdb => Ok(ActiveAdapter::Rdb(Box::new(DuckdbAdapter::new()))),
        DatabaseType::Mssql => Ok(ActiveAdapter::Rdb(Box::new(MssqlAdapter::new()))),
        DatabaseType::Oracle => Ok(ActiveAdapter::Rdb(Box::new(OracleRuntimeAdapter::new()))),
        DatabaseType::Mongodb => Ok(ActiveAdapter::Document(Box::new(MongoAdapter::new()))),
        DatabaseType::Redis => Ok(ActiveAdapter::Kv(Box::new(RedisAdapter::new()))),
        DatabaseType::Valkey => Ok(ActiveAdapter::Kv(Box::new(RedisAdapter::new_valkey()))),
        DatabaseType::Elasticsearch => Ok(ActiveAdapter::Search(Box::new(
            SearchEngineAdapter::new_elasticsearch(),
        ))),
        DatabaseType::Opensearch => Ok(ActiveAdapter::Search(Box::new(
            SearchEngineAdapter::new_opensearch(),
        ))),
    }
}

/// Request body for `save_connection`. Splitting `password` from the
/// `ConnectionConfigPublic` body lets the frontend express three distinct
/// intents:
/// - `password = None`     → preserve existing stored password
/// - `password = Some("")` → explicitly clear the stored password
/// - `password = Some(s)`  → set a new password
#[derive(Debug, Deserialize)]
pub struct SaveConnectionRequest {
    pub connection: ConnectionConfigPublic,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub is_new: Option<bool>,
}

/// Request body for `test_connection`. `password` follows the same three-way
/// semantics as `SaveConnectionRequest`. When `existing_id` is supplied and
/// `password` is `None`, the backend looks up the stored password without
/// ever exposing it to the caller.
#[derive(Debug, Deserialize)]
pub struct TestConnectionRequest {
    pub config: ConnectionConfigPublic,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub existing_id: Option<String>,
}

/// Sprint 359 — per-tab connection affinity record.
///
/// Lives in `AppState.tab_affinity` under `(connection_id, tab_id)`, keyed so
/// the same `tab_id` opened against two distinct connections never collides
/// (codex 7차 #4). Stores a native server-side identifier
/// (`pg_backend_pid()` / `CONNECTION_ID()`).
///
/// NOTE (Issue #1230): the native-cancel path does NOT read this record — the
/// pid the frontend passes to `cancel_query_native` comes from
/// `AppState.query_server_pids` (recorded per `query_id` by `execute_query`).
/// This affinity map is sprint-359 scaffolding kept for the future
/// tab-scoped ROLLBACK hand-off; `bind_tab_affinity_inner` has no caller yet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TabAffinity {
    pub server_pid: i64,
}

pub struct AppState {
    /// Active adapter handles keyed by `ConnectionConfig::id`.
    ///
    /// Sprint 64 replaces the previous `HashMap<_, PostgresAdapter>` with an
    /// `ActiveAdapter` enum so the same map can hold relational, document,
    /// search, or kv adapters. Command handlers dispatch through
    /// `ActiveAdapter::as_rdb()?` / `as_document()?` / … to regain a typed
    /// reference.
    ///
    /// Issue #1087 — the value is an `Arc` so a command can clone the handle
    /// under a short lock and release the guard **before** awaiting the
    /// adapter. Holding the lock across a long-running query previously
    /// serialised every other command (and `cancel_query_native`) on every
    /// connection behind it. Resolve through [`AppState::active_adapter`].
    pub active_connections: Mutex<HashMap<String, Arc<ActiveAdapter>>>,
    pub connection_status: Mutex<HashMap<String, ConnectionStatus>>,
    pub keep_alive_handles: Mutex<HashMap<String, JoinHandle<()>>>,
    /// Issue #1100 — per-connection lifecycle lock. `connect` / `disconnect`
    /// acquire [`AppState::connection_guard`] for the whole mutation so the
    /// check-then-act windows across the three registry maps can't interleave
    /// for the same id (double-click connect, auto-reconnect overlap). The map
    /// grows by distinct connection id (bounded by saved connections) and
    /// entries are never reclaimed — a handful of stale `Arc<Mutex>` is cheaper
    /// than reference-counting their teardown.
    pub connection_guards: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    pub query_tokens: Mutex<HashMap<String, CancellationToken>>,
    /// Sprint 359 (Q5.1 / Q5.6) — per-tab native-cancel affinity.
    ///
    /// Boot state is an empty map: every tab starts with no record
    /// (`None`-equivalent), and the first successful `executeQuery(tab_id,
    /// …)` writes a `TabAffinity { server_pid }`. `release_tab_connection`
    /// removes the entry and `cancel_query_native` reads the `server_pid`
    /// for the paradigm-native abort call.
    ///
    /// Keyed by `(connection_id, tab_id)` so the same tab id can coexist
    /// across two different connections (codex 7차 #4 — connection scope).
    pub tab_affinity: Mutex<HashMap<(String, String), TabAffinity>>,
    /// Issue #1230 — per-query server pid for native cancel.
    ///
    /// `execute_query` records the executing backend's server-side pid
    /// (pg `pg_backend_pid()` / mysql `CONNECTION_ID()`) here, keyed by the
    /// caller's unique `query_id`, as soon as the query pins a connection —
    /// i.e. while a long query is still running. The frontend fetches it via
    /// `get_query_server_pid(query_id)` and passes it to
    /// `cancel_query_native`, which finally makes the pre-built
    /// `pg_cancel_backend` / `KILL QUERY` path reachable for long queries
    /// (`pg_sleep`, big JOINs) the cooperative token can't abort. The entry
    /// is removed when the query finishes, so only in-flight queries appear.
    pub query_server_pids: Mutex<HashMap<String, i64>>,
    /// Sprint 359 (Q5.4) — per-connection **introspection pool** selector.
    ///
    /// Sidebar / autocomplete / prefetch borrow idle slots from this map
    /// instead of the tab pool, so a long user query in tab affinity
    /// never starves schema introspection. Lookup is `connection_id`,
    /// the slot count is `max_K=5` (strategy doc line 465). Real
    /// `pool.acquire()` rewiring of schema commands is the follow-up
    /// step — this surface is the structural precursor sidebar callers
    /// will start consuming in sprint-360+.
    pub introspection_pools: Mutex<HashMap<String, IntrospectionPool>>,
    /// Session-scoped UUID generated once per app process. Shared by all
    /// windows so they can agree on which localStorage entries are "current
    /// session" vs stale from a previous run.
    pub session_id: String,
}

impl AppState {
    /// Resolve the active adapter for `connection_id`, cloning the `Arc` and
    /// releasing the `active_connections` lock immediately.
    ///
    /// Issue #1087 — every command must resolve its adapter through this
    /// helper (lookup + `Arc` clone) instead of holding the map guard across
    /// the ensuing `.await`. Holding it kept a long-running query on one
    /// connection from being cancelled and serialised every command on every
    /// other connection behind it. The returned `Arc` keeps the adapter alive
    /// for the duration of the call even if a concurrent `disconnect` removes
    /// the map entry.
    pub async fn active_adapter(&self, connection_id: &str) -> Option<Arc<ActiveAdapter>> {
        self.active_connections
            .lock()
            .await
            .get(connection_id)
            .cloned()
    }

    /// Issue #1100 — acquire the per-connection lifecycle lock. `connect` /
    /// `disconnect` hold the returned guard for the whole mutation so same-id
    /// calls serialize instead of racing across the separate registry mutexes.
    pub async fn connection_guard(&self, id: &str) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = {
            let mut guards = self.connection_guards.lock().await;
            guards.entry(id.to_string()).or_default().clone()
        };
        lock.lock_owned().await
    }

    /// Issue #1100 — atomically install a freshly-connected adapter and its
    /// keep-alive handle for `id`, tearing down any predecessor: the previous
    /// keep-alive task is `abort()`-ed and the previous adapter
    /// `disconnect()`-ed. The original `connect` did a blind `insert` that
    /// dropped the old adapter without `disconnect()` and overwrote the old
    /// handle without `abort()`, so a re-connect (double-click, auto-reconnect
    /// overlap) leaked a server session and left a second ping loop alive.
    /// `HashMap::insert` returns the displaced value, so the swap always
    /// captures the predecessor; callers still hold [`AppState::connection_guard`]
    /// to keep the two map swaps and the status transition consistent.
    pub async fn install_connection(
        &self,
        id: &str,
        adapter: Arc<ActiveAdapter>,
        keep_alive: JoinHandle<()>,
    ) {
        let old_handle = self
            .keep_alive_handles
            .lock()
            .await
            .insert(id.to_string(), keep_alive);
        if let Some(handle) = old_handle {
            handle.abort();
        }

        let old_adapter = self
            .active_connections
            .lock()
            .await
            .insert(id.to_string(), adapter);
        if let Some(old) = old_adapter {
            if let Err(e) = old.lifecycle().disconnect().await {
                warn!(
                    conn_id = %id,
                    error = %e,
                    "Failed to disconnect replaced adapter during reconnect"
                );
            }
        }
    }

    pub fn new() -> Self {
        Self {
            active_connections: Mutex::new(HashMap::new()),
            connection_status: Mutex::new(HashMap::new()),
            keep_alive_handles: Mutex::new(HashMap::new()),
            connection_guards: Mutex::new(HashMap::new()),
            query_tokens: Mutex::new(HashMap::new()),
            tab_affinity: Mutex::new(HashMap::new()),
            query_server_pids: Mutex::new(HashMap::new()),
            introspection_pools: Mutex::new(HashMap::new()),
            session_id: uuid::Uuid::new_v4().to_string(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
pub(super) mod test_helpers {
    use super::*;
    use crate::models::{ConnectionConfig, ConnectionGroup};
    use crate::storage;
    use tempfile::TempDir;

    pub(crate) fn setup_test_env() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        dir
    }

    pub(crate) fn cleanup_test_env() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    pub(crate) fn sample_connection(id: &str, name: &str) -> ConnectionConfig {
        ConnectionConfig {
            id: id.to_string(),
            name: name.to_string(),
            db_type: DatabaseType::Postgresql,
            host: "localhost".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "secret".to_string(),
            database: "testdb".to_string(),
            read_only: false,
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
            trust_server_certificate: None,
        }
    }

    /// Test helper: invoke the `save_connection` Tauri command with a
    /// pre-existing `ConnectionConfig`. Treats `conn.password` as the new
    /// password (matching the historical single-arg `save_connection` shape).
    pub(crate) fn save_via_command(
        conn: ConnectionConfig,
        is_new: Option<bool>,
    ) -> Result<ConnectionConfigPublic, AppError> {
        let password = Some(conn.password.clone());
        let req = SaveConnectionRequest {
            connection: ConnectionConfigPublic::from(&conn),
            password,
            is_new,
        };
        super::save_connection(req)
    }

    pub(crate) fn load_storage() -> Result<crate::models::StorageData, AppError> {
        storage::load_storage_with_secrets()
    }

    /// Test helper: invoke storage::save_connection treating conn.password as
    /// the new plaintext (matches old single-arg behavior).
    pub(crate) fn storage_save_conn(conn: ConnectionConfig) -> Result<(), AppError> {
        let pw = Some(conn.password.clone());
        storage::save_connection(conn, pw)
    }

    pub(crate) fn sample_group(id: &str, name: &str) -> ConnectionGroup {
        ConnectionGroup {
            id: id.to_string(),
            name: name.to_string(),
            color: None,
            collapsed: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------
    // make_adapter factory tests (Sprint 65)
    // -------------------------------------------------------------------

    #[test]
    fn test_make_adapter_postgres_returns_rdb_variant() {
        let adapter = make_adapter(&DatabaseType::Postgresql).expect("postgres should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Rdb(_)),
            "expected Rdb variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Postgresql));
    }

    #[test]
    fn test_make_adapter_mongodb_returns_document_variant() {
        let adapter = make_adapter(&DatabaseType::Mongodb).expect("mongodb should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Document(_)),
            "expected Document variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Mongodb));
    }

    #[test]
    fn test_make_adapter_mysql_returns_rdb_variant() {
        // Sprint 281 (Phase 17 Slice A) — MySQL 어댑터가 Rdb variant 로
        // dispatch 되는지 회귀 가드. Slice A 이전엔 Unsupported 였음.
        let adapter = make_adapter(&DatabaseType::Mysql).expect("mysql should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Rdb(_)),
            "expected Rdb variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Mysql));
    }

    #[test]
    fn test_make_adapter_mariadb_returns_rdb_variant_with_mariadb_kind() {
        let adapter = make_adapter(&DatabaseType::Mariadb).expect("mariadb should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Rdb(_)),
            "expected Rdb variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Mariadb));
    }

    #[test]
    fn test_make_adapter_mssql_returns_runtime_rdb_variant() {
        let adapter = make_adapter(&DatabaseType::Mssql).expect("mssql should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Rdb(_)),
            "expected Rdb variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Mssql));
    }

    #[tokio::test]
    async fn test_make_adapter_mssql_rdb_methods_route_to_runtime() {
        let adapter = make_adapter(&DatabaseType::Mssql).expect("mssql should succeed");
        let rdb = adapter.as_rdb().expect("mssql is an RDB handle");

        assert_mssql_runtime_requires_open_connection(rdb.list_namespaces().await);
        assert_mssql_runtime_requires_open_connection(rdb.execute_sql("SELECT 1", None).await);
        assert_mssql_runtime_requires_open_connection(rdb.list_views("dbo").await);
        assert_mssql_runtime_requires_open_connection(rdb.list_functions("dbo").await);

        let drop = crate::models::DropTableRequest {
            connection_id: "mssql".into(),
            schema: "dbo".into(),
            table: "users".into(),
            cascade: false,
            preview_only: false,
            expected_database: None,
        };
        // #1071 — structured DDL is now wired through the shared dispatch path,
        // so the trait method builds the T-SQL and then surfaces the runtime
        // open-connection error (not the old #903 Unsupported boundary).
        assert_mssql_runtime_requires_open_connection(rdb.drop_table(&drop).await);
    }

    #[tokio::test]
    async fn test_make_adapter_oracle_returns_runtime_rdb_variant() {
        let adapter = make_adapter(&DatabaseType::Oracle).expect("oracle should dispatch");
        assert!(
            matches!(adapter, ActiveAdapter::Rdb(_)),
            "expected Rdb variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Oracle));

        let rdb = adapter.as_rdb().expect("oracle is an RDB handle");
        assert_eq!(rdb.current_database().await.unwrap(), None);
        assert_oracle_runtime_requires_open_connection(rdb.list_namespaces().await);

        let token = CancellationToken::new();
        token.cancel();
        assert_oracle_runtime_cancelled(rdb.execute_sql("SELECT 1 FROM DUAL", Some(&token)).await);

        let drop = crate::models::DropTableRequest {
            connection_id: "oracle".into(),
            schema: "SYSTEM".into(),
            table: "USERS".into(),
            cascade: false,
            preview_only: false,
            expected_database: None,
        };
        assert_oracle_runtime_slice_unsupported(rdb.drop_table(&drop).await, "structured DDL");
    }

    #[test]
    fn test_make_adapter_sqlite_returns_rdb_variant() {
        let adapter = make_adapter(&DatabaseType::Sqlite).expect("sqlite should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Rdb(_)),
            "expected Rdb variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Sqlite));
    }

    #[test]
    fn test_make_adapter_redis_returns_kv_variant() {
        let adapter = make_adapter(&DatabaseType::Redis).expect("redis should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Kv(_)),
            "expected Kv variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Redis));
    }

    fn assert_mssql_runtime_requires_open_connection<T: std::fmt::Debug>(
        result: Result<T, AppError>,
    ) {
        assert!(
            matches!(result, Err(AppError::Connection(ref message)) if message.contains("SQL Server connection is not open")),
            "expected MSSQL runtime open-connection error, got {result:?}"
        );
    }

    fn assert_oracle_runtime_requires_open_connection<T: std::fmt::Debug>(
        result: Result<T, AppError>,
    ) {
        assert!(
            matches!(result, Err(AppError::Connection(ref message)) if message.contains("Oracle connection is not open")),
            "expected Oracle runtime open-connection error, got {result:?}"
        );
    }

    fn assert_oracle_runtime_cancelled<T: std::fmt::Debug>(result: Result<T, AppError>) {
        assert!(
            matches!(result, Err(AppError::Database(ref message)) if message == "Query cancelled"),
            "expected Oracle cooperative cancellation, got {result:?}"
        );
    }

    fn assert_oracle_runtime_slice_unsupported<T: std::fmt::Debug>(
        result: Result<T, AppError>,
        surface: &str,
    ) {
        assert!(
            matches!(result, Err(AppError::Unsupported(ref message)) if message.contains("issue #905") && message.contains(surface)),
            "expected Oracle #905 runtime-slice Unsupported for {surface}, got {result:?}"
        );
    }

    #[test]
    fn test_make_adapter_duckdb_returns_rdb_variant() {
        let adapter = make_adapter(&DatabaseType::Duckdb).expect("duckdb should succeed");
        assert!(
            matches!(adapter, ActiveAdapter::Rdb(_)),
            "expected Rdb variant"
        );
        assert!(matches!(adapter.kind(), DatabaseType::Duckdb));
    }
}
