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
use crate::db::postgres::PostgresAdapter;
use crate::db::ActiveAdapter;
use crate::error::AppError;
use crate::models::{ConnectionConfigPublic, ConnectionStatus, DatabaseType};

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
/// MySQL/SQLite still map to `AppError::Unsupported` pending Phase 9.
pub(crate) fn make_adapter(db_type: &DatabaseType) -> Result<ActiveAdapter, AppError> {
    match db_type {
        DatabaseType::Postgresql => Ok(ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()))),
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
    fn test_make_adapter_mysql_returns_unsupported() {
        match make_adapter(&DatabaseType::Mysql) {
            Err(AppError::Unsupported(msg)) => {
                assert!(msg.contains("Mysql"), "unexpected message: {msg}");
            }
            other => panic!("expected Unsupported, got: {:?}", other.is_ok()),
        }
    }

    #[test]
    fn test_make_adapter_sqlite_returns_unsupported() {
        assert!(matches!(
            make_adapter(&DatabaseType::Sqlite),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn test_make_adapter_redis_returns_unsupported() {
        assert!(matches!(
            make_adapter(&DatabaseType::Redis),
            Err(AppError::Unsupported(_))
        ));
    }
}
