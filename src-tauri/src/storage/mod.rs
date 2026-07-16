pub mod corrupt_recovery;
pub mod crypto;
pub mod history_audit;
pub mod history_retention_boot;
pub mod key_migration;
pub mod legacy_cleanup;
pub mod local;
pub mod local_files;
pub mod meta;
pub mod mismatch_metric;
pub mod reconcile;
pub mod sql_redact;

use crate::error::AppError;
use crate::models::{ConnectionConfig, ConnectionGroup, StorageData};
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tracing::{debug, error, info, warn};
use zeroize::Zeroizing;

/// In-process lock to prevent TOCTOU race conditions between concurrent Tauri commands.
/// Storage operations are all synchronous (blocking file I/O), so std::sync::Mutex is correct.
static STORAGE_LOCK: LazyLock<std::sync::Mutex<()>> = LazyLock::new(|| std::sync::Mutex::new(()));

/// #1103 / Sprint 356 — process master key resolved once at boot by
/// [`boot_wire_master_key`] (which runs the keyring migration) and read by
/// every storage secret path. `None` until boot seeds it; the sole in-process
/// writer is boot, so the seeded key is effectively immutable at runtime.
/// P3-3 (#1455) — the raw AES key lives in a [`Zeroizing`] buffer so the
/// static and every per-decrypt clone are wiped on drop, matching the envelope
/// key path (`crypto::derive_envelope_key`). The derived `Vec<u8>` used to
/// linger in freed heap until overwritten.
static MASTER_KEY: Mutex<Option<Zeroizing<Vec<u8>>>> = Mutex::new(None);

/// #1103 — seed the process master key from the boot-time keyring migration
/// ([`key_migration::migrate_or_initialize`]). Called once from `lib.rs::run()`
/// before any IPC handler can fire.
pub fn seed_master_key(key: Vec<u8>) -> Result<(), AppError> {
    *MASTER_KEY
        .lock()
        .map_err(|e| AppError::Storage(format!("Master key lock error: {}", e)))? =
        Some(Zeroizing::new(key));
    Ok(())
}

/// Resolve the AES master key for encrypt/decrypt. Returns the boot-seeded
/// keyring key when present; otherwise (unit tests, or any call before boot
/// wiring runs) falls back to the on-disk `.key` via
/// [`crypto::get_or_create_key`], preserving the pre-#1103 behavior and its
/// #1093 orphan guard.
fn master_key() -> Result<Zeroizing<Vec<u8>>, AppError> {
    if let Some(key) = MASTER_KEY
        .lock()
        .map_err(|e| AppError::Storage(format!("Master key lock error: {}", e)))?
        .as_ref()
    {
        return Ok(key.clone());
    }
    Ok(Zeroizing::new(crypto::get_or_create_key()?))
}

/// #1103 — boot-time master-key resolution. Runs the Sprint 356 keyring
/// migration once (new install → key born in the keyring; existing plaintext
/// `.key` → migrated into the keyring then retired; headless Linux / locked
/// keychain → explicit disk fallback) and seeds the process master key. On
/// `KeySource::Fatal` (key lost but ciphertext still present) it logs and does
/// NOT seed — the decrypt path then refuses via the #1093 orphan guard, which
/// is the effective safe-mode entry. Returns the outcome so the caller can log
/// / surface the Linux-fallback state.
pub fn boot_wire_master_key() -> Result<key_migration::KeyOutcome, AppError> {
    let dir = key_migration::app_data_dir_for_keyring()?;
    let backend = crypto::OsKeyringBackend::new();
    let outcome = key_migration::migrate_or_initialize(&backend, &dir)?;
    if outcome.is_fatal() {
        error!(
            target: "boot",
            "key_migration: FATAL — master key lost but encrypted passwords present; \
             entering safe mode (decrypt disabled until the key is restored)"
        );
    } else {
        seed_master_key(outcome.key.clone())?;
    }
    Ok(outcome)
}

/// Test-only: clear the seeded master key so a subsequent storage call falls
/// back to the on-disk `.key` path. Keeps the global isolated between tests.
#[cfg(test)]
pub(crate) fn reset_master_key_for_test() {
    *MASTER_KEY.lock().expect("master key mutex poisoned") = None;
}

/// #1454 (P2-6) — test-only data-directory override. Honored ONLY in debug
/// builds; in release it is compiled out (`None`), so a shipped binary can never
/// be redirected to an attacker-chosen data dir via `TABLE_VIEW_TEST_DATA_DIR`
/// (bypassing app-data confinement, the master `.key`, and connections.json).
/// Every data-dir resolver (`storage::app_data_dir`, `storage::local::app_data_dir`,
/// `key_migration::app_data_dir_for_keyring`) routes through this one gate.
#[cfg(debug_assertions)]
pub(crate) fn data_dir_override() -> Option<PathBuf> {
    std::env::var_os("TABLE_VIEW_TEST_DATA_DIR").map(PathBuf::from)
}

#[cfg(not(debug_assertions))]
pub(crate) fn data_dir_override() -> Option<PathBuf> {
    None
}

fn app_data_dir() -> Result<PathBuf, AppError> {
    if let Some(dir) = data_dir_override() {
        fs::create_dir_all(&dir)?;
        return Ok(dir);
    }
    let dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| AppError::Storage("Cannot determine app data directory".into()))?;
    let dir = dir.join("table-view");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn storage_file_path() -> Result<PathBuf, AppError> {
    Ok(app_data_dir()?.join("connections.json"))
}

/// Load storage from disk WITHOUT decrypting passwords. Each connection's
/// `password` field still holds the on-disk ciphertext (or "" when no
/// password is set). Use this when a function will not return password data
/// to its caller — passing through ciphertext is safer than decrypting and
/// re-encrypting (and avoids changing nonces unnecessarily).
fn load_storage_raw() -> Result<StorageData, AppError> {
    let path = storage_file_path()?;
    if !path.exists() {
        info!("Storage file not found, creating default");
        let default = StorageData {
            connections: vec![],
            groups: vec![],
        };
        save_storage_raw(&default)?;
        return Ok(default);
    }

    let content = fs::read_to_string(&path)?;
    let data: StorageData = match serde_json::from_str(&content) {
        Ok(data) => data,
        Err(parse_err) => {
            // Corrupt JSON: a Serde error here would force the user to lose
            // all stored connections. Quarantine the file and start clean
            // so the user keeps a recoverable backup on disk and the app
            // remains usable.
            let backup = quarantine_corrupt_storage(&path)?;
            warn!(
                "connections.json failed to parse ({}); quarantined to {} and starting with empty storage",
                parse_err,
                backup.display()
            );
            let default = StorageData {
                connections: vec![],
                groups: vec![],
            };
            save_storage_raw(&default)?;
            default
        }
    };
    debug!("Loaded {} connections (raw)", data.connections.len());
    Ok(data)
}

/// Move a corrupt storage file aside with a timestamped suffix so the user
/// can inspect / recover it manually and the app can boot clean. Returns the
/// quarantine path on success.
fn quarantine_corrupt_storage(path: &std::path::Path) -> Result<PathBuf, AppError> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut backup = path.to_path_buf();
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("connections.json");
    backup.set_file_name(format!("{file_name}.corrupt-{ts}"));
    fs::rename(path, &backup)?;
    Ok(backup)
}

/// Save storage to disk WITHOUT re-encrypting passwords. Each connection's
/// `password` field MUST already contain ciphertext (or be empty).
///
/// Atomic write: write into a sibling tempfile, fsync, then rename. A crash
/// mid-write therefore never leaves a half-written connections.json.
/// On Unix the 0600 mode is applied at create time so the data never lives
/// in a world-readable file even momentarily.
fn save_storage_raw(data: &StorageData) -> Result<(), AppError> {
    let path = storage_file_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Storage("Storage path has no parent directory".into()))?;
    let json = serde_json::to_string_pretty(data)?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp_path = parent.join(format!(
        "connections.json.tmp.{}.{}",
        std::process::id(),
        nanos
    ));

    {
        let mut opts = fs::OpenOptions::new();
        opts.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp_path)?;
        use std::io::Write;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }

    if let Err(e) = fs::rename(&tmp_path, &path) {
        let _ = fs::remove_file(&tmp_path); // best-effort: leave no orphan
        return Err(e.into());
    }

    debug!("Saved {} connections (raw)", data.connections.len());
    Ok(())
}

/// Acquire the storage lock and load data. The caller must hold the lock
/// for the entire load-modify-save cycle.
fn with_lock<F, T>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError>,
{
    let _guard = STORAGE_LOCK
        .lock()
        .map_err(|e| AppError::Storage(format!("Storage lock error: {}", e)))?;
    f()
}

// --- Public API (each acquires STORAGE_LOCK to prevent TOCTOU) ---

/// Load storage with passwords cleared. Each `ConnectionConfig.password` is
/// returned as an empty string regardless of whether one is stored on disk.
/// Use this for any path that ends in IPC/HTTP/file output.
pub fn load_storage_redacted() -> Result<StorageData, AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;
        for conn in &mut data.connections {
            conn.password.clear();
        }
        Ok(data)
    })
}

/// Load storage with passwords decrypted. Use ONLY when a real database
/// connection is about to be made; never expose the result to the frontend.
pub fn load_storage_with_secrets() -> Result<StorageData, AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;
        let key = master_key()?;
        for conn in &mut data.connections {
            if !conn.password.is_empty() {
                conn.password = crypto::decrypt(&conn.password, &key)?;
            }
        }
        Ok(data)
    })
}

/// Returns whether each connection currently has a stored password,
/// indexed by connection id. Cheap (no decryption performed).
pub fn password_presence_map() -> Result<std::collections::HashMap<String, bool>, AppError> {
    with_lock(|| {
        let data = load_storage_raw()?;
        Ok(data
            .connections
            .into_iter()
            .map(|c| (c.id, !c.password.is_empty()))
            .collect())
    })
}

/// Decrypt the password for a single connection. Returns:
/// - `Ok(None)` when the connection does not exist
/// - `Ok(Some(""))` when the connection exists with no password
/// - `Ok(Some(plaintext))` when the connection has a stored password
pub fn get_decrypted_password(id: &str) -> Result<Option<String>, AppError> {
    with_lock(|| {
        let data = load_storage_raw()?;
        let conn = data.connections.iter().find(|c| c.id == id);
        match conn {
            None => Ok(None),
            Some(c) if c.password.is_empty() => Ok(Some(String::new())),
            Some(c) => {
                let key = master_key()?;
                Ok(Some(crypto::decrypt(&c.password, &key)?))
            }
        }
    })
}

/// Save a connection. `new_password` semantics:
/// - `None`     → preserve the existing ciphertext (or empty for new ids)
/// - `Some("")` → explicitly clear the password
/// - `Some(s)`  → encrypt `s` and store
pub fn save_connection(
    mut conn: ConnectionConfig,
    new_password: Option<String>,
) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

        // Check for duplicate name
        if data
            .connections
            .iter()
            .any(|c| c.id != conn.id && c.name == conn.name)
        {
            return Err(AppError::Validation(format!(
                "Connection with name '{}' already exists",
                conn.name
            )));
        }

        // Resolve the encrypted password to persist
        let encrypted = match new_password {
            Some(s) if !s.is_empty() => {
                let key = master_key()?;
                crypto::encrypt(&s, &key)?
            }
            Some(_) => String::new(),
            None => data
                .connections
                .iter()
                .find(|c| c.id == conn.id)
                .map(|c| c.password.clone())
                .unwrap_or_default(),
        };
        conn.password = encrypted;

        if let Some(existing) = data.connections.iter_mut().find(|c| c.id == conn.id) {
            *existing = conn;
        } else {
            data.connections.push(conn);
        }

        save_storage_raw(&data)
    })
}

pub fn delete_connection(id: &str) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;
        let initial_len = data.connections.len();
        data.connections.retain(|c| c.id != id);

        if data.connections.len() == initial_len {
            return Err(AppError::NotFound(format!("Connection '{}' not found", id)));
        }

        save_storage_raw(&data)
    })
}

pub fn save_group(group: ConnectionGroup) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

        if let Some(existing) = data.groups.iter_mut().find(|g| g.id == group.id) {
            *existing = group;
        } else {
            data.groups.push(group);
        }

        save_storage_raw(&data)
    })
}

pub fn delete_group(id: &str) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

        let initial_len = data.groups.len();
        data.groups.retain(|g| g.id != id);
        if data.groups.len() == initial_len {
            return Err(AppError::NotFound(format!("Group '{}' not found", id)));
        }

        // Move connections from deleted group to root
        for conn in &mut data.connections {
            if conn.group_id.as_deref() == Some(id) {
                conn.group_id = None;
            }
        }

        save_storage_raw(&data)
    })
}

pub fn move_connection_to_group(
    connection_id: &str,
    group_id: Option<&str>,
) -> Result<(), AppError> {
    with_lock(|| {
        let mut data = load_storage_raw()?;

        let conn = data
            .connections
            .iter_mut()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| {
                AppError::NotFound(format!("Connection '{}' not found", connection_id))
            })?;

        conn.group_id = group_id.map(String::from);
        save_storage_raw(&data)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionConfig, ConnectionGroup, DatabaseType};
    use serial_test::serial;
    use tempfile::TempDir;

    /// Helper: set up a temp directory as the test data dir.
    /// Returns the TempDir which must be kept alive for the duration of the test.
    fn setup_test_env() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        dir
    }

    fn cleanup_test_env() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    // Issue #1454 (P2-6) — the `TABLE_VIEW_TEST_DATA_DIR` override is honored in
    // debug builds (test isolation) but must be compiled out in release so a
    // shipped binary can never be redirected to an attacker-chosen data dir.
    // The release branch (`None`) is guaranteed at compile time by
    // `cfg(debug_assertions)`; a debug-mode `cargo test` cannot observe it, so
    // we only assert the debug behavior here.
    #[cfg(debug_assertions)]
    #[test]
    #[serial]
    fn data_dir_override_honors_env_in_debug() {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        assert_eq!(data_dir_override(), Some(dir.path().to_path_buf()));
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    /// Test helper: previous-style save that treats the conn.password field
    /// as the source of truth for the new password. Equivalent to the old
    /// single-arg `save_connection`.
    fn save_conn(conn: ConnectionConfig) -> Result<(), AppError> {
        let pw = Some(conn.password.clone());
        save_connection(conn, pw)
    }

    fn load_storage() -> Result<StorageData, AppError> {
        load_storage_with_secrets()
    }

    fn sample_connection(id: &str, name: &str) -> ConnectionConfig {
        ConnectionConfig {
            id: id.to_string(),
            name: name.to_string(),
            db_type: DatabaseType::Postgresql,
            host: "localhost".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "testpass".to_string(),
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

    fn sample_group(id: &str, name: &str) -> ConnectionGroup {
        ConnectionGroup {
            id: id.to_string(),
            name: name.to_string(),
            color: None,
            collapsed: false,
        }
    }

    // AC-01: load_storage creates default empty storage when file doesn't exist
    #[test]
    #[serial]
    fn test_load_storage_creates_default_when_no_file() {
        let _dir = setup_test_env();

        let data = load_storage().unwrap();
        assert!(data.connections.is_empty());
        assert!(data.groups.is_empty());

        cleanup_test_env();
    }

    // AC-02: save_connection adds new connection and can load it back
    #[test]
    #[serial]
    fn test_save_connection_adds_new_and_loads_back() {
        let _dir = setup_test_env();

        let conn = sample_connection("c1", "MyDB");
        save_conn(conn.clone()).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, "c1");
        assert_eq!(loaded.connections[0].name, "MyDB");
        assert_eq!(loaded.connections[0].host, "localhost");
        assert_eq!(loaded.connections[0].port, 5432);

        cleanup_test_env();
    }

    // AC-03: save_connection updates existing connection by id
    #[test]
    #[serial]
    fn test_save_connection_updates_existing_by_id() {
        let _dir = setup_test_env();

        let conn = sample_connection("c1", "MyDB");
        save_conn(conn).unwrap();

        let mut updated = sample_connection("c1", "MyDB Updated");
        updated.port = 3306;
        updated.host = "newhost".to_string();
        save_conn(updated).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].name, "MyDB Updated");
        assert_eq!(loaded.connections[0].port, 3306);
        assert_eq!(loaded.connections[0].host, "newhost");

        cleanup_test_env();
    }

    // AC-04: save_connection rejects duplicate name (different id, same name)
    #[test]
    #[serial]
    fn test_save_connection_rejects_duplicate_name() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "MyDB")).unwrap();

        let result = save_conn(sample_connection("c2", "MyDB"));
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("already exists"));
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        // Verify original connection is still intact
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, "c1");

        cleanup_test_env();
    }

    // AC-05: delete_connection removes connection by id
    #[test]
    #[serial]
    fn test_delete_connection_removes_by_id() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();

        delete_connection("c1").unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].id, "c2");
        assert_eq!(loaded.connections[0].name, "DB2");

        cleanup_test_env();
    }

    // AC-06: delete_connection returns NotFound for non-existent id
    #[test]
    #[serial]
    fn test_delete_connection_not_found_for_missing_id() {
        let _dir = setup_test_env();

        let result = delete_connection("nonexistent");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("nonexistent"));
            }
            other => panic!("Expected NotFound error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    // AC-07: password encryption/decryption roundtrip
    #[test]
    #[serial]
    fn test_password_roundtrip_encrypted() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "MyDB");
        conn.password = "pwd_tst".to_string();
        save_conn(conn).unwrap();

        // Verify password is NOT stored in plaintext in the file
        let data_dir = std::env::var("TABLE_VIEW_TEST_DATA_DIR").unwrap();
        let raw = std::fs::read_to_string(std::path::Path::new(&data_dir).join("connections.json"))
            .unwrap();
        assert!(
            !raw.contains("pwd_tst"),
            "Password should not appear in plaintext in storage file"
        );

        // Verify loading decrypts the password correctly
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].password, "pwd_tst");

        cleanup_test_env();
    }

    // AC-08: save_group adds and updates groups
    #[test]
    #[serial]
    fn test_save_group_adds_and_updates() {
        let _dir = setup_test_env();

        // Add a group
        save_group(sample_group("g1", "Production")).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.groups.len(), 1);
        assert_eq!(loaded.groups[0].id, "g1");
        assert_eq!(loaded.groups[0].name, "Production");

        // Update the group
        let updated_group = ConnectionGroup {
            id: "g1".to_string(),
            name: "Production Updated".to_string(),
            color: Some("#ff0000".to_string()),
            collapsed: true,
        };
        save_group(updated_group).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.groups.len(), 1);
        assert_eq!(loaded.groups[0].name, "Production Updated");
        assert_eq!(loaded.groups[0].color, Some("#ff0000".to_string()));
        assert!(loaded.groups[0].collapsed);

        cleanup_test_env();
    }

    // AC-09: delete_group moves orphaned connections to root
    #[test]
    #[serial]
    fn test_delete_group_moves_orphaned_connections_to_root() {
        let _dir = setup_test_env();

        save_group(sample_group("g1", "Group1")).unwrap();

        let mut conn = sample_connection("c1", "DB1");
        conn.group_id = Some("g1".to_string());
        save_conn(conn).unwrap();

        delete_group("g1").unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.groups.len(), 0);
        assert_eq!(loaded.connections.len(), 1);
        assert_eq!(loaded.connections[0].group_id, None);

        cleanup_test_env();
    }

    // AC-10: move_connection_to_group changes group_id
    #[test]
    #[serial]
    fn test_move_connection_to_group_changes_group() {
        let _dir = setup_test_env();

        save_group(sample_group("g1", "Group1")).unwrap();
        save_conn(sample_connection("c1", "DB1")).unwrap();

        // Move to group
        move_connection_to_group("c1", Some("g1")).unwrap();
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].group_id, Some("g1".to_string()));

        // Move back to root
        move_connection_to_group("c1", None).unwrap();
        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].group_id, None);

        cleanup_test_env();
    }

    // Additional: move_connection_to_group returns NotFound for missing connection
    #[test]
    #[serial]
    fn test_move_connection_to_group_not_found() {
        let _dir = setup_test_env();

        let result = move_connection_to_group("nonexistent", Some("g1"));
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("nonexistent"));
            }
            other => panic!("Expected NotFound error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    // Additional: delete_group returns NotFound for non-existent group
    #[test]
    #[serial]
    fn test_delete_group_not_found() {
        let _dir = setup_test_env();

        let result = delete_group("nonexistent");
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(msg) => {
                assert!(msg.contains("nonexistent"));
            }
            other => panic!("Expected NotFound error, got: {:?}", other),
        }

        cleanup_test_env();
    }

    // Additional: empty password is not encrypted
    #[test]
    #[serial]
    fn test_save_connection_empty_password_not_encrypted() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "MyDB");
        conn.password = String::new();
        save_conn(conn).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections[0].password, "");

        cleanup_test_env();
    }

    // Additional: multiple connections can be saved and all loaded back
    #[test]
    #[serial]
    fn test_save_multiple_connections() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "DB1")).unwrap();
        save_conn(sample_connection("c2", "DB2")).unwrap();
        save_conn(sample_connection("c3", "DB3")).unwrap();

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 3);

        cleanup_test_env();
    }

    // -------------------------------------------------------------------
    // Phase B password security
    // -------------------------------------------------------------------

    /// load_storage_redacted must NEVER return decrypted plaintext.
    #[test]
    #[serial]
    fn test_load_storage_redacted_omits_plaintext() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "noleak".into();
        save_conn(conn).unwrap();

        let data = load_storage_redacted().unwrap();
        for c in &data.connections {
            assert!(
                !c.password.contains("noleak"),
                "Plaintext leaked from load_storage_redacted: {}",
                c.password
            );
            assert!(c.password.is_empty(), "Redacted password must be empty");
        }

        cleanup_test_env();
    }

    /// load_storage_with_secrets must round-trip plaintext correctly.
    #[test]
    #[serial]
    fn test_load_storage_with_secrets_decrypts() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "rtrip".into();
        save_conn(conn).unwrap();

        let data = load_storage_with_secrets().unwrap();
        assert_eq!(data.connections[0].password, "rtrip");

        cleanup_test_env();
    }

    /// save_connection with `None` preserves the existing ciphertext (and the
    /// decrypted plaintext when read back).
    #[test]
    #[serial]
    fn test_save_connection_with_none_preserves_existing() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "alpha".into();
        save_conn(conn).unwrap();

        // Save again with `None`: should keep the existing password
        let mut updated = sample_connection("c1", "DB1 renamed");
        updated.password = String::new(); // value is irrelevant when None
        save_connection(updated, None).unwrap();

        let data = load_storage_with_secrets().unwrap();
        assert_eq!(data.connections[0].password, "alpha");
        assert_eq!(data.connections[0].name, "DB1 renamed");

        cleanup_test_env();
    }

    /// password_presence_map reports has-password without decrypting.
    #[test]
    #[serial]
    fn test_password_presence_map_reports_correctly() {
        let _dir = setup_test_env();

        let mut with = sample_connection("c1", "DB1");
        with.password = "yes".into();
        save_conn(with).unwrap();

        let mut without = sample_connection("c2", "DB2");
        without.password = String::new();
        save_conn(without).unwrap();

        let map = password_presence_map().unwrap();
        assert_eq!(map.get("c1"), Some(&true));
        assert_eq!(map.get("c2"), Some(&false));

        cleanup_test_env();
    }

    /// get_decrypted_password returns the right plaintext for the right id.
    #[test]
    #[serial]
    fn test_get_decrypted_password_returns_plaintext() {
        let _dir = setup_test_env();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "lkpw".into();
        save_conn(conn).unwrap();

        let pw = get_decrypted_password("c1").unwrap();
        assert_eq!(pw, Some("lkpw".to_string()));

        let missing = get_decrypted_password("nope").unwrap();
        assert_eq!(missing, None);

        cleanup_test_env();
    }

    // Additional: updating same-name same-id connection succeeds
    #[test]
    #[serial]
    fn test_save_connection_same_name_same_id_succeeds() {
        let _dir = setup_test_env();

        save_conn(sample_connection("c1", "MyDB")).unwrap();

        // Same id and same name should succeed (it's an update)
        let updated = sample_connection("c1", "MyDB");
        let result = save_conn(updated);
        assert!(result.is_ok());

        let loaded = load_storage().unwrap();
        assert_eq!(loaded.connections.len(), 1);

        cleanup_test_env();
    }

    // -------------------------------------------------------------------
    // #1103 — master-key wiring: storage secret paths read the boot-seeded
    // keyring key instead of the disk `.key`.
    // -------------------------------------------------------------------

    /// When a key is seeded (as boot does from the keyring outcome), saving a
    /// connection encrypts under that key and never touches the disk `.key`.
    #[test]
    #[serial]
    fn seeded_master_key_is_used_and_no_disk_key_written() {
        let dir = setup_test_env();
        seed_master_key((7..39u8).collect()).unwrap();
        // Use whatever is actually seeded (robust to global state ordering).
        let effective = master_key().unwrap();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "sekret".into();
        save_conn(conn).unwrap();

        // No disk `.key` — the master key came from the (mocked-at-boot) seed.
        assert!(
            !dir.path().join(".key").exists(),
            "seeded key path must not create a disk .key"
        );

        // The persisted ciphertext decrypts under the seeded key.
        let raw = fs::read_to_string(dir.path().join("connections.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let enc = parsed["connections"][0]["password"].as_str().unwrap();
        assert_eq!(crypto::decrypt(enc, &effective).unwrap(), "sekret");

        reset_master_key_for_test();
        cleanup_test_env();
    }

    /// P3-3 (#1455) — `master_key()` hands back a [`Zeroizing`] buffer (so the
    /// clone is wiped on drop) that still round-trips the seeded key value.
    #[test]
    #[serial]
    fn master_key_is_zeroizing_and_round_trips_seed() {
        let _dir = setup_test_env();
        let seed: Vec<u8> = (7..39u8).collect();
        seed_master_key(seed.clone()).unwrap();

        let key: Zeroizing<Vec<u8>> = master_key().unwrap();
        assert_eq!(
            &*key, &seed,
            "seeded key must survive the Zeroizing wrapper"
        );

        reset_master_key_for_test();
        cleanup_test_env();
    }

    /// With no seed (the pre-#1103 / unit path), storage falls back to the
    /// disk `.key`, which is created on first secret write.
    #[test]
    #[serial]
    fn unseeded_master_key_falls_back_to_disk_key() {
        let dir = setup_test_env();
        reset_master_key_for_test();

        let mut conn = sample_connection("c1", "DB1");
        conn.password = "ondisk".into();
        save_conn(conn).unwrap();

        assert!(
            dir.path().join(".key").exists(),
            "unseeded path must fall back to the disk .key"
        );
        let loaded = load_storage_with_secrets().unwrap();
        assert_eq!(loaded.connections[0].password, "ondisk");

        cleanup_test_env();
    }

    // C5 (audit 2026-05-05): corrupt JSON must not destroy user data.
    // Quarantine the bad file with a timestamped suffix and start clean,
    // so the user can recover manually instead of losing every saved
    // connection.
    #[test]
    #[serial]
    fn test_load_storage_quarantines_corrupt_file_and_returns_empty() {
        let dir = setup_test_env();
        let path = dir.path().join("connections.json");
        fs::write(&path, b"{ this is not valid json }").unwrap();

        let data = load_storage_redacted().unwrap();
        assert!(
            data.connections.is_empty(),
            "should boot empty after corruption"
        );
        assert!(data.groups.is_empty());

        // Quarantine artifact must exist with the expected prefix.
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            entries
                .iter()
                .any(|n| n.starts_with("connections.json.corrupt-")),
            "quarantined backup not found in {entries:?}"
        );

        cleanup_test_env();
    }
}
