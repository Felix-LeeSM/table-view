//! Sprint 209 — `commands/connection` entry. 1710-line god file 를
//! 5-way split (entry + session / crud / groups / io).
//!
//! Entry retains:
//!   - `AppState` + `impl AppState` + `impl Default for AppState` —
//!     8 internal `crate::commands::*` users import this directly.
//!   - `make_adapter` `pub(crate)` factory — used by `crud::connect` and
//!     `session::keep_alive_loop`.
//!   - `SaveConnectionRequest` / `TestConnectionRequest` request bodies —
//!     consumed by `crud::save_connection` / `crud::test_connection` and
//!     constructed in tests under `test_helpers`.
//!   - `pub use {session,crud,groups,io}::*;` re-exports so
//!     `lib.rs::invoke_handler!` and external users keep
//!     `commands::connection::<command>` paths.
//!
//! `mod test_helpers` (cfg-test) provides the shared fixtures
//! (`sample_connection` / `save_via_command` / `setup_test_env` / …) every
//! sub-module's `#[cfg(test)] mod tests` reuses.

use std::collections::HashMap;

use serde::Deserialize;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::db::mongodb::MongoAdapter;
use crate::db::mysql::MysqlAdapter;
use crate::db::postgres::PostgresAdapter;
use crate::db::sqlite::SqliteAdapter;
use crate::db::ActiveAdapter;
use crate::error::AppError;
use crate::models::{ConnectionConfigPublic, ConnectionStatus, DatabaseType};
use crate::state::introspection_pool::IntrospectionPool;

pub mod crud;
pub mod groups;
pub mod io;
pub mod session;

pub use crud::{
    connect, delete_connection, disconnect, list_connections, save_connection, test_connection,
};
pub use groups::{delete_group, list_groups, move_connection_to_group, save_group};
pub use io::{
    export_connections, export_connections_encrypted, import_connections,
    import_connections_encrypted, EncryptedExportResult, ExportPayload, ImportResult, RenamedEntry,
};
pub use session::get_session_id;

/// Build an `ActiveAdapter` for the given database type.
///
/// Sprint 65 adds MongoDB dispatch on top of Sprint 64's Postgres wiring.
/// Sprint 281 (Phase 17 Slice A) wires MySQL — RdbAdapter read path
/// (namespaces / tables / columns) is live; DDL / queries / streaming
/// surfaces still return `AppError::Unsupported` until Slice B~G land.
/// MariaDB shares the MySQL protocol adapter while preserving its distinct
/// `DatabaseType` on the active adapter. SQLite has a file-backed adapter;
/// MSSQL / Oracle remain explicit unsupported variants until their adapter
/// slices land.
pub(crate) fn make_adapter(db_type: &DatabaseType) -> Result<ActiveAdapter, AppError> {
    match db_type {
        DatabaseType::Postgresql => Ok(ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()))),
        DatabaseType::Mysql => Ok(ActiveAdapter::Rdb(Box::new(MysqlAdapter::new()))),
        DatabaseType::Mariadb => Ok(ActiveAdapter::Rdb(Box::new(MysqlAdapter::new_mariadb()))),
        DatabaseType::Sqlite => Ok(ActiveAdapter::Rdb(Box::new(SqliteAdapter::new()))),
        DatabaseType::Mongodb => Ok(ActiveAdapter::Document(Box::new(MongoAdapter::new()))),
        other => Err(AppError::Unsupported(format!(
            "Database type {:?} is not supported yet",
            other
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
/// Lives in `AppState.tab_affinity` under `(connection_id, tab_id)` so the
/// same `tab_id` opened against two distinct connections never collides
/// (codex 7차 #4). Stores the **native server-side identifier** used by
/// `cancel_query_native`:
///
/// * PostgreSQL → `pg_backend_pid()` (i32 surfaced as i64).
/// * MySQL      → `CONNECTION_ID()` thread id (u64 → i64 fits).
/// * MongoDB    → opid (server-assigned) discovered at execute time.
///
/// Boot value is `None` for every tab (Q5.6 lazy) — we materialise the
/// record only after the first `executeQuery(tab_id, …)` round-trip
/// records a real server pid.
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
    pub active_connections: Mutex<HashMap<String, ActiveAdapter>>,
    pub connection_status: Mutex<HashMap<String, ConnectionStatus>>,
    pub keep_alive_handles: Mutex<HashMap<String, JoinHandle<()>>>,
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
    pub fn new() -> Self {
        Self {
            active_connections: Mutex::new(HashMap::new()),
            connection_status: Mutex::new(HashMap::new()),
            keep_alive_handles: Mutex::new(HashMap::new()),
            query_tokens: Mutex::new(HashMap::new()),
            tab_affinity: Mutex::new(HashMap::new()),
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
            group_id: None,
            color: None,
            connection_timeout: None,
            keep_alive_interval: None,
            environment: None,
            auth_source: None,
            replica_set: None,
            tls_enabled: None,
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
    fn test_make_adapter_mssql_returns_unsupported() {
        assert!(matches!(
            make_adapter(&DatabaseType::Mssql),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn test_make_adapter_oracle_returns_unsupported() {
        assert!(matches!(
            make_adapter(&DatabaseType::Oracle),
            Err(AppError::Unsupported(_))
        ));
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
    fn test_make_adapter_redis_returns_unsupported() {
        assert!(matches!(
            make_adapter(&DatabaseType::Redis),
            Err(AppError::Unsupported(_))
        ));
    }
}
