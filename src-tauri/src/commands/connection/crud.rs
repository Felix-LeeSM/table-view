//! Sprint 209 — connection CRUD + connect/disconnect lifecycle.
//!
//! Extracted from the 1710-line `commands/connection.rs` god file. Owns:
//!   - `list_connections` / `save_connection` / `delete_connection` —
//!     storage-backed CRUD that never exposes plaintext passwords to the
//!     frontend.
//!   - `test_connection` — three-way password resolution (`Some(s)` /
//!     `Some("")` / `None` + `existing_id` lookup) and paradigm dispatch.
//!   - `connect` / `disconnect` — `AppState` lifecycle; `connect` spawns
//!     `session::keep_alive_loop` so background ping + auto-reconnect runs
//!     for every active connection.

use std::sync::Arc;

use super::session::keep_alive_loop;
use super::{make_adapter, AppState, SaveConnectionRequest, TestConnectionRequest};
use crate::db::mongodb::MongoAdapter;
use crate::db::mysql::MysqlAdapter;
use crate::db::postgres::PostgresAdapter;
use crate::db::redis::RedisAdapter;
use crate::db::search::SearchEngineAdapter;
use crate::db::sqlite::SqliteAdapter;
use crate::db::DuckdbAdapter;
use crate::db::MssqlAdapter;
use crate::db::OracleAdapter;
use crate::error::AppError;
use crate::models::{ConnectionConfigPublic, ConnectionStatus, DatabaseType};
use crate::storage;

#[tauri::command]
pub fn list_connections() -> Result<Vec<ConnectionConfigPublic>, AppError> {
    let data = storage::load_storage_redacted()?;
    let presence = storage::password_presence_map()?;
    Ok(data
        .connections
        .iter()
        .map(|c| {
            let mut p: ConnectionConfigPublic = c.into();
            // load_storage_redacted clears passwords, so derive has_password
            // from the presence map instead of the (now-empty) field.
            p.has_password = *presence.get(&c.id).unwrap_or(&false);
            p
        })
        .collect())
}

#[tauri::command]
pub fn save_connection(req: SaveConnectionRequest) -> Result<ConnectionConfigPublic, AppError> {
    if req.connection.name.trim().is_empty() {
        return Err(AppError::Validation("Connection name is required".into()));
    }
    let is_file_backed = matches!(
        &req.connection.db_type,
        DatabaseType::Sqlite | DatabaseType::Duckdb
    );
    if !is_file_backed && req.connection.host.trim().is_empty() {
        return Err(AppError::Validation("Host is required".into()));
    }
    match &req.connection.db_type {
        DatabaseType::Sqlite => {
            SqliteAdapter::validate_user_database_path(&req.connection.database)?;
        }
        DatabaseType::Duckdb => {
            DuckdbAdapter::validate_user_database_path(&req.connection.database)?;
        }
        _ => {}
    }

    let mut conn = req.connection.into_config_with_empty_password();
    if req.is_new.unwrap_or(false) {
        conn.id = uuid::Uuid::new_v4().to_string();
    }

    let new_password = req.password.clone();
    storage::save_connection(conn.clone(), new_password)?;

    let presence = storage::password_presence_map()?;
    let mut public = ConnectionConfigPublic::from(&conn);
    public.has_password = *presence.get(&conn.id).unwrap_or(&false);
    Ok(public)
}

#[tauri::command]
pub fn delete_connection(id: String) -> Result<(), AppError> {
    storage::delete_connection(&id)
}

#[tauri::command]
pub async fn test_connection(req: TestConnectionRequest) -> Result<String, AppError> {
    let TestConnectionRequest {
        config,
        password,
        existing_id,
    } = req;

    // Resolve which plaintext password to use for the test.
    let resolved_password: String = match password {
        Some(s) => s,
        None => match existing_id.as_deref() {
            Some(id) => storage::get_decrypted_password(id)?.unwrap_or_default(),
            None => String::new(),
        },
    };

    let mut full = config.into_config_with_empty_password();
    full.password = resolved_password;

    match full.db_type {
        DatabaseType::Postgresql => {
            PostgresAdapter::test(&full).await?;
        }
        DatabaseType::Mysql | DatabaseType::Mariadb => {
            MysqlAdapter::test(&full).await?;
        }
        DatabaseType::Sqlite => {
            SqliteAdapter::test(&full).await?;
        }
        DatabaseType::Duckdb => {
            DuckdbAdapter::test(&full).await?;
        }
        DatabaseType::Mssql => {
            MssqlAdapter::test(&full).await?;
        }
        DatabaseType::Oracle => {
            OracleAdapter::test(&full).await?;
        }
        DatabaseType::Mongodb => {
            MongoAdapter::test(&full).await?;
        }
        DatabaseType::Redis => {
            RedisAdapter::test(&full).await?;
        }
        DatabaseType::Valkey => {
            RedisAdapter::test_valkey(&full).await?;
        }
        DatabaseType::Elasticsearch | DatabaseType::Opensearch => {
            SearchEngineAdapter::test(&full).await?;
        }
    }
    Ok("Connection successful".into())
}

#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    let data = storage::load_storage_with_secrets()?;
    let config = data
        .connections
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::NotFound(format!("Connection '{}' not found", id)))?;

    // Sprint 364 (Phase 3 Q14) — `Connecting` 진입은 pool acquire 직전.
    // long-running connect (5s+) 동안 UI 가 spinner 를 띄울 수 있도록
    // 상태 map 에 먼저 기록하고, adapter.connect 가 끝나면 Connected /
    // Error 로 transition. fail path 가 ?  연산자로 일찍 return 하면 Error
    // 까지 기록해야 frontend listener 가 stuck-in-connecting 을 보지 않음.
    {
        let mut status = state.connection_status.lock().await;
        status.insert(id.clone(), ConnectionStatus::Connecting);
    }

    let adapter = match make_adapter(&config.db_type) {
        Ok(a) => a,
        Err(e) => {
            let mut status = state.connection_status.lock().await;
            status.insert(
                id.clone(),
                ConnectionStatus::Error {
                    message: e.to_string(),
                },
            );
            return Err(e);
        }
    };
    if let Err(e) = adapter.lifecycle().connect(&config).await {
        let mut status = state.connection_status.lock().await;
        status.insert(
            id.clone(),
            ConnectionStatus::Error {
                message: e.to_string(),
            },
        );
        return Err(e);
    }

    // Abort any previous keep-alive task for this connection
    {
        let mut handles = state.keep_alive_handles.lock().await;
        if let Some(old_handle) = handles.remove(&id) {
            old_handle.abort();
        }
    }

    {
        let mut connections = state.active_connections.lock().await;
        connections.insert(id.clone(), Arc::new(adapter));
    }
    {
        // Sprint 364 — pool ready, transition to Connected. `active_db` is
        // seeded from the connection's default database; `None` when the
        // user left `database` empty (e.g. Mongo without a default DB).
        let active_db = if config.database.is_empty() {
            None
        } else {
            Some(config.database.clone())
        };
        let mut status = state.connection_status.lock().await;
        status.insert(id.clone(), ConnectionStatus::Connected { active_db });
    }

    // Start keep-alive background task
    let keep_alive_interval = config.keep_alive_interval.unwrap_or(30) as u64;
    let handle = tokio::spawn(keep_alive_loop(
        app,
        id.clone(),
        keep_alive_interval,
        config,
    ));
    {
        let mut handles = state.keep_alive_handles.lock().await;
        handles.insert(id, handle);
    }

    Ok(())
}

#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppState>, id: String) -> Result<(), AppError> {
    // Cancel keep-alive task
    {
        let mut handles = state.keep_alive_handles.lock().await;
        if let Some(handle) = handles.remove(&id) {
            handle.abort();
        }
    }

    let adapter = {
        let mut connections = state.active_connections.lock().await;
        connections.remove(&id)
    };
    if let Some(adapter) = adapter {
        adapter.lifecycle().disconnect().await?;
    }
    {
        let mut status = state.connection_status.lock().await;
        status.insert(id, ConnectionStatus::Disconnected);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::*;
    use super::*;
    use serial_test::serial;
    use tokio::net::TcpListener;

    // AC-11: save_connection validates empty name and empty host
    #[test]
    fn test_save_connection_rejects_empty_name() {
        let conn = sample_connection("c1", "");
        let result = save_via_command(conn.clone(), None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("name is required")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_save_connection_rejects_whitespace_name() {
        let conn = sample_connection("c1", "   ");
        let result = save_via_command(conn, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_save_connection_rejects_empty_host() {
        let mut conn = sample_connection("c1", "MyDB");
        conn.host = String::new();
        let result = save_via_command(conn, None);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Host is required")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_save_connection_rejects_whitespace_host() {
        let mut conn = sample_connection("c1", "MyDB");
        conn.host = "   ".to_string();
        let result = save_via_command(conn, None);
        assert!(result.is_err());
    }

    // AC-12: save_connection with is_new=true generates UUID
    #[test]
    #[serial]
    fn test_save_connection_generates_uuid_when_is_new() {
        let _dir = setup_test_env();

        let conn = sample_connection("placeholder-id", "MyDB");
        let result = save_via_command(conn, Some(true)).unwrap();

        // UUID should differ from the placeholder id
        assert_ne!(result.id, "placeholder-id");
        // UUID should be a valid v4 format (36 chars with dashes)
        assert_eq!(result.id.len(), 36);
        assert!(result.id.contains('-'));

        // The saved connection should be loadable with the new UUID
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, result.id);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_save_connection_keeps_id_when_not_new() {
        let _dir = setup_test_env();

        let conn = sample_connection("my-custom-id", "MyDB");
        let result = save_via_command(conn, Some(false)).unwrap();

        assert_eq!(result.id, "my-custom-id");

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_save_connection_keeps_id_when_is_new_is_none() {
        let _dir = setup_test_env();

        let conn = sample_connection("my-custom-id", "MyDB");
        let result = save_via_command(conn, None).unwrap();

        assert_eq!(result.id, "my-custom-id");

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_list_connections_returns_from_storage() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "DB1")).unwrap();
        storage_save_conn(sample_connection("c2", "DB2")).unwrap();

        let connections = list_connections().unwrap();
        assert_eq!(connections.len(), 2);

        cleanup_test_env();
    }

    #[test]
    #[serial]
    fn test_delete_connection_command_removes_connection() {
        let _dir = setup_test_env();

        storage_save_conn(sample_connection("c1", "DB1")).unwrap();
        delete_connection("c1".to_string()).unwrap();

        let loaded = load_storage().unwrap();
        assert!(loaded.connections.is_empty());

        cleanup_test_env();
    }

    // -------------------------------------------------------------------
    // Password security regression tests (Phase B)
    // -------------------------------------------------------------------

    /// list_connections must NEVER include the plaintext password in the
    /// payload sent to the frontend, even when the password is stored.
    #[test]
    #[serial]
    fn test_list_connections_omits_plaintext_password() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "Sup3r!7".to_string();
        storage_save_conn(conn).unwrap();

        let publics = list_connections().unwrap();
        assert_eq!(publics.len(), 1);
        assert!(publics[0].has_password);

        // Serialize the wire format and assert the secret is not present
        let json = serde_json::to_string(&publics).unwrap();
        assert!(
            !json.contains("Sup3r!7"),
            "Plaintext password leaked into list_connections payload: {}",
            json
        );
        assert!(
            !json.contains("\"password\""),
            "Public payload must not include any 'password' field: {}",
            json
        );

        cleanup_test_env();
    }

    /// save_connection with `password = None` must preserve the existing
    /// stored password rather than clearing it.
    #[test]
    #[serial]
    fn test_save_connection_password_none_preserves_existing() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "origpw".into();
        storage_save_conn(conn).unwrap();

        // Now "edit" the connection without sending a new password
        let updated = sample_connection("c1", "DB1 edited");
        let req = SaveConnectionRequest {
            connection: ConnectionConfigPublic::from(&updated),
            password: None,
            is_new: Some(false),
        };
        save_connection(req).unwrap();

        // The decrypted password should still be the original
        let pw = storage::get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some("origpw".to_string()));

        cleanup_test_env();
    }

    /// `password = Some("")` must explicitly clear the stored password.
    #[test]
    #[serial]
    fn test_save_connection_password_empty_string_clears() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "before".into();
        storage_save_conn(conn).unwrap();

        let stub = sample_connection("c1", "DB1");
        let req = SaveConnectionRequest {
            connection: ConnectionConfigPublic::from(&stub),
            password: Some(String::new()),
            is_new: Some(false),
        };
        save_connection(req).unwrap();

        let pw = storage::get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some(String::new()));

        let publics = list_connections().unwrap();
        assert!(!publics[0].has_password);

        cleanup_test_env();
    }

    /// `password = Some(s)` must replace the stored password.
    #[test]
    #[serial]
    fn test_save_connection_password_some_replaces() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "old".into();
        storage_save_conn(conn).unwrap();

        let stub = sample_connection("c1", "DB1");
        let req = SaveConnectionRequest {
            connection: ConnectionConfigPublic::from(&stub),
            password: Some("brand-new".into()),
            is_new: Some(false),
        };
        save_connection(req).unwrap();

        let pw = storage::get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some("brand-new".to_string()));

        cleanup_test_env();
    }

    /// test_connection without an explicit password must look up the stored
    /// one when `existing_id` is supplied (so the dialog can run a test
    /// without the user re-typing the password).
    #[tokio::test]
    #[serial]
    async fn test_test_connection_uses_stored_password_when_omitted() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "lkpme".into();
        // Use a host that won't resolve so the test fails fast at the network
        // step — we only care whether the password resolution path ran.
        conn.host = "definitely-not-a-real-host.invalid".into();
        storage_save_conn(conn.clone()).unwrap();

        // Send no password, but supply existing_id. Storage lookup should
        // succeed; then the postgres adapter will fail to actually connect,
        // which is fine — the assertion is that get_decrypted_password ran.
        let req = TestConnectionRequest {
            config: ConnectionConfigPublic::from(&conn),
            password: None,
            existing_id: Some("c1".into()),
        };
        let result = test_connection(req).await;
        // We expect a connection error (host doesn't resolve), NOT a missing
        // password error. The mere fact that we got past the password lookup
        // is what's being verified.
        assert!(
            result.is_err(),
            "Expected connection failure to invalid host"
        );

        // Sanity: stored password is still intact and decryptable
        let pw = storage::get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some("lkpme".to_string()));

        cleanup_test_env();
    }

    /// Regression for "Unsupported operation: Mongodb is not supported yet"
    /// returned by `test_connection` (2026-05-01). The MongoAdapter has had
    /// `connect`/`ping`/CRUD wired since Sprint 65–80, but the test-connection
    /// dispatcher in `commands::connection` only listed `Postgresql`, so the
    /// "Test Connection" button on the Mongo dialog always returned
    /// `AppError::Unsupported`.
    ///
    /// The assertion is purely about routing: we send an unreachable host
    /// (with a tight server-selection timeout so the test stays fast) and
    /// require that the resulting error is `Connection(_)` — *not*
    /// `Unsupported(_)`.
    #[tokio::test]
    #[serial]
    async fn test_test_connection_routes_mongodb_to_mongo_adapter() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("m1", "Mongo1");
        conn.db_type = DatabaseType::Mongodb;
        conn.port = 27017;
        conn.host = "definitely-not-a-real-host.invalid".into();
        conn.password = String::new();
        conn.user = String::new();
        // Cap server-selection so the test doesn't sit on the driver's
        // default 30-second timeout.
        conn.connection_timeout = Some(1);

        let req = TestConnectionRequest {
            config: ConnectionConfigPublic::from(&conn),
            password: Some(String::new()),
            existing_id: None,
        };
        let result = test_connection(req).await;

        match result {
            Err(AppError::Connection(_)) => { /* expected */ }
            Err(AppError::Unsupported(msg)) => {
                panic!("Mongodb routing regressed — got Unsupported: {msg}");
            }
            other => panic!("Expected AppError::Connection, got: {:?}", other),
        }

        cleanup_test_env();
    }

    #[tokio::test]
    #[serial]
    async fn test_test_connection_routes_elasticsearch_to_live_search_adapter() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("s1", "Search1");
        conn.db_type = DatabaseType::Elasticsearch;
        conn.port = unused_tcp_port().await;
        conn.host = "127.0.0.1".into();
        conn.password = String::new();
        conn.user = String::new();
        conn.database = String::new();
        conn.connection_timeout = Some(1);

        let req = TestConnectionRequest {
            config: ConnectionConfigPublic::from(&conn),
            password: Some(String::new()),
            existing_id: None,
        };
        let result = test_connection(req).await;

        match result {
            Err(AppError::SearchNetwork(msg)) => {
                assert!(msg.contains("Elasticsearch network error"));
            }
            Err(AppError::Unsupported(msg)) => {
                panic!("Elasticsearch routing regressed — got Unsupported: {msg}");
            }
            other => panic!("Expected Elasticsearch connection error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    async fn unused_tcp_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        listener.local_addr().unwrap().port()
    }

    #[tokio::test]
    #[serial]
    async fn test_test_connection_routes_opensearch_to_live_search_adapter() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("s1", "OpenSearch1");
        conn.port = unused_tcp_port().await;
        conn.host = "127.0.0.1".into();
        conn.db_type = DatabaseType::Opensearch;
        conn.password = String::new();
        conn.user = String::new();
        conn.database = String::new();
        conn.connection_timeout = Some(1);

        let req = TestConnectionRequest {
            config: ConnectionConfigPublic::from(&conn),
            password: Some(String::new()),
            existing_id: None,
        };
        let result = test_connection(req).await;

        match result {
            Err(AppError::SearchNetwork(msg)) => {
                assert!(msg.contains("OpenSearch network error"));
            }
            Err(AppError::Unsupported(msg)) => {
                panic!("OpenSearch routing regressed — got Unsupported: {msg}");
            }
            other => panic!("Expected OpenSearch connection error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    #[tokio::test]
    #[serial]
    async fn test_test_connection_routes_valkey_to_valkey_adapter() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("v1", "Valkey1");
        conn.db_type = DatabaseType::Valkey;
        conn.port = 6379;
        conn.host = "definitely-not-a-real-host.invalid".into();
        conn.database = "0".into();
        conn.password = String::new();
        conn.user = String::new();

        let req = TestConnectionRequest {
            config: ConnectionConfigPublic::from(&conn),
            password: Some(String::new()),
            existing_id: None,
        };
        let result = test_connection(req).await;

        match result {
            Err(AppError::Connection(msg)) => {
                assert!(msg.contains("Valkey connection failed"));
            }
            Err(AppError::Unsupported(msg)) => {
                panic!("Valkey routing regressed — got Unsupported: {msg}");
            }
            other => panic!("Expected Valkey connection error, got: {:?}", other),
        }

        cleanup_test_env();
    }
}
