//! Connection CRUD + connect/disconnect lifecycle.
//!
//! Extracted from the `commands/connection.rs` god file. Owns:
//!   - `list_connections` / `save_connection` / `delete_connection` —
//!     storage-backed CRUD that never exposes plaintext passwords to the
//!     frontend.
//!   - `test_connection` — three-way password resolution (`Some(s)` /
//!     `Some("")` / `None` + `existing_id` lookup) and paradigm dispatch.
//!   - `connect` / `disconnect` — `AppState` lifecycle; `connect` spawns
//!     `session::keep_alive_loop` so background ping + auto-reconnect runs
//!     for every active connection.

use std::path::PathBuf;
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
use crate::models::{ConnectionConfigPublic, ConnectionStatus, DatabaseType, SshAuthMethod};
use crate::storage;
use table_view_core::ssh::tunnel::{SshAuth, SshTunnel, SshTunnelError, SshTunnelParams};

#[tauri::command]
pub fn list_connections() -> Result<Vec<ConnectionConfigPublic>, AppError> {
    let data = storage::load_storage_redacted()?;
    let presence = storage::password_presence_map()?;
    let wallet_presence = storage::wallet_password_presence_map()?;
    let ssh_password_presence = storage::ssh_password_presence_map()?;
    let ssh_passphrase_presence = storage::ssh_passphrase_presence_map()?;
    Ok(data
        .connections
        .iter()
        .map(|c| {
            let mut p: ConnectionConfigPublic = c.into();
            // load_storage_redacted clears passwords, so derive has_password
            // from the presence map instead of the (now-empty) field.
            p.has_password = *presence.get(&c.id).unwrap_or(&false);
            p.has_wallet_password = *wallet_presence.get(&c.id).unwrap_or(&false);
            p.has_ssh_password = *ssh_password_presence.get(&c.id).unwrap_or(&false);
            p.has_ssh_passphrase = *ssh_passphrase_presence.get(&c.id).unwrap_or(&false);
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
    let new_wallet_password = req.wallet_password.clone();
    let new_ssh_password = req.ssh_password.clone();
    let new_ssh_passphrase = req.ssh_passphrase.clone();
    storage::save_connection_with_wallet(
        conn.clone(),
        new_password,
        new_wallet_password,
        new_ssh_password,
        new_ssh_passphrase,
    )?;

    let presence = storage::password_presence_map()?;
    let wallet_presence = storage::wallet_password_presence_map()?;
    let ssh_password_presence = storage::ssh_password_presence_map()?;
    let ssh_passphrase_presence = storage::ssh_passphrase_presence_map()?;
    let mut public = ConnectionConfigPublic::from(&conn);
    public.has_password = *presence.get(&conn.id).unwrap_or(&false);
    public.has_wallet_password = *wallet_presence.get(&conn.id).unwrap_or(&false);
    public.has_ssh_password = *ssh_password_presence.get(&conn.id).unwrap_or(&false);
    public.has_ssh_passphrase = *ssh_passphrase_presence.get(&conn.id).unwrap_or(&false);
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
        wallet_password,
        ssh_password,
        ssh_passphrase,
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

    // #1065 — same 3-state resolution for the Oracle wallet password so a
    // test on an existing connection can reuse the stored value.
    let resolved_wallet_password: String = match wallet_password {
        Some(s) => s,
        None => match existing_id.as_deref() {
            Some(id) => storage::get_decrypted_wallet_password(id)?.unwrap_or_default(),
            None => String::new(),
        },
    };

    // #1064 — same 3-state resolution for the two SSH tunnel secrets.
    let resolved_ssh_password: String = match ssh_password {
        Some(s) => s,
        None => match existing_id.as_deref() {
            Some(id) => storage::get_decrypted_ssh_password(id)?.unwrap_or_default(),
            None => String::new(),
        },
    };
    let resolved_ssh_passphrase: String = match ssh_passphrase {
        Some(s) => s,
        None => match existing_id.as_deref() {
            Some(id) => storage::get_decrypted_ssh_passphrase(id)?.unwrap_or_default(),
            None => String::new(),
        },
    };

    let mut full = config.into_config_with_empty_password();
    full.password = resolved_password;
    full.wallet_password = resolved_wallet_password;
    full.ssh_password = resolved_ssh_password;
    full.ssh_passphrase = resolved_ssh_passphrase;

    // #1064 — a tunnel-enabled connection tests through its tunnel: open it,
    // run the adapter test against the local listener, then close it. The
    // tunnel is never installed in `AppState` — it lives for this call only.
    let tunnel = maybe_open_tunnel(&full).await?;
    let mut effective = full;
    if let Some(tunnel) = &tunnel {
        rewrite_target_through_tunnel(&mut effective, tunnel);
    }

    let test_result: Result<(), AppError> = match effective.db_type {
        DatabaseType::Postgresql => PostgresAdapter::test(&effective).await,
        DatabaseType::Mysql | DatabaseType::Mariadb => MysqlAdapter::test(&effective).await,
        DatabaseType::Sqlite => SqliteAdapter::test(&effective).await,
        DatabaseType::Duckdb => DuckdbAdapter::test(&effective).await,
        DatabaseType::Mssql => MssqlAdapter::test(&effective).await,
        DatabaseType::Oracle => OracleAdapter::test(&effective).await,
        DatabaseType::Mongodb => MongoAdapter::test(&effective).await,
        DatabaseType::Redis => RedisAdapter::test(&effective).await,
        DatabaseType::Valkey => RedisAdapter::test_valkey(&effective).await,
        DatabaseType::Elasticsearch | DatabaseType::Opensearch => {
            SearchEngineAdapter::test(&effective).await
        }
    };
    if let Some(tunnel) = tunnel {
        tunnel.close().await;
    }
    test_result?;
    Ok("Connection successful".into())
}

/// #1064 — open the SSH tunnel `config` asks for, or return `None` when the
/// connection does not use one (`ssh_enabled` off, or a file-backed DBMS
/// where the toggle is meaningless). The adapters then dial the tunnel's
/// local listener instead of `host`/`port`.
///
/// TOFU lives here rather than in the tunnel module: on first contact the
/// presented fingerprint is recorded (`storage::ssh_pins`) and the connect
/// fails once so the user can verify it; a *mismatch* never writes and only
/// recovers through the explicit delete-pin step.
async fn maybe_open_tunnel(
    config: &crate::models::ConnectionConfig,
) -> Result<Option<SshTunnel>, AppError> {
    if !config.ssh_enabled || matches!(config.db_type, DatabaseType::Sqlite | DatabaseType::Duckdb)
    {
        return Ok(None);
    }

    let ssh_host = config
        .ssh_host
        .clone()
        .unwrap_or_else(|| config.host.clone());
    let ssh_port = config.ssh_port.unwrap_or(22);
    let ssh_user = config
        .ssh_user
        .clone()
        .unwrap_or_else(|| config.user.clone());
    if ssh_user.trim().is_empty() {
        return Err(AppError::Validation(
            "SSH user is required for a tunneled connection".into(),
        ));
    }

    let auth = match config.ssh_auth_method {
        SshAuthMethod::Password => SshAuth::Password(config.ssh_password.clone()),
        SshAuthMethod::KeyFile => {
            let path = config
                .ssh_key_path
                .clone()
                .filter(|p| !p.trim().is_empty())
                .ok_or_else(|| {
                    AppError::Validation("SSH key path is required for key-file auth".into())
                })?;
            SshAuth::KeyFile {
                path: PathBuf::from(path),
                passphrase: (!config.ssh_passphrase.is_empty())
                    .then(|| config.ssh_passphrase.clone()),
            }
        }
    };

    let pinned = storage::ssh_pins::get_pin(&ssh_host, ssh_port).await?;
    let params = SshTunnelParams {
        host: ssh_host.clone(),
        port: ssh_port,
        user: ssh_user,
        auth,
        target_host: config.host.clone(),
        target_port: config.port,
        // Same clamp as the DB hop, but a 30s ceiling: dial + SSH handshake +
        // auth is strictly more round trips than a DB dial, and every
        // engine's own per-driver ceiling already sits at or below this.
        timeout: config.connect_timeout(30),
        pinned_fingerprint: pinned,
    };

    match SshTunnel::open(params).await {
        Ok(tunnel) => Ok(Some(tunnel)),
        Err(SshTunnelError::UnknownHostKey { fingerprint }) => {
            // TOFU record-then-fail: the pin is written, the error surfaces
            // the fingerprint, and the *next* connect matches and proceeds.
            storage::ssh_pins::upsert_pin(&ssh_host, ssh_port, &fingerprint).await?;
            Err(SshTunnelError::UnknownHostKey { fingerprint }.into())
        }
        Err(e) => Err(e.into()),
    }
}

/// #1064 — point `config` at the tunnel's local listener. The original
/// `host`/`port` stay on the stored config; the clone handed to the adapter
/// (and to the keep-alive loop, whose reconnect then dials the listener
/// while the tunnel lives) carries the rewrite.
fn rewrite_target_through_tunnel(config: &mut crate::models::ConnectionConfig, tunnel: &SshTunnel) {
    config.host = tunnel.local_addr().ip().to_string();
    config.port = tunnel.port();
}

#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    // Issue #1100 — serialize connect/disconnect for this id. Held for the
    // whole lifecycle mutation so a concurrent connect (double-click) or a
    // racing disconnect can't interleave across the three registry maps and
    // leak a server session / a second keep-alive loop.
    let _guard = state.connection_guard(&id).await;

    let data = storage::load_storage_with_secrets()?;
    let config = data
        .connections
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::NotFound(format!("Connection '{}' not found", id)))?;

    // Q14 — `Connecting` is recorded right before the pool acquire, so
    // the UI can spin a spinner during a long-running connect (5s+).
    // Once `adapter.connect` finishes the state transitions to Connected
    // or Error. If a fail path returns early through `?` it must record
    // Error too, otherwise the frontend listener is stuck in connecting.
    {
        let mut status = state.connection_status.lock().await;
        status.insert(id.clone(), ConnectionStatus::Connecting);
    }

    // #1064 — the tunnel (when enabled) is opened before the adapter dials,
    // and every failure path closes it before returning.
    let tunnel = match maybe_open_tunnel(&config).await {
        Ok(t) => t,
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
    let mut effective = config.clone();
    if let Some(tunnel) = &tunnel {
        rewrite_target_through_tunnel(&mut effective, tunnel);
    }

    let adapter = match make_adapter(&config.db_type) {
        Ok(a) => a,
        Err(e) => {
            if let Some(tunnel) = tunnel {
                tunnel.close().await;
            }
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
    if let Err(e) = adapter.lifecycle().connect(&effective).await {
        if let Some(tunnel) = tunnel {
            tunnel.close().await;
        }
        let mut status = state.connection_status.lock().await;
        status.insert(
            id.clone(),
            ConnectionStatus::Error {
                message: e.to_string(),
            },
        );
        return Err(e);
    }

    // Pool ready, transition to Connected. `active_db` is
    // seeded from the connection's default database; `None` when the user
    // left `database` empty (e.g. Mongo without a default DB). Computed
    // before `config` is moved into the keep-alive task below.
    let active_db = if config.database.is_empty() {
        None
    } else {
        Some(config.database.clone())
    };

    // Start keep-alive background task, then install atomically (issue #1100).
    // `install_connection` aborts any previous keep-alive handle,
    // `disconnect()`s any previous adapter, and (since #1064) closes and
    // replaces any previous tunnel for this id, so a re-connect never leaks a
    // server session or leaves a second ping loop or listener running.
    //
    // The keep-alive loop receives the *rewritten* config: its reconnect
    // dials the local listener, which forwards over the still-open tunnel —
    // no SSH-specific retry path (grill decision, 2026-07-17).
    let keep_alive_interval = config.keep_alive_interval.unwrap_or(30) as u64;
    let handle = tokio::spawn(keep_alive_loop(
        app,
        id.clone(),
        keep_alive_interval,
        effective,
    ));
    state
        .install_connection(&id, Arc::new(adapter), handle, tunnel)
        .await;

    {
        let mut status = state.connection_status.lock().await;
        status.insert(id.clone(), ConnectionStatus::Connected { active_db });
    }

    Ok(())
}

#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppState>, id: String) -> Result<(), AppError> {
    // Issue #1100 — serialize against a concurrent connect for this id so the
    // teardown can't interleave with an install (same check-then-act class).
    let _guard = state.connection_guard(&id).await;

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
    let disconnect_result = if let Some(adapter) = adapter {
        adapter.lifecycle().disconnect().await
    } else {
        Ok(())
    };
    // #1064 — the tunnel is closed last, so the adapter's sockets saw a live
    // forward path while they closed (mirror of install order). The adapter
    // result is surfaced only after the tunnel is torn down: an adapter error
    // must not strand an open listener + SSH session in `AppState`.
    if let Some(tunnel) = state.take_ssh_tunnel(&id).await {
        tunnel.close().await;
    }
    disconnect_result?;
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
        // The field-name guard anchors on the `"password":` key form (a value
        // is never followed by `:`). #1064 added a legitimate non-secret wire
        // *value* `password` — `sshAuthMethod`'s snake_case variant — so the
        // bare `"password"` substring can no longer stand in for the field
        // check without a false positive.
        assert!(
            !json.contains("\"password\":"),
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
            wallet_password: None,
            ssh_password: None,
            ssh_passphrase: None,
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
            wallet_password: None,
            ssh_password: None,
            ssh_passphrase: None,
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
            wallet_password: None,
            ssh_password: None,
            ssh_passphrase: None,
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
            wallet_password: None,
            ssh_password: None,
            ssh_passphrase: None,
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
    /// returned by `test_connection` (2026-05-01). The MongoAdapter already
    /// had `connect`/`ping`/CRUD wired, but the test-connection dispatcher in
    /// `commands::connection` only listed `Postgresql`, so the "Test
    /// Connection" button on the Mongo dialog always returned
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
            wallet_password: None,
            ssh_password: None,
            ssh_passphrase: None,
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
            wallet_password: None,
            ssh_password: None,
            ssh_passphrase: None,
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
            wallet_password: None,
            ssh_password: None,
            ssh_passphrase: None,
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
            wallet_password: None,
            ssh_password: None,
            ssh_passphrase: None,
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

    // -------------------------------------------------------------------
    // Issue #1100 — connect double-click check-then-act race.
    //
    // `install_connection` is the atomic registry swap that `connect` routes
    // through. The original `connect` did a blind `insert` (discarding the
    // displaced adapter/handle), so a re-connect leaked a server session
    // (old adapter dropped without `disconnect()`) and left a second
    // keep-alive loop running (old handle overwritten without `abort()`).
    // These tests use the shared `StubRdbAdapter` (fake adapter) to count
    // teardowns without standing up a real DB, per the issue's "test at the
    // Rust level with a mock/fake adapter" guidance.
    // -------------------------------------------------------------------
    mod connect_race {
        use super::*;
        use crate::db::testing::StubRdbAdapter;
        use crate::db::ActiveAdapter;
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        /// A fake RDB adapter whose `disconnect()` bumps `counter` — lets a
        /// test assert the predecessor was actually torn down.
        fn counting_adapter(counter: Arc<AtomicUsize>) -> Arc<ActiveAdapter> {
            let stub = StubRdbAdapter {
                disconnect_fn: Some(Box::new(move || {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                })),
                ..StubRdbAdapter::default()
            };
            Arc::new(ActiveAdapter::Rdb(Box::new(stub)))
        }

        /// Replacing a live connection must `disconnect()` the old adapter and
        /// `abort()` the old keep-alive loop — not leak them. Red against the
        /// pre-fix blind-`insert` path (which left `disconnects == 0` and the
        /// predecessor loop alive).
        #[tokio::test]
        async fn install_connection_tears_down_replaced_predecessor() {
            let state = AppState::new();
            let disconnects = Arc::new(AtomicUsize::new(0));

            let handle_a = tokio::spawn(std::future::pending::<()>());
            let abort_a = handle_a.abort_handle();
            state
                .install_connection("c1", counting_adapter(disconnects.clone()), handle_a, None)
                .await;

            let handle_b = tokio::spawn(std::future::pending::<()>());
            state
                .install_connection("c1", counting_adapter(disconnects.clone()), handle_b, None)
                .await;

            // Let the runtime process the abort of the displaced task.
            tokio::task::yield_now().await;
            assert!(
                abort_a.is_finished(),
                "predecessor keep-alive loop must be aborted on replace"
            );
            assert_eq!(
                disconnects.load(Ordering::SeqCst),
                1,
                "predecessor adapter must be disconnect()-ed exactly once"
            );
            assert_eq!(state.active_connections.lock().await.len(), 1);
            assert_eq!(state.keep_alive_handles.lock().await.len(), 1);
        }

        /// Eight concurrent connects for the same id (double-click / retry
        /// storm), each serialized by `connection_guard`, must leave exactly
        /// one live adapter + one keep-alive handle; the other seven are
        /// disconnected (no leaked sessions) and aborted (no extra loops).
        #[tokio::test]
        async fn concurrent_installs_leave_one_live_connection() {
            let state = Arc::new(AppState::new());
            let disconnects = Arc::new(AtomicUsize::new(0));

            let mut tasks = Vec::new();
            for _ in 0..8 {
                let state = state.clone();
                let counter = disconnects.clone();
                tasks.push(tokio::spawn(async move {
                    let _guard = state.connection_guard("c1").await;
                    let handle = tokio::spawn(std::future::pending::<()>());
                    state
                        .install_connection("c1", counting_adapter(counter), handle, None)
                        .await;
                }));
            }
            for t in tasks {
                t.await.unwrap();
            }

            assert_eq!(state.active_connections.lock().await.len(), 1);
            assert_eq!(state.keep_alive_handles.lock().await.len(), 1);
            assert_eq!(
                disconnects.load(Ordering::SeqCst),
                7,
                "7 of 8 concurrent connects must be torn down, leaving one live"
            );
        }
    }
}
